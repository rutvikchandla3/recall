# recall CLI/TUI delivery brief

Source of truth: `PRD.md` (2026-06-20). This brief translates the PRD into an implementation-ready CLI/TUI plan. Where the PRD leaves room, this doc makes the smallest v1 recommendation that preserves stated scope.

## 1. v1 UX contract

The core user promise is:

1. Launch `recall`
2. Type a natural-language memory of the session
3. Move to the right result with arrow keys
4. Press `Enter`
5. Paste the copied resume command into a shell

v1 must preserve these constraints from the PRD:
- Local-only coverage: Claude (CLI + IDE), Codex, pi
- Hybrid search: FTS5 + embeddings + RRF fusion
- TUI-first default entrypoint
- Resume action is print-and-copy, not in-app exec
- Subagents hidden by default
- Cloud agents, watch daemon, offline embeddings, cmux handoff are later phases

Recommended v1 behavior where the PRD is silent:
- **Empty query** shows recent sessions sorted by recency, still respecting default filters.
- **First run** should become usable as soon as metadata + FTS are available; embeddings can continue to backfill in the background.
- **Warnings** should never block copying a command; they should only degrade trust and surface fixes.

## 2. Command surface

### 2.1 Primary commands

| Command | Phase | UX contract |
|---|---|---|
| `recall` | v1 | Launch Ink TUI, load existing index immediately, kick off non-blocking incremental sync, refresh results when sync completes. |
| `recall index [--full] [--provider <p>]` | v1 | Build or rebuild the index from disk. Human-readable progress by provider and indexing stage. |
| `recall search "<q>" [--json] [--limit N]` | v1 | Headless search using the same parser, filters, and ranking as the TUI. |
| `recall sync` | v1 | One-shot incremental sync without opening the TUI. |
| `recall watch` | Phase 2 | Continuous file watching + near-real-time indexing. |
| `recall doctor` | v1 | Environment and health checks with actionable warnings/failures. |
| `recall config` | v1 | Show effective config and config path. |
| `recall config --edit` | v1 recommended | Open the config file in `$EDITOR`, creating it from defaults if missing. |

### 2.2 Command behavior details

#### `recall`
- Startup target: first paint from the existing DB in `<300 ms` on a warm index.
- Sync model: open with current results, show a sync status indicator, refresh list in place when new/changed sessions are indexed.
- Cold start: if no DB exists, show an indexing/bootstrap screen until searchable baseline data exists.

#### `recall index`
- `--full` forces manifest invalidation and full rebuild.
- `--provider` scopes work to `claude`, `codex`, or `pi`.
- Should surface per-stage progress: discover -> parse -> normalize -> FTS -> chunk -> embed -> finalize.
- Best effort resumability matters because embedding is the slow path.

#### `recall search`
- Same inline filter grammar as the TUI.
- `--json` should emit stable, scriptable result records including `provider`, `nativeId`, `title`, `repo`, `updatedAt`, `snippet`, `resumeCmd`, and score/rank metadata.
- Human output can be compact; JSON is the real contract.

#### `recall sync`
- Uses manifest-based incremental indexing only.
- No ranking/search output; success should summarize changed files/sessions.

#### `recall doctor`
- Human-readable checks grouped by environment, providers, search backend, and launch readiness.
- Must clearly distinguish `OK`, `WARN`, and `FAIL`.
- Should end with a short “next action” summary if anything is wrong.

#### `recall config`
- Default action: print effective config and file path.
- `--edit`: open file in `$EDITOR`; if absent, write defaults first.
- Keep v1 minimal; avoid a large interactive config editor.

## 3. Ink TUI breakdown

### 3.1 Layout

The PRD layout naturally maps to a 5-part screen:

1. **Header** — app name, indexed session count, sync status
2. **Search input** — live NL query with inline filters
3. **Results list** — ranked cross-provider matches
4. **Preview pane** — metadata, matched snippet, resume/fork command, warnings
5. **Footer help** — visible key hints and transient status messages

