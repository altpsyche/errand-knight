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
