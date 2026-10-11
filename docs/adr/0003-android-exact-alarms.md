# Android exact alarms via `SCHEDULE_EXACT_ALARM`

Critical deadlines on Android must fire at the stated time, which on Android means
`AlarmManager.setExactAndAllowWhileIdle`. Android 14+ denies `SCHEDULE_EXACT_ALARM` by default, so we
request it and route the user to system settings, falling back to inexact alarms plus a persistent
in-app warning if it is refused or later revoked. We deliberately do **not** declare
`USE_EXACT_ALARM`: Google Play restricts that permission to alarm-clock and calendar apps, and
requesting it would be a store-policy risk for a gamified to-do app.

## Consequences

- Exact alarms are used only for quests the user explicitly flagged as critical, never for streaks,
  reminders, or engagement nudges. This keeps the permission request defensible and matches the
  product's non-invasive stance.
- The denied-permission path is a first-class UI state, not an error: the app remains correct with
  inexact alarms, and says so.
- OEM battery optimisation can still suppress alarms on some devices. That handling is an open
  question in `docs/idea.md` §12 and needs its own decision before Phase 5 ships.