### 3.2 Component tree

```text
<App>
  <Header />
  <SearchInput />
  <ResultsPane>
    <ResultList>
      <ResultRow />
    </ResultList>
  </ResultsPane>
  <PreviewPane>
    <PreviewMeta />
    <PreviewSnippet />
    <PreviewCommand />
    <PreviewWarnings />
  </PreviewPane>
  <FooterHints />
  <HelpModal />
  <BootState />
  <EmptyState />
  <ErrorBanner />
</App>
```

### 3.3 Component responsibilities

#### `App`
Owns top-level state and side effects:
- query text
- parsed filters
- debounced search requests
- current result set
- selected index
- preview item
- sync status
- help modal visibility
- last action status (copied, warning, unsupported)

#### `Header`
Shows:
- app label (`recall`)
- indexed session count
- current mode/state (`Ready`, `Syncing`, `Indexing`, `Error`)
- optional provider count summary if cheap to compute

#### `SearchInput`
- Controlled text input
- Debounced search (~120 ms per PRD)
- Inline token parsing for `provider:`, `repo:`, `branch:`, `surface:`, `since:`, `until:`, `include:subagents`
- Optional small parsed-filter summary line is useful, but not required

#### `ResultList`
- Keyboard-highlighted list of top results
- Result row fields should match the PRD sketch:
  - provider badge
  - title
  - repo
  - relative time
  - branch or surface
  - matched snippet
  - score (optional in v1 UI, useful during tuning)
- Should preserve selection when results refresh if the selected `uid` still exists

#### `PreviewPane`
Shows the selected result’s:
- provider / repo / branch / timestamp / message count / models
- best snippet for the current query
- resolved resume command
- fork command availability
- warnings (`cwd missing`, `CLI missing`, `fork unsupported`, etc.)

#### `FooterHints`
Always-visible key map for the highest-value actions:
- `↑↓` move
- `⏎` copy resume cmd
- `t` transcript
- `f` fork
- `/` filter
- `?` help

Use this area for short transient confirmations too (`Copied resume command`, `Fork unsupported for Claude`).

#### `HelpModal`
Static keybinding + filter help. Keep it simple in v1.

#### `BootState` / `EmptyState` / `ErrorBanner`
- `BootState`: shown on first launch or empty DB while indexing baseline data
- `EmptyState`: no query / no results / no indexed sessions states
- `ErrorBanner`: non-fatal indexing or search failures, with pointer to `recall doctor`

## 4. Keyboard flows

### 4.1 Primary search -> resume flow

1. Launch `recall`
2. Existing index loads immediately
3. User types NL query
4. Search debounces and updates results
5. `↑/↓` moves selection
6. Preview updates on selection change
7. `Enter` prints the resume command to stdout, copies it to clipboard, exits `0`

This is the single most important path and should work even if sync is still running.

### 4.2 Fork flow

1. Search and highlight a result
2. Press `f`
3. If provider supports fork:
   - build fork command
   - validate like resume
   - print to stdout
   - copy to clipboard
   - exit `0`
4. If unsupported:
   - stay in TUI
   - show transient status in footer
   - keep preview warning visible

### 4.3 Transcript inspection flow

1. Highlight a result
2. Press `t`
3. Open transcript in `$PAGER`, falling back to `$EDITOR`, then `less`
4. On close, return to the same TUI state

For multi-file transcript cases, generate a temporary concatenated read-only view with path separators rather than opening only the first file.

### 4.4 Filter flow

The PRD uses inline tokens, so filters should remain text-first. Recommended v1 behavior:
- power users can simply type `repo:recall since:7d voyage embedding`
- pressing `/` should move focus to the query box if needed and surface filter help in the footer/help modal
- parsed filters should be stripped from the semantic/keyword query before ranking

### 4.5 Help and quit

- `?` toggles keybinding help
- `Ctrl+C` exits without emitting a command

### 4.6 Suggested key map

