# Recall core architecture brief

Source of truth: `PRD.md` (draft v0.1, 2026-06-20)

## 1) Locked v1 scope

`recall` is a local-first terminal app that indexes coding-agent session transcripts from disk, supports hybrid natural-language search across providers, and returns a copyable resume command.

Locked decisions from the PRD:
- **Stack:** Node + TypeScript, Ink TUI, `better-sqlite3`, `sqlite-vec`, Voyage embeddings, `chokidar`, `clipboardy`.
- **Providers in v1:** local **Claude Code** (CLI + IDE sessions in same store), **Codex**, **pi**.
- **Primary action:** print + copy resume command; **no exec handoff** in v1.
- **Search:** hybrid **FTS5 + vector KNN**, fused with **RRF** and boosted by recency/current repo/title match.
- **Storage:** local SQLite index at `~/.local/share/recall/index.db`; config at `~/.config/recall/config.json`.
- **Out of scope:** cloud claude.ai sessions, GUI/web, replay/edit/merge, team sync.

---

## 2) Recommended package/module boundaries

Keep provider-specific parsing isolated from indexing, search, and UI.

```text
src/
├─ adapters/
│  ├─ types.ts          # SessionAdapter contract + provider parse types
│  ├─ claude.ts         # Claude discovery + parsing + resume/fork commands
│  ├─ codex.ts          # Codex discovery + parsing + resume/fork commands
│  └─ pi.ts             # pi discovery + parsing + resume/fork commands
├─ domain/
│  ├─ session.ts        # normalized Session shape
│  ├─ query.ts          # parsed query + filter token types
│  └─ result.ts         # ranked search result / preview snippet types
├─ index/
│  ├─ discover.ts       # adapter fan-out, glob orchestration
│  ├─ parse.ts          # stream JSONL reading helpers
│  ├─ normalize.ts      # title synthesis, repo derivation, timestamps, surface
│  ├─ clean.ts          # strip system prompts/tool payloads/base instructions
│  ├─ chunk.ts          # ~512-token chunking + overlap + chunk cap policy
│  ├─ embed.ts          # Voyage batching + hash cache
│  ├─ manifest.ts       # path/size/mtime/hash incremental state
│  └─ store.ts          # SQLite schema, inserts, updates, deletes
├─ search/
│  ├─ parseQuery.ts     # inline filter extraction
│  ├─ fts.ts            # BM25 retrieval + highlighting
│  ├─ vector.ts         # query embedding + chunk KNN + session aggregation
│  ├─ fuse.ts           # RRF implementation
│  ├─ rank.ts           # recency/current-repo/title/subagent penalties
│  └─ snippets.ts       # choose preview snippet from FTS or nearest chunk
├─ launch/
│  ├─ resume.ts         # per-provider command templates
│  ├─ validate.ts       # cwd exists / CLI on PATH / fallback warnings
│  └─ clipboard.ts      # copy to pbcopy/clipboardy
├─ tui/
│  ├─ App.tsx
│  ├─ Input.tsx
│  ├─ ResultList.tsx
│  ├─ Preview.tsx
│  └─ Help.tsx
├─ config/
│  ├─ config.ts         # load/merge defaults + env + config file
│  └─ doctor.ts         # health checks
└─ cli.ts               # commands: recall/index/search/sync/watch/doctor/config
```

Boundary rules:
- **Adapters only normalize provider data**. They should not know about SQLite schema, ranking, or TUI.
- **Index layer owns durable search inputs**: cleaned body text, chunks, embeddings, manifest state.
- **Search layer reads only from SQLite**. No raw transcript reads during interactive search.
- **Launch layer is provider-agnostic** except for command templates.
- **TUI is a thin consumer** of search APIs and launch actions.

---

## 3) Canonical domain shapes

### Normalized session
Use the PRD’s `Session` as the canonical cross-provider record:

```ts
interface Session {
  uid: string;            // `${provider}:${nativeId}`
  provider: 'claude' | 'codex' | 'pi';
  nativeId: string;
  surface: 'cli' | 'ide' | 'desktop' | 'subagent' | 'cloud';
  cwd: string;
  repo: string | null;
  branch: string | null;
  title: string;
  titleSource: 'native' | 'synthesized';
  firstPrompt: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  models: string[];
  isSubagent: boolean;
  transcriptPaths: string[];
  resumeCmd: string;
  bytes: number;
}
```

### Provider adapter contract
This is the main extensibility boundary:

