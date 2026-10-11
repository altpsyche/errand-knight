# Optional AI, bring your own key

Errand Knight may ship LLM-backed assistance (recipe and checklist parsing, quest classification,
effort estimation, day planning, quest breakdown, natural-language quest creation). It must do so
without ever introducing a payment loop, an account system, or a server we operate. **We therefore
never proxy inference and never resell tokens.** A user who wants AI enables a specific feature, picks
a provider (any OpenAI-compatible `/chat/completions` endpoint, or Anthropic's Messages API, which
between them cover OpenAI, Anthropic, OpenRouter, Ollama, LM Studio, and llama.cpp), and supplies
their own API key or local base URL. The key is stored in the existing platform secure-storage
abstraction and is used only by the Rust core: **the frontend webview never holds a key and never
talks to the provider.** AI is off by default, and a default install still talks only to Google.

## Consequences

- Every AI feature is a strict enhancement over a deterministic path. The heuristic classifier in
  `docs/idea.md` §6 and the rule-based parser in §6 stay first-class and complete, so the app is fully
  usable with no key and on a plane.
- There is no monetisation path and no usage data leaves the device. Cost control is the user's
  provider account; the app's job is to make egress legible, not to meter it.
- Support burden shifts to "which base URL and model id do I use", so provider setup gets a `/wizard`
  and a docs page rather than a support conversation.
- Quest titles and calendar event descriptions are personal data. They may be sent only for a feature
  the user enabled, from the Rust core, with a payload the user can inspect before it is sent.

## Considered options

- **Operate a proxy and sell credits.** Rejected outright: it is a payment loop, it makes us a
  processor of user data, and it contradicts the MIT/self-host posture.
- **Bundle a local model.** Rejected as the only path: multi-GB downloads and a GPU requirement would
  gate a productivity app. A local provider through a user-supplied base URL is supported instead.
- **Store the key in the webview's `localStorage`.** Rejected: it puts the key in the least trusted
  process and makes exfiltration via any frontend dependency trivial.

## Status

Accepted. Revisit only if the project ever gains a hosted component, which would itself need an ADR.
