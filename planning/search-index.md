# Recall Search / Indexing Implementation Brief

Source of truth: [PRD.md](../PRD.md). This brief turns the PRD into an implementation plan for the indexing and search engine only.

## 1. Scope and Design Targets

Ship v1 around one local pipeline:

1. Discover Claude, Codex, and pi sessions from disk.
2. Stream-parse JSONL into a normalized session model.
3. Build two retrieval layers:
   - FTS5 for exact and symbolic lookup.
   - sqlite-vec + Voyage embeddings for semantic recall.
4. Rank with hybrid fusion plus practical boosts.
5. Return a snippet and resume command fast enough for an interactive TUI.

Hard constraints from the PRD:

- Local providers only: Claude CLI+IDE, Codex, pi.
- Do not parse Codex telemetry SQLite (`~/.codex/logs_2.sqlite`).
- Default results hide subagent noise.
- Searchable text is user + assistant text with tool payloads, base instructions, and system boilerplate stripped.
- Chunking is approximately 512 tokens with overlap and a cap per session.
- Index must be incremental and resumable.

## 2. Recommended Pipeline

Use a two-phase indexer:

1. `discover -> stat -> manifest check -> parse -> normalize -> persist session/text/chunks`
2. `select pending chunks -> redact -> embed -> persist vectors`

That split matters because:

- FTS should work before embeddings finish.
- failed embedding batches should not roll back parsed sessions.
- indexing can resume from `pending_embedding` state.

Recommended runtime shape:

```ts
for await (const candidate of discoverAllProviders()) {
  if (!manifest.needsReparse(candidate)) continue
  dirtyGroups.add(groupKey(candidate))
}

for (const group of dirtyGroups) {
  const parsed = await adapter.parse(group.paths)
  const normalized = normalize(parsed)
  store.upsertSession(normalized) // transaction
}

for (const batch of store.pendingEmbeddingBatches()) {
  const vectors = await embed(batch)
  store.upsertVectors(vectors) // transaction
}
```

## 3. Discovery

### 3.1 Adapter-owned discovery roots

Use one adapter per provider and keep discovery logic provider-local.

- Claude: `~/.claude/projects/*/*.jsonl`
- Codex: `~/.codex/sessions/**/rollout-*.jsonl`
- pi: `~/.pi/agent/sessions/**/*.jsonl`

Hard excludes:

- Codex: `**/session_index.jsonl`, `**/logs*.sqlite`
- pi: `**/run-history.jsonl`
- all providers: lockfiles, temp files, hidden editor artifacts

Important detail: discovery should return raw transcript file paths, not sessions yet. Session grouping happens after a cheap first-line peek because pi nested layouts can contain child runs and future formats may map multiple files to one logical session.

### 3.2 First-line peek for grouping

Before full parse, read only the first JSONL line to extract:

- provider-local native session id
- rough timestamp
- obvious path-type flags

Grouping key should be:

```ts
`${provider}:${nativeId}`
```

Do not group purely by path. For pi, nested `run-*` files may represent separate session ids inside a parent directory tree.

### 3.3 Discovery implementation notes

- Prefer directory walking with `opendir()` over shelling out.
- Persist `path`, `size`, `mtime_ms`, `sha256` in `sources`.
- Use `size + mtime_ms` as the fast skip gate.
- Recompute `sha256` only when size or mtime changes.
- A full crawl still runs on each launch; parsing is what stays incremental.

## 4. Parsing

### 4.1 Common parser behavior

Use a shared JSONL stream reader:

- `fs.createReadStream(path)`
- `readline.createInterface()`
- parse line-by-line
- never `JSON.parse()` the full file in memory

Error policy:

- malformed line: count it, log it, continue
- abort file only if the first line is invalid or invalid-line rate crosses a threshold
- store `last_error` in metadata for `doctor`

Output of adapter parse should be provider-neutral:

```ts
interface ParsedSession {
  provider: 'claude' | 'codex' | 'pi'
  nativeId: string
  transcriptPaths: string[]
  cwd: string | null
  branch: string | null
  surface: 'cli' | 'ide' | 'desktop' | 'subagent' | 'cloud'
  title: string | null
  titleSource: 'native' | null
  firstPrompt: string | null
  createdAt: string | null
  updatedAt: string | null
  models: string[]
  isSubagent: boolean
  turns: Array<{ role: 'user' | 'assistant'; text: string; ts?: string }>
  rawBytes: number
}
```

