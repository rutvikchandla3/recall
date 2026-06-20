# Recall — Unified Natural-Language Search & Resume for Coding Agent Sessions

> **Status:** Draft v0.1 (PRD) · **Date:** 2026-06-20 · **Owner:** Rutvik
> **Working name:** `recall` (placeholder — rename freely)
> **One-liner:** One TUI to search every coding-agent session you've ever run, in plain English, and jump straight back into the right one.

---

## 1. TL;DR

You run 40–50 coding agents a day across Claude Code, Codex, and pi. Today there are **~1,700 sessions already on disk** and growing. When you need to find *"where did I build the pi-delegate ranking?"* you brute-force it: open each tool's native picker (`claude --resume`, `codex resume`, `pi -r`), squint at recency-ordered titles, and resume blindly to check. There is **no content-aware, cross-tool, natural-language search**.

`recall` is a single terminal app that:

1. **Indexes** every session from every agent into one local store (metadata + full-text + embeddings).
2. Lets you **ask in natural language** ("where did I wire up the Voyage embeddings?") and ranks matches across *all* tools with a hybrid semantic + keyword engine.
3. Shows a **dropdown TUI** with provider badge, repo/branch, time, and the matching snippet.
4. On select, **prints + copies the exact resume command** (`cd <cwd> && claude --resume <id>`) so you paste and you're back in that conversation.

**v1 scope (decided):** TypeScript + Ink · hybrid search (local embeddings by default, optional Voyage + FTS5) · print/copy resume · local providers only (Claude CLI+IDE, Codex, pi). Cloud agents and exec-handoff are Phase 2+.

---

## 2. Problem

### 2.1 The pain
- **Volume:** 40–50 agents/day × multiple tools. The native pickers only show *one tool's* recent sessions, ordered by recency, keyed by a title (or no title at all). They have no concept of "search by what happened inside."
- **Fragmentation:** Three tools, three storage formats, three resume commands, three mental models. There is no place that knows about all of them at once.
- **No content search:** "Where did I build X" is a *semantic* question about the *content* of a conversation. None of the native tools can answer it — you can only scan titles or resume-and-skim.
- **Cost of a miss:** resuming the wrong session spins up a heavy agent, loads context, and wastes a minute each time. With dozens of candidates, finding one session is a multi-minute archaeology dig.

### 2.2 What's actually on disk (verified 2026-06-20)

| Tool | Count | Location | Title? | Resume |
|---|---|---|---|---|
| **Claude Code** (CLI + IDE) | 468 | `~/.claude/projects/<enc-cwd>/<uuid>.jsonl` | ✅ `ai-title` record | `claude --resume <id>` |
| **Codex** | 131 | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | ⚠️ `session_index.jsonl` (**stale**: 102/131) | `codex resume <id>` |
| **pi** | ~1,116 | `~/.pi/agent/sessions/<enc-cwd>/…` (+ board/view/hackerclaw) | ❌ none — must synthesize | `pi --session <id>` |
| **Total** | **~1,715** | — | mixed | per-tool |

Key facts that shape the design (each independently verified):
- **Claude** sessions carry an LLM-generated `{type:"ai-title", aiTitle, sessionId}` record, plus `cwd`, `gitBranch`, timestamps. IDE-launched sessions (e.g. `…-hackerrank-vscode-copilot-chat`) live in the **same** store, so "IDE" is covered for free.
- **Codex** records are `{timestamp, type, payload}` with `type ∈ {session_meta, event_msg, response_item}`. `session_meta.payload` gives `cwd`, `originator`, `source` (`vscode`/`cli`), and `thread_source` (`subagent` vs main) — so we can tell real sessions from subagent noise. The native title index is **incomplete and lagging**, so we cannot trust it; we scan the files ourselves.
- **pi** has **two on-disk layouts** (flat `<ts>_<uuid>.jsonl` and nested `…/<uuid>/<hash>/run-0/session.jsonl`) and **no stored title** — titles must be synthesized from the first user message. Huge volume; much of it is subagent spam (`agent-board`, `agent-view`, `run-history.jsonl`) that should be filterable.
- **"Cloud" gap:** truly remote claude.ai/code agents are *not* fully on disk — `~/.claude/tasks/<id>/` holds only `.lock`/`.highwatermark`, no transcript. Enumerating those needs the claude.ai API/daemon → **Phase 2**.
- **Do NOT parse** `~/.codex/logs_2.sqlite` (288 MB telemetry) — it's not session data and would blow up indexing.

---

## 3. Goals & Non-Goals

