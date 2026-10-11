// Tests for the triage helper, at its one seam: `run(input, { client })`. A fake client returns
// canned Jev answers; nothing here touches the network or needs a key.

import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from './client.mjs';
import { run } from './triage.mjs';

const ISSUE = { title: 'Tauri v2 desktop shell', body: 'Stand up the empty Tauri window.' };

// A client that answers every request with the given role and phase answers.
function fakeClient(role, phase) {
  const calls = [];
  return {
    calls,
    async available() {
      return { status: 'ok' };
    },
    async ask(request) {
      calls.push(request);
      return { status: 'ok', answers: { role: { type: 'choice', ...role }, phase: { type: 'choice', ...phase } } };
    },
  };
}

test('applies both labels when Jev is confident', async () => {
  const client = fakeClient(
    { choice: 'ready-for-agent', confidence: 0.93 },
    { choice: 'phase:0', confidence: 0.85 },
  );
  const decision = await run(ISSUE, { client });
  assert.deepEqual(decision, {
    status: 'ok',
    role: { label: 'ready-for-agent', confidence: 0.93, decision: 'apply' },
    phase: { label: 'phase:0', confidence: 0.85, decision: 'apply' },
  });
  // One request carries both questions, as Choices, over the issue's title and body.
  assert.equal(client.calls.length, 1);
  const [request] = client.calls;
  assert.deepEqual(request.state, { issue: ISSUE });
  assert.deepEqual(Object.keys(request.questions).sort(), ['phase', 'role']);
  assert.equal(request.questions.role.type, 'choice');
  assert.equal(request.questions.phase.type, 'choice');
});

test('defers a label below the threshold and applies one exactly at it', async () => {
  const client = fakeClient(
    { choice: 'needs-info', confidence: 0.79 },
    { choice: 'phase:1', confidence: 0.8 },
  );
  const decision = await run(ISSUE, { client });
  assert.equal(decision.status, 'ok');
  assert.deepEqual(decision.role, { label: 'needs-info', confidence: 0.79, decision: 'defer' });
  assert.deepEqual(decision.phase, { label: 'phase:1', confidence: 0.8, decision: 'apply' });
});

// The real shared client, with its two boundaries injected: the environment and the SDK import.
// `sent` records every request that reaches the fake SDK; `systemOne` replaces its answer, and by
// default any request is an error, so a skip test proves none was sent.
function realClient({ env, sdkImport, systemOne }) {
  const sent = [];
  const loads = [];
  const importSdk = async () => {
    loads.push(true);
    if (sdkImport) return sdkImport();
    return {
      TypeSafeClient: class {
        async systemOne(request) {
          sent.push(request);
          if (systemOne) return systemOne(request);
          throw new Error('a skipped run must not reach the SDK');
        }
      },
    };
  };
  return { client: createClient({ env, importSdk }), sent, loads };
}

test('skips without calling Jev when TYPESAFE_API_KEY is not set', async () => {
  const { client, sent, loads } = realClient({ env: {} });
  const decision = await run(ISSUE, { client });
  assert.equal(decision.status, 'skipped');
  assert.match(decision.reason, /TYPESAFE_API_KEY/);
  assert.equal(loads.length, 0);
  assert.equal(sent.length, 0);
});

test('skips without calling Jev when the SDK is not installed', async () => {
  const missing = () => {
    // The error Node raises for a dynamic import of a package that is not in node_modules.
    const error = new Error("Cannot find package '@typesafe-ai/sdk'");
    error.code = 'ERR_MODULE_NOT_FOUND';
    throw error;
  };
  const { client, sent } = realClient({ env: { TYPESAFE_API_KEY: 'test-key' }, sdkImport: missing });
  const decision = await run(ISSUE, { client });
  assert.equal(decision.status, 'skipped');
  assert.match(decision.reason, /@typesafe-ai\/sdk/);
  assert.equal(sent.length, 0);
});

const KEY = 'tsk-test-0123456789';

test('reports a failed request as one error line with the key redacted', async () => {
  const { client, sent } = realClient({
    env: { TYPESAFE_API_KEY: KEY },
    systemOne: () => {
      throw new Error(`401 invalid key ${KEY}\nrequest body follows`);
    },
  });
  const decision = await run(ISSUE, { client });
  assert.equal(decision.status, 'error');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].model, 'jev-1.13.0', 'the request names the pinned model, never jev-latest');
  assert.ok(!decision.reason.includes(KEY), `key leaked: ${decision.reason}`);
  assert.ok(!decision.reason.includes('\n'), 'reason is more than one line');
});