### 4.2 Claude parsing

Observed useful record types:

- `user`
- `assistant`
- `ai-title`
- `attachment`
- `last-prompt`

Implementation rules:

- `nativeId`: `sessionId`
- `title`: last non-empty `aiTitle` from `type:"ai-title"`
- `cwd`: from any record carrying `cwd`
- `branch`: from `gitBranch`
- `createdAt`: earliest timestamp
- `updatedAt`: latest timestamp
- `models`: collect `assistant.message.model`
- `turns`:
  - keep `user.message.content` when text
  - keep `assistant.message.content[*].text`
  - drop `thinking`, tool-use payloads, hook attachments, deferred tool lists, skill listings
- `firstPrompt`: first retained user turn; fall back to `last-prompt.lastPrompt`

Claude-specific strip list should explicitly remove attachment types like:

- `hook_success`
- `deferred_tools_delta`
- `skill_listing`

Those records are useful operationally but poison ranking.

### 4.3 Codex parsing

Observed top-level record types:

- `session_meta`
- `event_msg`
- `response_item`

Implementation rules:

- `nativeId`: `session_meta.payload.id`
- `cwd`: `session_meta.payload.cwd`
- `surface`: `session_meta.payload.source` (`cli` / `vscode`)
- `isSubagent`: `session_meta.payload.thread_source === 'subagent'`
- `models`: collect from assistant response items
- `createdAt`: `session_meta.payload.timestamp`
- `updatedAt`: latest record timestamp
- `title`:
  - first choice: `session_meta.payload.thread_name` if present
  - second choice: optional hint from `session_index.jsonl`, but never use that file for discovery or freshness
  - fallback: synthesize from first real user turn
- `turns`:
  - keep `response_item.payload.role === 'user'|'assistant'`
  - from `content[]`, keep only `input_text`, `output_text`, or plain `text`
  - drop `toolCall`, `toolResult`, `thinking`, developer/base instructions, environment dumps
- ignore `event_msg` for body text; use it only for timestamps and abort metadata

Codex transcripts often inline huge harness instructions as user/developer content. Strip known wrappers at parse/clean time:

- `<permissions instructions>...</permissions instructions>`
- `<collaboration_mode>...</collaboration_mode>`
- `<skills_instructions>...</skills_instructions>`
- `<plugins_instructions>...</plugins_instructions>`
- `<apps_instructions>...</apps_instructions>`
- `<environment_context>...</environment_context>`
- `# AGENTS.md instructions for ...`

### 4.4 pi parsing

Observed useful record types:

- `session`
- `model_change`
- `thinking_level_change`
- `message`

Implementation rules:

- `nativeId`: `session.id`
- `cwd`: `session.cwd`
- `createdAt`: `session.timestamp`
- `updatedAt`: latest record timestamp
- `models`: collect from `model_change.modelId`
- `title`: always synthesize unless a future native title appears
- `isSubagent`: true when path or cwd indicates board/view/helper runs, or when file lives under known agent helper roots
- `turns`:
  - keep `message.message.role === 'user'|'assistant'`
  - from `content[]`, keep `type === 'text'`
  - drop `thinking`, `toolCall`, `toolResult`, `bashExecution`

pi-specific path heuristics:

- keep indexing helper sessions so `include:subagents` can surface them
- tag as subagent when path or cwd contains markers such as `agent-board`, `agent-view`, `hackerclaw`, `run-*` helper layouts
- hard-ignore `run-history.jsonl`

## 5. Normalization

Convert parsed provider output into one canonical search document.

### 5.1 Session fields

Use the PRD model, but add internal hashes/version fields.

Recommended derived fields:

- `uid = `${provider}:${nativeId}``
- `repo`:
  - first try `git rev-parse --show-toplevel` if `cwd` exists
  - fallback to `basename(cwd)`
  - cache repo-root lookups aggressively
- `surface`:
  - Claude: start conservative with `cli`; preserve raw `entrypoint` for later refinement
  - Codex: map `source:vscode` to `ide`, `source:cli` to `cli`
  - pi: `cli` or `subagent`
- `messageCount`: retained user + assistant turns only
- `resumeCmd`: precompute from provider template

### 5.2 Search body construction

Build body from retained turns only.

Format:

```text
User: ...

Assistant: ...

User: ...
```

Role labels help chunk boundaries and semantic retrieval without noticeably hurting keyword search.

