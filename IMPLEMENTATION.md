# Recall Implementation Plan

## 1. Scope

This document translates `PRD.md` into an implementation-ready plan for a greenfield TypeScript repo.

### v1 target
- Local-only indexing of Claude Code, Codex, and pi sessions.
- Hybrid search: SQLite FTS5 + Voyage embeddings via `sqlite-vec`.
- Ink TUI for live search, ranked results, preview, and copyable resume command.
- CLI commands: `recall`, `index`, `search`, `sync`, `doctor`, `config`.
- Resume behavior is print + copy only. No direct process handoff in v1.

### Assumptions
- Node 20+.
- SQLite extension loading is available on the machine.
- `voyage-code-3` is the default embedding model unless the spike disproves it.
- Repo currently has only `PRD.md`, so this plan defines the initial project structure too.
- Examples below assume `pnpm`, but the implementation is package-manager agnostic.

## 2. Delivery strategy

Split work into four lanes that can run mostly in parallel once shared contracts exist:

1. **Foundation lane**
   - project scaffold
   - config/paths
   - SQLite connection + migrations
   - shared types/interfaces
2. **Provider lane**
   - Claude adapter
   - Codex adapter
   - pi adapter
   - fixture coverage for each format
3. **Search lane**
   - text cleaning
   - manifest + sync engine
   - chunking + embedding cache
   - FTS search, vector search, fusion/ranking
4. **UX lane**
   - command surface
   - Ink app
   - preview/actions
   - doctor/config UX

Single integration owner should maintain shared interfaces while the other lanes parallelize.

## 3. Recommended repo layout

```text
recall/
├─ PRD.md
├─ IMPLEMENTATION.md
├─ package.json
├─ tsconfig.json
├─ src/
│  ├─ cli.ts
│  ├─ commands/
│  │  ├─ tui.ts
│  │  ├─ index.ts
│  │  ├─ search.ts
│  │  ├─ sync.ts
│  │  ├─ doctor.ts
│  │  └─ config.ts
│  ├─ core/
│  │  ├─ paths.ts
│  │  ├─ config.ts
│  │  ├─ env.ts
│  │  ├─ errors.ts
│  │  ├─ logger.ts
│  │  └─ child-process.ts
│  ├─ db/
│  │  ├─ connection.ts
│  │  ├─ migrate.ts
│  │  ├─ schema/
│  │  │  ├─ 001_init.sql
│  │  │  ├─ 002_vec.sql
│  │  │  └─ 003_indexes.sql
│  │  ├─ sessions-repo.ts
│  │  ├─ chunks-repo.ts
│  │  ├─ manifest-repo.ts
│  │  └─ meta-repo.ts
│  ├─ providers/
│  │  ├─ types.ts
│  │  ├─ registry.ts
│  │  ├─ claude/
│  │  │  ├─ discover.ts
│  │  │  ├─ parse.ts
│  │  │  └─ normalize.ts
│  │  ├─ codex/
│  │  │  ├─ discover.ts
│  │  │  ├─ parse.ts
│  │  │  └─ normalize.ts
│  │  └─ pi/
│  │     ├─ discover.ts
│  │     ├─ parse.ts
│  │     └─ normalize.ts
│  ├─ ingest/
│  │  ├─ sync-engine.ts
│  │  ├─ discover-all.ts
│  │  ├─ fingerprint.ts
│  │  ├─ clean-text.ts
│  │  ├─ synthesize-title.ts
│  │  ├─ derive-repo.ts
│  │  └─ merge-sessions.ts
│  ├─ embeddings/
│  │  ├─ chunk.ts
│  │  ├─ redact.ts
│  │  ├─ voyage.ts
│  │  ├─ cache.ts
│  │  └─ index-chunks.ts
│  ├─ search/
│  │  ├─ query-parser.ts
│  │  ├─ filters.ts
│  │  ├─ keyword-search.ts
│  │  ├─ vector-search.ts
│  │  ├─ fuse.ts
│  │  ├─ snippet.ts
│  │  ├─ rank.ts
│  │  └─ service.ts
│  ├─ launch/
│  │  ├─ resume.ts
│  │  ├─ clipboard.ts
│  │  ├─ pager.ts
│  │  └─ validate-command.ts
│  └─ tui/
│     ├─ App.tsx
│     ├─ state.ts
│     ├─ hooks/
│     │  ├─ useSearch.ts
│     │  ├─ useSelection.ts
│     │  └─ useBackgroundSync.ts
│     └─ components/
│        ├─ SearchInput.tsx
│        ├─ ResultList.tsx
│        ├─ PreviewPane.tsx
│        ├─ Footer.tsx
│        └─ HelpModal.tsx
├─ test/
│  ├─ fixtures/
│  │  ├─ claude/
│  │  ├─ codex/
│  │  └─ pi/
│  ├─ adapters/
│  ├─ search/
│  ├─ tui/
│  └─ integration/
└─ scripts/
   ├─ smoke-index.ts
   └─ anonymize-fixtures.ts
```

