# TypeSafe's Jev is used in dev tooling only

Every agent session on this repo runs on a thinking model, and the owner pays for its tokens. Closed-set
workflow decisions (picking a triage label, checking a review finding against its source, choosing
which docs to read) do not need one. TypeSafe's System One model, Jev, answers typed questions far
more cheaply, so **we use Jev in the repo's dev tooling, the scripts agents run with plain `node`, to
cut agent cost, and nowhere else.** It is never used in app code, the Rust core or the frontend.
Whether the app ever uses it is undecided. That question belongs to the AI-integration work under
[ADR-0002](0002-optional-ai-bring-your-own-key.md) and the
[optional AI assistance spec](../specs/optional-ai-assist.md), where it would be one more provider a
user opts into with their own key.

## Consequences

- This ADR is the one the review checklist's "a new outbound network destination requires an ADR"
  rule points to for the dev tooling's calls to `api.typesafe.ai`. It covers those calls and the
  vendored `typesafe-ai` skill (`.agents/skills/typesafe-ai/`) pointing agents at
  `docs.typesafe.ai`. It does not cover any call from the app; the app's default install still talks
  only to Google.
- The dev key, `TYPESAFE_API_KEY`, lives only in the owner's shell. It is never committed and never a
  CI secret, and the credits are for development only (see [`docs/dev_setup.md`](../dev_setup.md)).
- Every tool works without a key: it prints a one-line skip notice, exits cleanly, and the workflow
  runs as it did before. No CI step depends on Jev.
- The vendored skill's description says "use when a feature needs…". That is upstream's general
  advice; this ADR overrides it here, and `AGENTS.md` lists app use as an anti-pattern.

## Considered options

- **A skill-suggestion router**, from TypeSafe's cookbook. Rejected: it needs a hook that runs
  before every turn, which most harnesses lack, and with about 22 skills it gains little.
- **A review checklist pre-check.** Rejected: `docs/workflow.md` applies the checklist in full on
  every review, so a pre-check would save nothing.
- **Use Jev in the app now.** Not decided here. It would send user data to a third party, so it goes
  through ADR-0002's opt-in, bring-your-own-key rules, not through this ADR.

## Status

Accepted.
