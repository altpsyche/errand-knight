// Every tunable number the Jev tools use, and the model they use it with, in one reviewed place.
// See README.md beside this file. Thresholds are calibrated against this exact model id: a new
// model is a deliberate edit here, never `jev-latest`, so its calibration cannot shift silently.

/** The pinned System One model every Jev tool asks. */
export const MODEL = 'jev-1.13.0';

/** Triage applies a suggested label without deliberating at Choice confidence at or above this. */
export const TRIAGE_APPLY_CONFIDENCE = 0.8;

/** The pruner puts a doc on the read list at a Noul (probability it is relevant) at or above this. */
export const PRUNE_INCLUDE_NOUL = 0.2;

/**
 * The verifier flags a finding when Jev's Noul (probability its source supports it) is below this.
 * Set from the first live sample: a supported finding scored 0.89, an unsupported one 0.61. A flag
 * costs one re-read, so erring towards flagging is cheap.
 */
export const VERIFY_FLAG_BELOW = 0.7;

// Jev's context limits, per the TypeSafe docs as of 2026-10-11: a request holds at most 64k tokens,
// and its longest single question plus `state` at most 32k.
export const JEV_REQUEST_TOKENS = 64_000;
export const JEV_QUESTION_TOKENS = 32_000;

/**
 * Characters per token for estimating a request's size without a tokenizer. English prose runs
 * nearer 4; 3 overestimates, so a batch the estimate accepts fits the real limits.
 */
export const JEV_CHARS_PER_TOKEN = 3;