## 4. Core architecture

### 4.1 Runtime pieces
- **CLI layer** parses commands and either launches the Ink app or runs a headless command.
- **Background sync worker** performs incremental indexing without blocking TUI first paint.
- **Search service** executes filters, keyword retrieval, vector retrieval, fusion, and snippet selection.
- **Launch service** builds resume/fork commands, validates cwd/CLI presence, prints and copies output.

### 4.2 Important design choices
- Use **TypeScript + plain `tsc` output**, not a bundler, to avoid friction with native modules (`better-sqlite3`, `sqlite-vec`).
- Keep **one SQLite DB** at `~/.local/share/recall/index.db`.
- Keep **one config file** at `~/.config/recall/config.json`.
- Spawn incremental sync from the TUI as a **separate child process** (`recall sync --json --quiet`) so indexing cannot freeze the UI.
- On cold start, make the app usable as soon as metadata + FTS rows exist; chunk embedding can continue as a backfill stage.
- Keep search query execution in-process because local DB reads should stay under the latency target.

## 5. Shared TypeScript contracts

```ts
export type ProviderId = 'claude' | 'codex' | 'pi';
export type Surface = 'cli' | 'ide' | 'desktop' | 'subagent' | 'cloud';

export interface TranscriptSegment {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'meta';
  text: string;
  timestamp?: string;
  model?: string;
}

export interface ParsedProviderSession {
  provider: ProviderId;
  nativeId: string;
  sourcePath: string;
  cwd?: string | null;
  branch?: string | null;
  surface?: Surface | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  title?: string | null;
  titleSource?: 'native' | 'synthesized';
  isSubagent?: boolean;
  segments: TranscriptSegment[];
  rawModels: string[];
}

export interface SessionRecord {
  uid: string;
  provider: ProviderId;
  nativeId: string;
  surface: Surface;
  cwd: string;
  repo: string | null;
  branch: string | null;
  title: string;
  titleSource: 'native' | 'synthesized';
  firstPrompt: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  models: string[];
  isSubagent: boolean;
  transcriptPaths: string[];
  bytes: number;
}
```

Provider adapters should emit `ParsedProviderSession`; normalization/merge produces `SessionRecord`.

## 6. Database design

### 6.1 Tables

