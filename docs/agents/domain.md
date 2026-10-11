# Domain docs

How the engineering skills consume Errand Knight's domain documentation. This repo is
**single-context**.

## Before exploring, read these

- **[`AGENTS.md`](../../AGENTS.md)** — conventions, anti-patterns, the ADR index, and the precedence
  order to apply when sources disagree.
- **[`docs/idea.md`](../idea.md) §3 Core Concepts** — the authoritative vocabulary. Campaign, Account,
  Source, Quest, Player, and the quest states are defined there and are all load-bearing.
- **`GLOSSARY.md`** at the repo root, *if it exists*. It is created lazily by `/domain-modeling` the
  first time a term is resolved. If it does not exist, **proceed silently**: do not flag its absence
  and do not create it upfront.
- **[`docs/adr/`](../adr/)** — read the ADRs that touch the area you are about to work in.
- **The co-located `.md`** beside the code you touch, which describes how that module works.
- **[`docs/specs/`](../specs/)** — what was agreed to be built, and its testing seams.

## Use the glossary's vocabulary

When your output names a domain concept (an issue title, a test name, a type name), use the term as
`docs/idea.md` §3 and the code define it. The distinctions are the design:

- **Campaign** vs **Account** — accounts hold credentials; campaigns hold progression. An account is
  never attached to a campaign directly.
- **Source** — a calendar, a task list, or the built-in local list. Campaigns subscribe to sources
  many-to-many. Never "feed", never "connection".
- **Outbox** — the local-first mutation queue. Never "sync queue".
- **Completion** — one grant of XP, keyed for idempotency. Never "check-off".

Do not drift to synonyms. If a synonym is genuinely better, `/domain-modeling` changes the model and
the vocabulary together, in one commit.

## Flag conflicts

If your output contradicts an ADR or a decided constraint, say so explicitly rather than silently
overriding it:

> _Contradicts ADR-0002 (AI is opt-in with a user-supplied key), but worth reopening because…_

Under `AGENTS.md`, adding a module requires an ADR, and an ADR outranks code docs and `AGENTS.md`.
