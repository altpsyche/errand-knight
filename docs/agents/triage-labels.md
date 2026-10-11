# Triage labels

The skills speak in terms of five canonical triage roles. This file maps each role to the label
string `altpsyche/errand-knight` actually uses.

| Role in mattpocock/skills | Label here | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Owner needs to evaluate this issue |
| `needs-info` | `needs-info` | Waiting on the reporter for more information |
| `ready-for-agent` | `ready-for-agent` | Fully specified; an implementer model can start |
| `ready-for-human` | `ready-for-human` | Needs human hands: OAuth consent screens, store listings, GPU testing on real hardware, signing identities |
| `wontfix` | `wontfix` | Will not be actioned |

**Moving an issue to `ready-for-agent` or `ready-for-human` also applies exactly one `phase:N`**,
below, in the same edit, whoever filed the issue. Those two states put an issue on a frontier, and
the vendored `/triage` does not know phase labels exist, so this line is what adds them. If the
phase is unclear, ask the owner rather than guess.

## Ask Jev first

Before choosing a role or a phase for an issue, run the triage helper
([`scripts/jev/README.md`](../../scripts/jev/README.md)):

```bash
node scripts/jev/triage-cli.mjs <number>
```

It prints one line for the role and one for the phase, each ending in `apply` or `defer`. Settle
the role first; the phase follows from it:

- **Role `apply`** — apply that role label without deliberating.
- **Role `defer`** — decide the role as you normally would.
- **Phase** — only when the role you end up with is `ready-for-agent` or `ready-for-human`, per the
  rule above. Then `apply` means apply that `phase:N`, and `defer` means the phase is unclear: ask
  the owner. For any other role, ignore the phase line; the helper always prints one.
- **A skip or error line** (`jev triage: skipped, …` or `jev triage: error, …`) — continue as
  normal, as if the tool did not exist.

The helper only suggests the role and phase labels. Everything else `/triage` does, including
`needs-triage`, comments and closing, is unchanged.

## Creating the labels

The five role labels are created **before** `/triage` first runs, so it applies existing labels
instead of inventing near-duplicates. Create them with:

```bash
for l in needs-triage needs-info ready-for-agent ready-for-human wontfix; do
  gh label create "$l" --force
done
```

## Phase labels

Every issue also carries exactly one `phase:N` label, 0 through 6, mirroring
[`docs/idea.md`](../idea.md) § Roadmap. Create them the same way:

```bash
for n in 0 1 2 3 4 5 6; do gh label create "phase:$n" --force; done
```

## PR review state

PR review uses its own labels, separate from triage: `status:in-review`, `status:changes-requested`,
`status:approved`, `status:blocked`. See [`docs/workflow.md`](../workflow.md) § Where state lives.