```sql
CREATE TABLE sessions (
  uid TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  native_id TEXT NOT NULL,
  surface TEXT NOT NULL,
  cwd TEXT NOT NULL,
  repo TEXT,
  branch TEXT,
  title TEXT NOT NULL,
  title_source TEXT NOT NULL,
  first_prompt TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  message_count INTEGER NOT NULL,
  models_json TEXT NOT NULL,
  is_subagent INTEGER NOT NULL,
  transcript_paths_json TEXT NOT NULL,
  resume_cmd TEXT NOT NULL,
  fork_cmd TEXT,
  bytes INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  indexed_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE sessions_fts USING fts5(
  uid UNINDEXED,
  title,
  first_prompt,
  body,
  tokenize='porter unicode61 remove_diacritics 2'
);

CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL,
  ord INTEGER NOT NULL,
  chunk_hash TEXT NOT NULL,
  text TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  FOREIGN KEY(uid) REFERENCES sessions(uid) ON DELETE CASCADE,
  UNIQUE(uid, ord)
);

CREATE VIRTUAL TABLE chunk_embeddings USING vec0(
  embedding float[1024]
);

CREATE TABLE source_manifest (
  path TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  native_id TEXT,
  size INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  file_hash TEXT,
  indexed_at TEXT NOT NULL,
  parse_status TEXT NOT NULL,
  last_error TEXT
);

CREATE TABLE embedding_cache (
  chunk_hash TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  embedding_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE parse_errors (
  path TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  error TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 6.2 Notes
- `sessions.body` keeps the cleaned searchable transcript so re-snippeting does not require re-reading raw files.
- `sessions_fts` is app-managed: on session upsert, delete existing FTS row and insert a fresh one.
- `chunks.id` rowid must align with `chunk_embeddings.rowid`.
- `app_meta` stores embedding model, embedding dimensions, schema version, last sync times, and feature probes.
- If embedding dimensions change later, require `recall index --full` and recreate vector tables.

## 7. Provider adapter implementation

## 7.1 Common adapter contract

```ts
export interface SessionAdapter {
  id: ProviderId;
  discover(): AsyncIterable<string>;
  parse(path: string): Promise<ParsedProviderSession | ParsedProviderSession[] | null>;
  buildResumeCmd(input: { nativeId: string; cwd: string }): string;
  buildForkCmd?(input: { nativeId: string; cwd: string }): string | null;
}
```

Use one adapter per provider. Discovery is file-based; merge/dedupe happens after parse.

## 7.2 Claude adapter
- Discover: `~/.claude/projects/*/*.jsonl`.
- Parse line-by-line.
- Extract:
  - title from `ai-title.aiTitle`
  - session id from `sessionId` field or filename fallback
  - cwd from record payload, else decode from path as fallback
  - branch from `gitBranch` when present
  - timestamps from earliest/latest record timestamps
  - user/assistant text from content-bearing records only
- Surface:
  - default `cli`
  - if record metadata indicates VS Code/IDE source, map to `ide`
- Resume: `cd <cwd> && claude --resume <id>`
- Fork: only if Claude CLI exposes a stable equivalent later; otherwise `null` in v1

## 7.3 Codex adapter
- Discover: `~/.codex/sessions/**/rollout-*.jsonl`
- Explicitly ignore:
  - `session_index.jsonl` as canonical input
  - `logs_*.sqlite`
- Parse `session_meta`, `event_msg`, `response_item`
- Extract:
  - cwd from `session_meta.payload.cwd`
  - surface from `source` (`vscode` => `ide`, `cli` => `cli`)
  - subagent flag from `thread_source === 'subagent'`
  - title from `thread_name` if present, else synthesize
  - transcript text from user/assistant response items only
- Resume: `cd <cwd> && codex resume <id>`
- Fork: `cd <cwd> && codex fork <id>`

## 7.4 pi adapter
- Discover both layouts:
  - `~/.pi/agent/sessions/**/*.jsonl`
  - `~/.pi/agent/sessions/**/run-*/session.jsonl`
- Mark likely subagent/noise paths early:
  - `agent-board`
  - `agent-view`
  - `hackerclaw`
  - other known board/view synthetic traces
- Parse line-by-line and extract:
  - session id from transcript/session records
  - title synthesized from first user message
  - cwd from metadata or path-derived fallback if present
  - timestamps from first/last message
  - transcript text from natural-language user/assistant messages only
- Nested pi layouts may yield multiple files for the same logical session id; merge them by `provider:nativeId`, sort segments by timestamp, and union `transcriptPaths`.
- Resume: `cd <cwd> && pi --session <id>`
- Fork: `cd <cwd> && pi --fork <id>` if supported; otherwise omit
- Fallback behavior if `--session` probe fails: store `pi --session-id <id>` in doctor output and allow config override

## 8. Text extraction and cleaning

### 8.1 Keep
- User natural-language messages
- Assistant natural-language messages
- Short assistant summaries of failures if they appear in normal text

### 8.2 Drop
- System prompts
- base instructions
- raw tool call payloads
- raw tool results
- giant JSON blobs
- telemetry-only/meta-only lines

### 8.3 Cleaning rules
- Normalize whitespace
- Collapse repeated blank lines
- Strip ANSI codes
- Truncate repeated boilerplate headers
- Remove duplicated assistant echoes if the provider stores them twice

### 8.4 Title synthesis
If no native title:
1. take first user segment with non-empty text
2. strip formatting/code fences
3. take first sentence or first ~80 chars
4. trim filler prefixes like “hey”, “can you”, “please” only if safe
5. fall back to `(untitled)`

## 9. Repo and branch derivation

Do not shell out to Git for every session blindly.

### Strategy
1. If provider already exposes branch, trust it.
2. For repo name, use cached `git rev-parse --show-toplevel` only when cwd exists.
3. If git lookup fails, fall back to `basename(cwd)`.
4. Cache branch/repo lookups by cwd root during indexing.

This keeps indexing fast even when many sessions share the same worktree.

## 10. Incremental sync pipeline

### 10.1 High-level flow
1. discover candidate files from enabled providers
2. fingerprint each file with `size + mtimeMs`
3. skip unchanged files using `source_manifest`
4. parse changed/new files via adapter
5. normalize + clean segments
6. merge multi-file sessions by `uid`
7. compute `content_hash`
8. upsert session row and FTS row
9. mark changed sessions as `embedding_status = pending` in memory for this sync pass
10. regenerate chunks for changed sessions only
11. reuse cached embeddings where `chunk_hash` already exists
12. embed missing chunks in batches
13. upsert vectors
14. delete/tombstone missing files and any sessions no longer backed by files
15. write sync summary to `app_meta`

### 10.2 Content hashing
Use a stable hash over:
- title
- first prompt
- cleaned body
- updatedAt
- embedding model version

Only regenerate chunks/vectors when this hash changes.

### 10.3 Failure policy
- One bad file should not fail the sync.
- Record the error in `parse_errors` and continue.
- `doctor` should surface recent parse failures.

## 11. Chunking and embedding

### 11.1 Chunk policy
- target: ~512 tokens
- overlap: ~96 tokens
- max chunks/session: 40
- selection policy for giant sessions:
  - always keep first 8 chunks
  - always keep last 8 chunks
  - choose remaining slots by chunk density score (keyword richness / message density)

### 11.2 Token counting
Use an approximate tokenizer library rather than raw character count so chunk windows stay consistent. If exact Voyage tokenization is not available, approximate is acceptable because retrieval quality matters more than token-perfect limits.

### 11.3 Redaction before embedding
Redact only the text sent to Voyage, not the local searchable body.

Default redaction patterns:
- `KEY=...` env var assignments for obvious secret names
- Bearer tokens
- PEM blocks
- long hex/base64 blobs
- AWS/GitHub/OpenAI/Voyage style key prefixes where confidently identifiable

Replace with semantic placeholders like `<REDACTED_API_KEY>` so embeddings preserve topic shape.

### 11.4 Embedding cache
- `chunk_hash = sha256(model + '\0' + redactedChunkText)`
- if cached, reuse stored vector
- if missing, batch requests to Voyage
- batch size configurable; default 32

## 12. Search design

## 12.1 Query parsing
Support inline filters inside free text:
- `provider:claude|codex|pi`
- `repo:<name>`
- `branch:<name>`
- `surface:cli|ide|desktop|subagent`
- `since:3d|2026-06-01`
- `until:...`
- `include:subagents`

Implementation notes:
- parse quoted values
- convert relative dates (`3d`, `12h`, `2w`) to timestamps at query time
- return `{ filters, freeText }`
- if `freeText` is empty, skip embeddings and show filtered recency-ordered browse results

## 12.2 Keyword search
Use FTS5 with weighted columns.

Initial query shape:
```sql
SELECT uid, bm25(sessions_fts, 3.0, 2.0, 1.0) AS score,
       snippet(sessions_fts, 3, '«', '»', '…', 18) AS snippet
