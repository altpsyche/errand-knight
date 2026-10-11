// Doc pruner: given a ticket or PR, says which ADRs, co-located `.md` files and `docs/idea.md`
// sections are relevant to the work, so an agent reads those and `AGENTS.md` and skips the rest.
// See README.md beside this file.
//
// The units are found on every run, not listed here, so a new ADR or co-located doc is judged
// without an edit to this file.

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { errorLine } from './client.mjs';
import { JEV_CHARS_PER_TOKEN, JEV_QUESTION_TOKENS, JEV_REQUEST_TOKENS, PRUNE_INCLUDE_NOUL } from './constants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ALWAYS = 'AGENTS.md';
const IDEA_DOC = 'docs/idea.md';
const ADR = /^docs\/adr\/\d{4}-[^/]+\.md$/;

/**
 * Split `docs/idea.md` into its sections: one per `#` or `##` heading, running to the next one, so
 * a `###` subsection stays inside its numbered section. Lines inside a code fence are never
 * headings. Text before the first heading belongs to no section and is dropped.
 */
export function ideaSections(doc) {
  const sections = [];
  let current = null;
  let fenced = false;
  for (const line of doc.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^#{1,2} +(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      current = { path: IDEA_DOC, heading: heading[1], lines: [line] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections.map(({ lines, ...section }) => ({ ...section, text: lines.join('\n').trim() }));
}

/**
 * Whether a tracked `.md` path is a co-located doc: one in a subdirectory, beside the code it
 * describes. Not one at the root (`AGENTS.md` is always read; `README.md` is the project's front
 * page), not under `docs/` (ADRs and `docs/idea.md` are their own units; the rest is workflow the
 * agent already follows), not under a dot-directory (skills in `.agents/`, CI in `.github/`), and
 * never under `node_modules/`.
 */
export function isCoLocated(file) {
  const parts = file.split('/');
  if (parts.length < 2 || parts[0] === 'docs') return false;
  return !parts.some((part) => part.startsWith('.') || part === 'node_modules');
}

async function trackedMarkdown(root) {
  const { stdout } = await promisify(execFile)('git', ['-C', root, 'ls-files', '-z', '--', '*.md'], {
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.split('\0').filter(Boolean).sort();
}

/** Every unit the pruner judges, in read-list order: ADRs, `docs/idea.md` sections, co-located docs. */
async function units(root) {
  const tracked = await trackedMarkdown(root);
  const read = async (file) => ({ path: file, text: (await readFile(path.join(root, file), 'utf8')).trim() });
  const adrs = await Promise.all(tracked.filter((f) => ADR.test(f)).map(read));
  const idea = ideaSections(await readFile(path.join(root, IDEA_DOC), 'utf8'));
  const coLocated = await Promise.all(tracked.filter(isCoLocated).map(read));
  return [...adrs, ...idea, ...coLocated];
}

function question(unit) {
  const document = { path: unit.path, ...(unit.heading && { section: unit.heading }), text: unit.text };
  return {
    type: 'noul',
    instructions: {
      document,
      question:
        'Should an agent doing the work described in `work` read `document` before starting, ' +
        'because it decides, constrains or describes something that work touches?',
    },
    criteria: {
      true: 'The document governs or explains code, files, behaviour or decisions the work changes or depends on.',
      false: 'The document is about an area of the project the work does not touch.',
    },
  };
}

const tokens = (value) => Math.ceil(JSON.stringify(value).length / JEV_CHARS_PER_TOKEN);

/**
 * Pack questions into as few requests as the limits allow, in order. Every question passed here
 * already fits beside the state on its own.
 */
function batches(stateTokens, asks) {
  const out = [];
  let current = null;
  for (const ask of asks) {
    if (!current || current.tokens + ask.tokens > JEV_REQUEST_TOKENS) {
      current = { tokens: stateTokens, asks: [] };
      out.push(current);
    }
    current.asks.push(ask);
    current.tokens += ask.tokens;
  }
  return out.map((b) => b.asks);
}

const entry = ({ path: file, heading }) => ({ path: file, ...(heading && { heading }) });

/**
 * The read list for one ticket or PR.
 *
 * @param {{ title: string, body?: string, files?: string[] }} input  its title and body, and the
 *   paths it changes (none for an issue). Never the diff: only these three fields are sent.
 * @param {{ client: { available(): Promise<object>, ask(request): Promise<object> }, root?: string }} deps
 *   a shared client from client.mjs, and the repo root the docs are read from (default: this repo)
 * @returns one of
 *   { status: 'ok', read: Entry[] }  `AGENTS.md` first, then each unit to read, in discovery order.
 *     Entry = { path, heading?, reason, noul? }: `heading` for a `docs/idea.md` section; reason
 *     'always' (AGENTS.md), 'relevant' (with its noul), or 'oversize' (too large to ask about)
 *   { status: 'skipped', reason }  no key, or the SDK is not installed
 *   { status: 'error', reason }    anything else; never thrown
 */
export async function run(input, { client, root = ROOT }) {
  try {
    // Before any other work, so a keyless run skips even when the docs or git are unavailable.
    const ready = await client.available();
    if (ready.status !== 'ok') return ready;
    // An empty input (often a forgotten number with an empty, non-TTY stdin) has nothing to judge.
    if (!input?.title?.trim()) {
      return { status: 'error', reason: 'the work has no title: give an issue or PR number, or pipe it on stdin' };
    }
    const state = { work: { title: input.title, body: input.body ?? '', changed_files: [...(input.files ?? [])] } };
    const stateTokens = tokens(state);

    const all = (await units(root)).map((unit, i) => ({ id: `u${i}`, unit, question: question(unit) }));
    for (const ask of all) ask.tokens = tokens(ask.question);
    // Too large to ask about beside the state: include it, since a missed doc costs more than a read.
    const oversize = new Set(all.filter((a) => stateTokens + a.tokens > JEV_QUESTION_TOKENS).map((a) => a.id));

    const nouls = {};
    const results = await Promise.all(
      batches(stateTokens, all.filter((a) => !oversize.has(a.id))).map((batch) =>
        client.ask({ state, questions: Object.fromEntries(batch.map((a) => [a.id, a.question])) }),
      ),
    );
    for (const result of results) {
      if (result.status !== 'ok') return { status: result.status, reason: result.reason };
      Object.assign(nouls, result.answers);
    }

    const read = [{ path: ALWAYS, reason: 'always' }];
    for (const { id, unit } of all) {
      if (oversize.has(id)) {
        read.push({ ...entry(unit), reason: 'oversize' });
        continue;
      }
      const noul = nouls[id]?.noul;
      if (typeof noul !== 'number') throw new Error('Jev returned no usable answer');
      if (noul >= PRUNE_INCLUDE_NOUL) read.push({ ...entry(unit), reason: 'relevant', noul });
    }
    return { status: 'ok', read };
  } catch (error) {
    return { status: 'error', reason: errorLine(error) };
  }
}
