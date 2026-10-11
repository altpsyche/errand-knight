// Finding verifier: before a Reviewer posts, asks Jev whether each draft finding's quoted line, read
// against its cited source, supports it, and marks each finding keep or flag. It never removes a
// finding; the Reviewer re-reads the source of a flagged one and decides. See README.md beside
// this file.
//
// The constitution bullets are read from the review checklist on every run, not copied here, so a
// checklist edit changes which findings are exempt without a second edit.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorLine } from './client.mjs';
import { JEV_CHARS_PER_TOKEN, JEV_QUESTION_TOKENS, JEV_REQUEST_TOKENS, VERIFY_FLAG_BELOW } from './constants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW_DOC = 'docs/workflow.md';
const FIELDS = ['text', 'quote', 'source', 'excerpt'];

/**
 * The bullets under the review checklist's **The constitution** heading, whitespace-collapsed and
 * lower-cased. Throws when the section is missing or empty, which the caller reports as one line.
 */
export function constitutionBullets(workflowDoc) {
  const bullets = [];
  let inSection = false;
  for (const line of workflowDoc.split('\n')) {
    if (/^\*\*/.test(line)) {
      inSection = /^\*\*The constitution\*\*/.test(line);
      continue;
    }
    if (/^#/.test(line)) inSection = false;
    if (inSection && /^\s*[-*] /.test(line)) bullets.push(normalise(line.replace(/^\s*[-*] /, '')));
  }
  if (!bullets.length) throw new Error(`${WORKFLOW_DOC} has no bullets under "**The constitution**"`);
  return bullets;
}

function normalise(text) {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * A finding cites the constitution when its source names it, or its excerpt quotes one of the
 * constitution's bullets whole. Such a finding is never sent to Jev and never flagged.
 */
function citesConstitution(finding, bullets) {
  if (/constitution/i.test(finding.source)) return true;
  const excerpt = normalise(finding.excerpt);
  return bullets.some((bullet) => excerpt.includes(bullet));
}

/** Checks the input shape; throws one line naming the first problem, so nothing malformed is sent. */
function validate(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('no findings: give a JSON array of findings, each with text, quote, source and excerpt');
  }
  const seen = new Set();
  return input.map((raw, index) => {
    const label = `finding ${index + 1}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label} is not an object`);
    if (raw.id !== undefined && (typeof raw.id !== 'string' || !raw.id.trim())) {
      throw new Error(`${label} has an id that is not a non-empty string`);
    }
    const id = raw.id?.trim() ?? `F${index + 1}`;
    if (seen.has(id)) {
      const how = raw.id === undefined ? ', the default for its position: give every finding an id' : '';
      throw new Error(`${label} repeats the id ${id}${how}`);
    }
    seen.add(id);
    for (const field of FIELDS) {
      if (typeof raw[field] !== 'string' || !raw[field].trim()) throw new Error(`${label} (${id}) has no ${field}`);
    }
    return { id, text: raw.text, quote: raw.quote, source: raw.source, excerpt: raw.excerpt };
  });
}

function question(key) {
  return {
    type: 'noul',
    instructions:
      `\`findings.${key}\` is one finding from a code review of Errand Knight: \`text\` is the finding, ` +
      '`quote` is the line under review it is about, and `excerpt` is an excerpt of `source`, the rule or ' +
      'spec it cites. Read the quoted line against the cited excerpt. Does that line, read against that ' +
      'source, support the finding?',
    criteria: {
      true: 'The quoted line does what the finding says, and the excerpt says what the finding relies on it saying.',
      false: 'The quoted line does not show what the finding claims, or the excerpt does not say what the finding relies on.',
    },
  };
}

function tokens(value) {
  return Math.ceil(JSON.stringify(value).length / JEV_CHARS_PER_TOKEN);
}

function fits(entries) {
  const state = { findings: Object.fromEntries(entries.map((e) => [e.key, e.body])) };
  const stateTokens = tokens(state);
  const sizes = entries.map((e) => tokens(e.question));
  const longest = Math.max(...sizes);
  const all = sizes.reduce((a, b) => a + b, 0);
  return stateTokens + longest <= JEV_QUESTION_TOKENS && stateTokens + all <= JEV_REQUEST_TOKENS;
}