test('reports an SDK that fails to load, other than a missing module, as a redacted error', async () => {
  const broken = () => {
    const error = new Error(`SyntaxError while loading, env had ${KEY}`);
    error.code = 'ERR_INVALID_PACKAGE_CONFIG';
    throw error;
  };
  const { client, sent } = realClient({ env: { TYPESAFE_API_KEY: KEY }, sdkImport: broken });
  const decision = await run(ISSUE, { client });
  assert.equal(decision.status, 'error');
  assert.equal(sent.length, 0);
  assert.ok(!decision.reason.includes(KEY), `key leaked: ${decision.reason}`);
});

test('skips before reading the docs when there is no key, even if the docs no longer parse', async () => {
  // A repo root with neither doc: reading them would be an error, not a skip.
  const root = await mkdtemp(path.join(tmpdir(), 'jev-triage-'));
  try {
    const { client } = realClient({ env: {} });
    const decision = await run(ISSUE, { client, root });
    assert.equal(decision.status, 'skipped');
    assert.match(decision.reason, /TYPESAFE_API_KEY/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// The CLI, run as an agent runs it, with a `gh` stub first on PATH that records any call.
const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'triage-cli.mjs');

async function runCli(args, { env = {}, stdin = '' } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'jev-cli-'));
  const log = path.join(dir, 'gh.log');
  await writeFile(path.join(dir, 'gh'), `#!/bin/sh\necho "$@" >> "${log}"\nexit 1\n`);
  await chmod(path.join(dir, 'gh'), 0o755);
  try {
    const result = spawnSync(process.execPath, [CLI, ...args], {
      input: stdin,
      encoding: 'utf8',
      env: { PATH: dir, ...env },
    });
    const ghCalls = existsSync(log) ? (await readFile(log, 'utf8')).trim().split('\n') : [];
    return { status: result.status, stdout: result.stdout, ghCalls };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('the CLI prints the skip line without calling gh when there is no key', async () => {
  const { status, stdout, ghCalls } = await runCli(['3']);
  assert.equal(status, 0);
  assert.equal(stdout, 'jev triage: skipped, TYPESAFE_API_KEY is not set; triage as normal\n');
  assert.deepEqual(ghCalls, []);
});

test('an issue with no title or body is an error and never reaches Jev', async () => {
  const client = fakeClient(
    { choice: 'needs-info', confidence: 0.9 },
    { choice: 'phase:0', confidence: 0.9 },
  );
  const decision = await run({ title: '  ', body: '\n' }, { client });
  assert.equal(decision.status, 'error');
  assert.equal(client.calls.length, 0);
});

test('the CLI turns empty stdin into one error line, exit 0, with no request', async () => {
  // A dead base URL: if the empty issue were sent, it would fail here rather than reach Jev.
  const env = { TYPESAFE_API_KEY: 'dummy-key', TYPESAFE_BASE_URL: 'http://127.0.0.1:9' };
  const { status, stdout } = await runCli([], { env, stdin: '  \n\n' });
  assert.equal(status, 0);
  assert.match(stdout, /^jev triage: error, [^\n]*no title[^\n]*\n$/);
});

// A repo root holding this repo's two docs, with the triage labels doc passed through `edit`.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function withDocs(edit, fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'jev-docs-'));
  try {
    await mkdir(path.join(root, 'docs', 'agents'), { recursive: true });
    const labels = await readFile(path.join(REPO, 'docs/agents/triage-labels.md'), 'utf8');
    await writeFile(path.join(root, 'docs/agents/triage-labels.md'), edit(labels));
    await writeFile(path.join(root, 'docs/idea.md'), await readFile(path.join(REPO, 'docs/idea.md'), 'utf8'));
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('role options follow the label column of the triage labels table', async () => {
  const rename = (doc) => doc.replace('| `ready-for-agent` | `ready-for-agent` |', '| `ready-for-agent` | `agent-ready` |');
  await withDocs(rename, async (root) => {
    const client = fakeClient(
      { choice: 'agent-ready', confidence: 0.9 },
      { choice: 'phase:0', confidence: 0.9 },
    );
    const decision = await run(ISSUE, { client, root });
    assert.equal(decision.status, 'ok');
    assert.deepEqual(Object.keys(client.calls[0].questions.role.criteria).sort(), [
      'agent-ready',
      'needs-info',
      'ready-for-human',
      'wontfix',
    ]);
  });
});

test('a triage table row outside the five canonical roles is an error, not silently dropped', async () => {
  const addRow = (doc) =>
    doc.replace('| `wontfix` | `wontfix` |', '| `duplicate` | `duplicate` | Already tracked elsewhere |\n| `wontfix` | `wontfix` |');
  await withDocs(addRow, async (root) => {
    const client = fakeClient(
      { choice: 'wontfix', confidence: 0.9 },
      { choice: 'phase:0', confidence: 0.9 },
    );
    const decision = await run(ISSUE, { client, root });
    assert.equal(decision.status, 'error');
    assert.match(decision.reason, /duplicate/);
    assert.equal(client.calls.length, 0);
  });
});