| Key | Action | Exit? |
|---|---|---|
| type | update query | No |
| `↑/↓` | move selection | No |
| `Enter` | copy + print resume command | Yes |
| `f` | copy + print fork command if supported | Yes on success |
| `t` | open transcript preview | No |
| `y` | copy native session ID | No |
| `/` | focus/filter help | No |
| `?` | toggle help | No |
| `Ctrl+C` | quit | Yes |

## 5. Preview pane state model

The preview pane is the trust surface. It should tell the user both **why** a result matched and **whether** the generated command is safe to use.

### 5.1 Preview content priority

1. Session identity: provider, title, repo, branch/surface
2. Time + activity: updated time, message count, models
3. Match explanation: highlighted FTS span or nearest semantic chunk
4. Action target: exact resume command
5. Warnings: anything that may make the command fail

### 5.2 Preview states

| State | Behavior |
|---|---|
| `bootstrapping` | Show indexing progress and when search will become usable. |
| `idle-empty` | If query is empty, show recent sessions or a short prompt with example queries. |
| `searching` | Keep current results visible; show a spinner/status instead of blanking the list. |
| `result-selected` | Show full metadata, snippet, and command. |
| `no-results` | Show parsed filters and a suggestion to broaden/remove them. |
| `warning` | Show command plus inline warning badges. |
| `error` | Show failure message and suggest `recall doctor`. |

### 5.3 Snippet logic

- Prefer FTS-highlighted text when keyword search produced a strong match.
- Fall back to the best semantic chunk text when the vector hit is stronger.
- Keep snippets short and readable; this pane is for confidence, not transcript browsing.

### 5.4 Warning badges

At minimum:
- `cwd missing`
- `CLI missing from PATH`
- `fork unsupported`
- `subagent hidden by default` should not appear in results unless explicitly included, so no badge needed in normal flow

## 6. Resume and fork command behavior

### 6.1 Templates

Per PRD:
- Claude: `cd <cwd> && claude --resume <id>`
- Codex: `cd <cwd> && codex resume <id>`
- pi: `cd <cwd> && pi --session <id>` with fallback `pi --session-id <id>`

Fork where supported:
- Codex: `cd <cwd> && codex fork <id>`
- pi: `cd <cwd> && pi --fork <id>`
- Claude: unsupported in v1 unless the provider adds a native fork path later

### 6.2 Validation before offering

Validation should happen as part of result enrichment, not only on keypress:
- does `cwd` exist?
- is the provider CLI on `PATH`?
- does the session have a valid native ID?
- is fork supported for this provider?

### 6.3 Output behavior

Recommended output contract:
- command itself goes to **stdout**
- warnings go to **stderr**
- clipboard copy happens in both resume and fork flows
- command copy should still happen even if warnings exist

This keeps the command pipe-friendly while still surfacing problems.

### 6.4 UX behavior on unsupported fork

- `f` on an unsupported provider should not exit
- preview should show `Fork unsupported`
- footer should confirm why nothing happened

### 6.5 `y` behavior

`y` should copy only the native session ID and stay in the TUI. This is useful for advanced/manual workflows and should not close the app.

## 7. Doctor and config UX

### 7.1 `recall doctor`

The doctor command should answer: “Can this machine index, search, and resume reliably?”

Recommended check groups:

#### Environment
- config file readable/writable
- index directory exists and has user-only permissions where possible
- clipboard support available

#### Provider discovery
- Claude session root exists/readable
- Codex session root exists/readable
- pi session root exists/readable
- quick file count/glob sanity per provider

#### Search backend
- SQLite DB opens
- schema version is current
- FTS tables exist
- `sqlite-vec` loads successfully
- Voyage API key present for semantic search

#### Launch readiness
- `claude`, `codex`, `pi` binaries resolvable on `PATH`
- current DB has indexed sessions for each enabled provider

Output should be concise and action-oriented, e.g.:
- `FAIL  sqlite-vec extension did not load`
- `WARN  VOYAGE_API_KEY missing; semantic search disabled`
- `OK    468 Claude sessions discoverable`