### Goals
- **G1** — Find any past session by natural-language description in **< 15 seconds** (vs minutes today).
- **G2** — Cover Claude (CLI + IDE), Codex, and pi from local disk, in one ranked view.
- **G3** — Hybrid search: semantic ("what was this about") + keyword (exact symbols, file names, error strings).
- **G4** — One keystroke from a result to a ready-to-run resume command.
- **G5** — Stay fresh automatically as 40–50 new sessions land daily.
- **G6** — Pluggable adapters so new agents (Gemini, Cursor, cloud) slot in without touching core.

### Non-Goals (v1)
- ❌ Editing, replaying, or merging sessions — read + locate only.
- ❌ A GUI / web app — TUI only.
- ❌ Taking over the terminal to exec the agent — v1 prints/copies the command (exec/cmux handoff is a later opt-in).
- ❌ Indexing remote claude.ai cloud agents (Phase 2).
- ❌ Team/multi-user sync — single-user, single-machine.

---

## 4. Users & Use Cases

**Primary user:** a power user running many parallel agents across tools (you).

**User stories**
- *"Where did I build the pi-delegate query-aware ranking?"* → top hit is the actual Claude session; copy `claude --resume <id>`.
- *"That Codex run a few days ago in `codesift` about MCP init failing"* → filter `repo:codesift since:3d`, semantic match on "MCP initialization".
- *"The session where I set up VOYAGE_API_KEY"* → keyword nails the exact env var even with no title.
- *"I started something in pi about the Linear OAuth reset but never finished"* → finds the unfinished pi thread, resume to continue.
- *"Show me everything I touched in `ade` this week"* → `repo:ade since:7d`, browse chronologically.

---

## 5. Product Overview (UX)

### 5.1 Flow
```
$ recall
  → (background) incremental sync of new sessions
  → live search box; type natural language
  → ranked dropdown across all tools, with snippets
  → ↑/↓ to highlight, preview pane updates
  → Enter → resume command printed + copied to clipboard → exit
  → paste → you're back in the exact conversation
```

### 5.2 TUI layout (Ink)
```
┌─ recall ────────────────────────────────────────── 1,715 sessions ─┐
│ 🔎  where did I build the voyage embedding indexer                  │
├────────────────────────────────────────────────────────────────────┤
│ ▸ [claude] Improve code shift indexing & querying        codesift   │  ← results
│     2d ago · main · …added Voyage embeddings for chunk-level…  0.91  │     list
│   [codex]  Fix missing VOYAGE_API_KEY env var            codesift   │
│     5d ago · cli  · …export VOYAGE_API_KEY before running…     0.78  │
│   [pi]     (untitled) wire embeddings into recall index  recall     │
│     6d ago · main · …embed chunks with voyage-code-3…         0.72  │
├──────────────────── preview ───────────────────────────────────────┤
│ claude · codesift · branch main · 2026-06-18 · 142 msgs · opus-4.8 │
│ Matched: "…I added Voyage embeddings so each chunk is indexed…"     │
│ Resume:  cd ~/rcode/codesift && claude --resume 76529b5e…           │
├────────────────────────────────────────────────────────────────────┤
│ ↑↓ move  ⏎ copy resume cmd  t transcript  f fork  / filter  ? help │
└────────────────────────────────────────────────────────────────────┘
```

