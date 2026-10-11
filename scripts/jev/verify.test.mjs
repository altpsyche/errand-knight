// Tests for the finding verifier. Most drive its seam, `run(input, { client, root })`, with a fake
// client returning canned Noul answers; a few run the CLI as an agent would. Nothing here reaches
// Jev or needs a real key.

import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from './client.mjs';
import { human, run } from './verify.mjs';

// A draft finding as a Reviewer writes it: the finding, the line it quotes, the source it cites,
// and an excerpt of that source.
function finding(overrides = {}) {
  return {
    text: 'The helper prints the key when a request fails.',
    quote: 'console.log(`request failed with ${key}`);',
    source: 'docs/adr/0004-jev-dev-tooling-only.md',
    excerpt: 'The dev key, TYPESAFE_API_KEY, lives only in the owner\'s shell. It is never committed.',
    ...overrides,
  };
}

// A client that answers each Noul with the next value from `nouls`, in the order its questions
// arrive, and records every request.
function fakeClient(nouls = []) {
  const calls = [];
  const queue = [...nouls];
  return {
    calls,
    async available() {
      return { status: 'ok' };
    },
    async ask(request) {
      calls.push(request);
      const answers = {};
      for (const id of Object.keys(request.questions)) answers[id] = { type: 'noul', noul: queue.shift() ?? 0.9 };
      return { status: 'ok', answers };
    },
  };
}

test('keeps a supported finding and flags an unsupported one, in one request of Noul questions', async () => {
  const client = fakeClient([0.92, 0.12]);
  const result = await run([finding({ id: 'F1' }), finding({ id: 'F2' })], { client });
  assert.deepEqual(result, {
    status: 'ok',
    findings: [
      { id: 'F1', decision: 'keep', noul: 0.92, reason: 'checked' },
      { id: 'F2', decision: 'flag', noul: 0.12, reason: 'checked' },
    ],
  });
  assert.equal(client.calls.length, 1);
  const questions = Object.values(client.calls[0].questions);
  assert.equal(questions.length, 2);
  for (const q of questions) assert.equal(q.type, 'noul');
});

test('flags just below the threshold and keeps exactly at it', async () => {
  const client = fakeClient([0.49, 0.5]);
  const result = await run([finding({ id: 'A' }), finding({ id: 'B' })], { client });
  assert.equal(result.status, 'ok');
  assert.deepEqual(
    result.findings.map((f) => [f.id, f.decision]),
    [
      ['A', 'flag'],
      ['B', 'keep'],
    ],
  );
});

test('never flags or sends a finding whose source names the constitution', async () => {
  const client = fakeClient([0.05]);
  const constitutional = finding({
    id: 'C1',
    source: 'docs/workflow.md § Review checklist, The constitution',
    excerpt: 'Telemetry of any kind blocks the merge.',
  });
  const result = await run([constitutional, finding({ id: 'F2' })], { client });
  assert.deepEqual(result.findings, [
    { id: 'C1', decision: 'keep', noul: null, reason: 'constitution' },
    { id: 'F2', decision: 'flag', noul: 0.05, reason: 'checked' },
  ]);
  // Only F2 reached Jev.
  assert.equal(client.calls.length, 1);
  assert.equal(Object.keys(client.calls[0].questions).length, 1);
});

test('never flags a finding whose excerpt quotes a constitution bullet whole, whatever its source says', async () => {
  const client = fakeClient([0.05]);
  const constitutional = finding({
    source: 'docs/workflow.md:120',
    excerpt: '- No new outbound   network destination. Adding one requires an ADR.',
  });
  const result = await run([constitutional], { client });
  assert.deepEqual(result.findings, [{ id: 'F1', decision: 'keep', noul: null, reason: 'constitution' }]);
  assert.equal(client.calls.length, 0);
});