### 5.3 Boilerplate cleaning

Run a deterministic cleaner before hashing/chunking:

1. strip known harness wrapper blocks
2. remove repeated blank lines
3. normalize line endings to `\n`
4. trim whitespace per line but preserve code fences and indentation inside code blocks
5. collapse repeated identical lines above a threshold

Do not do fuzzy “AI cleaning”. Keep it rule-based and versioned.

### 5.4 Title synthesis

For sessions without a native title:

1. take first retained user turn after boilerplate stripping
2. remove fenced code blocks and XML-like harness blocks
3. collapse whitespace
4. truncate to roughly 80 chars / 12 words
5. if empty, use `(untitled)`

Keep original casing. Do not title-case it.

## 6. Chunking

### 6.1 Goals

Chunking should optimize semantic retrieval, not storage symmetry.

Requirements:

- target ~512 tokens
- overlap 64-96 tokens
- preserve conversation boundaries where possible
- cap per session at 40 chunks
- bias toward first, last, and information-dense middle chunks

### 6.2 Chunk algorithm

Recommended algorithm:

1. split cleaned body into turn blocks
2. estimate token count per turn
3. merge adjacent turns until target size is reached
4. if a turn is too large, split by:
   - fenced code block boundaries
   - paragraph breaks
   - sentence boundaries
   - hard token split as last resort
5. emit overlap from the trailing part of the previous chunk

Store per chunk:

- `ord`
- `start_char`, `end_char`
- `approx_tokens`
- `text`
- `text_sha256`
- `info_score`

### 6.3 Approximate token counting

Use a deterministic local tokenizer in TS. If no model-matched tokenizer is available, use a stable approximation (`chars / 4`) but keep it versioned.

A good practical target is 420-520 tokens per chunk with 80-token overlap.

### 6.4 Chunk cap selection

If a session produces more than 40 chunks:

- keep first 8
- keep last 8
- score the middle chunks by `info_score`
- keep the top 24 middle chunks

Suggested `info_score` inputs:

- identifier density (`fooBar`, `snake_case`, env vars)
- path/file density (`src/...`, `foo.ts`)
- error-like lexemes (`Error`, `ENOENT`, `failed`, stack traces)
- code fence presence
- unique non-stopword term count
- boilerplate ratio penalty

This matches the PRD’s “first + last + densest chunks” requirement.

## 7. Hashing, Manifest, and Incremental Reindex

Use three hash layers.

### 7.1 Source hash

Per transcript file:

- `size`
- `mtime_ms`
- `sha256`

Purpose:

- skip unchanged files
- detect silent content changes when stat changes
- feed grouped session fingerprints

### 7.2 Normalized body hash

Per session:

- `raw_body_sha256 = sha256(cleaned body + title + first_prompt + key metadata)`

Purpose:

- skip FTS rewrites when nothing searchable changed
- invalidate snippets and title synthesis when normalization changes

### 7.3 Embedding hash

Per chunk:

- `embed_sha256 = sha256(embed_model + redaction_version + embed_text)`

Purpose:

- dedupe identical chunks across sessions
- avoid re-embedding after metadata-only changes
- keep embed cache valid across reindexes

### 7.4 Versioned invalidation

Persist these version stamps in `index_meta` and per row:

- `parse_version`
- `normalize_version`
- `chunk_version`
- `redact_version`
- `embed_model`
- `embed_dims`

Any change to those forces targeted invalidation:

- parse/normalize bump -> reparse sessions
- chunk bump -> rebuild chunks and vectors
- redaction/model/dim bump -> re-embed only

### 7.5 Tombstones

After a full discovery pass:

- mark missing `sources.path` rows as deleted
- if all source paths for a session are gone, delete or tombstone the session and cascade FTS/chunk/vector rows

Use soft deletes only if auditability matters; otherwise physical delete is simpler.

## 8. Embeddings

### 8.1 Provider interface

Keep embeddings behind a provider abstraction even in v1:

```ts
interface Embedder {
  model: string
  dims: number
  embedTexts(texts: string[]): Promise<Float32Array[]>
  embedQuery(query: string): Promise<Float32Array>
}
```

Default v1 choice: `voyage-code-3`, configurable.

### 8.2 What to embed

Embed chunk text with a short metadata prefix:

```text
Title: <title>
Repo: <repo>
Branch: <branch>
Provider: <provider>

<chunk text>
```

