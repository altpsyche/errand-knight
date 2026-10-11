// Triage helper: suggests one role label and one `phase:N` for an issue, each with Jev's
// confidence and an apply/defer decision. See README.md beside this file.
//
// The label meanings and phase descriptions are read from their authoritative docs on every run,
// not copied here, so an edit to either doc changes what Jev is asked without a second edit.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorLine } from './client.mjs';
import { TRIAGE_APPLY_CONFIDENCE } from './constants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LABELS_DOC = 'docs/agents/triage-labels.md';
const IDEA_DOC = 'docs/idea.md';

// The five canonical triage roles the vendored skills speak in. The table maps each to this repo's
// label string; `needs-triage` is the state being left, so its label is never a suggestion.
const CANONICAL_ROLES = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix'];
const LEAVING = 'needs-triage';

/**
 * Role criteria from the triage labels table: each row's label (second column) mapped to its
 * "Meaning" cell, for every canonical role but `needs-triage`. Throws when a row names a role
 * outside the canonical five, or a canonical role has no row, which the caller reports as one line.
 */
export function roleCriteria(labelsDoc) {
  const rows = new Map();
  for (const line of labelsDoc.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    // | `role` | `label` | meaning |  →  ['', `role`, `label`, meaning, '']
    const role = /^`([^`]+)`$/.exec(cells[1] ?? '')?.[1];
    const label = /^`([^`]+)`$/.exec(cells[2] ?? '')?.[1];
    if (cells.length < 5 || !role || !label) continue;
    if (!CANONICAL_ROLES.includes(role)) {
      throw new Error(`${LABELS_DOC} has a row for \`${role}\`, which is not one of the five triage roles`);
    }
    rows.set(role, { label, meaning: cells[3] });
  }
  const missing = CANONICAL_ROLES.filter((r) => !rows.get(r)?.meaning);
  if (missing.length) throw new Error(`${LABELS_DOC} has no row for ${missing.join(', ')}`);
  const criteria = {};
  for (const [role, { label, meaning }] of rows) if (role !== LEAVING) criteria[label] = meaning;
  return criteria;
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

async function readDocs(root) {
  const [labels, idea] = await Promise.all([
    readFile(path.join(root, LABELS_DOC), 'utf8'),
    readFile(path.join(root, IDEA_DOC), 'utf8'),
  ]);
  return { roles: roleCriteria(labels), phases: phaseCriteria(idea) };
}

/**
 * Suggest a role label and a phase label for one issue.
 *
 * @param {{ title: string, body?: string }} input  the issue
 * @param {{ client: { available(): Promise<object>, ask(request): Promise<object> }, root?: string }} deps
 *   a shared client from client.mjs, and the repo root the docs are read from (default: this repo)
 * @returns one of
 *   { status: 'ok', role: Suggestion, phase: Suggestion }, Suggestion = { label, confidence, decision }
 *   { status: 'skipped', reason }  no key, or the SDK is not installed
 *   { status: 'error', reason }    anything else; never thrown
 */
export async function run(input, { client, root = ROOT }) {
  try {
    // Before any other work, so a keyless run skips even when a doc no longer parses.
    const ready = await client.available();
    if (ready.status !== 'ok') return ready;
    // An empty issue (often a forgotten number with an empty, non-TTY stdin) must not get a label.
    if (!input?.title?.trim()) {
      return { status: 'error', reason: 'the issue has no title: give an issue number, or pipe the issue on stdin' };
    }
    const { roles, phases } = await readDocs(root);
    const state = { issue: { title: input.title, body: input.body ?? '' } };
    const result = await client.ask({ state, questions: questions(roles, phases) });
    if (result.status !== 'ok') return { status: result.status, reason: result.reason };
    return { status: 'ok', role: judge(result.answers.role), phase: judge(result.answers.phase) };
  } catch (error) {
    return { status: 'error', reason: errorLine(error) };
  }
}
