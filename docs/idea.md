# Errand Knight

**Name:** Errand Knight  
**Tagline:** Turn real life into a quest log.  
**Status:** Idea / pre-scaffolding  
**License:** MIT  
**Primary platforms:** Windows, Linux, Android (desktop-first implementation, mobile-first long-term direction)

> Chosen name. A trademark and app-store name search is required before public release.

---

## 1. Vision

Errand Knight is a cross-platform, gamified productivity app that turns routine chores, meal-prep sessions, work, learning, and deadlines into an interactive RPG quest log.

It connects to Google Calendar and Google Tasks, turning real obligations into quests. Completing a real task grants XP, advances the player, and triggers celebratory feedback. Missed deadlines can cost HP. Streaks reward consistency. The experience is designed to build good habits, not to extract money, attention, or engagement.

The project is **free and open source (MIT)**. There is no advertising, no tracking, no monetisation, and no dark-pattern gamification. The maintainer may publish an official app in stores, but the code is designed so that anyone can compile, self-host, and use it with their own Google Cloud credentials.

---

## 2. Product Principles

1. **Local-first and offline-capable.** Quest data and progression live on-device in SQLite and sync when possible.
2. **Privacy by default.** No telemetry, ads, or unnecessary data collection. Google API data stays between the user, Google, and the app.
3. **Non-invasive.** Background sync is opt-in, quiet, battery-friendly, and respectful of the user's attention.
4. **For good, not profit.** The gamification encourages healthy consistency and recovery, not guilt or compulsion.
5. **Multi-account by design.** Users can connect work and personal Google accounts from the start.
6. **FOSS-compatible.** Self-builders can bring their own OAuth client, package ID, and signing identity.
7. **Accessible and cross-platform.** WebGPU is the primary renderer, with a WebGL2 fallback and an accessible DOM UI layer.
8. **User-owned data.** Full export/import and clear deletion controls.

---

## 3. Core Concepts

### Campaign
An isolated progression container. A user may have a Personal campaign, a Work campaign, a Family campaign, and so on. XP, HP, streaks, levels, and quests belong to a campaign.

This gives us clean separation now and leaves room for future multiplayer:

- **Phase 1:** separate single-player campaigns.
- **Later:** family campaigns where members play together.
- **Further later:** community campaigns and shared goals.

### Account
A connected Google account. An account owns credentials and exposes sources (calendars and task lists). Accounts are not attached to campaigns directly.

### Source
A single Google calendar or task list, or the built-in local quest list. Campaigns subscribe to sources, many-to-many: one campaign can draw from sources across several accounts, and one source can feed several campaigns. Sources are opt-in: nothing is imported until the user subscribes a source to a campaign, so meetings and shared calendars do not flood the quest log.

Local-only quests (no Google account) are supported from day one. This lets users try the app without OAuth and keeps the RPG core usable while OAuth verification is pending.

### Quest
A real-world obligation represented as an RPG quest. Quests come from:

- Google Tasks items
- Google Calendar events
- User-created local quests
- Parsed recipe/checklist content from Calendar event descriptions

Quest categories:

- **Vitality** — cooking, meals, rest, health, self-care.
- **Discipline** — cleaning, laundry, maintenance, admin.
- **Focus** — work, study, learning, deep tasks.

Each quest can have difficulty, estimated effort, due date, XP reward, HP risk, checklist steps, and source metadata.

### Player
The user's character inside a campaign. The player has:

- Level
- XP
- HP
- Streak
- Category affinities or stats
- Cosmetic progression, potentially

### Quest States

- Available
- In Progress
- Completed
- Missed
- Deferred / Skipped
- Archived

### Sync Outbox
Local-first mutation queue. Completing a quest is written locally first, then pushed to Google Tasks when connectivity and auth allow. Conflict resolution uses source revision metadata (Tasks `etag` / `updated`) and local precedence rules.

### Completion Idempotency
Each quest completion carries an idempotency key derived from the source item and occurrence. XP is granted once per key, whether the completion originates in the app or arrives from Google Tasks via sync. If a task is un-completed in Google Tasks, the corresponding completion is reverted and its XP is withdrawn, with a visible entry in the campaign history.

### Calendar Event Completion
Calendar access is read-only, so Google holds no completion state for events. Completion of event-based quests lives only in the app. An event-based quest is considered missed only if the user has flagged it as critical; otherwise unmarked past events expire quietly with no penalty.