```ts
interface SessionAdapter {
  id: 'claude' | 'codex' | 'pi' | string;
  discover(): AsyncIterable<string>;
  parse(path: string): Promise<ParsedSession>;
  buildResumeCmd(s: Session): string;
  buildForkCmd?(s: Session): string | null;
}
```

Implementation note: `ParsedSession` should minimally contain:
- normalized `Session` fields except derived launch text if preferred,
- cleaned searchable body text,
- chunk source text,
- parse warnings/diagnostics.

That shape is **not explicitly fixed by the PRD**, so treat it as an internal contract.

---

## 4) Provider adapter responsibilities

### Claude adapter
Input:
- `~/.claude/projects/*/*.jsonl`

Rules:
- Use native `ai-title` record for `title` when present.
- Read `cwd`, `gitBranch`, timestamps from records.
- If `cwd` is absent, fallback to decoding the encoded cwd directory name.
- Claude IDE sessions are already covered because they share this local store.
- Resume command: `cd <cwd> && claude --resume <id>`.

### Codex adapter
Input:
- `~/.codex/sessions/**/rollout-*.jsonl`

Rules:
- Parse actual rollout JSONL files; **do not rely on** `session_index.jsonl` because it is stale/incomplete.
- Read metadata from `session_meta.payload`.
- Map `source` to `surface` (`cli`/`vscode`→`ide` as needed).
- Mark `isSubagent` from `thread_source: subagent`.
- Extract searchable text from `response_item` / message content.
- Hard exclude `~/.codex/logs_2.sqlite` and any telemetry files.
- Resume command: `cd <cwd> && codex resume <id>`.
- Fork command: `cd <cwd> && codex fork <id>`.

### pi adapter
Input:
- `~/.pi/agent/sessions/**/*.jsonl`
- nested `**/run-*/session.jsonl`

Rules:
- Support both flat and nested layouts.
- There is no stored title; synthesize from first user message.
- Mark board/view/hackerclaw/run-history-style noise as subagent/filterable where appropriate.
- Resume id is the session `id` from transcript data.
- Resume command: `cd <cwd> && pi --session <id>` with fallback `pi --session-id <id>`.
- Fork command: `cd <cwd> && pi --fork <id>` where supported.

Cross-provider invariant:
- Adapters must emit enough normalized data that the rest of the app never needs provider-specific branching except when building commands.

---

## 5) Runtime flows

### A. Full / cold indexing flow
1. Load config and enabled providers.
2. Each adapter discovers transcript paths.
3. Skip excluded files/directories up front.
4. For each file, compare against manifest `(path, size, mtime, hash)` unless `--full`.
5. Stream-parse JSONL line by line.
6. Normalize:
   - `nativeId`, `cwd`, `repo`, `branch`, timestamps, surface, message count, models.
   - title: native if present, else synthesized from first user message.
   - searchable text: concatenate user + assistant text only.
7. Clean text:
   - strip tool-call payloads,
   - strip system prompts/base instructions,
   - avoid embedding obvious secret patterns.
8. Chunk cleaned body into ~512-token windows with overlap.
9. Enforce chunk cap (example from PRD: 40/session), favoring first + last + densest chunks.
10. Embed uncached chunks via Voyage.
11. Persist session row, FTS row, chunk rows, vector rows, manifest updates, embed cache.

### B. Incremental sync on app launch
1. Start TUI using existing DB immediately.
2. Kick off background incremental sync.
3. Refresh results when new/updated sessions are committed.
4. Keep this non-blocking; first paint must not wait for embedding work.

### C. Search flow
1. Parse inline filters from query:
   - `provider:`, `repo:`, `branch:`, `surface:`, `since:`, `until:`, `include:subagents`.
2. Apply filters as hard pre-filters.
3. Run in parallel:
   - **FTS5/BM25** over `title`, `first_prompt`, `body`.
   - **Vector KNN** over embedded chunks.
4. Aggregate vector hits to session via **max chunk similarity**.
5. Fuse lists with **RRF**.
6. Apply boosts/penalties:
   - recency decay,
   - current cwd/repo boost,
   - exact title substring boost,
   - subagent penalty,
   - very short session penalty.
7. Return top-N with best snippet for preview.

### D. Selection / launch flow
1. Build provider-specific resume command.
2. Validate:
   - cwd exists,
   - CLI exists on PATH.
3. On `Enter`, print full command to stdout and copy it to clipboard.
4. Exit `0` even if warnings exist; warnings should be shown before exit.

### E. Headless mode
- `recall search "<q>" --json` should use the exact same search pipeline and ranking logic as the TUI.

---

## 6) Persistence layout

