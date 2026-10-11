#!/usr/bin/env node
// CLI for the finding verifier. See README.md beside this file.
//
//   node scripts/jev/verify-cli.mjs <findings.json> [--json]   reads the findings from the file
//   node scripts/jev/verify-cli.mjs [--json] < findings.json   or from stdin
//
// The input is a JSON array of findings, each { id?, text, quote, source, excerpt }.
// Always exits 0: a skip or an error is one line on stdout, and the Reviewer continues as normal.

import { readFileSync } from 'node:fs';
import { createClient, errorLine } from './client.mjs';
import { human, run } from './verify.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const file = args.find((a) => !a.startsWith('--'));

function readFindings() {
  if (!file && process.stdin.isTTY) throw new Error('give a findings file, or pipe the findings on stdin');
  const text = readFileSync(file ?? 0, 'utf8');
  if (!text.trim()) throw new Error('no findings: the input is empty');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('the findings are not JSON: give a JSON array of { text, quote, source, excerpt }');
  }
}

// Check the key and the SDK first: a keyless run must not read the findings, and must print the skip.
const client = createClient();
let result = await client.available();
try {
  if (result.status === 'ok') result = await run(readFindings(), { client });
} catch (error) {
  result = { status: 'error', reason: errorLine(error) };
}
console.log(json ? JSON.stringify(result) : human(result));
