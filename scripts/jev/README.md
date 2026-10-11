# Jev dev tools

Small command-line tools that hand closed-set workflow decisions to TypeSafe's Jev model, so a
thinking model does not spend tokens on them. Dev tooling only, never app code
([ADR-0004](../../docs/adr/0004-jev-dev-tooling-only.md)). Each runs with plain `node` in any harness.

| File | What it is |
|---|---|
| `constants.mjs` | The pinned model id and **every threshold**. Tune them here, in one reviewed edit |
| `client.mjs` | The shared client: key and SDK checks, one request, never throws |
| `triage.mjs` | The triage helper, `run(input, { client })` |
| `triage-cli.mjs` | Its CLI |
| `triage.test.mjs` | Tests at the `run()` seam with a fake client; run by `pnpm scripts:test` |

## Triage helper

Suggests one role label (`needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) and one
`phase:N` for an issue, each with Jev's Choice confidence and a decision:

- **apply** — confidence is at or above `TRIAGE_APPLY_CONFIDENCE` (0.8). Apply the label.
- **defer** — below it. Decide the role as you normally would; treat a deferred phase as unclear,
  which means asking the owner.

How the agent uses it is in [`docs/agents/triage-labels.md`](../../docs/agents/triage-labels.md).

```bash
node scripts/jev/triage-cli.mjs 3                     # reads issue #3 with `gh issue view`
node scripts/jev/triage-cli.mjs 3 --json              # one JSON object instead
gh issue view 3 --json title,body | node scripts/jev/triage-cli.mjs
node scripts/jev/triage-cli.mjs < issue.txt           # plain text: first line title, rest body
pnpm run --silent jev:triage 3                        # the same, through pnpm
```

Default output, two lines:

```text
role: ready-for-agent (confidence 0.93) apply
phase: phase:0 (confidence 0.62) defer - phase unclear, ask the owner
```

`--json` prints `{ status: "ok", role, phase }`, where `role` and `phase` are each
`{ label, confidence, decision }`, or `{ status: "skipped" | "error", reason }`.

Jev sees the issue's title and body as state, and two Choice questions asked in one request. Their
options are read from the authoritative docs on every run rather than copied here, so a roadmap or
label edit cannot drift out of sync with the tool:

- **Role** — the "Meaning" column of the table in `docs/agents/triage-labels.md`. `needs-triage`
  is the state being left, so it is never suggested.
- **Phase** — each `### Phase N — Title` heading under `docs/idea.md` § Roadmap, with its bullets.

If either doc stops matching that shape, the tool prints an error line and exits 0.

## Skip behaviour

Every tool is optional. Without `TYPESAFE_API_KEY` in the environment, or without the SDK
installed (`pnpm install` not run), it makes no request, prints one line and exits 0:

```text
jev triage: skipped, TYPESAFE_API_KEY is not set; triage as normal
```

Any other failure (network, an API error, `gh` failing, a doc that no longer parses) prints one
`jev triage: error, …` line and also exits 0. Nothing here fails the caller's workflow; the caller
carries on as it would without the tool. The key comes from the owner's shell only
([`docs/dev_setup.md`](../../docs/dev_setup.md) § The TypeSafe dev key) and is never printed.

## The SDK

`@typesafe-ai/sdk` is an exact-pinned devDependency, loaded with a dynamic `import()` so a missing
module is a skip, not a crash. It is pre-1.0: a version bump is its own PR. The model is pinned in
`constants.mjs` (`jev-1.13.0`, never `jev-latest`) because the thresholds are calibrated against
one model's confidence. `scripts/check-skills.mjs` does not use the SDK and stays dependency-free.