### Filesystem
Inputs:
- `~/.claude/projects/...`
- `~/.codex/sessions/...`
- `~/.pi/agent/sessions/...`

Outputs:
- `~/.config/recall/config.json`
- `~/.local/share/recall/index.db`

Permissions/security:
- Config and DB should be user-only (`0600`) per PRD.

### SQLite responsibilities
- `sessions`: canonical per-session metadata.
- `sessions_fts`: keyword retrieval index over title/first prompt/body.
- `chunks`: chunk text + ordering + session ownership.
- `chunks_vec`: vector index for chunk embeddings.
- `manifest`: incremental file-state tracking.
- `embed_cache`: hash-based embedding reuse.

Recommended relation model:
- `sessions.uid` is the stable cross-provider key.
- `chunks.uid` links chunks to a session.
- `chunks_vec` should map 1:1 to `chunks` rows; simplest implementation is shared `rowid`/chunk id alignment.

The PRD’s schema sketch is sufficient for v1; do not add provider-specific tables unless a format truly cannot normalize.

---

## 7) Config and env handling

Minimum configuration needed by workers:
- **Voyage API key**: env or config, never logged.
- **Enabled providers** and provider root paths.
- **Index/config paths**.
- **Chunking/embedding settings**: model, chunk size, overlap, max chunks/session.
- **Search defaults**: include/exclude subagents, result limit, current repo boost.
- **Privacy settings**: redaction on/off, secret-pattern skip rules.

Assumed precedence (not explicitly locked by PRD, but recommended):
1. CLI flags
2. Environment variables
3. `~/.config/recall/config.json`
4. Built-in defaults

`recall doctor` should verify:
- provider directories exist,
- `claude` / `codex` / `pi` CLIs are on PATH,
- Voyage key exists for semantic search,
- DB is readable/writable,
- vector extension loads successfully.

---

## 8) Key technical decisions workers should honor

- **Local-first, single-machine design**: no remote session dependency in v1.
- **Stream parsing only**: do not load large JSONL transcripts fully into memory.
- **Do not index telemetry/non-session files**: especially Codex `logs_2.sqlite`.
- **Native title first, synthesized fallback second**.
- **Search on cleaned conversational content only**: user + assistant text, not raw tool payload noise.
- **Chunk-level embeddings, session-level ranking**: retrieve at chunk granularity, surface at session granularity.
- **Hybrid retrieval is mandatory** for v1 quality; keyword-only is Phase 0/spike only.
- **Hide subagents by default**: they are part of the corpus but should not dominate results.
- **Resume command generation is deterministic and stored/derived from normalized metadata**.
- **Background sync must not block TUI first paint**.
- **Reuse `codesift` Voyage/sqlite-vec plumbing if practical**, but keep recall’s provider/index/search interfaces independent.

---

## 9) Assumptions and edge cases

### Assumptions
These are useful implementation assumptions, but only the PRD should override them:
- If Voyage or `sqlite-vec` is unavailable, the app should degrade to **FTS-only** search with a visible warning rather than hard fail.
- A query with filters but no free-text should return the filtered set ranked mainly by recency.
- `repo` should be derived from git-root basename when possible; otherwise fallback to cwd basename/subpath heuristics.

### Edge cases to handle explicitly
- **Missing/invalid cwd**: still index; warn at launch time.
- **Deleted worktree**: still copy the resume command, but flag that cwd no longer exists.
- **Missing title**: synthesize from first user message; truncate and clean.
- **Very short or empty sessions**: index metadata, penalize ranking, possibly no embeddings.
- **pi nested layouts**: one logical session may reference multiple transcript paths.
- **Codex stale title index**: never trust `session_index.jsonl` as canonical.
- **Provider id collisions**: avoid with `uid = ${provider}:${nativeId}`.
- **Secrets in transcripts**: skip/ redact obvious secret patterns before embedding.
- **Cloud Claude artifacts**: ignore `~/.claude/tasks/<id>/` in v1; they are not full transcripts.
- **Subagent noise**: preserve in DB for opt-in searches, but exclude by default.

---

## 10) Practical build order

1. Domain types + adapter contract.
2. Provider discovery/parsing fixtures for Claude/Codex/pi.
3. SQLite schema + full indexer + FTS-only search.
4. Text cleaning + title synthesis + subagent filtering.
5. Chunking + embed cache + Voyage + sqlite-vec.
6. Hybrid ranking + snippets.
7. Ink TUI + launch/copy flow.
8. Incremental sync + doctor/config.

This keeps Phase 0 and Phase 1 aligned with the PRD roadmap while preserving the correct boundaries for later providers and cloud adapters.
