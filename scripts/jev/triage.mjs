// Triage helper: suggests one role label and one `phase:N` for an issue, each with Jev's
// confidence and an apply/defer decision. See README.md beside this file.
//
// The label meanings and phase descriptions are read from their authoritative docs on every run,
// not copied here, so an edit to either doc changes what Jev is asked without a second edit.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRIAGE_APPLY_CONFIDENCE } from './constants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LABELS_DOC = 'docs/agents/triage-labels.md';
const IDEA_DOC = 'docs/idea.md';

// `needs-triage` is the state being left, so it is never a suggestion.
const ROLES = ['needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix'];

/**
 * Role criteria from the triage labels table: each label mapped to its "Meaning" cell.
 * Throws when a role is missing, which the caller reports as a one-line error.
 */
export function roleCriteria(labelsDoc) {
  const meanings = {};
  for (const line of labelsDoc.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    // | role | `label` | meaning |  →  ['', role, `label`, meaning, '']
    const label = /^`([^`]+)`$/.exec(cells[2] ?? '')?.[1];
    if (cells.length >= 5 && label && ROLES.includes(label)) meanings[label] = cells[3];
  }
  const missing = ROLES.filter((r) => !meanings[r]);
  if (missing.length) throw new Error(`${LABELS_DOC} has no meaning for ${missing.join(', ')}`);
  return meanings;
}

/**
 * Phase criteria from the `docs/idea.md` roadmap: `phase:N` mapped to the phase's heading and its
 * bullets. Throws when the roadmap has no phases.
 */
export function phaseCriteria(ideaDoc) {
  const criteria = {};
  let inRoadmap = false;
  let current = null;
  for (const line of ideaDoc.split('\n')) {
    if (/^## /.test(line)) {
      inRoadmap = /roadmap/i.test(line);
      current = null;
      continue;
    }
    if (!inRoadmap) continue;
    const heading = /^### Phase (\d+)\s*[—–-]\s*(.+)$/.exec(line);
    if (heading) {
      current = { phase: heading[2].trim(), covers: [] };
      criteria[`phase:${heading[1]}`] = current;
    } else if (current && /^\s*[-*] /.test(line)) {
      current.covers.push(line.replace(/^\s*[-*] /, '').trim());
    }
  }
  if (!Object.keys(criteria).length) throw new Error(`${IDEA_DOC} has no "### Phase N — …" headings under its Roadmap`);
  return criteria;
}

function questions(roles, phases) {
  return {
    role: {
      type: 'choice',
      instructions:
        'This is a GitHub issue on Errand Knight, a local-first desktop and Android app. ' +
        'Which triage state should the issue move to next?',
      criteria: roles,
    },
    phase: {
      type: 'choice',
      instructions:
        "Which phase of the project's roadmap does the work this issue asks for belong to? " +
        'Each option lists the work that phase covers.',
      criteria: phases,
    },
  };
}

function judge(answer) {
  if (!answer || typeof answer.choice !== 'string' || typeof answer.confidence !== 'number') {
    throw new Error('Jev returned no usable answer');
  }
  return {
    label: answer.choice,
    confidence: answer.confidence,
    decision: answer.confidence >= TRIAGE_APPLY_CONFIDENCE ? 'apply' : 'defer',
  };
}

async function readDocs() {
  const [labels, idea] = await Promise.all([
    readFile(path.join(ROOT, LABELS_DOC), 'utf8'),
    readFile(path.join(ROOT, IDEA_DOC), 'utf8'),
  ]);
  return { roles: roleCriteria(labels), phases: phaseCriteria(idea) };
}

/**
 * Suggest a role label and a phase label for one issue.
 *
 * @param {{ title: string, body?: string }} input  the issue
 * @param {{ client: { ask(request): Promise<object> } }} deps  a shared client from client.mjs
 * @returns one of
 *   { status: 'ok', role: Suggestion, phase: Suggestion }, Suggestion = { label, confidence, decision }
 *   { status: 'skipped', reason }  no key, or the SDK is not installed
 *   { status: 'error', reason }    anything else; never thrown
 */
export async function run(input, { client }) {
  try {
    const { roles, phases } = await readDocs();
    const state = { issue: { title: input.title, body: input.body ?? '' } };
    const result = await client.ask({ state, questions: questions(roles, phases) });
    if (result.status !== 'ok') return { status: result.status, reason: result.reason };
    return { status: 'ok', role: judge(result.answers.role), phase: judge(result.answers.phase) };
  } catch (error) {
    return { status: 'error', reason: oneLine(error) };
  }
}

function oneLine(error) {
  return String(error?.message ?? error).split('\n')[0];
}
