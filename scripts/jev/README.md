# Jev dev tools

Small command-line tools that hand closed-set workflow decisions to TypeSafe's Jev model, so a
thinking model does not spend tokens on them. Dev tooling only, never app code
([ADR-0004](../../docs/adr/0004-jev-dev-tooling-only.md)). Each runs with plain `node` in any harness.

| File | What it is |
|---|---|
| `constants.mjs` | The pinned model id and **every threshold**. Tune them here, in one reviewed edit |
| `client.mjs` | The shared client: `available()` checks the key and SDK without a request, `ask()` makes one request, and neither throws. Also `errorLine`, the one redacting error-to-line helper every tool and CLI uses |
| `triage.mjs` | The triage helper, `run(input, { client, root })`. `root` is the repo root the docs are read from; it defaults to this repo, and tests point it at a temp tree |
| `triage-cli.mjs` | Its CLI |
| `triage.test.mjs` | Tests at the `run()` seam with a fake client, plus CLI runs as a subprocess with a `gh` stub on PATH; run by `pnpm scripts:test` |
| `prune.mjs` | The doc pruner, `run(input, { client, root })`, with `root` as in the triage helper |
| `prune-cli.mjs` | Its CLI |
| `prune.test.mjs` | Tests at its `run()` seam over a git repo built in a temp dir, plus CLI runs with a `gh` stub and a fake Jev server on localhost |

## Triage helper