---

## 4. MVP Scope

### Platforms

**Desktop first:**
- Windows and Linux.
- System tray integration.
- Native notifications.
- Optional autostart, off by default.
- Loopback OAuth redirect flow.
- Background sync only while the app runs, or as an explicitly enabled background mode.

**Android later:**
- Tauri v2 Android build via Cargo NDK.
- OAuth via Google Identity Services `AuthorizationClient` (or AppAuth with verified App Links), wrapped in a Kotlin Tauri plugin.
- WorkManager for periodic background sync, invoking a headless Rust sync entry point (no webview).
- Exact alarms via Android `AlarmManager`, exposed through a Kotlin Tauri plugin.
- Notification permission handling for modern Android versions.
- Mobile portrait layout and touch-friendly quest HUD.

**Exact alarms are required.** They will be used for deadlines the user explicitly marks as critical, with clear disclosure and platform-permission handling:

- The app requests `SCHEDULE_EXACT_ALARM`, which is denied by default on Android 14+ and must be granted by the user via system settings.
- The app does **not** use `USE_EXACT_ALARM`; Google Play restricts it to alarm-clock and calendar apps.
- If permission is denied or revoked, critical deadlines fall back to inexact alarms plus a persistent in-app warning, and the user is offered a one-tap path to the settings screen.

### MVP Features

1. Project foundation with Tauri v2, Svelte 5 + Vite + TypeScript, and SQLite.
2. Google OAuth 2.0 PKCE with multi-account support.
3. Google Calendar read-only sync for events.
4. Google Tasks read/write sync.
5. Quest classification into Vitality, Discipline, and Focus.
6. RPG progression: XP, levels, HP, streaks, campaign framing.
7. Recipe/checklist parser for multiline Calendar descriptions.
8. WebGPU/WGSL animated quest HUD.
9. WebGL2 renderer (first-class; it is the effective primary on Linux).
10. Local offline cache and sync outbox.
11. Tauri command bridge from quest completion to Google Tasks update.
12. Export/import and account/campaign management.

### Explicit Non-Goals for MVP

- Calendar write-back or event creation.
- Multiplayer or family campaigns.
- Community features.
- iOS support.
- Monetisation, ads, telemetry, or social feeds.
- Full mobile feature parity.

---

## 5. Technical Architecture

### Stack

| Layer | Choice |
|---|---|
| Native core | Rust + Tauri v2 |
| Frontend | Svelte 5 + Vite + TypeScript |
| Persistence | SQLite via `sqlx`, WAL mode, migrations |
| HTTP / OAuth | `reqwest` + `oauth2` + platform redirect handling |
| Primary renderer | WebGPU + raw WGSL (where the webview supports it) |
| Second renderer | WebGL2 + GLSL ES 3.0 (first-class; default on Linux) |
| Animation / particles | WebGPU compute shader (WebGPU path), CPU/instanced fallback (WebGL path) |
| Desktop integration | Tauri tray, notifications, autostart |
| Android integration | Cargo NDK, Kotlin Tauri plugins, `AlarmManager`, WorkManager, GIS `AuthorizationClient` |
| Secure storage | Platform keychain/keystore abstraction, with an encrypted-file fallback on Linux when Secret Service is unavailable |
| License | MIT |

### Native Rust Modules

- `auth` — OAuth 2.0 PKCE, token refresh, account lifecycle.
- `google_api` — Calendar v3 and Tasks v1 clients.
- `sync` — periodic polling, incremental sync, outbox, conflict handling. Exposes a headless entry point usable without the webview (Android WorkManager, desktop background mode).
- `progression` — XP curves, HP, levels, streaks, category logic.
- `parser` — recipe and checklist extraction from event descriptions.
- `storage` — SQLite repositories, migrations, backups.
- `commands` — typed Tauri command bridge for the frontend.
- `platform/desktop` — tray, notifications, autostart, loopback redirect.
- `platform/android` — Kotlin Tauri plugins for OAuth, exact alarms, and background work.

### Frontend Modules

- `renderer` — renderer abstraction with WebGPU and WebGL2 backends.
- `game` — quest/player/campaign view models and animation state.
- `views` — quest log, campaign dashboard, settings, accounts, debug/sync status.
- `components` — accessible HTML overlay for lists, forms, dialogs, and text.
- `state` — Svelte runes-based stores for campaign, sync, and player state.

