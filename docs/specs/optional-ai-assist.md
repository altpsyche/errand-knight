# Spec: Optional AI assistance

Status: draft, not yet accepted. Seams in § Testing Decisions need the owner's confirmation before
implementation starts. Governed by [ADR-0002](../adr/0002-optional-ai-bring-your-own-key.md).

## Problem Statement

Errand Knight's value depends on turning messy real-world input into a clean quest log. Two jobs are
currently specified as heuristics that will visibly fail on real data:

- Classifying a free-text obligation into Vitality, Discipline, or Focus.
- Parsing a multiline calendar description into ingredients, quantities, and checklist steps.

A keyword list gets "pick up dry cleaning before mum's birthday" wrong, and a rule-based parser mangles
unstructured prose. Meanwhile a user who has an LLM key already pays for a model that would do both
jobs well, and has no way to point this app at it without also handing over their calendar.

The user also wants no payment loop, no account, and no telemetry in the app: a productivity app that
suddenly wants a subscription has failed at its one job.

## Solution

An optional AI layer that is off by default and inert without a user-supplied provider. The user
enables individual capabilities, configures one provider (an OpenAI-compatible base URL or Anthropic),
and pastes their own key. The key never leaves the Rust core, and the frontend never talks to the
provider.

Every capability has a deterministic fallback that already exists and stays complete. With AI off, the
app is indistinguishable from a version that never had it, minus the toggle. Turning AI off after using
it removes nothing the user already stored.

The app shows the exact payload before it leaves the device, per capability, the first time that
capability is used.

## User Stories

**Setup and consent**

1. As a privacy-conscious user, I want AI features to be absent until I enable them, so that a default
   install sends nothing anywhere new.
2. As a user, I want to enable AI capabilities one at a time, so that I can allow quest classification
   without allowing my calendar descriptions to be read.
3. As a user, I want to choose my provider by base URL as well as by name, so that I can use a local
   model server I already run.
4. As a user, I want to paste an API key and have it stored in the OS keychain, so that it survives
   restarts without sitting in a config file.
5. As a user on Linux without a Secret Service, I want a documented encrypted-file fallback, so that
   setup does not silently fail.
6. As a user, I want a "test connection" action that reports the provider's error verbatim, so that I
   can tell a bad key from a bad URL from a bad model id.
7. As a user, I want to fetch the provider's available model ids when it supports listing, and type one
   by hand when it does not, so that the app does not ship a model list that goes stale.
8. As a user, I want to see the exact request that would be sent, before it is sent, so that I can
   judge whether I am comfortable.
9. As a user, I want to disable AI entirely with one control that also clears the stored key, so that
   "off" is a state I can verify.
10. As a user, I want the app to work identically when the provider is unreachable, so that a network
    failure is never a broken quest log.

**Recipe and checklist parsing**

11. As a meal-prepping user, I want a calendar event's description parsed into interactive steps, so
    that I can work through it in the app.
12. As a user, I want parsed steps shown for correction before the quest is finalised, so that a wrong
    parse costs me an edit and not a wrong quest.
13. As a user, I want the original description preserved verbatim alongside the parsed steps, so that I
    can always recover the source.
14. As a user, I want the rule-based parser to run first and AI only when it is unsure, so that common
    cases cost no tokens and no latency.
15. As a user, I want quantities and batch-prep sections detected separately from instruction steps, so
    that a shopping list is not a set of checkboxes.

**Classification and estimation**

16. As a user, I want a new quest classified into Vitality, Discipline, or Focus, so that I do not pick
    a category for every imported item.
17. As a user, I want a suggested difficulty and effort estimate, so that XP is roughly right without
    me tuning it.
18. As a user, I want to override any classification or estimate, and I want my override to be
    remembered for items that look like it, so that the app stops making the same mistake.
19. As a user, I want imported items never to be assigned a critical flag by AI, so that a model
    mistake can never cost HP.
20. As a user, I want low-confidence suggestions visibly marked as such, so that I know when to look.

**Planning and breakdown**

21. As a user, I want a "plan my day" suggestion that orders today's quests, so that I start instead of
    deciding.
22. As a user, I want the plan to respect my campaign's critical deadlines and effort estimates, so
    that it is not just a re-sort by due date.
23. As a user, I want to break a large quest into checklist steps, so that a daunting task becomes
    startable.
24. As a user, I want to create a quest from a sentence, so that capture is faster than a form.
25. As a user, I want a generated plan to be a proposal I accept or discard, so that AI never mutates
    my progression state on its own.

**Trust and control**

26. As a user, I want every AI call cancellable, so that a slow provider does not freeze the UI.
27. As a user, I want AI failures to degrade to the deterministic path with a non-blocking notice, so
    that a bad provider never blocks real work.
28. As a user, I want a per-capability record of which provider and model produced a stored suggestion,
    so that I can tell what changed when I switch models.
29. As a user, I want logs to redact keys and payloads by default, so that a shared log file is not a
    leak.
30. As a user, I want a build with all AI code compiled out, so that a self-builder or a store build
    can guarantee the capability is absent rather than merely disabled.

## Implementation Decisions

