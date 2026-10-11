// Tests for the triage helper, at its one seam: `run(input, { client })`. A fake client returns
// canned Jev answers; nothing here touches the network or needs a key.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from './client.mjs';
import { run } from './triage.mjs';

const ISSUE = { title: 'Tauri v2 desktop shell', body: 'Stand up the empty Tauri window.' };

// A client that answers every request with the given role and phase answers.
function fakeClient(role, phase) {
  const calls = [];
  return {
    calls,
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