That improves semantic recall for short or ambiguous chunks without polluting local snippets.

Do not embed:

- raw tool payload dumps
- harness instructions
- giant secret-looking values

### 8.3 Batch strategy

- fetch pending chunks ordered by session recency
- dedupe by `embed_sha256`
- batch 32-64 texts per API call
- retry 429/5xx with backoff
- mark failures per chunk, not per run

### 8.4 Query embeddings

At query time:

- strip inline filters first
- normalize whitespace
- run the same redaction pass before network egress
- cache identical query embeddings persistently

If query text is empty after filter parsing, skip semantic retrieval.

### 8.5 Fallback behavior

If the Voyage key is missing or embedding fails:

- keep the index usable
- mark semantic search unavailable
- return FTS-only results

## 9. SQLite / FTS5 / sqlite-vec Schema

Recommended SQLite settings on DB creation:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

### 9.1 Core tables

```sql
CREATE TABLE index_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE sources (
  path TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_error TEXT
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  native_id TEXT NOT NULL,
  surface TEXT NOT NULL,
  cwd TEXT NOT NULL,
  repo TEXT,
  branch TEXT,
  title TEXT NOT NULL,
  title_source TEXT NOT NULL,
  first_prompt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  message_count INTEGER NOT NULL,
  models_json TEXT NOT NULL,
  is_subagent INTEGER NOT NULL DEFAULT 0,
  transcript_paths_json TEXT NOT NULL,
  resume_cmd TEXT NOT NULL,
  fork_cmd TEXT,
  bytes INTEGER NOT NULL,
  raw_body_sha256 TEXT NOT NULL,
  normalize_version TEXT NOT NULL,
  chunk_version TEXT NOT NULL,
  indexed_at TEXT NOT NULL
);

CREATE TABLE session_docs (
  session_id INTEGER PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  first_prompt TEXT NOT NULL,
  body TEXT NOT NULL
);

CREATE TABLE session_sources (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  path TEXT NOT NULL REFERENCES sources(path) ON DELETE CASCADE,
  PRIMARY KEY (session_id, path)
);
```

### 9.2 FTS5 tables

Use external-content FTS so snippet/highlight functions work.

```sql
CREATE VIRTUAL TABLE session_fts USING fts5(
  title,
  first_prompt,
  body,
  content='session_docs',
  content_rowid='session_id',
  tokenize='porter unicode61 remove_diacritics 2',
  prefix='2 3 4'
);
```

Maintain it with triggers on `session_docs`.

Also add a chunk FTS table for precise snippet extraction without changing the primary keyword retriever:

```sql
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  start_char INTEGER NOT NULL,
  end_char INTEGER NOT NULL,
  approx_tokens INTEGER NOT NULL,
  text TEXT NOT NULL,
  text_sha256 TEXT NOT NULL,
  embed_sha256 TEXT NOT NULL,
  info_score REAL NOT NULL,
  UNIQUE(session_id, ord)
);

CREATE VIRTUAL TABLE chunk_fts USING fts5(
  text,
  content='chunks',
  content_rowid='id',
  tokenize='porter unicode61 remove_diacritics 2',
  prefix='2 3 4'
);
```

`session_fts` is the keyword ranker. `chunk_fts` is a snippet helper and optional exact-hit booster.

### 9.3 Vector storage

Keep one vector row per chunk. Exact `vec0` DDL depends on the installed sqlite-vec build, but the logical shape should be:

- vector row keyed to `chunks.id`
- one embedding column with fixed `dims`
- optional side map table if rowid cannot be forced to equal `chunks.id`

Recommended logical schema:

```sql
CREATE TABLE chunk_vec_map (
  rowid INTEGER PRIMARY KEY,
  chunk_id INTEGER NOT NULL UNIQUE REFERENCES chunks(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- install-specific vec0 DDL here, one vector per rowid/chunk
CREATE VIRTUAL TABLE chunk_vec USING vec0(
  embedding float[EMBED_DIMS]
);
```

If the extension supports an explicit `chunk_id` metadata column, use it. Otherwise keep `chunk_vec_map`.

### 9.4 Caches

```sql
CREATE TABLE embed_cache (
  embed_sha256 TEXT NOT NULL,
  model TEXT NOT NULL,
  dims INTEGER NOT NULL,
  vector BLOB NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (embed_sha256, model)
);

CREATE TABLE query_cache (
  query_norm TEXT NOT NULL,
  model TEXT NOT NULL,
  dims INTEGER NOT NULL,
  vector BLOB NOT NULL,
  last_used_at TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (query_norm, model)
);
```