### Persistence Model (initial shape)

- `campaigns`
- `players`
- `accounts`
- `sources` (calendar, task list, or local)
- `campaign_sources` (many-to-many subscription)
- `quests`
- `quest_steps`
- `quest_completions` (unique idempotency key)
- `sync_state`
- `outbox`
- `settings`

### Sync Model

1. App starts and loads local data immediately.
2. Sync runs on a schedule and on demand.
3. Calendar events are pulled read-only using `syncToken` incremental sync, with `singleEvents=true` so recurring events expand into individual occurrences.
4. Google Tasks are pulled by polling with `updatedMin`, `showDeleted`, and `showHidden`. The Tasks API offers no sync token and no push notifications.
5. Incoming items from subscribed sources are normalised into quests.
6. Local completion writes to the outbox immediately, keyed by its idempotency key.
7. The sync engine pushes pending Google Tasks updates.
8. Conflicts are resolved with transparent, documented rules.
9. Quest and progression updates emit events to the frontend.

**Google Tasks API constraints:**

- `due` is date-only; the API discards the time component. Task deadlines and HP penalties therefore operate at day granularity. Calendar events keep precise times.
- Recurrence rules are not exposed; recurring tasks appear as individual items.
- Calendar push notifications require a public HTTPS endpoint, so they are not used; Calendar is polled like Tasks.

### OAuth Flow

**Desktop:**
- Use a Google OAuth client of type "Desktop app".
- Open the system browser to Google's OAuth consent screen.
- Use a loopback redirect on `127.0.0.1` with a random free port.
- Exchange the authorization code plus PKCE verifier **and the client secret** for tokens. Google requires `client_secret` for Desktop clients even with PKCE; Google documents that this secret is not treated as confidential for installed apps, so embedding it in the binary is acceptable.
- Store refresh/access tokens through the platform secure-storage abstraction.

**Android:**
- Use an Android OAuth client tied to the package name and signing certificate. No client secret.
- Request scopes through Google Identity Services `AuthorizationClient` via a Kotlin Tauri plugin. Custom URI scheme redirects are blocked for new Android OAuth clients, and embedded webviews are disallowed. AppAuth with verified App Links is the fallback.
- Store tokens with Android Keystore-backed protection.

**Scopes for the first version:**
- `https://www.googleapis.com/auth/calendar.events.readonly`
- `https://www.googleapis.com/auth/tasks`
- `openid email`

### FOSS and OAuth Reality

- PKCE is used everywhere. Desktop clients still carry a non-confidential client secret (see above); Android clients have none.
- Official store builds use the maintainer's OAuth client IDs and signing identity.
- Self-compiled builds cannot safely reuse the official Android client ID because Android OAuth clients are bound to package name and signing SHA-1.
- The project will document how users create their own Google Cloud project and OAuth clients.
- Build-time/runtime configuration will support bringing your own client ID and desktop client secret.
- `calendar.events.readonly` and `tasks` are **sensitive** (not restricted) scopes. The official app requires Google OAuth verification: verified homepage, privacy policy, scope justification, and a demo video. No CASA security assessment is needed. Unverified apps are capped at 100 users.
- The privacy policy must comply with the Google API Services User Data Policy, including the Limited Use requirements.
- Google OAuth consent screens left in "Testing" mode expire refresh tokens after roughly seven days, which breaks background sync. Self-builders should publish their own consent screen to "In production" (unverified, for personal use) to avoid this.
- Verification takes weeks, so it starts during Phase 1, not before release.

---

## 6. RPG Systems

### XP and Levels

- Configurable XP curve.
- Base XP per quest difficulty.
- Category multipliers.
- Streak multipliers.
- Bonus XP for completing checklists or early completion.
- Diminishing returns for trivial tasks to avoid gaming the system.

### HP

- HP represents the player's resilience, not moral worth.
- Only quests explicitly flagged as critical can reduce HP when missed. Imported items never cost HP by default.
- HP can recover through rest, healthy habits, or completing recovery quests.
- HP loss should be configurable, gentle by default, and disabled entirely if desired.

### Streaks

- Daily or weekly consistency.
- Category-specific streaks.
- Streak multipliers for progression.
- Recovery/freeze mechanics to avoid all-or-nothing behaviour.
- No punitive streak-shaming notifications.

### Classification

Initial heuristics use clear rules and keyword/content signals:

