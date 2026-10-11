// Every tunable number the Jev tools use, and the model they use it with, in one reviewed place.
// See README.md beside this file. Thresholds are calibrated against this exact model id: a new
// model is a deliberate edit here, never `jev-latest`, so its calibration cannot shift silently.

/** The pinned System One model every Jev tool asks. */
export const MODEL = 'jev-1.13.0';

/** Triage applies a suggested label without deliberating at Choice confidence at or above this. */
export const TRIAGE_APPLY_CONFIDENCE = 0.8;
