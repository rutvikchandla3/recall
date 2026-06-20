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

Semantic search uses Voyage for embeddings and stores vectors locally with `sqlite-vec`.
Set `VOYAGE_API_KEY` before running `recall sync` / `recall index`; without it, Recall still indexes chunks and falls back to FTS-only search.

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
