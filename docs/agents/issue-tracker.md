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
- **List PRs** for a PR frontier, open, carrying one label and unclaimed, oldest first. It asks
  GraphQL for each PR's newest comment directly, because `gh pr list --json comments` reads only
  a PR's first 100 comments:
  `gh api graphql -F owner='{owner}' -F repo='{repo}' -F label=<label> -f query='query($owner:String!,$repo:String!,$label:String!){repository(owner:$owner,name:$repo){pullRequests(states:OPEN,labels:[$label],first:100,orderBy:{field:CREATED_AT,direction:ASC}){nodes{number title comments(last:1){nodes{body}}}}}}' --jq '.data.repository.pullRequests.nodes[] | select(.comments.nodes[0].body // "" | startswith("Claimed:") | not) | {number, title}'`
- **Comment**: `gh issue comment <number> --body "..."`
- **Label**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`
- **Claim**: `gh issue edit <number> --add-assignee @me` then
  `gh issue comment <number> --body "Claimed: branch <number>-<slug> (session <token>)"`, then
  **Read back a claim**. Every session shares the owner's account, so the comment is the claim and
  the token tells sessions apart; the assignee only hides the issue from the frontier. The owner
  frees an issue claim left by a dead session by unassigning it and commenting.
- **Claim a PR** for a review or a fix round:
  `gh pr comment <number> --body "Claimed: review (session <token>)"` or
  `--body "Claimed: fix round (session <token>)"`, then **Read back a claim**. A PR is claimed
  while its newest comment starts with `Claimed:`, which is what **List PRs** filters on. The
  session posts nothing else until its report or its answer to the findings, which it posts after
  the label swap, and that comment releases the claim. Any other comment releases it too, so the
  owner frees a claim left by a dead session by commenting.
- **Session token**: eight random hex characters, generated once per session with
  `openssl rand -hex 4`, and carried by every claim the session posts.
- **Read back a claim**, straight after posting it, for an issue or a PR alike. The claims that
  count are the `Claimed:` comments after the newest comment that is not one, and the earliest of
  them wins. This prints the winner and the item's labels:
  `gh api graphql -F owner='{owner}' -F repo='{repo}' -F n=<number> -f query='query($owner:String!,$repo:String!,$n:Int!){repository(owner:$owner,name:$repo){issueOrPullRequest(number:$n){... on Issue{labels(first:20){nodes{name}} comments(last:100){nodes{body}}} ... on PullRequest{labels(first:20){nodes{name}} comments(last:100){nodes{body}}}}}}' --jq '.data.repository.issueOrPullRequest | {labels: [.labels.nodes[].name], winner: (.comments.nodes | .[((map(.body | startswith("Claimed:") | not) | rindex(true)) // -1) + 1:] | first | .body)}'`
  The session holds the item only if the winner carries its token and the item still carries the
  label that put it on the frontier. Otherwise it backs off: it deletes its own claim with
  `gh api -X DELETE 'repos/{owner}/{repo}/issues/comments/<id>'`, where `<id>` is the number
  after `issuecomment-` in the URL that posting the claim printed, then picks again. On an issue
  it leaves the assignee, which the winner shares.
- **Branch**: `git fetch origin` then `git switch -c <number>-<slug> origin/main`. Branch from
  `origin/main`, not a local `main` that may be stale.
- **Open a PR**: `git push -u origin HEAD` then
  `gh pr create --title "..." --body-file <file> --label status:in-review`. The body contains
  `Closes #<number>` so merging closes the issue.
- **Check out a PR** for review or a fix round: `git fetch origin` then `gh pr checkout <number>`.
  A Reviewer uses `origin/main`, not `main`, as the fixed point.
- **Post a review**:
  `gh pr edit <number> --remove-label status:in-review --add-label status:changes-requested` (or
  `status:approved` when the report has zero open findings), then
  `gh pr comment <number> --body-file <file>`. The label goes first so the report, which releases
  the claim, is the last write. GitHub forbids approving your own PR and every session is the
  owner's account, so the label, not a GitHub review, carries the verdict.
- **Return a PR for review** after a fix round, per [`docs/workflow.md`](../workflow.md) § 4:
  `gh pr edit <number> --remove-label status:changes-requested --add-label status:in-review`, then
  `gh pr comment <number> --body-file <file>` with the answer to each finding.

`gh` infers the repo from `git remote -v` when run inside the clone.

## Labels

Two families, both defined up front so agents never invent a label:

- **Triage roles** — see [`triage-labels.md`](./triage-labels.md).
- **Phase** — `phase:0` … `phase:6`, mirroring [`docs/idea.md`](../idea.md) § Roadmap. Every
  issue carries exactly one. Two rules apply it: publishing an issue from a skill, below, and
  moving an issue to `ready-for-agent` or `ready-for-human` in triage, per
  [`triage-labels.md`](./triage-labels.md).

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

Create a GitHub issue and apply the label the skill names, **plus exactly one `phase:N`**. The
vendored skills do not know about phase labels, so this line is the only thing that adds them.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Not currently used: `/wayfinder` is not vendored (see
[`.agents/skills/README.md`](../../.agents/skills/README.md)). If it is vendored later, the map
is a single issue labelled `wayfinder:map`, children are GitHub sub-issues labelled
`wayfinder:<research|prototype|grilling|task>`, and blocking uses GitHub's native issue
dependencies, with a `Blocked by: #<n>` line in the child body as the fallback.