**One new module in the Rust core, `ai`.** It owns provider configuration, the HTTP clients, the
prompt templates, the payload builder, and the capability gates. The frontend reaches it only through
typed Tauri commands, consistent with every other core capability. No new frontend dependency performs
network I/O.

**A provider trait with two adapters.** An OpenAI-compatible adapter over `/chat/completions` and
`/models`, and an Anthropic adapter over `/v1/messages`. The trait is the seam that everything else is
tested against, so no test requires a network or a real key.

**A pure payload builder.** Each capability declares the fields it wants. The builder turns a quest or
event into a request body, and separately into a redacted human-readable preview. The preview and the
body are produced by the same code path, so what the user is shown is what is sent. This is the
highest-value seam in the feature and it has no I/O at all.

**Capability gates, not a global switch.** Each capability is an independently enabled flag, because
the consent unit is the data type being sent: classification sends a quest title, parsing sends a
calendar description. A capability's gate is checked in the core, not the UI, so a frontend bug cannot
bypass consent.

**Egress disclosure is first-run per capability,** stored as a "shown and accepted" marker alongside
the flag. The preview is reachable later from settings, not only on first use.

**Failure is always a fallthrough.** Every capability returns either a suggestion or a typed reason for
absence. The caller renders the deterministic result and attaches a notice. There is no state where an
AI failure produces an empty or partial quest.

**AI never writes progression.** Completions, XP grants, HP changes, and the critical flag are out of
bounds. The AI produces suggestions; the existing progression module remains the only writer.

**No cost metering, and no shipped price table.** A user-set ceiling on output tokens per request is
the only limiter, because the app cannot know a provider's prices and a stale table is worse than none.
Providers that return token usage surface it as information.

**Key storage reuses the existing secure-storage abstraction** rather than adding a second mechanism,
so Linux-without-Secret-Service and Android Keystore are handled once, in one place.

**The compiled-out build is a Cargo feature,** defaulting to on for official builds. With it off, the
`ai` module is absent and its commands are not registered. This is a build-time guarantee, and it is
what makes the claim checkable rather than a promise.

## Testing Decisions

A good test here observes behaviour through the module's public interface and never reaches into prompt
strings or HTTP internals. The dangerous regressions are consent and data-leak regressions, so the tests
that matter most are the ones asserting that a payload does **not** contain a field.

The seams, proposed and to be confirmed with the owner before implementation:

1. **The payload builder**, as a pure function. Highest seam, no I/O. Tests assert the redaction
   contract: a capability's payload contains exactly its declared fields and no others, and the preview
   matches the body field for field.
2. **The capability gate**, as a pure function over (capability, config). Tests assert that a disabled
   capability short-circuits before any provider call, for every capability, and that the gate lives
   below the command layer.
3. **The provider trait**, with an in-memory fake. Tests assert request shape, timeout, cancellation,
   error mapping, and the fallthrough contract, with no network.
4. **The progression boundary**, asserted structurally: the `ai` module exposes no function that writes
   XP, HP, completion, or the critical flag. A test enumerates the module's public surface and fails on
   a violation, so the boundary is enforced mechanically rather than by review.

Prior art in this repo will be the Tauri command layer tests and the sync outbox tests from Phase 0 and
Phase 1, both of which already use a fake transport. Prefer those idiomatic patterns over inventing new
test scaffolding.

Not tested with automated tests: prompt wording quality and model output quality. Those are evaluated by
hand against a fixture set of real calendar descriptions, which is why `docs/idea.md` § Phase 1 collects
real samples before the parser work starts.

## Out of Scope

- Any hosted component, proxy, credit system, subscription, or usage reporting.
- Streaming responses. The capabilities are all short, batched, and latency-tolerant; streaming adds a
  cancellable partial-state problem for no user benefit.
- Fine-tuning, embeddings, vector search, or a local model runtime bundled with the app.
- AI-generated art, quest titles authored entirely by AI without user review, or any AI write to
  progression state.
- Automatic re-classification of already-imported quests when AI is switched on. Turning AI on must not
  silently rewrite history.
- Multi-provider routing, fallback chains, or cost optimisation across providers.

## Further Notes

Phase placement is deliberately not decided here. Two candidates and their tradeoff:

- **Inside Phase 2 (RPG Core)**, next to the heuristic classifier and parser it improves, so both paths
  are built and tested together and the deterministic path cannot quietly rot.
- **As its own phase after Phase 5**, so the app's core value is proven without AI and the feature is
  additive.

The stronger argument is the first: building the deterministic path and its AI enhancement in the same
phase is what keeps the fallback honest, and it front-loads the key-storage and consent design that is
expensive to retrofit. This should be settled by `/grill-with-docs` before the ticket breakdown.

Open questions this spec does not answer:

1. Whether the compiled-out Cargo feature should default to **off** for self-builders, so the privacy
   claim is opt-in rather than opt-out.
2. Whether a self-hosted model should be permitted to receive richer payloads than a hosted one, given
   that it never leaves the user's machine. Tempting, but it forks the redaction contract into two
   rules, which is exactly the kind of subtlety that leaks later.
3. How "remember my override" learns without becoming a privacy problem. A local, inspectable rule
   derived from the override is acceptable; anything that sends corrections to a provider is not.