/**
 * First-fit packing into as few requests as Jev's two context limits allow. A finding that does
 * not fit a request on its own is returned in `oversize`, to be kept unchecked.
 */
function pack(entries) {
  const batches = [];
  const oversize = [];
  for (const entry of entries) {
    if (!fits([entry])) {
      oversize.push(entry);
      continue;
    }
    const batch = batches.find((b) => fits([...b, entry]));
    if (batch) batch.push(entry);
    else batches.push([entry]);
  }
  return { batches, oversize };
}

function judge(answer) {
  // A probability or nothing: NaN would compare as not-below the threshold and keep silently.
  const usable = typeof answer?.noul === 'number' && answer.noul >= 0 && answer.noul <= 1;
  if (!usable) throw new Error('Jev returned no usable answer');
  return { decision: answer.noul < VERIFY_FLAG_BELOW ? 'flag' : 'keep', noul: answer.noul, reason: 'checked' };
}

const ON_FLAG = 're-read the cited source once, then keep or drop the finding';

/**
 * The CLI's default output for a `run()` result: one line per finding, in input order, or one
 * line for a skip or an error.
 */
export function human(result) {
  if (result.status !== 'ok') return `jev verify: ${result.status}, ${result.reason}; continue as normal`;
  return result.findings
    .map((f) => {
      if (f.reason === 'constitution') return `${f.id}: keep (cites the constitution, never flagged)`;
      if (f.reason === 'too-large') return `${f.id}: keep (too large to check)`;
      const line = `${f.id}: ${f.decision} (noul ${f.noul.toFixed(2)})`;
      return f.decision === 'flag' ? `${line} - ${ON_FLAG}` : line;
    })
    .join('\n');
}

/**
 * Check draft review findings against their cited sources.
 *
 * @param {Array<{ id?: string, text: string, quote: string, source: string, excerpt: string }>} input
 *   the findings; `id` defaults to F1, F2, … by position
 * @param {{ client: { available(): Promise<object>, ask(request): Promise<object> }, root?: string }} deps
 *   a shared client from client.mjs, and the repo root the review checklist is read from
 * @returns one of
 *   { status: 'ok', findings: Verdict[] }, in input order,
 *     Verdict = { id, decision: 'keep' | 'flag', noul: number | null, reason: 'checked' | 'constitution' | 'too-large' }
 *   { status: 'skipped', reason }  no key, or the SDK is not installed
 *   { status: 'error', reason }    anything else, including malformed input; never thrown
 */
export async function run(input, { client, root = ROOT }) {
  try {
    // Before any other work, so a keyless run skips even when the input or the checklist is bad.
    const ready = await client.available();
    if (ready.status !== 'ok') return ready;
    const findings = validate(input);
    const bullets = constitutionBullets(await readFile(path.join(root, WORKFLOW_DOC), 'utf8'));

    const verdicts = new Map();
    const toCheck = [];
    findings.forEach((f, index) => {
      if (citesConstitution(f, bullets)) {
        verdicts.set(f.id, { decision: 'keep', noul: null, reason: 'constitution' });
        return;
      }
      const key = `f${index + 1}`;
      const body = { text: f.text, quote: f.quote, source: f.source, excerpt: f.excerpt };
      toCheck.push({ id: f.id, key, body, question: question(key) });
    });

    const { batches, oversize } = pack(toCheck);
    for (const entry of oversize) verdicts.set(entry.id, { decision: 'keep', noul: null, reason: 'too-large' });
    for (const batch of batches) {
      const state = { findings: Object.fromEntries(batch.map((e) => [e.key, e.body])) };
      const questions = Object.fromEntries(batch.map((e) => [e.key, e.question]));
      const result = await client.ask({ state, questions });
      if (result.status !== 'ok') return { status: result.status, reason: result.reason };
      for (const entry of batch) verdicts.set(entry.id, judge(result.answers[entry.key]));
    }

    return { status: 'ok', findings: findings.map((f) => ({ id: f.id, ...verdicts.get(f.id) })) };
  } catch (error) {
    return { status: 'error', reason: errorLine(error) };
  }
}