// Realistic citations of the constitution: the checklist named without its section, and the
// bullet quoted in part, with its punctuation and case changed. Each must be kept unasked.
for (const [name, excerpt] of [
  ["a bullet's first sentence only", 'No new outbound network destination.'],
  ['a bullet without its final period', 'No telemetry, analytics, ads, or monetisation of any kind, including build-flagged'],
  ["a bullet's later sentence", 'Adding one requires an ADR.'],
  ["a bullet's clause after a semicolon, in another case", 'THE FRONTEND NEVER HOLDS THAT KEY'],
  ["the opening words of a bullet, cut mid-sentence", 'No telemetry, analytics, ads, or monetisation…'],
  ['a whole bullet', 'Imported items never cost HP.'],
]) {
  test(`never flags a finding citing the review checklist with ${name}`, async () => {
    const client = fakeClient([0.05]);
    const result = await run([finding({ source: 'docs/workflow.md § Review checklist', excerpt })], { client });
    assert.deepEqual(result.findings, [{ id: 'F1', decision: 'keep', noul: null, reason: 'constitution' }]);
    assert.equal(client.calls.length, 0);
  });
}

test('still checks a finding citing a checklist line outside the constitution', async () => {
  const client = fakeClient([0.05]);
  const excerpt = 'No `Manager` suffix; no module without an ADR.';
  const result = await run([finding({ source: 'docs/workflow.md § Review checklist', excerpt })], { client });
  assert.deepEqual(result.findings, [{ id: 'F1', decision: 'flag', noul: 0.05, reason: 'checked' }]);
});

// About 20k tokens of excerpt: one fits a request, two do not.
const LARGE = 'The renderer must work on both the WebGPU and WebGL2 paths. '.repeat(1000);
// Far past the 32k state-plus-question limit on its own.
const HUGE = LARGE.repeat(4);

test('splits findings across requests when they do not fit one, and checks each exactly once', async () => {
  const client = fakeClient([0.9, 0.2, 0.8]);
  const input = [finding({ id: 'A', excerpt: LARGE }), finding({ id: 'B', excerpt: LARGE }), finding({ id: 'C' })];
  const result = await run(input, { client });
  assert.equal(result.status, 'ok');
  assert.equal(client.calls.length, 2);
  const asked = client.calls.map((c) => Object.keys(c.questions).length);
  assert.deepEqual(asked.sort(), [1, 2], 'the small finding shares a request with one large one');
  assert.deepEqual(result.findings.map((f) => f.id), ['A', 'B', 'C']);
  for (const f of result.findings) assert.equal(f.reason, 'checked');
});

test('splits many small findings whose questions together pass the whole-request limit', async () => {
  // Each finding is a few characters of state but carries a question of a few hundred, so 600 of
  // them sit far inside the 32k state-plus-longest-question limit and far past the 64k one.
  const tiny = (n) => ({ text: `t${n}`, quote: `q${n}`, source: `s${n}`, excerpt: `e${n}` });
  const input = Array.from({ length: 600 }, (_, n) => tiny(n));
  const client = fakeClient();
  const result = await run(input, { client });
  assert.equal(result.status, 'ok');
  assert.ok(client.calls.length > 1, `${client.calls.length} request for 600 questions`);
  const asked = client.calls.reduce((sum, c) => sum + Object.keys(c.questions).length, 0);
  assert.equal(asked, 600, 'every finding is asked exactly once');
  assert.equal(result.findings.length, 600);
});

test('keeps a finding too large for any request without asking Jev', async () => {
  const client = fakeClient([0.1]);
  const result = await run([finding({ id: 'BIG', excerpt: HUGE }), finding({ id: 'F2' })], { client });
  assert.deepEqual(result.findings, [
    { id: 'BIG', decision: 'keep', noul: null, reason: 'too-large' },
    { id: 'F2', decision: 'flag', noul: 0.1, reason: 'checked' },
  ]);
  assert.equal(client.calls.length, 1);
  assert.equal(Object.keys(client.calls[0].questions).length, 1);
});