FROM sessions_fts
WHERE sessions_fts MATCH ?
ORDER BY score
LIMIT 50;
```

Notes:
- lower `bm25` is better, so normalize before fusion
- query builder must escape/quote dangerous FTS syntax when user input is plain text
- retain exact symbols like `VOYAGE_API_KEY` as phrase-like tokens when possible

## 12.3 Semantic search
1. embed `freeText`
2. KNN search top chunk rows from `chunk_embeddings`
3. join chunk rows back to `sessions`
4. aggregate by `uid` using max chunk similarity
5. keep best chunk text for fallback snippet

Target limits:
- retrieve top 100 chunks
- aggregate to top 40 sessions before fusion

## 12.4 Fusion and reranking
Use Reciprocal Rank Fusion with small additive boosts.

```ts
rrfScore = 1 / (60 + keywordRank) + 1 / (60 + vectorRank)
finalScore = rrfScore + recencyBoost + repoBoost + titleBoost + exactTokenBoost - shortPenalty
```

Initial boost policy:
- `repoBoost`: +0.10 when current cwd repo matches result repo
- `titleBoost`: +0.12 when normalized free-text is substring of title
- `exactTokenBoost`: +0.08 when a rare exact token appears in title/first prompt
- `recencyBoost`: `0.08 * exp(-ageDays / 30)`
- `shortPenalty`: `0.06` for very short sessions
- hard-exclude subagents unless explicitly included

Keep weights configurable and cover them with golden ranking tests.

## 12.5 Snippet selection
- Prefer FTS snippet when keyword match exists.
- Otherwise use the best semantic chunk excerpt.
- Preview pane should also show full resume command and provider/repo/branch/time metadata.

## 13. TUI design

## 13.1 App state

```ts
interface AppState {
  query: string;
  parsedQuery: ParsedQuery;
  results: SearchResult[];
  selectedIndex: number;
  preview: SearchResult | null;
  syncStatus: 'idle' | 'syncing' | 'done' | 'error';
  helpOpen: boolean;
  warning?: string | null;
}
```

## 13.2 Components
- `SearchInput`
  - controlled input
  - debounced search (~120ms)
- `ResultList`
  - top N results
  - provider badge
  - repo/branch/age/snippet line
- `PreviewPane`
  - richer metadata
  - matched excerpt
  - resume/fork command
  - warnings (`cwd missing`, `CLI missing`)
- `Footer`
  - key hints
- `HelpModal`
  - keybindings + filters

## 13.3 Keyboard flows
- type: update query
- `↑` / `↓`: move selection
- `Enter`: print + copy resume command, exit 0
- `f`: print + copy fork command when supported
- `y`: copy session id
- `t`: open transcript in `$PAGER` or `$EDITOR`
- `?`: toggle help
- `Esc` or `Ctrl+C`: exit

## 13.4 Transcript action
- If `transcriptPaths.length === 1`, open it directly.
- If multiple paths exist, create a merged temp file under the app data dir and open that.
- Prefer `$PAGER`, then `$EDITOR`, then `less`.

## 13.5 Startup behavior
1. open DB and load previous index immediately
2. render first paint
3. if no DB exists yet, show a bootstrap state until baseline metadata + FTS indexing completes
4. asynchronously spawn background incremental sync
5. refresh results if sync updates current query materially

## 14. CLI command implementation

## 14.1 `recall`
- launch Ink TUI
- optionally accept initial query text from argv later
- background sync kicks off automatically

## 14.2 `recall index [--full] [--provider <p>]`
- foreground indexing command
- prints progress and summary
- `--full` clears chunk/vector/search tables for targeted providers and rebuilds

## 14.3 `recall search "<q>" [--json] [--limit N]`
- headless hybrid search
- without `--json`, print compact human table
- with `--json`, emit machine-readable result payloads

## 14.4 `recall sync`
- one-shot incremental sync
- used by both humans and background TUI child process

## 14.5 `recall doctor`
Checks:
- provider directories exist
- `claude`, `codex`, `pi` binaries on PATH
- `VOYAGE_API_KEY` present when semantic search enabled
- sqlite DB opens and migrations succeed
- sqlite extension for `sqlite-vec` loads
- latest index stats by provider
- recent parse errors
- current embedding model/dimensions

## 14.6 `recall config`
- show resolved config
- optionally `--json`
- support `--edit` by opening the config file in `$EDITOR`; if absent, create it from defaults first

## 15. Resume and fork command handling

### Validation rules
Before showing/copying command:
- verify cwd exists
- verify executable is on PATH
- if validation fails, still allow copy but surface warning in preview and footer

### Templates
- Claude: `cd <cwd> && claude --resume <id>`
- Codex: `cd <cwd> && codex resume <id>`
- pi: `cd <cwd> && pi --session <id>`
- pi fallback: configurable alternate template `pi --session-id <id>`

All commands should be shell-escaped safely.

## 16. Config model

Suggested default config:

```json
{
  "paths": {
    "dataDir": "~/.local/share/recall",
    "configDir": "~/.config/recall"
  },
  "providers": {
    "claude": { "enabled": true, "roots": ["~/.claude/projects"] },
    "codex": { "enabled": true, "roots": ["~/.codex/sessions"] },
    "pi": { "enabled": true, "roots": ["~/.pi/agent/sessions"] }
  },
  "indexing": {
    "chunkTokens": 512,
    "chunkOverlapTokens": 96,
    "maxChunksPerSession": 40,
    "backgroundSyncOnLaunch": true
  },
  "embeddings": {
    "provider": "voyage",
    "model": "voyage-code-3",
    "dimensions": 1024,
    "batchSize": 32,
    "redactBeforeSend": true,
    "enabled": true
  },
  "search": {
    "defaultLimit": 20,
    "includeSubagents": false,
    "recencyHalfLifeDays": 30
  }
}
```

Use `zod` to validate config and merge with defaults.

## 17. Testing strategy

## 17.1 Unit tests
- query parser
- title synthesis
- text cleaning
- command builders
- redaction rules
- ranking math

## 17.2 Adapter fixture tests
Create anonymized real-world fixtures for:
- Claude JSONL with `ai-title`
- Codex rollout + stale index edge cases
- pi flat and nested layouts
- subagent/noise examples that must be filtered

Each adapter test should assert:
- native id
- cwd
- branch/surface when available
- title behavior
- message count
- subagent detection
- searchable body extraction

## 17.3 DB/integration tests
- migrations apply on empty DB
- upsert session + FTS row + chunk rows + vector row coherence
- incremental sync skips unchanged files
- changed session only re-chunks changed content
- deleted source file removes or tombstones session correctly

## 17.4 Search quality tests
Golden ranking fixtures from real user stories:
- “where did I build the pi-delegate ranking?”
- “VOYAGE_API_KEY”
- “MCP init failing”
- repo/branch/date filter combinations

Assert top-5 contains expected session and preferred provider ordering.

## 17.5 TUI tests
Use Ink testing utilities for:
- initial render
- arrow navigation
- help modal
- enter triggers print/copy path
- warnings render when cwd missing

## 17.6 Performance smoke tests
- cold index on fixture corpus
- repeated search latency
- background sync does not block first paint

## 18. Milestones

## Milestone 0 — Spike and contracts
Goal: prove extraction and store design before UI polish.

Tasks:
1. scaffold project
2. add SQLite connection + migration runner
3. define adapter interfaces and normalized types
4. add one anonymized fixture per provider
5. implement FTS-only headless `recall search`

Exit criteria:
- all 3 providers parse correctly on fixtures
- `recall index` produces rows and searchable text
- `recall search` finds exact keyword sessions across providers

## Milestone 1 — Ingestion and metadata completeness
Tasks:
1. full provider discovery
2. robust text cleaning
3. title synthesis
4. repo/branch derivation cache
5. manifest-based incremental sync
6. parse error reporting

Exit criteria:
- repeated sync skips unchanged files
- subagent noise hidden by default
- `doctor` reports coverage and failures cleanly

## Milestone 2 — Semantic and hybrid search
Tasks:
1. chunker
2. redaction + Voyage client
3. embedding cache
4. vector table integration
5. hybrid fusion + boosts
6. snippet selection

Exit criteria:
- target sessions land in top-5 for semantic queries on fixture corpus
- reindex only embeds new/changed chunks

## Milestone 3 — TUI and launch UX
Tasks:
1. Ink search input/result list/preview pane
2. background sync process
3. enter/fork/transcript/session-id actions
4. warning badges and help modal

Exit criteria:
- first paint uses existing DB immediately
- enter prints + copies exact resume command
- TUI remains usable during background sync

## Milestone 4 — Hardening and ship
Tasks:
1. integration tests
2. ranking tuning
3. doctor polish
4. docs / README / config sample
5. smoke test on real local corpus

Exit criteria:
- median search interaction feels sub-15s end-to-end
- no blocking parse failures on known real formats
- shipping checklist passes

## 19. Parallelizable task breakdown

### Track A — Foundation
- A1: project scaffold, tsconfig, test harness
- A2: config/paths/env loader
- A3: SQLite connection, migrations, repos
- A4: shared types + utility libraries

### Track B — Providers
- B1: Claude adapter + fixtures
- B2: Codex adapter + fixtures
- B3: pi adapter + fixtures
- B4: merge/dedupe pipeline for multi-file sessions

### Track C — Search/indexing
- C1: text cleaner + title synthesis
- C2: manifest/incremental sync engine
- C3: FTS indexing + search
- C4: chunking + cache
- C5: Voyage embedding client + redaction
- C6: vector search + RRF + rerank

### Track D — UX
- D1: CLI command wiring
- D2: TUI layout
- D3: preview/actions/copy/pager
- D4: background sync child process
- D5: doctor output

### Suggested dependency graph
- A1/A2/A3/A4 first
- then B1/B2/B3 + C1 + D1 in parallel
- then B4 + C2 + C3 + D2 in parallel
- then C4/C5/C6 + D3/D4
- finally D5 + full integration/perf tests

## 20. First implementation tickets

1. **Scaffold repo + base tooling**
   - package.json, tsconfig, lint/test scripts, entrypoint
2. **Create DB schema + migration runner**
3. **Define provider interfaces + normalized session model**
4. **Implement Claude adapter against fixture**
5. **Implement Codex adapter against fixture**
6. **Implement pi adapter against flat + nested fixtures**
7. **Implement cleaner/title synthesizer/merge pipeline**
8. **Implement `recall index` + manifest skipping**
9. **Implement FTS indexing + `recall search --json`**
10. **Implement chunking + embedding cache + Voyage client**
11. **Implement vector search + RRF reranking**
12. **Implement Ink TUI + preview/actions**
13. **Implement `doctor` + command validation**
14. **Tune ranking and run end-to-end smoke test on real corpus**

## 21. Known risks to handle explicitly

- **Format drift**: keep per-provider fixture coverage and defensive parsing.
- **pi session merging**: nested layouts may duplicate or fragment sessions; keep merge logic isolated and test-heavy.
- **Extension loading**: probe sqlite-vec during doctor and fail early with actionable messaging.
- **Secret leakage to Voyage**: default redaction on for outbound embedding text.
- **Cold start cost**: chunk caps + embedding cache + resumable sync.
- **Deleted worktrees**: preserve resume command but visibly warn.

## 22. Recommended immediate next step

Start with **Milestone 0** and avoid touching the semantic stack until all three adapters can reliably produce normalized sessions and FTS-only search results. The hybrid layer will only work if ingestion quality is high.