### 7.2 `recall config`

Keep v1 config UX low-complexity:
- `recall config` prints the effective config and path
- `recall config --edit` opens the file in `$EDITOR`
- if missing, write a defaults file first

Recommended v1 config areas:
- provider root overrides
- index DB location
- Voyage API key / model selection
- chunk sizing / chunk cap
- redaction toggle
- default inclusion/exclusion of subagents

Avoid a fully interactive config TUI in v1.

## 8. Validation strategy

Validation should cover correctness, relevance, UX flow, and performance.

### 8.1 Adapter and parser correctness

- Build sanitized fixtures from real Claude, Codex, and pi transcripts
- Golden-test normalized `Session` output per provider
- Include format-drift fixtures:
  - Claude with/without `cwd`
  - Codex stale/missing title index
  - pi flat layout and nested `run-*/session.jsonl`
  - subagent/noise cases that must be filtered

### 8.2 Search correctness and relevance

Create a small judged query set from the PRD’s user stories plus live session memories.

Minimum benchmark set:
- “where did I build the pi-delegate ranking?”
- “VOYAGE_API_KEY setup”
- “MCP init failing in codesift”
- “Linear OAuth reset in pi”
- `repo:ade since:7d`

For each query, track:
- expected target session(s)
- top-1 / top-5 hit rate
- whether FTS or semantic retrieval carried the result

This is the fastest way to tune chunking, boosts, and RRF weights.

### 8.3 Launch command validation

Unit test command building and warnings:
- valid `cwd` + CLI on path
- missing `cwd`
- missing CLI
- fork unsupported
- pi fallback to `--session-id`

### 8.4 TUI interaction testing

Use Ink test utilities for:
- query typing
- selection movement
- help modal toggling
- `Enter` / `f` / `y` / `t` behavior
- state preservation across background sync refreshes

Snapshot/golden testing is useful for stable rendering of result rows and preview states.

### 8.5 Performance gates

From the PRD:
- warm TUI first paint: `<300 ms`
- query latency: `<150 ms` local search, excluding network variance for query embeddings
- incremental sync: `<2 s` for ~50 new sessions
- cold indexing: resumable; single-digit minutes target

### 8.6 Dogfooding scenarios

Before calling MVP done, manually validate:
- wrong-title/right-content sessions still surface from transcript content
- one keystroke resume works from all 3 providers
- subagent noise stays hidden by default
- missing worktree warnings are visible but non-blocking
- first-run experience remains understandable during long embedding backfill

## 9. Milestone sequencing

This sequencing stays aligned with the PRD’s phases but adds implementation order.

### Milestone 0 — contracts, fixtures, and storage foundation

Scope:
- lock normalized `Session` shape
- lock search result shape used by both CLI and TUI
- create sanitized transcript fixtures
- set up SQLite schema, manifest, FTS tables

Exit criteria:
- adapters can target a stable contract
- test corpus exists for all 3 providers

### Milestone 1 — Phase 0 spike: extract + index + FTS search

Scope:
- implement Claude, Codex, and pi adapters
- stream-parse JSONL
- normalize title/cwd/branch/text/resume command
- filter non-session noise and subagents
- implement `recall index`, `recall sync`, `recall search` (FTS-only)

Exit criteria:
- keyword search returns correct cross-provider sessions
- resume commands are built correctly for all providers
- coverage is high enough to trust the extraction path

### Milestone 2 — hybrid retrieval + ranking + validation

Scope:
- chunking + embed cache
- Voyage embedding integration
- sqlite-vec integration
- query embeddings + RRF fusion + ranking boosts
- command validation/warning enrichment

Exit criteria:
- judged query set hits top-5 target reliably
- semantic retrieval clearly improves over FTS-only for “what was this about” queries

### Milestone 3 — TUI MVP

Scope:
- Ink app shell
- live search input
- results list + preview pane
- key flows: `Enter`, `f`, `t`, `y`, `?`
- non-blocking sync on launch

