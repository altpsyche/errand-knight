---
name: work
description: "Session start for Errand Knight. Use when the owner says \"let's work\", \"work\", \"next\", \"continue\", \"review\", or \"what's next\" without naming a ticket: pick the role, pick the next item from the tracker, confirm with the owner, then run it under docs/workflow.md."
---

# Work

Resolve the session's role and its next item, confirm both with the owner, then run the item
under [`docs/workflow.md`](../../../docs/workflow.md).

## 1. Pick the role

Infer from what the owner says, and say which you picked:

| The owner says | Role |
|---|---|
| "next", "continue", "what's next", "let's work" | **Implementer** |
| "review", "check this", a branch or PR name | **Reviewer** |
| "let's plan", "think about", an idea with no ticket | **Planner** |

When it is genuinely unclear, ask. One question, not three.

## 2. Pick the next item

Read [`docs/agents/issue-tracker.md`](../../../docs/agents/issue-tracker.md) for how to query.
Then apply the role's frontier:

- **Implementer** — open issues labelled `ready-for-agent`, oldest first, with no open blocker
  and no assignee.
- **Reviewer** — open PRs labelled `status:in-review`, oldest first.
- **Planner** — the earliest unfinished Phase in [`docs/idea.md`](../../../docs/idea.md) § Roadmap.

State the item in one line with its number and title, plus the one-sentence reason it is next.
**Then stop and wait for confirmation.** Claiming work the owner did not agree to is the failure
mode here.

If the frontier is empty, say so plainly and propose the most useful thing to do instead: a
`/triage` pass, a `/retro`, or starting the next Phase. Do not invent a ticket.

## 3. Run it

Hand off to the skill the role's step names in `docs/workflow.md`. Do not re-implement the
workflow here; the steps below are the glue the skills themselves do not do. Commands are in
[`docs/agents/issue-tracker.md`](../../../docs/agents/issue-tracker.md).

**Implementer**

1. **Claim**, as the first write after confirmation: assign yourself and comment
   `Claimed: branch <n>-<slug>`. Every session runs as the owner's account, so the comment, not
   the assignee, is what tells two sessions apart.
2. **Branch** from an up-to-date `main` as `<n>-<slug>`. Never commit to `main`.
3. `/implement`, driving `/tdd` at the seams agreed up front. Its closing `/review-pr` is a
   self-check: fix what it finds, but it is not the review. A review by the author is not a review.
4. **Open the PR**: push, then create it with a body written by `/pr` that contains `Closes #<n>`,
   and label it `status:in-review`. Without that label no Reviewer will find it.

**Reviewer** — a session that did not write the diff.

1. `/review-pr` with `main` as the fixed point. Its standards sources here are `AGENTS.md`, the
   review checklist in [`docs/workflow.md`](../../../docs/workflow.md), the ADRs that touch the
   diff, and `CODING_STANDARDS.md` if `/retro` has created it. The originating spec is the issue
   in `Closes #<n>`. When the PR closes no issue, review the Spec axis against the PR body, say so
   in the report, and flag the missing issue as a finding; do not stop to ask.
2. **Post the report** on the PR as a comment. A finding that stays in the chat does not exist.
3. **Set the state**: swap `status:in-review` for `status:approved` only when no finding is open.
   Any finding, however minor, means `status:changes-requested`; see the verdict rule in
   [`docs/workflow.md`](../../../docs/workflow.md) § 3. Never push to the branch.

**Planner** → `/grill-with-docs`, then `/to-spec` and `/to-tickets`.

## 4. Close out

Before ending the session, in this order:

1. The tracker reflects reality: claimed items claimed, finished items closed with a comment.
2. The tree is clean, and the co-located `.md` changed in the same commit as its code.
3. Any convention you changed is changed in `AGENTS.md` in the same commit.