### 5.3 Interactions
- **Type** → live hybrid search (debounced ~120ms).
- **↑/↓** → move selection; preview pane updates with metadata + matched excerpt + resume command.
- **Enter** → print the full `cd … && <resume>` to stdout **and** copy to clipboard (`pbcopy`); exit 0.
- **t** → open the raw transcript in `$PAGER`/`$EDITOR`.
- **f** → copy the *fork* command instead (`codex fork` / `pi --fork`) where supported.
- **y** → copy just the session id.
- **/** or inline tokens → filters (below).
- **?** → keybinding help.

### 5.4 Query filters (inline tokens, parsed out of the NL query)
- `provider:claude|codex|pi`
- `repo:<name>` (matches git-root basename or cwd substring)
- `branch:<name>`
- `surface:cli|ide|desktop|subagent`
- `since:3d|2026-06-01` · `until:…`
- `include:subagents` (off by default — pi/codex subagent threads are hidden)
- everything else = free-text natural-language query.

---

## 6. Functional Requirements

### 6.1 Indexing
- **FR-1** Discover sessions per provider via adapter globs; never parse non-session files (exclude `logs_*.sqlite`, telemetry, locks).
- **FR-2** Incremental by default: a manifest of `(path, size, mtime, content-hash)` skips unchanged files. Full reindex on demand (`--full`).
- **FR-3** Stream-parse JSONL line-by-line (readline) so multi-MB pi/codex files never load fully into memory.
- **FR-4** Extract per session: metadata (see §8) + a cleaned **searchable text** = concatenated user + assistant text, with tool-call payloads, system prompts, and base instructions stripped.
- **FR-5** Chunk searchable text into ~512-token windows (with overlap) for embeddings; cap chunks per session (e.g. 40) to bound cost on giant transcripts — prefer first + last + densest chunks.
- **FR-6** Title resolution: use native title if present (Claude `aiTitle`, Codex `thread_name`); else **synthesize** from the first user message (truncated, cleaned); optionally LLM-titled in a later phase.
- **FR-7** Mark `is_subagent` (Codex `thread_source:subagent`, pi `agent-board`/`agent-view`/`run-*`) and exclude from default results.

### 6.2 Search & ranking (hybrid)
- **FR-8** Two retrievers run in parallel:
  - **Keyword:** SQLite **FTS5** (BM25) over `title` (weight ×3), `first_prompt` (×2), `body`.
  - **Semantic:** embed the query (local Ollama by default, optional Voyage) → **sqlite-vec** KNN over chunk vectors → aggregate to session via max-chunk similarity.
- **FR-9** Fuse the two ranked lists with **Reciprocal Rank Fusion**, then apply boosts:
  - recency (exponential decay), `repo == current cwd` boost, exact-title-substring boost, penalty for `is_subagent` and for very short sessions.
- **FR-10** Return top-N with the **best-matching snippet** (FTS-highlighted span or nearest chunk text) for the preview.
- **FR-11** Honor inline filters (§5.4) as hard pre-filters before ranking.
- **FR-12** Headless mode: `recall search "<q>" --json` returns the ranked results for scripting / future MCP.

### 6.3 Resume / launch (print-and-copy)
- **FR-13** Build the resume command from the per-provider template and the session's `cwd`:
  - Claude → `cd <cwd> && claude --resume <id>`
  - Codex → `cd <cwd> && codex resume <id>`
  - pi → `cd <cwd> && pi --session <id>`  (fallback `pi --session-id <id>`)
- **FR-14** On Enter: print to stdout + copy to clipboard; exit 0.
- **FR-15** Validate before offering: warn if `cwd` no longer exists (deleted worktree) or the CLI isn't on `PATH`; still copy the command but flag it.
- **FR-16** `f` produces the fork variant where supported (`codex fork <id>`, `pi --fork <id>`).

### 6.4 Freshness
- **FR-17** `recall` runs an incremental sync on launch (fast, non-blocking — first paint uses the existing index, results refresh when sync lands).
- **FR-18** `recall watch` (Phase 2): a `chokidar` watcher on the session dirs that indexes new/changed files within seconds.

### 6.5 CLI surface
| Command | Purpose |
|---|---|
| `recall` | Launch the TUI (with incremental sync). |
| `recall index [--full] [--provider <p>]` | Build/rebuild the index. |
| `recall search "<q>" [--json] [--limit N]` | Headless search. |
| `recall sync` / `recall watch` | One-shot / continuous incremental sync. |
| `recall doctor` | Check CLIs on PATH, dirs exist, API key set, DB health. |
| `recall config` | Show/edit config. |

---

## 7. Architecture

**Stack:** Node + TypeScript · **Ink** (TUI) · **better-sqlite3** (sync, fast) · **sqlite-vec** (loadable vector extension) · local Ollama embeddings by default, optional **Voyage** · **chokidar** (watch) · **clipboardy** (copy).

```
                        ┌────────────────────────────────────────┐
   on-disk sessions     │                recall                   │
 ┌───────────────┐      │  ┌──────────────┐   ┌────────────────┐  │
 │ ~/.claude/... │─┐    │  │  Adapters    │   │  Index engine  │  │
 │ ~/.codex/...  │─┼───▶│  │ claude/codex │──▶│ parse→normalize│  │
 │ ~/.pi/...     │─┘    │  │ /pi (+iface) │   │ →chunk→embed   │  │
 └───────────────┘      │  └──────────────┘   └───────┬────────┘  │
                        │                              ▼           │
                        │   ┌───────────────────────────────────┐ │
                        │   │  SQLite: sessions + FTS5 + vec      │ │
                        │   └───────────────┬───────────────────┘ │
                        │                   ▼                      │
                        │   ┌──────────────┐  ┌─────────────────┐ │
                        │   │ Search/rank  │  │  Ink TUI         │ │
                        │   │ FTS+KNN+RRF  │─▶│  list + preview  │ │
                        │   └──────────────┘  └────────┬────────┘ │
                        │                              ▼           │
                        │                     Launcher: print+copy │
                        └────────────────────────────────────────┘
```

**Reuse opportunity:** `codesift` already does Voyage-based chunk indexing/querying — its embedding + sqlite-vec plumbing can likely be lifted or shared as a library rather than rebuilt.

**Layout (illustrative)**
```
recall/
├─ src/
│  ├─ adapters/        claude.ts · codex.ts · pi.ts · types.ts (SessionAdapter)
│  ├─ index/           discover.ts · parse.ts · normalize.ts · chunk.ts · embed.ts · store.ts
│  ├─ search/          fts.ts · vector.ts · fuse.ts · rank.ts
│  ├─ tui/             App.tsx · ResultList.tsx · Preview.tsx · Input.tsx
│  ├─ launch/          resume.ts (templates, validation, clipboard)
│  └─ cli.ts
├─ ~/.config/recall/   config.json
└─ ~/.local/share/recall/index.db   (sessions + FTS5 + vectors)
```

---

## 8. Data Model

### 8.1 Normalized `Session`
```ts
interface Session {
  uid: string;            // `${provider}:${nativeId}`
  provider: 'claude' | 'codex' | 'pi';
  nativeId: string;       // session UUID used by the resume command
  surface: 'cli' | 'ide' | 'desktop' | 'subagent' | 'cloud';
  cwd: string;
  repo: string | null;    // git-root basename, derived
  branch: string | null;
  title: string;          // native or synthesized
  titleSource: 'native' | 'synthesized';
  firstPrompt: string;
  createdAt: string;      // ISO
  updatedAt: string;      // last activity (used for recency)
  messageCount: number;
  models: string[];
  isSubagent: boolean;
  transcriptPaths: string[];  // pi nested layout can span files
  resumeCmd: string;          // pre-templated
  bytes: number;
}
```

### 8.2 SQLite schema (sketch)
```sql
CREATE TABLE sessions (uid TEXT PRIMARY KEY, provider TEXT, native_id TEXT,
  surface TEXT, cwd TEXT, repo TEXT, branch TEXT, title TEXT, first_prompt TEXT,
  created_at TEXT, updated_at TEXT, message_count INT, models TEXT,
  is_subagent INT, transcript_paths TEXT, resume_cmd TEXT, bytes INT);

CREATE VIRTUAL TABLE sessions_fts USING fts5(   -- keyword retriever
  title, first_prompt, body, content='', tokenize='porter unicode61');

CREATE TABLE chunks (id INTEGER PRIMARY KEY, uid TEXT, ord INT, text TEXT);
CREATE VIRTUAL TABLE chunks_vec USING vec0(      -- semantic retriever
  embedding float[768]);                           -- default local embeddinggemma dims

CREATE TABLE manifest (path TEXT PRIMARY KEY, size INT, mtime INT, hash TEXT, indexed_at TEXT);
CREATE TABLE embed_cache (hash TEXT PRIMARY KEY, embedding BLOB);  -- avoid re-embedding
```

---

## 9. Provider Adapter Contract (extensibility)

Every provider implements one interface; adding Gemini/Cursor/cloud = one new file.

```ts
interface SessionAdapter {
  id: 'claude' | 'codex' | 'pi' | string;
  discover(): AsyncIterable<string>;            // session file paths
  parse(path: string): Promise<ParsedSession>;  // → normalized fields + raw text
  buildResumeCmd(s: Session): string;
  buildForkCmd?(s: Session): string | null;
}
```

**Adapter notes from real data:**
- **claude** — glob `~/.claude/projects/*/*.jsonl`; title from `ai-title.aiTitle`; `cwd`/`gitBranch`/`timestamp` from records; decode `enc-cwd` (`-`→`/`) as a fallback when `cwd` is absent.
- **codex** — glob `~/.codex/sessions/**/rollout-*.jsonl`; metadata from `session_meta.payload`; `surface` from `source`; `isSubagent` from `thread_source`; text from `response_item` messages; **ignore** the stale `session_index.jsonl` except as a title hint.
- **pi** — glob both `~/.pi/agent/sessions/**/*.jsonl` (flat) and `**/run-*/session.jsonl` (nested); mark `agent-board`/`agent-view`/`hackerclaw` as subagent; **synthesize title** from first user `message`; resume id = session `id`.

---

## 10. Non-Functional Requirements

- **Query latency:** < 150 ms local (FTS + vec KNN); query embedding adds ~50–100 ms (cache identical queries).
- **TUI startup:** < 300 ms to first paint; sync runs in background.
- **Incremental sync:** < 2 s for a day's ~50 new sessions.
- **Cold index (~1,715 sessions):** bounded by embedding throughput — batch + cache; target single-digit minutes, resumable.
- **Memory:** stream-parse; never hold a full transcript in memory.
- **Footprint:** index DB under user-only perms in `~/.local/share/recall/`.

---

## 11. Privacy & Security

- **Local-first:** all parsing, storage, keyword search, and default embeddings are on-device. Hosted embedding egress only happens if the user selects **Voyage** explicitly or already has `VOYAGE_API_KEY` in the environment.
- **Sensitive content:** transcripts can contain secrets/keys. Mitigations: (a) local embeddings by default, (b) configurable **redaction** pass before embedding, (c) never embed obvious secret patterns.
- **Keys:** Voyage key from env/config when Voyage is selected, never logged; DB and config are `0600`.
- **No background phone-home** beyond the embedding provider you configure.

---

## 12. Roadmap

### Phase 0 — Spike (validate extraction)
- Adapters (claude/codex/pi) + stream parse + normalized schema.
- `recall index` → SQLite; `recall search` headless **FTS-only**.
- Goal: prove we can cleanly extract title/cwd/text/resume-cmd for all three. **Exit:** keyword search returns correct sessions across tools.

### Phase 1 — MVP (the shippable v1)
- Add local-first embeddings (Ollama `embeddinggemma` by default), optional Voyage, sqlite-vec, and hybrid RRF ranking + boosts.
- Ink TUI: live search, result list, preview pane, print/copy resume.
- Incremental sync on launch; subagent filtering; inline filters.
- **Exit:** "where did I build X" reliably surfaces the right session in top-5, copyable in one keystroke.

### Phase 2 — Daily-driver polish
- `recall watch` daemon (chokidar) for near-instant freshness.
- Transcript preview/pager, fork action, richer facets, fuzzy repo filter.
- Better model setup UX, additional local backends, and redaction tuning.

### Phase 3 — Reach
- **claude.ai cloud** adapter (API/daemon) for remote agents.
- More adapters: Gemini, Cursor, aider.
- Optional **exec/cmux handoff** mode (open resumed session in a new cmux pane).
- **MCP server** wrapping `recall search` so *other agents* (including Claude Code itself) can query your session history as a tool.

---

## 13. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Format drift (pi already has 2 layouts; codex index stale) | parsing breaks | defensive parsing, adapter version tags, fixture tests per format |
| Subagent/telemetry noise (pi board/view, codex subagents, 288MB sqlite) | junk results, slow index | strict globs, `is_subagent` filter, hard exclude telemetry files |
| Embedding cost/latency for ~1.7k sessions | slow cold start | chunk caps, batching, content-hash cache, resumable indexing |
| Hosted embedding provider accidentally selected | privacy leak | local provider default, explicit Voyage opt-in, redaction before outbound embedding |
| Resume correctness (deleted worktrees, id format quirks) | dead commands | validate cwd/CLI, surface warnings, fork fallback |
| Cloud API undocumented | Phase 3 slips | isolate behind adapter; v1 ships without it |

---

## 14. Success Metrics

- **Time-to-find:** median < 15 s from launch to copied resume command.
- **Top-5 hit rate:** target session in top-5 for ≥ 90% of recalled queries.
- **Coverage:** ≥ 99% of on-disk sessions indexed (per provider).
- **Adoption:** becomes your default way to resume (replaces native pickers).
- **Freshness:** new sessions searchable within one launch / a few seconds (Phase 2).

---

## 15. Open Questions

1. **Title synthesis for pi** — first-message truncation for v1; is an LLM-generated title (batch, cached) worth the cost later?
2. **Embedding model** — local `embeddinggemma` by default (768 dims); if `VOYAGE_API_KEY` is present in the environment, use Voyage `voyage-code-3` (1024 dims) unless the user forces local.
3. **Redaction default** — on by default before any embedding provider; local users can disable for fidelity if desired.
4. **Index location** — `~/.local/share/recall/` vs alongside `codesift` if we share infra.
5. **cmux integration** — is the print/copy flow enough long-term, or do you want a first-class "open in new cmux pane" action sooner than Phase 3?
