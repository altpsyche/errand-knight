#!/usr/bin/env node
// CLI for the doc pruner. See README.md beside this file.
//
//   node scripts/jev/prune-cli.mjs <number> [--json]   a PR (`gh pr view`), else an issue (`gh issue view`)
//   gh pr view 12 --json title,body,files | node scripts/jev/prune-cli.mjs [--json]
//   node scripts/jev/prune-cli.mjs [--json] < ticket.txt    first non-blank line is the title, the rest the body
//
// Prints the read list, one path a line (`docs/idea.md § <heading>` for a section), AGENTS.md first.
// Always exits 0: a skip or an error is one line on stdout, and the agent reads the docs as normal.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createClient, errorLine } from './client.mjs';
import { run } from './prune.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const number = args.find((a) => /^\d+$/.test(a));

const gh = (...ghArgs) =>
  JSON.parse(execFileSync('gh', ghArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));

// `gh` lists a PR's files as objects; piped JSON may list plain paths. Only the path is kept.
function work({ title, body, files }) {
  return {
    title: String(title ?? ''),
    body: String(body ?? ''),
    files: (files ?? []).map((f) => (typeof f === 'string' ? f : f?.path)).filter(Boolean),
  };
}

function readWork() {
  if (number) {
    // GitHub numbers issues and PRs from one sequence: a PR first, which carries its changed files.
    try {
      return work(gh('pr', 'view', number, '--json', 'title,body,files'));
    } catch {
      return work(gh('issue', 'view', number, '--json', 'title,body'));
    }
  }
  if (process.stdin.isTTY) throw new Error('give an issue or PR number, or pipe it on stdin');
  const text = readFileSync(0, 'utf8');
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.title === 'string') return work(parsed);
  } catch {
    // Not JSON: plain text, read below.
  }
  const [title, ...rest] = text.trim().split('\n');
  return work({ title: title.trim(), body: rest.join('\n').trim() });
}

function human(result) {
  if (result.status !== 'ok') return `jev prune: ${result.status}, ${result.reason}; read the docs as normal`;
  return result.read.map(({ path, heading }) => (heading ? `${path} § ${heading}` : path)).join('\n');
}

// Check the key and the SDK first: a keyless run must not call `gh`, and must print the skip.
const client = createClient();
let result = await client.available();
try {
  if (result.status === 'ok') result = await run(readWork(), { client });
} catch (error) {
  result = { status: 'error', reason: errorLine(error) };
}
console.log(json ? JSON.stringify(result) : human(result));