Exit criteria:
- launch -> query -> select -> copy resume works smoothly
- preview explains why a result matched
- sync refresh does not destabilize selection or input

### Milestone 4 — doctor/config/hardening

Scope:
- `recall doctor`
- `recall config` / `--edit`
- empty/error states polish
- performance tuning
- packaging/readme/basic install path

Exit criteria:
- a new machine can self-diagnose setup issues
- MVP is supportable for daily use

### Milestone 5 — Phase 2 polish

Scope:
- `recall watch`
- richer transcript handling
- redaction/offline embedding path
- richer facets and repo matching

This should not block shipping v1.

## 10. Practical task breakdown and parallel work

### 10.1 Workstreams

| Workstream | Tasks | Dependencies | Parallel notes |
|---|---|---|---|
| A. Contracts + fixtures | Normalized types, search result contract, sanitized transcripts | None | Must happen first; unblocks almost everything. |
| B. Claude adapter | Discover, parse, native title extraction, resume cmd | A | Can run in parallel with C and D. |
| C. Codex adapter | Discover, parse, stale index avoidance, subagent detection | A | Parallel with B and D. |
| D. pi adapter | Both layouts, synthesized title, subagent/noise detection | A | Parallel with B and C. |
| E. Store + manifest + FTS | SQLite schema, manifest, incremental indexing, FTS search | A | Can start before adapters finish if contracts are frozen. |
| F. Embeddings + vec spike | Reuse/port codesift Voyage + sqlite-vec plumbing | A, E | Can start while adapters are still landing. |
| G. Ranking + query parser | Inline filters, RRF, recency/repo boosts, snippets | E, F | Can proceed with mock adapter data initially. |
| H. Launch + clipboard | Resume/fork builders, validation, stdout/stderr contract | A | Independent of TUI; parallel-friendly. |
| I. Ink TUI | Layout, navigation, help, preview, sync refresh | A, G | Can start against mocked search API before hybrid search is done. |
| J. Doctor + config | Health checks, config loader, `--edit` behavior | A, E, H | Can run in parallel with late TUI work. |
| K. QA + perf harness | Relevance benchmark, fixture drift tests, latency checks | A onward | Should begin as soon as Milestone 1 is usable. |

### 10.2 Best parallelization cuts

1. **Freeze contracts early**
   - `Session`
   - `SearchResult`
   - `CommandValidation`
   - query filter parser output

2. **Split adapters by provider**
   - three mostly independent tracks once contracts and fixtures exist

3. **Build TUI against mocked search results**
   - avoids blocking UI work on final ranking quality

4. **Run embeddings/vector work separately**
   - especially if reusing `codesift` plumbing; this is a good spike for a separate owner

5. **Start QA early**
   - judged query set and golden fixtures should land during Milestone 1, not after MVP is “done”

### 10.3 Critical path

The likely critical path is:

`contracts -> at least one adapter + store -> all adapters -> FTS search -> embeddings/vec -> ranking -> TUI integration -> doctor/config hardening`

The two biggest risk reducers are:
- locking fixtures/contracts before broad implementation
- proving `sqlite-vec` + Voyage plumbing early

## 11. Decision gates to lock early

The PRD leaves a few open decisions. They should be resolved at these points:

- **Before vector schema freeze:** choose embedding model and dimensions (`voyage-code-3` is the current leaning).
- **Before config work starts:** lock config file location and minimal schema.
- **Before semantic indexing ships:** decide the default redaction posture.
- **Before TUI keybindings freeze:** confirm whether `f` should exit on successful fork copy (recommended: yes).

## 12. Recommended MVP acceptance checklist

Ship v1 when all of the following are true:
- all 3 providers index from local disk with high coverage
- default TUI path is fast and stable
- semantic + keyword search meaningfully beats recency/title scanning
- `Enter` always yields a usable resume command or a clearly warned one
- `doctor` explains broken setup without code-level debugging
- the app is good enough to replace native resume pickers in daily use