- **Vitality:** cook, meal, prep, groceries, eat, workout, sleep, doctor.
- **Discipline:** clean, laundry, wash, tidy, repair, bill, organise.
- **Focus:** work, study, learn, write, code, meeting, deadline.

Rules are user-overridable, and the engine will learn from corrections later if privacy-preserving local learning is feasible.

### Recipe and Checklist Parser

Calendar event descriptions often contain unstructured text. The parser will:

1. Split descriptions by headings and blank lines.
2. Detect ingredient lists, quantities, and batch-prep sections.
3. Detect checklist syntaxes such as `- [ ]`, `[]`, `*`, and numbered steps.
4. Produce interactive quest steps.
5. Preserve the original text for reference and editing.
6. Allow user correction before the quest is finalised, especially in v1.

---

## 7. Rendering and HUD

### WebGPU Path

- Procedural 2D/isometric character and scene.
- HP/XP bars implemented with vertex and fragment shaders:
  - liquid fill
  - distortion
  - glow
  - threshold flashes
- Compute-shader particle emitter for quest-completion bursts.
- High-DPI handling via `devicePixelRatio` and `ResizeObserver`.
- Adaptive layout for desktop widescreen and, later, mobile portrait.

### WebGL2 Path

- Same renderer interface and visual language.
- GLSL ES 3.0 instead of WGSL.
- No compute shaders; particles fall back to CPU or instanced quads.
- Feature detection at runtime and graceful degradation.
- The app must remain fully usable with reduced visual effects, and with no GPU canvas at all.

**WebGL2 is a first-class renderer, not a rarely-used fallback.** Tauri uses the system webview, and WebGPU availability differs per platform:

| Platform | Webview | Expected renderer |
|---|---|---|
| Windows | WebView2 (Chromium) | WebGPU |
| Linux | WebKitGTK | WebGL2 (no stable WebGPU in WebKitGTK) |
| Android | Android System WebView | Detected at runtime |

### Renderer Parity

- Effects are specified once (inputs, timing, visual intent) and implemented in WGSL and GLSL as a pair, so the two paths do not drift.
- CI and manual test matrix covers WebView2 (WebGPU), WebKitGTK (WebGL2), and Android WebView.
- WebKitGTK on Nvidia and on Wayland is tested from Phase 3 onward, since GPU acceleration there is a known source of issues.

### Accessibility

- Quest lists, forms, and settings are real DOM elements, not canvas text.
- Canvas is decorative or `aria-hidden`.
- Keyboard navigation, focus management, screen-reader labels, and reduced-motion support.
- Colour is never the only indicator of quest state.

---

## 8. Minimal and Non-Invasive Behaviour

- No ads.
- No analytics by default.
- No streak-shaming, fake urgency, or manipulative loops.
- Notifications are opt-in, configurable, and quiet-hour aware.
- Desktop autostart is off by default.
- Background sync is opt-in and battery-conscious.
- Exact alarms are only used when the user marks a deadline as critical.
- Nothing is imported from Google until the user subscribes a calendar or task list to a campaign.
- All data can be exported and deleted.
- Removing an account deletes its tokens and offers a clear choice about associated quest history.

---

## 9. FOSS and Distribution Plan

- License: **MIT**.
- Public repository with contribution guide, code of conduct, and architecture docs.
- Official builds published by the maintainer for Windows, Linux, and Android.
- Self-builders can compile their own copies with their own OAuth client IDs.
- Documentation:
  - Google Cloud OAuth setup
  - Desktop build
  - Android build
  - Self-hosting and privacy model
  - Troubleshooting sync/auth
- Privacy policy required for store distribution, compliant with the Google API Services User Data Policy (Limited Use).
- No mandatory account system outside of Google OAuth.

---

## 10. Roadmap

### Phase 0 — Foundation
- Idea document and architecture decisions.
- Repository layout.
- Tauri v2 desktop shell.
- Svelte 5 + Vite + TypeScript frontend.
- SQLite migrations and repository layer, including the source/campaign mapping and idempotent completions.
- Local-only quests.
- Android spike: Tauri Android build, GIS `AuthorizationClient` sign-in, and one exact alarm via a Kotlin plugin, to surface platform blockers before the architecture sets.