Suggests one role label (`needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) and one
`phase:N` for an issue, each with Jev's Choice confidence and a decision:

- **apply** — confidence is at or above `TRIAGE_APPLY_CONFIDENCE` (0.8). Apply the label.
- **defer** — below it. Decide the role as you normally would; treat a deferred phase as unclear,
  which means asking the owner.

A phase is only ever applied alongside `ready-for-agent` or `ready-for-human`; for any other role
the phase line is ignored, though the helper always prints one.

How the agent uses it is in [`docs/agents/triage-labels.md`](../../docs/agents/triage-labels.md).

```bash
node scripts/jev/triage-cli.mjs 3                     # reads issue #3 with `gh issue view`
node scripts/jev/triage-cli.mjs 3 --json              # one JSON object instead
gh issue view 3 --json title,body | node scripts/jev/triage-cli.mjs
node scripts/jev/triage-cli.mjs < issue.txt           # plain text: first non-blank line title, rest body
pnpm run --silent jev:triage 3                        # the same, through pnpm
```

Default output, two lines:

```text
role: ready-for-agent (confidence 0.93) apply
phase: phase:0 (confidence 0.62) defer - phase unclear: ask the owner if the role is ready-for-*
```

`--json` prints `{ status: "ok", role, phase }`, where `role` and `phase` are each
`{ label, confidence, decision }`, or `{ status: "skipped" | "error", reason }`.

Jev sees the issue's title and body as state, and two Choice questions asked in one request. Their
options are read from the authoritative docs on every run rather than copied here, so a roadmap or
label edit cannot drift out of sync with the tool:

- **Role** — the rows of the table in `docs/agents/triage-labels.md`: each row's label (second
  column) with its "Meaning". Every row must name one of the five canonical roles in its first
  column, and all five must be there; a new or missing role is an error line, never silently
  dropped. `needs-triage` is the state being left, so its label is never suggested.
- **Phase** — each `### Phase N — Title` heading under `docs/idea.md` § Roadmap, with its bullets.

If either doc stops matching that shape, the tool prints an error line and exits 0.

## Doc pruner

Says which docs to read before working on a ticket or reviewing a PR. It prints a read list:
`AGENTS.md` always first, then each unit that Jev judges relevant to the work, in the order
below. The agent reads those and skips the rest. It leans towards including, because missing a
governing ADR costs far more than reading an extra doc.

How the agent uses it is in [`/work`](../../.agents/skills/work/SKILL.md) § 3 and
[`docs/workflow.md`](../../docs/workflow.md) §§ 2–3.

```bash
node scripts/jev/prune-cli.mjs 12                     # a PR, with `gh pr view`, falling back to `gh issue view`
node scripts/jev/prune-cli.mjs 8 --json               # one JSON object instead
gh pr view 12 --json title,body,files | node scripts/jev/prune-cli.mjs
node scripts/jev/prune-cli.mjs < ticket.txt           # plain text: first non-blank line title, rest body
pnpm run --silent jev:prune 12                        # the same, through pnpm
```

Default output, one doc a line, with ` § <heading>` for a `docs/idea.md` section:

```text
AGENTS.md
docs/adr/0004-jev-dev-tooling-only.md
docs/idea.md § 12. Open Questions
scripts/jev/README.md
```

`--json` prints `{ status: "ok", read }`, where each entry is `{ path, heading?, reason, noul? }`
and `reason` is `always` (AGENTS.md), `relevant` (with its noul) or `oversize` (see below); or
`{ status: "skipped" | "error", reason }`.

**What Jev sees.** The state is the work: its title, its body and the paths it changes (a PR's
files; none for an issue). Never the diff, which would be large and would push documents out of
the context limit. Each unit is one Noul question, "should an agent doing this work read this
document?", carrying the unit's text. A unit is included at a noul at or above
`PRUNE_INCLUDE_NOUL` (0.2).

**The units**, found on every run so a new doc is judged without an edit here:

- **Each ADR**: a tracked file matching `docs/adr/NNNN-*.md`.
- **Each `docs/idea.md` section**: one per `#` or `##` heading, running to the next one, so the
  title and intro form one unit and each numbered section (`## 5. Technical Architecture`) is one
  unit with its `###` subsections inside it. That is the level the other docs cite ("idea.md §5"),
  and a `###` subsection is often a few lines that mean little without its section. A heading
  inside a code fence is not a heading.
- **Each co-located `.md`**: a tracked `.md` file in a subdirectory, beside the code it describes,
  except under `docs/` (ADRs and `docs/idea.md` are units of their own, and the rest is workflow
  the agent already follows), under a dot-directory (`.agents/` skills, `.github/`) or under
  `node_modules/`. Root files are not units: `AGENTS.md` is always on the list, and `README.md`
  is the project's front page. Tracked means `git ls-files`: an untracked file is not
  authoritative, and the rule keeps out build output and nested worktrees.

**Batching.** The questions go in as few requests as Jev's limits allow: 64k tokens a request,
and 32k for the state plus the longest question. Sizes are estimated at
`JEV_CHARS_PER_TOKEN` (3) characters a token, which overestimates English, so an accepted batch
fits. A unit too large for one question beside the state is put on the list without asking, with
reason `oversize`. All the limits live in `constants.mjs`.

If git or `docs/idea.md` cannot be read, or Jev leaves a unit unanswered, the tool prints an error
line and exits 0, and the agent reads the docs as it would without the tool.

## Skip behaviour

Every tool is optional. Without `TYPESAFE_API_KEY` in the environment, or without the SDK
installed (`pnpm install` not run), it makes no request, prints one line and exits 0. The client's
`available()` checks both before any other work, so a keyless run never calls `gh` or reads a doc:

```text
jev triage: skipped, TYPESAFE_API_KEY is not set; triage as normal
jev prune: skipped, TYPESAFE_API_KEY is not set; read the docs as normal
```

Any other failure prints one `jev <tool>: error, …` line and also exits 0: network, an API error,
`gh` failing, a doc that no longer parses, or an issue with no title (such as empty stdin), which
is never sent to Jev. Nothing here fails the caller's workflow; the caller carries on as it would
without the tool. The key comes from the owner's shell only
([`docs/dev_setup.md`](../../docs/dev_setup.md) § The TypeSafe dev key) and is never printed.

## The SDK

`@typesafe-ai/sdk` is an exact-pinned devDependency, loaded with a dynamic `import()` so a missing
module is a skip, not a crash. It is pre-1.0: a version bump is its own PR. The model is pinned in
`constants.mjs` (`jev-1.13.0`, never `jev-latest`) because the thresholds are calibrated against
one model's confidence. `scripts/check-skills.mjs` does not use the SDK and stays dependency-free.
