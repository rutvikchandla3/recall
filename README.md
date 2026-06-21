# Recall

Search every coding-agent session you've ever run — across Claude, Codex, and pi — in plain English, then jump back in with the exact resume command.

![Recall terminal UI](./assets/recall-ui.png)

## What we're building

Recall is a local-first CLI/TUI that:

- indexes session history from Claude, Codex, and pi
- lets you search with natural language and inline filters like `provider:`, `repo:`, `branch:`, and `since:`
- shows the most relevant matching snippet
- copies the exact resume command for the session you want

## The problem we're solving

If you run lots of coding agents, finding *"the conversation where I fixed X"* is way harder than it should be.

- each tool has its own session picker
- most pickers are recency-based, not content-based
- there is no single search across tools
- resuming the wrong session wastes time and context

Recall makes past agent work searchable, cross-tool, and fast.

## Current scope

Early MVP focused on local session stores for:

- Claude
- Codex
- pi

## Quickstart (60 seconds)

```bash
npm install -g coding-agent-recall
recall
```

Or without installing globally:

```bash
npx coding-agent-recall
```

On first launch, Recall:

- creates `~/.config/recall/config.json`
- creates its local SQLite index under `~/.local/share/recall/`
- auto-discovers Claude, Codex, and pi session roots
- starts indexing in the background and is immediately searchable by keyword
- points you to `recall setup` to turn on semantic (meaning-based) search — that command asks before downloading a ~300MB local model

`npm install` does **not** scan or index your machine. Indexing starts on first `recall` launch.

## First run

Keyword search works the moment you launch. To enable semantic search, run `recall setup` — it asks before downloading anything:

```
Embeddings provider: local (llama.cpp in-process)
Model: hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf
Cache dir: ~/.cache/recall/models

Download local embedding model embeddinggemma-300M (~300MB) to ~/.cache/recall/models? [Y/n] y
```

If you decline:

```
Download local embedding model embeddinggemma-300M (~300MB) to ~/.cache/recall/models? [Y/n] n
  - Run `recall setup` to download the embedding model (~300MB) and enable semantic search.
  - Or set RECALL_AUTO_DOWNLOAD=1 and re-run `recall setup`.
  - Or switch to Voyage by setting VOYAGE_API_KEY.
  - Keyword (FTS) search still works without the model.

Keyword (FTS) search is still fully functional without the embedding model.
```

No TTY (CI/scripts)? Recall never blocks — it stays keyword-only. Pre-approve with `RECALL_AUTO_DOWNLOAD=1` or `recall setup --yes`.

Then run `recall sync` to build the semantic vectors.

## Semantic search

Recall always does fast keyword search (SQLite FTS5). Semantic search adds meaning-based hybrid RRF ranking. Pick ONE backend:

### Zero-config local (default)

In-process `node-llama-cpp` loads the embeddinggemma-300M GGUF model. No external daemon or API key required. The ~300MB model is downloaded once on demand and cached under `~/.cache/recall/models/`.

```bash
recall setup          # interactive: prompts [Y/n] before downloading
recall setup --yes    # non-interactive / CI: skip the prompt
```

After download:

```bash
recall sync           # builds semantic vectors
```

### Ollama (if you already run it)

Set `embeddings.provider` to `"ollama"` in `~/.config/recall/config.json` (note: the legacy value `"local"` still maps to Ollama). Then:

```bash
ollama pull embeddinggemma
recall sync
```

### Voyage (hosted API)

```bash
export VOYAGE_API_KEY=...
recall sync   # auto-selects voyage-code-3 / 1024 dims
```

To force local even when `VOYAGE_API_KEY` is set:

```bash
RECALL_EMBEDDINGS_PROVIDER=llama recall sync
```

Switched providers or dimensions? Run `recall index --full`. Trouble? Run `recall doctor`.

## Commands

```bash
recall                    # first launch auto-bootstraps + starts indexing
recall setup              # download + enable the local embedding model (prompts [Y/n])
recall pull               # alias for `recall setup`
recall setup --yes        # skip the download prompt (CI / non-interactive)
recall setup --refresh    # re-download even if cached (fixes corrupt cache)
recall search "query"     # headless hybrid search
recall index              # foreground re-index
recall index --full       # full rebuild (use after changing providers or dimensions)
recall sync               # one-shot incremental sync
recall doctor             # diagnostics: providers, embeddings, database
recall config             # show resolved config
```

`recall setup` (and its alias `recall pull`) is the only command that downloads the model. All other commands, including background sync and `recall doctor`, are strictly non-interactive and never download.

## Packaging / install size

Global install pulls Recall + `node-llama-cpp`'s platform prebuilt binary (~tens of MB, no compiler required on macOS/Linux/Windows x64+arm64; cmake source build only on exotic platforms). The ~300MB embeddinggemma GGUF is NOT in the npm tarball — it is downloaded once at runtime after you confirm with `Y`, into `~/.cache/recall/models/`. Keyword search works without it. Offline or behind a proxy? The download fails gracefully and Recall stays keyword-only; retry with `recall setup`.

For deeper product and implementation details, see [`PRD.md`](./PRD.md) and [`IMPLEMENTATION.md`](./IMPLEMENTATION.md).