### Phase 1 — Identity and Sync Prototype
- Google OAuth PKCE prototype for desktop.
- Multi-account storage.
- Source subscription UI (opt-in per calendar and task list).
- Calendar read-only sync.
- Google Tasks read/write sync.
- Outbox and completion bridge.
- Headless sync entry point.
- Sync diagnostics UI.
- Start Google OAuth verification for the official client.
- Collect real Calendar description samples and begin the recipe/checklist parser against them.

### Phase 2 — RPG Core
- Campaign model.
- Quest classification.
- XP, levels, HP, and streaks.
- Recipe/checklist parser.
- Export/import.

### Phase 3 — Graphics HUD
- Renderer abstraction.
- WebGPU/WGSL HP/XP bars.
- Compute-shader particle burst.
- WebGL2 renderer with effect parity.
- Renderer test matrix (WebView2, WebKitGTK incl. Nvidia/Wayland, Android WebView).
- High-DPI and responsive layout.
- Accessible DOM overlay.

### Phase 4 — Desktop Polish
- System tray.
- Native notifications.
- Optional autostart and background mode.
- Windows and Linux packaging.

### Phase 5 — Android
- Cargo NDK build.
- GIS `AuthorizationClient` OAuth via Kotlin plugin.
- WorkManager sync via the headless Rust entry point.
- Exact alarms via Kotlin plugin and `AlarmManager`, with `SCHEDULE_EXACT_ALARM` grant flow and denied-permission fallback.
- Notification permissions.
- Portrait/mobile layout and touch interactions.

### Phase 6 — Future Multiplayer
- Family campaigns.
- Shared quests and cooperative goals.
- Community campaigns.
- Privacy-preserving social architecture.

---

## 11. Success Criteria

The first release is successful if:

1. A user can connect multiple Google accounts and separate work/personal campaigns.
2. Calendar events and Tasks become quests without manual duplicate entry.
3. Completing a quest in the app completes the corresponding Google Task.
4. The app works offline and syncs reliably when online.
5. Progression feels encouraging, configurable, and non-manipulative.
6. The animated HUD runs on WebGPU where available and on WebGL2 elsewhere (including Linux) with matching visual language.
7. No ads, tracking, or monetisation are present.
8. The FOSS community can compile and run the app with their own Google credentials.
9. Exact deadline alarms work on Android with clear user consent.
10. The codebase remains modular enough to add family/community multiplayer later.

---

## 12. Open Questions

1. Trademark and app-store availability of "Errand Knight".
2. Whether XP is purely per-campaign or shared through a player profile.
3. When Calendar write-back should arrive.
4. Android package name and signing/release identity.
5. Exact-alarm UX details and OEM battery-optimisation handling.
6. Notification style, digest cadence, and quiet-hour defaults.
7. How much procedural art is appropriate versus static assets.
8. Multiplayer data model and trust/privacy boundaries.
9. Tagline revision once family campaigns ship (e.g. a cooperative framing).

---

## 13. Decision Log

| Decision | Choice |
|---|---|
| App frontend | Svelte 5 + Vite + TypeScript |
| Documentation site | Astro, separately, if needed |
| Native core | Rust + Tauri v2 |
| Database | `sqlx` + SQLite |
| Primary renderer | WebGPU + raw WGSL |
| Second renderer | WebGL2, first-class (default on Linux) |
| Progression model | Separate campaigns first |
| Accounts ↔ campaigns | Campaigns subscribe to sources (calendar / task list), many-to-many; accounts own credentials only |
| Source import | Opt-in per calendar and task list |
| Local-only quests | Yes, from day one |
| Completion model | Idempotency key per completion; un-completing reverts XP |
| HP penalties | Only for quests flagged critical |
| Desktop OAuth | Desktop client, PKCE + non-confidential client secret, loopback redirect |
| Android OAuth | GIS `AuthorizationClient` via Kotlin plugin; AppAuth + App Links fallback |
| Android native code | Kotlin Tauri plugins, not hand-written JNI |
| OAuth verification | Sensitive scopes; start verification in Phase 1 |
| Calendar access | Read-only for v1 |
| Platform order | Desktop first; mobile-first direction later |
| Exact alarms | Essential for critical Android deadlines; `SCHEDULE_EXACT_ALARM` with user grant, never `USE_EXACT_ALARM` |
| Multi-account | Yes, from the start |
| Monetisation | None |
| Telemetry | None by default |
| License | MIT |
| Official distribution | Maintainer publishes store builds |
| FOSS self-builds | Bring your own Google OAuth client |
