# Issue tracker

Issues and specs for this repo live as **GitHub issues** on `altpsyche/errand-knight`. Issues
are authoritative and public. Use the `gh` CLI for all operations.

`.scratch/` is a local, gitignored scratch area for in-flight thinking that is not ready to be
public: draft specs, ticket breakdowns mid-edit, wayfinding notes. **Nothing authoritative lives
in `.scratch/`**; promote it to a GitHub issue when it stabilises. If the two ever disagree,
the GitHub issue wins.

## Conventions

- **Create**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read**: `gh issue view <number> --comments`, also fetching labels:
  `gh issue view <n> --json number,title,body,labels,comments`.
- **List**: `gh issue list --state open --json number,title,body,labels,assignees --jq '[.[] | {number, title, labels: [.labels[].name], assignees: [.assignees[].login]}]'`
- **Comment**: `gh issue comment <number> --body "..."`
- **Label**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

`gh` infers the repo from `git remote -v` when run inside the clone.

## Labels

Two families, both defined up front so agents never invent a label:

- **Triage roles** — see [`triage-labels.md`](./triage-labels.md).
- **Phase** — `phase:0` … `phase:6`, mirroring [`docs/idea.md`](../idea.md) § Roadmap. Every
  issue carries exactly one.

## Local markdown fallback

When GitHub is unreachable (offline, or no network in the sandbox), fall back to local markdown
and say so in your reply:

- One file per feature or effort: `.scratch/<effort-slug>/spec.md`.
- One file per ticket: `.scratch/<effort-slug>/issues/NN-<slug>.md`, numbered from `01`, with a
  `Blocked by:` line at the top when it depends on another ticket.
- The **frontier** is the open ticket with the lowest number whose blockers are all closed.

Reconcile to GitHub in the same session, or tell the owner which items are still local-only.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo starts treating external PRs as
feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr`
equivalents: `gh pr view <n> --comments`, `gh pr diff <n>`, `gh pr list --state open --json
number,title,body,labels,author,authorAssociation`, `gh pr comment`, `gh pr edit --add-label`,
`gh pr close`. Keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or
`NONE`. GitHub shares one number space across issues and PRs, so resolve a bare `#42` with
`gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue and apply the label the skill names.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Not currently used: `/wayfinder` is not vendored (see
[`.agents/skills/README.md`](../../.agents/skills/README.md)). If it is vendored later, the map
is a single issue labelled `wayfinder:map`, children are GitHub sub-issues labelled
`wayfinder:<research|prototype|grilling|task>`, and blocking uses GitHub's native issue
dependencies, with a `Blocked by: #<n>` line in the child body as the fallback.