for (const [name, input] of [
  ['no findings at all', []],
  ['something other than an array', { text: 'one finding, not in a list' }],
  ['a finding with a blank quote', [finding({ quote: '   ' })]],
  ['a finding with no excerpt', [{ text: 't', quote: 'q', source: 's' }]],
  ['two findings with one id', [finding({ id: 'F1' }), finding({ id: 'F1' })]],
  ['a finding that is not an object', ['F1: the key is logged']],
  ['a blank id', [finding({ id: '  ' })]],
  ['an id that is not a string', [finding({ id: 7 })]],
]) {
  test(`input with ${name} is one error line and never reaches Jev`, async () => {
    const client = fakeClient();
    const result = await run(input, { client });
    assert.equal(result.status, 'error');
    assert.ok(!result.reason.includes('\n'));
    assert.equal(client.calls.length, 0);
  });
}

test('a defaulted id that collides with a given one says how to fix it', async () => {
  const client = fakeClient();
  const result = await run([finding({ id: 'F2' }), finding()], { client });
  assert.equal(result.status, 'error');
  assert.match(result.reason, /default/);
  assert.equal(client.calls.length, 0);
});

// A client whose single answer for every question is `answer`.
function answering(answer) {
  return {
    async available() {
      return { status: 'ok' };
    },
    async ask(request) {
      return { status: 'ok', answers: Object.fromEntries(Object.keys(request.questions).map((k) => [k, answer])) };
    },
  };
}

for (const [name, answer] of [
  ['no answer', undefined],
  ['a noul that is not a number', { type: 'noul', noul: 'high' }],
  ['a noul that is NaN', { type: 'noul', noul: NaN }],
  ['a noul above 1', { type: 'noul', noul: 1.5 }],
]) {
  test(`${name} from Jev is an error line, never a silent keep`, async () => {
    const result = await run([finding()], { client: answering(answer) });
    assert.equal(result.status, 'error');
    assert.match(result.reason, /no usable answer/);
  });
}

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

test('skips without calling Jev when TYPESAFE_API_KEY is not set, even on malformed input', async () => {
  const { client, sent, loads } = realClient({ env: {} });
  const result = await run([], { client });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /TYPESAFE_API_KEY/);
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
  const result = await run([finding()], { client });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /@typesafe-ai\/sdk/);
  assert.equal(sent.length, 0);
});

const KEY = 'tsk-test-0123456789';

test('reports a failed request as one error line with the key redacted, on the pinned model', async () => {
  const { client, sent } = realClient({
    env: { TYPESAFE_API_KEY: KEY },
    systemOne: () => {
      throw new Error(`401 invalid key ${KEY}\nrequest body follows`);
    },
  });
  const result = await run([finding()], { client });
  assert.equal(result.status, 'error');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].model, 'jev-1.13.0', 'the request names the pinned model, never jev-latest');
  assert.ok(!result.reason.includes(KEY), `key leaked: ${result.reason}`);
  assert.ok(!result.reason.includes('\n'), 'reason is more than one line');
});

test('a failure in a later request fails the whole run rather than reporting half the findings', async () => {
  let n = 0;
  const { client, sent } = realClient({
    env: { TYPESAFE_API_KEY: KEY },
    systemOne: (request) => {
      n += 1;
      if (n === 2) throw new Error('529 overloaded');
      const answers = Object.fromEntries(Object.keys(request.questions).map((k) => [k, { type: 'noul', noul: 0.9 }]));
      return { answers };
    },
  });
  const result = await run([finding({ excerpt: LARGE }), finding({ excerpt: LARGE })], { client });
  assert.equal(sent.length, 2);
  assert.deepEqual(result, { status: 'error', reason: '529 overloaded' });
});

