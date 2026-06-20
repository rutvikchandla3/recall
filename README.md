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

## Run locally

```bash
pnpm install
pnpm build
pnpm dev
```

## Commands

```bash
recall
recall search "voyage embeddings"
recall index
recall sync
```

For deeper product and implementation details, see [`PRD.md`](./PRD.md) and [`IMPLEMENTATION.md`](./IMPLEMENTATION.md).
