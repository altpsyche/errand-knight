# Development & Review Workflow

How work moves from idea to merged code. Skills live in
[`.agents/skills/`](../.agents/skills/README.md); the human is the index that reaches for them.

Session start is [`/work`](../.agents/skills/work/SKILL.md): it picks the role, picks the next item
from the tracker, and confirms both before anything is written.

## Roles

| Role | Owns | Never does |
|---|---|---|
| **Owner** (human) | Priorities, ADRs, merging, anything on the `ready-for-human` list | Waits on an agent for a decision it could make |
| **Planner** | Sharpening the idea, the spec, the ticket breakdown | Writes implementation code |
| **Implementer** | One ticket, test-first, on a branch | Touches an unrelated file, or merges |
| **Reviewer** | Two-axis review of the diff since a fixed point | Edits the branch under review |

One agent may hold several roles in a session, but never Implementer and Reviewer for the same diff.
A review by the author of the change is not a review.

## The loop

```
idea → grill → spec → tickets → implement (tdd) → review → fix rounds → merge → retro
        ↑                                                                      ↓
        └──────────────── environment improves ────────────────────────────────┘
```

The last arrow is the point. A `retro` that changes nothing about the environment is a status report.

## Steps

### 1. Plan (Planner)

Reach for `/grill-with-docs` when a repo exists to leave a paper trail in, `/grill-me` when it does
not. It interrogates a frontier of decisions one round at a time, writing terms to `GLOSSARY.md` and
hard-to-reverse choices to `docs/adr/` as they land.

Then `/to-spec` synthesises what was already discussed into `docs/specs/<slug>.md`. It does not
interview; the grilling already did. Then `/to-tickets` cuts the spec into **tracer-bullet** tickets,
each declaring its blocking edges, and publishes them to the tracker with `ready-for-agent` or
`ready-for-human`.

**Done when:** every ticket is small enough for one session, its blockers are declared, and the owner
has confirmed the spec's testing seams.

### 2. Implement (Implementer) — `/implement`

Claim the ticket as the first write, so two sessions never collide, then branch as `<n>-<slug>`; nothing
is committed to `main`. Read the ADRs that touch the area. Then drive `/tdd` at the seams agreed during
planning.

- Red before green. One slice at a time: one test, one minimal implementation, repeat.
- `pnpm verify` runs regularly, and once more at the end.
- Run the app for anything user-visible. A green suite is not evidence a window rendered.
- Commit to the branch; one concern per commit.

**Done when:** the ticket's own acceptance criteria pass, `pnpm verify` is green, every source you
made stale is corrected in the same commit, and a PR whose body says `Closes #<n>` is open and labelled
`status:in-review`.

### 3. Review (Reviewer) — `/review-pr`

Run by a session that did not write the diff. It claims the PR first, as an Implementer claims a
ticket, and posts the report last, after setting the verdict; the report releases the claim. Two
axes, run as parallel sub-agents and reported side by side:

- **Standards** — does the diff follow `AGENTS.md`, `docs/workflow.md`'s checklist below, the ADRs that
  touch it, and `CODING_STANDARDS.md` once `/retro` has created it?
- **Spec** — does it faithfully implement the originating spec, no more and no less?

The reviewer sets the verdict and posts the report as a PR comment; it does not push to the branch.
Every finding names its source and quotes the line it is about. The Implementer's own `/review-pr` run
at the end of `/implement` is a self-check, not this step.

**The verdict is strict.** `status:approved` means the report has zero open findings. Any finding at
all, including a judgement call, a low-severity edge case or a nit, sets `status:changes-requested`.
There is no "non-blocking" finding and no "approve, but consider…": a finding worth writing down is
worth a fix round. Severity orders the list; it does not decide the verdict. On a re-review, every
earlier finding is either fixed or closed by a dispute the reviewer accepted, and the new diff is
reviewed in full, so new findings start another round.

### 4. Fix rounds

The implementer claims the PR first, then addresses every finding on the same branch, whatever its
severity. The issue is already claimed and the branch and PR exist, so a fix round skips claiming the
issue, branching and opening a PR. A finding may be disputed, with a reason and a source; "it works"
and "it is minor" are not disputes. The reviewer either accepts the dispute, which closes the
finding, or holds it, which keeps the PR in changes requested. Scope creep found in review becomes a
new ticket, not a bigger diff.

When the round is done, swap `status:changes-requested` back to `status:in-review`, then post one PR
comment that answers each finding: fixed in `<sha>`, naming the test for a behaviour change, or
disputed with a reason and a source. That comment is the last write, and it releases the claim.

### 5. Merge and learn (Owner)

The owner merges. Then `/retro` looks back over the session and proposes changes to the **environment**
rather than the code: pointers in `AGENTS.md`, a deterministic check where a mistake was mechanical, a
standard where it was a judgement call.

**Done when:** the issue is closed with a comment linking the PR, and every accepted retro action has
either landed or become its own issue.

## Review checklist

Applied in full on every review. Each line is a hard rule, not a judgement call.

**Correctness**

- Every acceptance criterion in the spec is demonstrably met.
- A behaviour change has a test that fails without it. Name the test.
- No test asserts an implementation detail, and no expected value is recomputed the way the code does.

**The constitution** — a violation here blocks the merge outright

- No telemetry, analytics, ads, or monetisation of any kind, including build-flagged.
- No new outbound network destination. Adding one requires an ADR.
- Nothing is imported from Google that the user did not subscribe.
- Imported items never cost HP.
- AI features are off by default and require a user-supplied key; the frontend never holds that key.

**Stack**

- `cargo fmt` and `cargo clippy -- -D warnings` clean.
- Migrations are additive and reversible; no destructive migration without an ADR.
- Writes that can be retried carry an idempotency key.
- Anything touching time states the granularity it assumes (day vs instant).
- The renderer change works on both the WebGPU and WebGL2 paths, or the PR says which one it covers.
- New UI is real DOM, keyboard-navigable, and readable by a screen reader with the canvas absent.

**Craft**

- The co-located `.md` is updated in the same commit.
- One concern per commit.
- No `Manager` suffix; no module without an ADR.
- `AGENTS.md` is still under 200 lines and still true.

## Where state lives

**The tracker is the state.** Nothing about an item's status lives only in a chat log or a `.md` file.

| State | Representation |
|---|---|
| Needs evaluation | `needs-triage` |
| Blocked on the reporter | `needs-info` |
| Specified, agent can start | `ready-for-agent` |
| Needs human hands | `ready-for-human` |
| Won't action | `wontfix` |
| In review | `status:in-review` |
| Changes requested | `status:changes-requested` |
| Approved, not merged | `status:approved` |
| Blocked by another item | `status:blocked` + a native blocking dependency |
| Phase | one `phase:N` label, 0 through 6 |

Label definitions and creation commands: [`docs/agents/triage-labels.md`](agents/triage-labels.md).
Tracker operations: [`docs/agents/issue-tracker.md`](agents/issue-tracker.md).

## Starting a session

The owner says "let's work", "next", "continue", "review", or "what's next" without naming a ticket.
That is the `/work` trigger: pick the role, pick the next item, state it in one line, and **wait for
confirmation** before claiming it.
