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

## Install

```bash
npm install -g coding-agent-recall
recall
```

Or without installing globally:

```bash
npx coding-agent-recall
```

## Run locally

```bash
pnpm install
pnpm build
pnpm dev
```

On first launch, Recall now:
- creates `~/.config/recall/config.json`
- creates its local SQLite index under `~/.local/share/recall/`
- auto-discovers Claude, Codex, and pi session roots
- starts indexing in the background

Semantic search stores vectors locally with `sqlite-vec`. The default embedding setup is local-first via Ollama + `embeddinggemma`; without a ready local model, Recall still indexes chunks and falls back to FTS-only search.

One-time local semantic setup:

```bash
# Install/start Ollama first if needed: https://ollama.com/download
ollama pull embeddinggemma
recall doctor   # verifies Ollama/model readiness
recall sync
```

Prefer Voyage instead? If `VOYAGE_API_KEY` is already present in your environment, Recall automatically selects Voyage for sync/search (unless you force `RECALL_EMBEDDINGS_PROVIDER=local`). You can also set `embeddings.provider` to `"voyage"` in `~/.config/recall/config.json`, use model `voyage-code-3` with `dimensions: 1024`, and set `VOYAGE_API_KEY` before running `recall sync` / `recall index`. After switching embedding dimensions or providers, run `recall index --full` if prompted.

`recall sync` and `recall doctor` print setup hints when semantic search is not enabled, e.g. when Ollama is not running, `embeddinggemma` has not been pulled, or a Voyage key is missing.

`npm install` itself does **not** scan or index your machine. Indexing starts on first `recall` launch.

## Commands

```bash
recall                    # first launch auto-bootstraps + starts indexing
recall search "voyage embeddings"
recall index
recall sync
recall doctor
```

For deeper product and implementation details, see [`PRD.md`](./PRD.md) and [`IMPLEMENTATION.md`](./IMPLEMENTATION.md).