test('skips before reading the checklist when there is no key, even if it no longer parses', async () => {
  // A repo root with no docs/workflow.md: reading it would be an error, not a skip.
  const root = await mkdtemp(path.join(tmpdir(), 'jev-verify-'));
  try {
    const { client } = realClient({ env: {} });
    const result = await run([finding()], { client, root });
    assert.equal(result.status, 'skipped');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a checklist with no constitution section is an error, not a run without the exemption', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'jev-verify-'));
  try {
    await mkdir(path.join(root, 'docs'), { recursive: true });
    await writeFile(path.join(root, 'docs/workflow.md'), '# Workflow\n\n**Correctness**\n\n- Tests pass.\n');
    const client = fakeClient();
    const result = await run([finding()], { client, root });
    assert.equal(result.status, 'error');
    assert.match(result.reason, /constitution/);
    assert.equal(client.calls.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the default output is one line per finding, and a flag line says what to do', async () => {
  const client = fakeClient([0.92, 0.31]);
  const input = [
    finding({ id: 'F1' }),
    finding({ id: 'F2' }),
    finding({ id: 'F3', source: 'docs/workflow.md § The constitution' }),
    finding({ id: 'F4', excerpt: HUGE }),
  ];
  assert.equal(
    human(await run(input, { client })),
    [
      'F1: keep (noul 0.92)',
      'F2: flag (noul 0.31) - re-read the cited source once, then keep or drop the finding',
      'F3: keep (cites the constitution, never flagged)',
      'F4: keep (too large to check)',
    ].join('\n'),
  );
});

// The CLI, run as an agent runs it. A dummy key with a dead base URL means a request that got past
// every guard fails with a connection error instead of reaching Jev.
const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'verify-cli.mjs');
const DEAD = { TYPESAFE_API_KEY: 'dummy-key', TYPESAFE_BASE_URL: 'http://127.0.0.1:9' };

function runCli(args, { env = {}, stdin = '' } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], { input: stdin, encoding: 'utf8', env });
  return { status: result.status, stdout: result.stdout };
}

test('the CLI prints the skip line without reading the findings when there is no key', () => {
  const { status, stdout } = runCli(['/nonexistent/findings.json']);
  assert.equal(status, 0);
  assert.equal(stdout, 'jev verify: skipped, TYPESAFE_API_KEY is not set; continue as normal\n');
});

test('the CLI turns empty stdin into one error line, exit 0, with no request', () => {
  const { status, stdout } = runCli([], { env: DEAD, stdin: '  \n' });
  assert.equal(status, 0);
  assert.match(stdout, /^jev verify: error, [^\n]*no findings[^\n]*\n$/);
});

test('the CLI turns input that is not JSON into one error line', () => {
  const { status, stdout } = runCli([], { env: DEAD, stdin: 'F1: the key is logged\n' });
  assert.equal(status, 0);
  assert.match(stdout, /^jev verify: error, [^\n]*JSON[^\n]*\n$/);
});

test('the CLI reads findings from a file and sends them, as JSON with --json', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'jev-verify-cli-'));
  try {
    const file = path.join(dir, 'findings.json');
    await writeFile(file, JSON.stringify([finding()]));
    const { status, stdout } = runCli([file, '--json'], { env: DEAD });
    assert.equal(status, 0);
    // The dead base URL fails the request: proof the file was read, validated and sent.
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.status, 'error');
    assert.match(parsed.reason, /connection|fetch/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the CLI reads findings from stdin and sends them', () => {
  const { status, stdout } = runCli([], { env: DEAD, stdin: JSON.stringify([finding()]) });
  assert.equal(status, 0);
  assert.match(stdout, /^jev verify: error, [^\n]*(connection|fetch)[^\n]*\n$/i);
});

test('the sample findings file is valid input and shows the exemption', async () => {
  const file = path.join(path.dirname(CLI), 'fixtures', 'findings.sample.json');
  const sample = JSON.parse(await readFile(file, 'utf8'));
  const client = fakeClient();
  const result = await run(sample, { client });
  assert.equal(result.status, 'ok');
  assert.ok(result.findings.some((f) => f.reason === 'constitution'));
  assert.ok(result.findings.some((f) => f.reason === 'checked'));
});
