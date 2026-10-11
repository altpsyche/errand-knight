# Errand Knight — Agent Context

Tauri v2 (Rust core) + Svelte 5 + Vite + TypeScript, SQLite via `sqlx`, WAL mode. MIT, FOSS, solo
maintainer. Repo: `altpsyche/errand-knight`. Rust crate `src-tauri/`, frontend package `src/`.

Turns real obligations (Google Calendar events, Google Tasks, local quests) into an RPG quest log.
Completing a real task grants XP; missing a critical one costs HP; streaks reward consistency.

**Product constitution.** No telemetry, no ads, no monetisation, no payment loop, ever. Local-first
and offline-capable. Google data stays between the user, Google, and the app. Every AI feature is
opt-in, off by default, and uses a key the user supplies. These are the product, not tunable defaults.

> **Stay under 200 lines** — this loads into every session. Detail belongs in a co-located `.md`.
> **Session start:** owner says "let's work" / "next" / "review" with no ticket → follow
> [`.agents/skills/work/SKILL.md`](.agents/skills/work/SKILL.md).
> **Skills:** `/name` anywhere in this repo means read `.agents/skills/name/SKILL.md` and follow it.
> No harness registers them as commands; every agent, Claude included, reads the file.
> **Pre-code:** Phase 0 has not landed. [`docs/idea.md`](docs/idea.md) is the product source of truth,
> and the layout below is the plan, not a description of files on disk.

## Where things live

| What | Where |
|---|---|
| Product intent — the WHY | [`docs/idea.md`](docs/idea.md) — authoritative |
| ADRs — the WHY, decided | [`docs/adr/`](docs/adr/), named `NNNN-kebab-title.md` |
| Specs — the WHAT | [`docs/specs/`](docs/specs/) |
| System docs — the HOW | a co-located `.md` beside the code it describes |
| Vocabulary | `GLOSSARY.md`, created lazily by `/domain-modeling`. Until it exists, `docs/idea.md` §3 Core Concepts is the authority |
| Issues, PR state | **GitHub issues** — see [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md) |
| Local scratch, never authoritative | `.scratch/` (gitignored) |
| Skills | [`.agents/skills/README.md`](.agents/skills/README.md) |
| Sandbox, SSH and build gotchas — read before pushing or running anything system-level | [`docs/dev_setup.md`](docs/dev_setup.md) |

**Precedence when sources disagree:** ADR → spec → `docs/idea.md` → co-located `.md` → this file.
An issue is a request; an ADR is a decision. When they conflict the ADR wins and the issue is wrong.
Fix the stale source in the same commit, or say plainly that you did not.

## Verifying your work

```bash
pnpm verify           # everything CI runs
pnpm skills:check     # skill frontmatter, doc links, CLAUDE.md symlink, under a second
```

**Prefer running these over reasoning about whether your change is correct.** Phase 0 extends
`pnpm verify` with `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`, and the Svelte
typecheck. Update this block and [`.github/workflows/ci.yml`](.github/workflows/ci.yml) in the same
commit that wires them.

## Architecture

Module breakdown, persistence tables, the sync model, and OAuth flows live in
[`docs/idea.md`](docs/idea.md) §5 Technical Architecture. **Read the relevant module there before
adding or reshaping one**; do not restate it here, it will drift.

Two constraints that are easy to get wrong and expensive to undo:

- **Rendering.** WebGL2 is first-class, not a fallback: Linux WebKitGTK has no stable WebGPU. Effects
  are specified once and implemented as a WGSL/GLSL pair. A feature that only works on the WebGPU
  path is half-built.
- **Time granularity.** Google Tasks `due` is date-only, so task deadlines and HP penalties operate at
  day granularity. Calendar events keep precise times. Do not assume a task has a time.

## Anti-Patterns

Each of these is decided and load-bearing. Sources are authoritative; read them before arguing.

- Do not add Calendar write-back or event creation in v1 — Calendar is read-only (idea.md §5).
- Do not import anything from Google until the user subscribes that specific source to a campaign. A
  calendar appearing in the account list is not consent to import it.
- Do not let an imported item cost HP. Only quests the user explicitly flagged as critical reduce HP
  (idea.md §6).
- Do not grant XP without an idempotency key, and do not grant it twice for the same key. Completion
  may arrive from the app or from Tasks sync; un-completing reverts the XP and logs a visible entry.
- Do not use `USE_EXACT_ALARM` on Android. Use `SCHEDULE_EXACT_ALARM` with an explicit user grant and
  an inexact-alarm fallback (ADR-0003).
- Do not sign in on Android through an embedded webview or a custom URI scheme; Google blocks both for
  new clients. Use GIS `AuthorizationClient` via the Kotlin plugin (idea.md §5).
- Do not send user data, prompts, quest titles, or event descriptions to any third party without the
  user having enabled that feature and supplied the key. A default install talks to Google and nobody
  else (ADR-0002).
- Do not add a telemetry, analytics, crash-reporting, or "anonymous usage" SDK. This includes
  privacy-friendly ones and anything enabled by a build flag.
- Do not call the AI provider from the frontend webview. Keys and egress belong in Rust (ADR-0002).
- Do not add a `Manager` suffix, and do not add a module without an ADR.

## ADRs — `docs/adr/`

Read the full ADR when it governs your work; the file is the authority, this is an index.

- **Accepted:** [0001](docs/adr/0001-agentic-development-workflow.md) agentic development workflow ·
  [0002](docs/adr/0002-optional-ai-bring-your-own-key.md) optional AI, bring your own key ·
  [0003](docs/adr/0003-android-exact-alarms.md) Android exact alarms
- **Pending:** the open questions in [`docs/idea.md`](docs/idea.md) §12 stay there until one is
  decided. A decided question gets a number here and a file in `docs/adr/`.

Adding a system requires an ADR. An ADR outranks code docs and outranks this file.

## Working Agreement

- **Roles — [`docs/workflow.md`](docs/workflow.md).** One ticket → one branch + PR. The reviewer
  is a different session from the author, posts findings on the PR, and never edits the branch; the
  owner merges. Implementer → `/implement` driving `/tdd` at seams agreed up front, then a PR labelled
  `status:in-review`. Planner → `/grill-with-docs`, then `/to-spec` and `/to-tickets`. Queue and
  session start → `/work`.
- **Update the co-located `.md` in the same commit** as the code, and update the issue. Do not batch
  either to the end of a sprint.
- **One concern per commit** — do not mix a refactor with a feature.
- **Change a convention → change this file in the same commit**, and keep it under 200 lines.
- **Leave the tree clean.** Uncommitted work makes the next agent's picture of the repo wrong.
- **A claim about the code requires reading the code.** Write no finding of the form "X does not
  handle Y" without having read X's implementation of Y.