### 9.5 Secondary indexes

```sql
CREATE INDEX idx_sessions_provider_updated ON sessions(provider, updated_at DESC);
CREATE INDEX idx_sessions_repo_updated ON sessions(repo, updated_at DESC);
CREATE INDEX idx_sessions_branch_updated ON sessions(branch, updated_at DESC);
CREATE INDEX idx_sessions_subagent_updated ON sessions(is_subagent, updated_at DESC);
CREATE INDEX idx_chunks_session_ord ON chunks(session_id, ord);
```

## 10. Query Parsing and Prefiltering

Parse inline filters before any retrieval.

Supported filters from the PRD:

- `provider:`
- `repo:`
- `branch:`
- `surface:`
- `since:`
- `until:`
- `include:subagents`

Implementation details:

- regex parse tokens outside quoted strings
- remove parsed filters from the free-text query
- convert `since:3d`, `since:2w`, `since:12h` to ISO lower bounds
- `repo:foo` should match `sessions.repo = 'foo'`; if value contains `/`, also allow `cwd LIKE '%value%'`
- default predicate includes `is_subagent = 0`

Build one SQL `WHERE` fragment used by both FTS and vector branches.

## 11. Hybrid Ranking

### 11.1 Keyword branch

Use `session_fts` as the primary lexical ranker.

Query behavior:

- build an FTS query from the stripped free-text portion
- keep quoted phrases quoted
- fall back to token AND/OR query if exact parse fails
- retrieve top 100 session ids

Weight columns with BM25:

- `title` x5.0
- `first_prompt` x2.5
- `body` x1.0

Example:

```sql
SELECT s.id,
       bm25(session_fts, 5.0, 2.5, 1.0) AS bm25_score
FROM session_fts
JOIN session_docs d ON d.session_id = session_fts.rowid
JOIN sessions s ON s.id = d.session_id
WHERE session_fts MATCH ? AND <prefilters>
ORDER BY bm25_score
LIMIT 100;
```

### 11.2 Semantic branch

- embed query text
- KNN over `chunk_vec`
- take top 200 chunks
- aggregate to session by max similarity
- retain best chunk id per session

Aggregation rule:

```text
session_vector_score = max(chunk_similarity)
```

`max` is better than averaging for this problem because users usually remember one salient region of a transcript.

### 11.3 Fusion

Use Reciprocal Rank Fusion with `k = 60`.

```text
rrf = 1/(60 + keyword_rank) + 1/(60 + vector_rank)
```

If a session appears in only one branch, it still gets an RRF contribution from that branch.

Do not directly average BM25 and cosine scores. Their scales are unstable. RRF is more robust.

## 12. Boosts and Penalties

Apply boosts after RRF.

### 12.1 Recency boost

Use an exponential decay on `updated_at`:

```text
recency_boost = 0.18 * exp(-age_days / 14)
```

This gives strong help to sessions from the last 1-2 weeks without drowning older exact matches.

### 12.2 Current repo / cwd boost

Resolve current launch context once:

- `currentCwd = process.cwd()`
- `currentRepo = current git root basename or basename(currentCwd)`

Boosts:

- `+0.10` if `session.repo === currentRepo`
- `+0.05` if `session.cwd` shares a prefix with `currentCwd`

If the user already supplied `repo:...`, do not add an extra repo boost.

### 12.3 Exact-substring boost

FTS tokenization can soften symbols like `VOYAGE_API_KEY` or file paths. Add a post-rank exact-hit bonus for “code-like” query tokens.

Extract exactish terms from the free-text query when they contain `_`, `/`, `.`, `-`, or camelCase/ALLCAPS.

Boosts:

- `+0.15` if the full query appears in the title, case-insensitive
- `+0.10` if an exactish term appears in `first_prompt`
- `+0.08` if an exactish term appears in `body`

### 12.4 Penalties

- `-0.20` for subagents when `include:subagents` is enabled
- `-0.08` for very short sessions (`message_count < 4` or tiny body)
- `-0.03` if `cwd` no longer exists

### 12.5 Tie-breakers

Final sort order:

1. total score desc
2. exact-title-hit desc
3. updated_at desc
4. keyword rank asc

## 13. Snippet Extraction

