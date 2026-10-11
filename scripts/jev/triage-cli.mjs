#!/usr/bin/env node
// CLI for the triage helper. See README.md beside this file.
//
//   node scripts/jev/triage-cli.mjs <issue-number> [--json]   reads the issue with `gh issue view`
//   gh issue view 3 --json title,body | node scripts/jev/triage-cli.mjs [--json]
//   node scripts/jev/triage-cli.mjs [--json] < issue.txt       first non-blank line is the title, the rest the body
//
// Always exits 0: a skip or an error is one line on stdout, and the caller triages as normal.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createClient, errorLine } from './client.mjs';
import { run } from './triage.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const number = args.find((a) => /^\d+$/.test(a));

function readIssue() {
  if (number) {
    const out = execFileSync('gh', ['issue', 'view', number, '--json', 'title,body'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(out);
  }
  if (process.stdin.isTTY) throw new Error('give an issue number, or pipe the issue on stdin');
  const text = readFileSync(0, 'utf8');
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.title === 'string') return { title: parsed.title, body: parsed.body ?? '' };
  } catch {
    // Not JSON: plain text, read below.
  }
  const [title, ...rest] = text.trim().split('\n');
  return { title: title.trim(), body: rest.join('\n').trim() };
}

function human(decision) {
  if (decision.status !== 'ok') return `jev triage: ${decision.status}, ${decision.reason}; triage as normal`;
  const line = (name, s, onDefer) =>
    `${name}: ${s.label} (confidence ${s.confidence.toFixed(2)}) ${s.decision}` +
    (s.decision === 'defer' ? ` - ${onDefer}` : '');
  return [
    line('role', decision.role, 'decide the role as normal'),
    line('phase', decision.phase, 'phase unclear, ask the owner'),
  ].join('\n');
}

// Check the key and the SDK first: a keyless run must not fetch the issue, and must print the skip.
const client = createClient();
let decision = await client.available();
try {
  if (decision.status === 'ok') decision = await run(readIssue(), { client });
} catch (error) {
  decision = { status: 'error', reason: errorLine(error) };
}
console.log(json ? JSON.stringify(decision) : human(decision));
