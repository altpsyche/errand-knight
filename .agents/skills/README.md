# Agent skills

Vendored from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT) at commit
`7a030a8b0dcaa601bb0dda9aaf174affb3d61145` (v1.3.1). They are kept as ordinary files so every
model, in every harness, reads the same version.

- **Every harness**, including Claude Code and the DeepSeek Harness (DSH), starts at the root
  `AGENTS.md`, which points at this folder. A skill is used by reading its `SKILL.md` and
  following it; `/name` in any doc is shorthand for exactly that. There is deliberately no
  `.claude/` folder, and no harness-specific wiring of any kind: every agent takes the same path.
- DSH discovers these skills automatically and injects each `description` into context, so no
  registration step is needed.

Who runs which skill is defined in [`docs/workflow.md`](../../docs/workflow.md). Repo config
the skills read lives in [`docs/agents/`](../../docs/agents/).

## Included

| Planning | Building | Reviewing | Shared / reference |
|---|---|---|---|
| [`grill-with-docs`](./grill-with-docs/SKILL.md), [`grill-me`](./grill-me/SKILL.md), [`to-spec`](./to-spec/SKILL.md), [`to-tickets`](./to-tickets/SKILL.md), [`triage`](./triage/SKILL.md), [`research`](./research/SKILL.md) | [`implement`](./implement/SKILL.md), [`tdd`](./tdd/SKILL.md), [`diagnosing-bugs`](./diagnosing-bugs/SKILL.md), [`pr`](./pr/SKILL.md), [`prototype`](./prototype/SKILL.md), [`wizard`](./wizard/SKILL.md) | [`review-pr`](./review-pr/SKILL.md), [`retro`](./retro/SKILL.md) | [`grilling`](./grilling/SKILL.md), [`domain-modeling`](./domain-modeling/SKILL.md), [`codebase-design`](./codebase-design/SKILL.md), [`handoff`](./handoff/SKILL.md), [`writing-for-agents`](./writing-for-agents/SKILL.md), [`setup-matt-pocock-skills`](./setup-matt-pocock-skills/SKILL.md) |

**Local skill (not upstream):** [`work`](./work/SKILL.md) is the session-start router behind
"let's work". It picks the role, picks the next item from the tracker, confirms with the owner,
then hands off to the skills above.

**From TypeSafe (not mattpocock):** [`typesafe-ai`](./typesafe-ai/SKILL.md), the reference for
TypeSafe's API and its Jev model, used only to build the repo's dev tooling. Its description says
"use when a feature needs…", but Jev never goes into app code:
[ADR-0004](../../docs/adr/0004-jev-dev-tooling-only.md) fences it to dev tooling.

## Deliberately left out

Trimmed to keep context load down. Any of these can be vendored later by re-copying from the
pinned commit above.

- `wayfinder` — the roadmap in `docs/idea.md` already charts Phase 0 to 6; there is no fog to map yet.
- `improve-codebase-architecture` — nothing to scan in a pre-Phase-0 repo.
- `implement-spec` — overlaps `implement`; revisit if parallel worktree subagents become routine.
- `setup-ts-deep-modules` — a one-shot dependency-cruiser setup; run it once the frontend exists.
- `ask-matt` — upstream's router for its own flows; [`work`](./work/SKILL.md) replaces it here.
- `teach`, `to-questionnaire`, `wait-what`, `scaffold-exercises`, `migrate-to-shoehorn`,
  `setup-pre-commit`, `git-guardrails-claude-code`, and everything under `in-progress/`.

## Local changes — re-apply after updating from upstream

1. `engineering/code-review` is vendored as **`review-pr`**, which says what it reviews and is not
   mistaken for the built-in review commands some harnesses ship. The rename is applied to the
   frontmatter `name`, the `agents/openai.yaml` display name, and the cross-references in
   `implement` and `tdd`.

Everything else is byte-identical to upstream. This repo uses lowercase `docs/`, `docs/adr/`,
`docs/agents/`, and `GLOSSARY.md`, which are the upstream defaults, so **no path rewrites are
needed**. Keep it that way: a capitalised `Docs/` would reintroduce a rewrite on every update.

## TypeSafe skill

Vendored from [typesafe-ai/skills](https://github.com/typesafe-ai/skills) (MIT) at commit
`65a39f393687675ce170e6094757de20370365b9`: every file under `skills/typesafe-ai/` (`SKILL.md` and
`LICENSE`), copied to [`typesafe-ai/`](./typesafe-ai/SKILL.md). **No local changes**: both files are
byte-identical to upstream, so an update is a re-copy, never a merge. It is deliberately not
installed through the Claude plugin or `npx skills`; both are harness-specific.

To update, pick the new commit `<sha>`, then for each file the upstream tree lists:

```bash
gh api "repos/typesafe-ai/skills/git/trees/<sha>?recursive=1" \
  --jq '.tree[] | select(.path | startswith("skills/typesafe-ai/")) | [.path, .sha] | @tsv'
gh api "repos/typesafe-ai/skills/contents/skills/typesafe-ai/<file>?ref=<sha>" --jq .content \
  | base64 -d > .agents/skills/typesafe-ai/<file>
git hash-object .agents/skills/typesafe-ai/<file>   # must equal the blob sha the tree listed
```

Then update the pin in this section, and run `pnpm skills:check`.
