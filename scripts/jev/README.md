# Jev dev tools

Small command-line tools that hand closed-set workflow decisions to TypeSafe's Jev model, so a
thinking model does not spend tokens on them. Dev tooling only, never app code
([ADR-0004](../../docs/adr/0004-jev-dev-tooling-only.md)). Each runs with plain `node` in any harness.

| File | What it is |
|---|---|
| `constants.mjs` | The pinned model id, **every threshold**, and Jev's context limits. Tune them here, in one reviewed edit |
| `client.mjs` | The shared client: `available()` checks the key and SDK without a request, `ask()` makes one request, and neither throws. Also `errorLine`, the one redacting error-to-line helper every tool and CLI uses |
| `triage.mjs` | The triage helper, `run(input, { client, root })`. `root` is the repo root the docs are read from; it defaults to this repo, and tests point it at a temp tree |
| `triage-cli.mjs` | Its CLI |
| `triage.test.mjs` | Tests at the `run()` seam with a fake client, plus CLI runs as a subprocess with a `gh` stub on PATH; run by `pnpm scripts:test` |
| `prune.mjs` | The doc pruner, `run(input, { client, root })`, with `root` as in the triage helper |
| `prune-cli.mjs` | Its CLI |
| `prune.test.mjs` | Tests at its `run()` seam over a git repo built in a temp dir, plus CLI runs with a `gh` stub and a fake Jev server on localhost |
| `verify.mjs` | The finding verifier, `run(input, { client, root })`, and `human(result)`, the CLI's default output. `root` is the repo root the review checklist is read from |
| `verify-cli.mjs` | Its CLI |
| `verify.test.mjs` | Tests at the `run()` seam with a fake client, plus CLI runs as a subprocess; run by `pnpm scripts:test` |
| `fixtures/findings.sample.json` | A sample findings file in the input format, for a live check and as a template |

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
`AGENTS.md` always first, then each ADR, spec, `docs/idea.md` section and co-located doc that Jev
judges relevant to the work, in the order below. The agent reads those and skips the rest. It leans towards including, because missing a
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
- **Each spec**: a tracked `.md` file under `docs/specs/`. A spec outranks `docs/idea.md` in
  `AGENTS.md`'s precedence order, so it is judged like the sections below it.
- **Each `docs/idea.md` section**: one per `#` or `##` heading, running to the next one, so the
  title and intro form one unit and each numbered section (`## 5. Technical Architecture`) is one
  unit with its `###` subsections inside it. That is the level the other docs cite ("idea.md §5"),
  and a `###` subsection is often a few lines that mean little without its section. A heading
  inside a code fence is not a heading.
- **Each co-located `.md`**: a tracked `.md` file in a subdirectory, beside the code it describes,
  except under `docs/`, under a dot-directory (`.agents/` skills, `.github/`) or under
  `node_modules/`. Root files are not units: `AGENTS.md` is always on the list, and `README.md`
  is the project's front page. Tracked means `git ls-files`: an untracked file is not
  authoritative, and the rule keeps out build output and nested worktrees.

The units are listed in that order, which is `AGENTS.md`'s precedence order. The rest of `docs/`
is not judged, because it says how to work rather than what governs the code a ticket touches,
and each file is already reached by name at the step that needs it. `docs/workflow.md` is the
loop `/work` runs, `docs/dev_setup.md` is what `AGENTS.md` sends you to before anything
system-level, and `docs/agents/*.md` is the skills' wiring: `issue-tracker.md` for `/work` and
every tracker step, `triage-labels.md` for `/triage`, `domain.md` for the engineering skills.
Pruning those would hide a step's instructions from the agent running that step, and listing them
for every ticket would add the same docs to every list.

**Batching.** The questions go in as few requests as Jev's limits allow: 64k tokens a request,
and 32k for the state plus the longest question. Sizes are estimated at
`JEV_CHARS_PER_TOKEN` (3) characters a token, which overestimates English, so an accepted batch
fits. A unit too large for one question beside the state is put on the list without asking, with
reason `oversize`. All the limits live in `constants.mjs`.

If git or `docs/idea.md` cannot be read, or Jev leaves a unit unanswered, the tool prints an error
line and exits 0, and the agent reads the docs as it would without the tool.

## Finding verifier

Checks a Reviewer's draft findings before the report is posted: does each finding's quoted line,
read against its cited source, support it? Each finding comes back with a decision:

- **keep** — Jev's Noul (the probability that the source supports the finding) is at or above
  `VERIFY_FLAG_BELOW` (0.7).
- **flag** — below it. Re-read the cited source once, then keep or drop the finding yourself. The
  tool never removes a finding.

The threshold was set from one live sample, the fixture below: its supported finding scored 0.89
and its unsupported one 0.61, so the first guess of 0.5 kept both. A flag costs only one re-read,
while a kept false finding costs a fix round, so the threshold errs towards flagging. Retune it in
`constants.mjs` as more live runs come in.

Two kinds of finding are kept without asking Jev, so they are never flagged:

