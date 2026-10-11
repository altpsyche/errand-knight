# Errand Knight

**Turn real life into a quest log.**

Errand Knight turns routine chores, meal prep, work, learning, and deadlines into an interactive RPG
quest log. It connects to Google Calendar and Google Tasks, turning real obligations into quests.
Completing a real task grants XP; missed deadlines can cost HP; streaks reward consistency. It is
designed to build habits, not to extract money, attention, or engagement.

- **Free and open source (MIT).** No ads, no tracking, no monetisation, no dark patterns.
- **Local-first and offline-capable.** Quest data and progression live on-device in SQLite.
- **Bring your own credentials.** Self-builders compile with their own Google OAuth client.
- **Optional AI, off by default.** Bring your own LLM key; the app never proxies or resells inference.

> **Status: pre-scaffolding.** Phase 0 has not landed. [`docs/idea.md`](docs/idea.md) is the complete
> product and architecture specification and is the source of truth for what this becomes. There is
> no runnable app yet.

## Planned stack

| Layer | Choice |
|---|---|
| Native core | Rust + Tauri v2 |
| Frontend | Svelte 5 + Vite + TypeScript |
| Persistence | SQLite via `sqlx`, WAL mode |
| Primary renderer | WebGPU + WGSL |
| Linux renderer | WebGL2 + GLSL ES 3.0 (first-class, not a fallback) |
| Platforms | Windows, Linux, then Android |

## Documentation

| Document | What it covers |
|---|---|
| [`docs/idea.md`](docs/idea.md) | Vision, product principles, MVP scope, architecture, roadmap |
| [`docs/workflow.md`](docs/workflow.md) | How work moves from idea to merged code, and the review checklist |
| [`docs/adr/`](docs/adr/) | Decisions that are hard to reverse, and why |
| [`docs/specs/`](docs/specs/) | What is agreed to be built, and its testing seams |
| [`AGENTS.md`](AGENTS.md) | Conventions, constraints, and anti-patterns for contributors and agents |
| [`docs/agents/`](docs/agents/) | Tracker, labels, and domain-doc conventions |

## Built by agents

This repository is developed primarily by coding agents driven by one human owner, using the open
conventions: a root [`AGENTS.md`](AGENTS.md) as the always-loaded context file, and
[Agent Skills](https://agentskills.io/) vendored at a pinned commit in
[`.agents/skills/`](.agents/skills/README.md). Work is spec-driven: idea to spec to tickets to
test-first implementation to a two-axis review.

If you are a contributor, start with [`AGENTS.md`](AGENTS.md) then
[`docs/workflow.md`](docs/workflow.md). If you are an agent, start with
[`AGENTS.md`](AGENTS.md); it will route you.

## Verification

```bash
pnpm skills:check   # agent layer: skill frontmatter, pointers, AGENTS.md budget
pnpm verify         # everything CI runs (Phase 0 extends this with Rust and web checks)
```

## License

[MIT](LICENSE). "Errand Knight" is a working name; a trademark and app-store search is required
before public release.
