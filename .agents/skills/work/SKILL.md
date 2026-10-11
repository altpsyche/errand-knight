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
  and no assignee. Claim the winner as your first write.
- **Reviewer** — open PRs labelled `status:in-review`, oldest first.
- **Planner** — the earliest unfinished Phase in [`docs/idea.md`](../../../docs/idea.md) § Roadmap.

State the item in one line with its number and title, plus the one-sentence reason it is next.
**Then stop and wait for confirmation.** Claiming work the owner did not agree to is the failure
mode here.

If the frontier is empty, say so plainly and propose the most useful thing to do instead: a
`/triage` pass, a `/retro`, or starting the next Phase. Do not invent a ticket.

## 3. Run it

Hand off to the skill the role's step names in `docs/workflow.md`. Do not re-implement the
workflow here.

- Implementer → `/implement`, driving `/tdd` at seams agreed up front, closing with `/review-pr`.
- Reviewer → `/review-pr`.
- Planner → `/grill-with-docs`, then `/to-spec` and `/to-tickets`.

## 4. Close out

Before ending the session, in this order:

1. The tracker reflects reality: claimed items claimed, finished items closed with a comment.
2. The tree is clean, and the co-located `.md` changed in the same commit as its code.
3. Any convention you changed is changed in `AGENTS.md` in the same commit.