- **Constitution findings** — the `source` mentions "constitution", or the `excerpt` quotes any
  sentence or semicolon clause of a bullet under **The constitution** in
  [`docs/workflow.md`](../../docs/workflow.md)'s review checklist, or a bullet's first five words,
  ignoring case, punctuation and spacing. The match errs towards exempting: keeping a finding
  unasked costs nothing, flagging a constitution one could cost a violation. The bullets are read
  from that doc on every run; if the section is gone, the tool prints an error line rather than
  run without the exemption. A finding that cites the rule only through `AGENTS.md`, in none of the
  checklist's words, is still checked, so cite one as
  `docs/workflow.md § Review checklist, The constitution`. A Reviewer never drops a
  constitution-level finding on a flag alone, however it was cited.
- **Too large to check** — a finding whose own text, quote and excerpt overflow one request.

How the Reviewer uses it is in [`docs/workflow.md`](../../docs/workflow.md) § 3 and the Reviewer
steps of [`/work`](../../.agents/skills/work/SKILL.md).

### Input

A JSON array of findings, from a file or stdin. Every field but `id` is a non-empty string:

```json
[
  {
    "id": "F1",
    "text": "The finding, as the report states it.",
    "quote": "the line under review the finding is about",
    "source": "docs/workflow.md § Review checklist, The constitution",
    "excerpt": "The text of the cited source the finding relies on."
  }
]
```

`id` is optional and defaults to `F1`, `F2`, … by position; ids must be unique. `source` names
the rule or spec the finding cites (a doc and section, an ADR, the issue) and `excerpt` is the
relevant text of it, copied. [`fixtures/findings.sample.json`](fixtures/findings.sample.json) is a
sample to copy and to make a live check with. Its findings are illustrative: F1's source supports
it (expect `keep`), F2 quotes a real line that does not show what it claims (expect `flag`), and
F3 cites the constitution. An empty input, a value that is not an array, or a finding that is not
an object, has a blank field or repeats an id is an error line naming the first problem, and
nothing is sent: fix that finding and run again.

```bash
node scripts/jev/verify-cli.mjs findings.json           # one line per finding
node scripts/jev/verify-cli.mjs findings.json --json    # one JSON object instead
node scripts/jev/verify-cli.mjs < findings.json         # from stdin
pnpm run --silent jev:verify findings.json              # the same, through pnpm
```

Default output, one line per finding in input order:

```text
F1: keep (noul 0.92)
F2: flag (noul 0.31) - re-read the cited source once, then keep or drop the finding
F3: keep (cites the constitution, never flagged)
F4: keep (too large to check)
```

`--json` prints `{ status: "ok", findings }`, where each finding is
`{ id, decision: "keep" | "flag", noul, reason: "checked" | "constitution" | "too-large" }` and
`noul` is `null` unless the reason is `checked`; or `{ status: "skipped" | "error", reason }`.

### Requests

Jev's state is the batch's findings, keyed `f<n>` by their position `n` in the whole input (so a
batch's keys need not start at `f1`), each with its `text`, `quote`, `source`
and `excerpt`; each finding gets one Noul question that names its own key. Findings are packed
first-fit into as few requests as Jev's two context limits allow (`docs.typesafe.ai/models`): 64k
tokens for the state plus every question, and 32k for the state plus the longest question. Both
limits and `JEV_CHARS_PER_TOKEN`, the conservative characters-per-token estimate used to size a
request before sending it, are in `constants.mjs`, shared with the doc pruner. If any request
fails, the whole run is one error line: the Reviewer never gets half the findings checked.

## Skip behaviour

Every tool is optional. Without `TYPESAFE_API_KEY` in the environment, or without the SDK
installed (`pnpm install` not run), it makes no request, prints one line and exits 0. The client's
`available()` checks both before any other work, so a keyless run never calls `gh`, reads a doc
or reads its input:

```text
jev triage: skipped, TYPESAFE_API_KEY is not set; triage as normal
jev prune: skipped, TYPESAFE_API_KEY is not set; read the docs as normal
jev verify: skipped, TYPESAFE_API_KEY is not set; continue as normal
```

Any other failure prints one `jev <tool>: error, …` line and also exits 0: network, an API error,
`gh` failing, a doc that no longer parses, or input that is never sent to Jev because it is empty
or malformed (an issue with no title, such as empty stdin, or a findings file that is not a JSON
array of complete findings). Nothing here fails the caller's workflow; the caller carries on as it would
without the tool. The key comes from the owner's shell only
([`docs/dev_setup.md`](../../docs/dev_setup.md) § The TypeSafe dev key) and is never printed.

## The SDK

`@typesafe-ai/sdk` is an exact-pinned devDependency, loaded with a dynamic `import()` so a missing
module is a skip, not a crash. It is pre-1.0: a version bump is its own PR. The model is pinned in
`constants.mjs` (`jev-1.13.0`, never `jev-latest`) because the thresholds are calibrated against
one model's confidence. `scripts/check-skills.mjs` does not use the SDK and stays dependency-free.