Snippet quality matters as much as top-5 relevance.

### 13.1 Selection policy

For each ranked session:

1. if keyword branch exists and is competitive, prefer a keyword snippet
2. otherwise use the best semantic chunk

Rule of thumb:

- use keyword snippet when keyword rank exists and `keyword_rank <= vector_rank + 10`
- otherwise use semantic snippet

### 13.2 Keyword snippet path

Use `chunk_fts` constrained to the session’s chunk ids:

- query `chunk_fts MATCH ?`
- filter `chunks.session_id = ?`
- take best BM25 chunk
- render snippet with FTS highlight markers

This is more precise than asking FTS to excerpt the full session body.

Suggested output length:

- 180-240 characters in the results list
- longer excerpt in preview pane

### 13.3 Semantic snippet path

Use the best-matching chunk from the vector branch.

Optional polish:

- highlight raw query terms in the chunk text locally
- trim to nearest sentence boundaries around the most query-dense span

### 13.4 Snippet provenance

Return snippet metadata with each result:

```ts
snippetSource: 'fts' | 'vector'
bestChunkId?: number
```

That makes debugging ranking much easier.

## 14. Caching Strategy

Use three cache classes.

### 14.1 Persistent caches

- `sources`: path stat/hash manifest
- `embed_cache`: chunk embeddings by `embed_sha256 + model`
- `query_cache`: query embeddings by normalized query + model

### 14.2 In-memory caches

- repo-root resolution by cwd
- parsed query/filter objects
- recent search results keyed by `index_revision + query + currentRepo`

Keep the result cache small (50-100 entries). Clear it whenever the index revision changes.

### 14.3 Resumable indexing state

Add an `index_runs` table or `index_meta` keys for:

- current revision
- last successful full sync timestamp
- last embedding batch cursor
- last failure summary

That makes partial failures recoverable instead of forcing a full reindex.

## 15. Privacy and Redaction

### 15.1 Local-vs-egress boundary

Keep two representations:

- local searchable text: full cleaned text in SQLite
- outbound embedding text: redacted text only

Redaction should affect:

- chunk embedding requests
- query embedding requests

It should not silently mutilate the local FTS corpus.

### 15.2 Redaction modes

Implement now, even if v1 defaults to `off`.

- `off`: no outbound redaction except hard secret regexes
- `conservative`: redact obvious secrets and secret values
- `strict`: also redact emails, URLs with creds, long IDs, and suspicious high-entropy strings

Recommended v1 behavior:

- default config can remain `off` for fidelity, matching PRD leanings
- still always hard-redact obvious secrets before egress

### 15.3 Hard-redact patterns

Always replace these before embedding:

- GitHub tokens: `ghp_`, `github_pat_`, `gho_`
- OpenAI/Voyage/Anthropic-style API key prefixes where detectable
- Slack tokens
- AWS access keys / secret pairs when obvious
- `-----BEGIN ... PRIVATE KEY-----` blocks
- bearer tokens in headers
- `.env` assignments: keep key name, replace value
- long high-entropy strings next to `token|secret|key|password`

Preserve variable names like `VOYAGE_API_KEY`; redact only the value.

### 15.4 Auditability

Store per session/chunk redaction stats:

- `redaction_count`
- `had_secret_like_content`

Do not log raw redacted values.

### 15.5 Filesystem hygiene

- create DB/config with `0600`
- never log embedding payloads in debug output
- `doctor` should warn when permissions are broader than expected

## 16. Build Order

Recommended implementation order:

1. adapters + stream parsing + normalization fixtures
2. SQLite schema + manifest + session/chunk persistence
3. FTS-only search + filters + snippet extraction
4. chunk capping + embedding pipeline + sqlite-vec
5. hybrid ranking + boosts + query cache
6. privacy/redaction + degraded-mode handling

## 17. Acceptance Checks

Before calling the engine done, verify these cases from real transcripts:

1. Exact symbol recall: `VOYAGE_API_KEY`, file paths, error strings
2. Semantic recall: “where did I build the voyage embedding indexer”
3. Cross-provider recall: same repo across Claude, Codex, pi
4. Subagent suppression by default, recovery with `include:subagents`
5. Repo/time filters working as hard constraints
6. Incremental sync skipping unchanged sources
7. Reindex after chunk/redaction/model version bump only touching affected rows

This should yield a search core that is fast, debuggable, and aligned with the PRD’s hybrid-local-first design.