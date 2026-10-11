// Tests for the doc pruner. Most drive its seam, `run(input, { client, root })`, with a fake client
// over a small git repo built in a temp dir, so unit discovery is proven on a real tree. A few run
// the CLI as an agent would, with a `gh` stub on PATH and a fake Jev server on localhost. Nothing
// here reaches Jev or needs a real key.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from './client.mjs';
import { estimateTokens, run } from './prune.mjs';

const WORK = {
  title: 'Sync outbox retries',
  body: 'Retry failed Tasks writes from the outbox.',
  files: ['src-tauri/src/sync/outbox.rs'],
};

// A minimal repo with the shapes the pruner reads: AGENTS.md, ADRs, docs/idea.md and a co-located
// `.md`. Each unit's text carries a marker the fake client keys its answers on, so no test depends
// on how the question is worded.
const BASE = {
  'AGENTS.md': '# Agents\n',
  'docs/adr/0001-first.md': '# First\n\nMARK-ADR-1\n',
  'docs/adr/0002-second.md': '# Second\n\nMARK-ADR-2\n',
  'docs/idea.md': '# Idea\n\nMARK-INTRO\n\n## 1. Vision\n\nMARK-VISION\n\n## 2. Sync\n\nMARK-SYNC\n',
  'scripts/tool/README.md': '# Tool\n\nMARK-TOOL\n',
};

async function withRepo(files, fn, { untracked = {} } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'jev-prune-'));
  try {
    for (const [file, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), text);
    }
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', '-f', '--', ...Object.keys(files)], { cwd: root });
    for (const [file, text] of Object.entries(untracked)) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), text);
    }
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// A client that answers each Noul with the value for the first marker its question contains, or
// `fallback` when it contains none. `calls` records every request.
function fakeClient(nouls = {}, fallback = 0.9) {
  const calls = [];
  return {
    calls,
    async available() {
      return { status: 'ok' };
    },
    async ask(request) {
      calls.push(request);
      const answers = {};
      for (const [id, question] of Object.entries(request.questions)) {
        const text = JSON.stringify(question);
        const marker = Object.keys(nouls).find((m) => text.includes(m));
        answers[id] = { type: 'noul', noul: marker ? nouls[marker] : fallback };
      }
      return { status: 'ok', answers };
    },
  };
}

const asked = (client) => client.calls.flatMap((c) => Object.values(c.questions).map((q) => JSON.stringify(q)));

test('the read list starts with AGENTS.md, then each unit Jev finds relevant', async () => {
  await withRepo(BASE, async (root) => {
    const client = fakeClient({ 'MARK-ADR-1': 0.9, 'MARK-ADR-2': 0.05, 'MARK-INTRO': 0.01, 'MARK-VISION': 0.02, 'MARK-SYNC': 0.7, 'MARK-TOOL': 0.1 });
    const result = await run(WORK, { client, root });
    assert.equal(result.status, 'ok');
    assert.deepEqual(
      result.read.map(({ path: p, heading }) => (heading ? `${p} § ${heading}` : p)),
      ['AGENTS.md', 'docs/adr/0001-first.md', 'docs/idea.md § 2. Sync'],
    );
  });
});

const listed = (result) => result.read.map(({ path: p, heading }) => (heading ? `${p} § ${heading}` : p));

test('includes a unit at exactly the 0.2 threshold and excludes one just below it', async () => {
  await withRepo(BASE, async (root) => {
    const client = fakeClient({ 'MARK-ADR-1': 0.2, 'MARK-ADR-2': 0.19 }, 0);
    const result = await run(WORK, { client, root });
    assert.equal(result.status, 'ok');
    assert.deepEqual(listed(result), ['AGENTS.md', 'docs/adr/0001-first.md']);
    assert.deepEqual(result.read[1], { path: 'docs/adr/0001-first.md', reason: 'relevant', noul: 0.2 });
  });
});

test('AGENTS.md is on the read list even when Jev finds nothing relevant', async () => {
  await withRepo(BASE, async (root) => {
    const result = await run(WORK, { client: fakeClient({}, 0), root });
    assert.deepEqual(result, { status: 'ok', read: [{ path: 'AGENTS.md', reason: 'always' }] });
  });
});

test('asks one Noul per unit over the work title, body and changed files, never a diff', async () => {
  await withRepo(BASE, async (root) => {
    const client = fakeClient();
    await run({ ...WORK, diff: 'MARK-DIFF +retry()' }, { client, root });
    assert.equal(client.calls.length, 1);
    const [request] = client.calls;
    assert.deepEqual(request.state, {
      work: { title: WORK.title, body: WORK.body, changed_files: ['src-tauri/src/sync/outbox.rs'] },
    });
    assert.ok(!JSON.stringify(request).includes('MARK-DIFF'), 'the diff reached Jev');
    const questions = Object.values(request.questions);
    assert.ok(questions.every((q) => q.type === 'noul'));
    // ADR-1, ADR-2, three idea.md sections, one co-located doc: each asked about exactly once.
    for (const marker of ['MARK-ADR-1', 'MARK-ADR-2', 'MARK-INTRO', 'MARK-VISION', 'MARK-SYNC', 'MARK-TOOL']) {
      assert.equal(asked(client).filter((q) => q.includes(marker)).length, 1, marker);
    }
    assert.equal(questions.length, 6);
  });
});

// About 25k tokens at the estimate's 3 characters a token: fits beside a small state in one
// question (32k), but three of them do not fit in one request (64k).
const LARGE = 'x'.repeat(75_000);

test('batches questions into more than one request when they exceed the request limit', async () => {
  const files = {
    ...BASE,
    'docs/adr/0003-big-a.md': `MARK-BIG-A ${LARGE}`,
    'docs/adr/0004-big-b.md': `MARK-BIG-B ${LARGE}`,
    'docs/adr/0005-big-c.md': `MARK-BIG-C ${LARGE}`,
  };
  await withRepo(files, async (root) => {
    const client = fakeClient();
    const result = await run(WORK, { client, root });
    assert.equal(result.status, 'ok');
    assert.ok(client.calls.length > 1, `expected several requests, got ${client.calls.length}`);
    for (const marker of ['MARK-BIG-A', 'MARK-BIG-B', 'MARK-BIG-C', 'MARK-ADR-1', 'MARK-TOOL']) {
      assert.equal(asked(client).filter((q) => q.includes(marker)).length, 1, marker);
    }
    // Every request carries the same state.
    assert.ok(client.calls.every((c) => c.state.work.title === WORK.title));
    assert.ok(listed(result).includes('docs/adr/0005-big-c.md'));
  });
});

test('includes a unit too large for one question without asking about it', async () => {
  // About 34k tokens: over the 32k a single question plus the state may hold.
  const files = { ...BASE, 'docs/adr/0003-huge.md': `MARK-HUGE ${'x'.repeat(102_000)}` };
  await withRepo(files, async (root) => {
    const client = fakeClient({}, 0);
    const result = await run(WORK, { client, root });
    assert.equal(result.status, 'ok');
    assert.equal(asked(client).filter((q) => q.includes('MARK-HUGE')).length, 0, 'the oversize unit was asked about');
    assert.deepEqual(result.read, [
      { path: 'AGENTS.md', reason: 'always' },
      { path: 'docs/adr/0003-huge.md', reason: 'oversize' },
    ]);
  });
});

// A work item whose body alone is about 20k tokens, as a long PR description would be.
const LONG_WORK = { ...WORK, body: 'b'.repeat(60_000) };

test('a unit that fits alone but not beside a large state is included without asking', async () => {
  // About 15k tokens: under the 32k question limit alone, over it beside the 20k state.
  const files = { ...BASE, 'docs/adr/0003-mid.md': `MARK-MID ${'x'.repeat(45_000)}` };
  await withRepo(files, async (root) => {
    const client = fakeClient({}, 0);
    const result = await run(LONG_WORK, { client, root });
    assert.equal(result.status, 'ok');
    assert.equal(asked(client).filter((q) => q.includes('MARK-MID')).length, 0, 'the unit was asked about');
    assert.ok(asked(client).some((q) => q.includes('MARK-TOOL')), 'a small unit was not asked about');
    assert.deepEqual(result.read, [
      { path: 'AGENTS.md', reason: 'always' },
      { path: 'docs/adr/0003-mid.md', reason: 'oversize' },
    ]);
  });
});

test("the state's size counts towards every request's limit", async () => {
  // Five units of about 9k tokens: 46k alone fits one request, beside the 20k state it does not.
  const files = { ...BASE };
  for (const n of [3, 4, 5, 6, 7]) files[`docs/adr/000${n}-part.md`] = `MARK-PART-${n} ${'x'.repeat(27_000)}`;
  await withRepo(files, async (root) => {
    const client = fakeClient();
    const result = await run(LONG_WORK, { client, root });
    assert.equal(result.status, 'ok');
    assert.equal(client.calls.length, 2);
    for (const n of [3, 4, 5, 6, 7]) {
      assert.equal(asked(client).filter((q) => q.includes(`MARK-PART-${n}`)).length, 1, `MARK-PART-${n}`);
    }
  });
});

test('a request of exactly 64k estimated tokens is sent whole, and one token more is split', async () => {
  // The boundary is the spec's 64k; the sizes are measured with the pruner's own estimator,
  // padding the last ADR three characters (one estimated token) at a time.
  const files = {
    'AGENTS.md': '# Agents\n',
    'docs/idea.md': '# Idea\n',
    'docs/adr/0001-a.md': `MARK-A ${'x'.repeat(53_000)}`,
    'docs/adr/0002-b.md': `MARK-B ${'x'.repeat(53_000)}`,
    'docs/adr/0003-c.md': `MARK-C ${'x'.repeat(50_000)}`,
  };
  const work = { ...WORK, body: 'b'.repeat(30_000) };
  await withRepo(files, async (root) => {
    const measure = fakeClient();
    await run(work, { client: measure, root });
    assert.equal(measure.calls.length, 1, 'the starting sizes should fit in one request');
    const [request] = measure.calls;
    const total = estimateTokens(request.state) + Object.values(request.questions).reduce((n, q) => n + estimateTokens(q), 0);
    const pad = async (n) => {
      files['docs/adr/0003-c.md'] += 'x'.repeat(3 * n);
      await writeFile(path.join(root, 'docs/adr/0003-c.md'), files['docs/adr/0003-c.md']);
    };

    await pad(64_000 - total);
    const exact = fakeClient();
    assert.equal((await run(work, { client: exact, root })).status, 'ok');
    assert.equal(exact.calls.length, 1, 'exactly 64k was split');

    await pad(1);
    const over = fakeClient();
    assert.equal((await run(work, { client: over, root })).status, 'ok');
    assert.equal(over.calls.length, 2, '64k + 1 was sent whole');
  });
});

test('units are ADRs, docs/idea.md sections at ## and co-located docs; nothing else is asked about', async () => {
  const files = {
    'AGENTS.md': '# Agents\n',
    'README.md': '# Readme MARK-NO-README\n',
    'docs/workflow.md': 'MARK-NO-WORKFLOW\n',
    'docs/specs/thing.md': 'MARK-NO-SPEC\n',
    'docs/adr/README.md': 'MARK-NO-ADR-INDEX\n',
    'docs/adr/0007-real.md': '# Real\n',
    'docs/idea.md': [
      '# Errand Knight',
      'intro',
      '## 1. Vision',
      '### A subsection',
      'stays inside Vision',
      '```md',
      '## Not a heading, inside a fence',
      '```',
      '## 2. Sync',
      'body',
    ].join('\n'),
    '.agents/skills/demo/SKILL.md': 'MARK-NO-SKILL\n',
    '.github/notes.md': 'MARK-NO-GITHUB\n',
    'node_modules/pkg/README.md': 'MARK-NO-NODE-MODULES\n',
    'src-tauri/src/sync/sync.md': '# Sync module\n',
    'scripts/jev/README.md': '# Jev\n',
  };
  const untracked = { 'src/scratch.md': 'MARK-NO-UNTRACKED\n' };
  await withRepo(
    files,
    async (root) => {
      const client = fakeClient({}, 0.9);
      const result = await run(WORK, { client, root });
      assert.equal(result.status, 'ok');
      assert.deepEqual(listed(result), [
        'AGENTS.md',
        'docs/adr/0007-real.md',
        'docs/idea.md § Errand Knight',
        'docs/idea.md § 1. Vision',
        'docs/idea.md § 2. Sync',
        'scripts/jev/README.md',
        'src-tauri/src/sync/sync.md',
      ]);
      assert.ok(!asked(client).some((q) => q.includes('MARK-NO-')), 'a non-unit was asked about');
      const vision = asked(client).find((q) => q.includes('1. Vision'));
      assert.match(vision, /stays inside Vision/);
      assert.match(vision, /Not a heading, inside a fence/);
    },
    { untracked },
  );
});

test('a blank title never reaches Jev', async () => {
  await withRepo(BASE, async (root) => {
    const client = fakeClient();
    const result = await run({ title: '  ', body: '\n', files: [] }, { client, root });
    assert.equal(result.status, 'error');
    assert.match(result.reason, /no title/);
    assert.equal(client.calls.length, 0);
  });
});

test('an answer missing from the response is an error, not a silent exclusion', async () => {
  await withRepo(BASE, async (root) => {
    const client = fakeClient();
    const ask = client.ask;
    client.ask = async (request) => {
      const result = await ask(request);
      delete result.answers.u0;
      return result;
    };
    const result = await run(WORK, { client, root });
    assert.equal(result.status, 'error');
  });
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

test('skips before reading any doc when TYPESAFE_API_KEY is not set', async () => {
  // A root that is not a repo and holds no docs: reading them would be an error, not a skip.
  const root = await mkdtemp(path.join(tmpdir(), 'jev-prune-empty-'));
  try {
    const { client, sent, loads } = realClient({ env: {} });
    const result = await run(WORK, { client, root });
    assert.equal(result.status, 'skipped');
    assert.match(result.reason, /TYPESAFE_API_KEY/);
    assert.equal(loads.length, 0);
    assert.equal(sent.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('skips without calling Jev when the SDK is not installed', async () => {
  const missing = () => {
    const error = new Error("Cannot find package '@typesafe-ai/sdk'");
    error.code = 'ERR_MODULE_NOT_FOUND';
    throw error;
  };
  await withRepo(BASE, async (root) => {
    const { client, sent } = realClient({ env: { TYPESAFE_API_KEY: 'test-key' }, sdkImport: missing });
    const result = await run(WORK, { client, root });
    assert.equal(result.status, 'skipped');
    assert.match(result.reason, /@typesafe-ai\/sdk/);
    assert.equal(sent.length, 0);
  });
});

const KEY = 'tsk-test-0123456789';

test('sends Noul questions to the pinned model and reads their answers', async () => {
  await withRepo(BASE, async (root) => {
    const { client, sent } = realClient({
      env: { TYPESAFE_API_KEY: KEY },
      systemOne: ({ questions }) => ({
        answers: Object.fromEntries(
          Object.entries(questions).map(([id, q]) => [id, { type: 'noul', noul: JSON.stringify(q).includes('MARK-TOOL') ? 0.6 : 0.1 }]),
        ),
      }),
    });
    const result = await run(WORK, { client, root });
    assert.deepEqual(listed(result), ['AGENTS.md', 'scripts/tool/README.md']);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].model, 'jev-1.13.0', 'the request names the pinned model, never jev-latest');
  });
});

test('reports a failed request as one error line with the key redacted', async () => {
  await withRepo(BASE, async (root) => {
    const { client, sent } = realClient({
      env: { TYPESAFE_API_KEY: KEY },
      systemOne: () => {
        throw new Error(`401 invalid key ${KEY}\nrequest body follows`);
      },
    });
    const result = await run(WORK, { client, root });
    assert.equal(result.status, 'error');
    assert.equal(sent.length, 1);
    assert.match(result.reason, /^401 invalid key/, 'the reason is the failed request, not a later symptom');
    assert.ok(!result.reason.includes(KEY), `key leaked: ${result.reason}`);
    assert.ok(!result.reason.includes('\n'), 'reason is more than one line');
  });
});

test('a docs tree that cannot be read is an error, not an empty read list', async () => {
  // A repo with no docs/idea.md.
  const { 'docs/idea.md': _, ...files } = BASE;
  await withRepo(files, async (root) => {
    const client = fakeClient();
    const result = await run(WORK, { client, root });
    assert.equal(result.status, 'error');
    assert.equal(client.calls.length, 0);
  });
});

// The CLI, run as an agent runs it: a `gh` stub first on PATH that records every call and answers
// `pr view` with $GH_PR and `issue view` with $GH_ISSUE (failing when unset), and a fake Jev on
// localhost that records every request and answers each Noul with `noul`. The CLI reads this
// repo's docs; these tests assert only what does not depend on their content.
const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'prune-cli.mjs');

async function fakeJev(noul = 0.9) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const request = JSON.parse(body);
      requests.push(request);
      const answers = Object.fromEntries(Object.keys(request.questions).map((id) => [id, { type: 'noul', noul }]));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: request.model, answers, usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() };
}

async function runCli(args, { env = {}, stdin = '' } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'jev-prune-cli-'));
  const log = path.join(dir, 'gh.log');
  await writeFile(
    path.join(dir, 'gh'),
    [
      '#!/bin/sh',
      `echo "$@" >> "${log}"`,
      'case "$1" in',
      '  pr) [ -n "$GH_PR" ] && { printf "%s" "$GH_PR"; exit 0; } ;;',
      '  issue) [ -n "$GH_ISSUE" ] && { printf "%s" "$GH_ISSUE"; exit 0; } ;;',
      'esac',
      'echo "no such item" >&2',
      'exit 1',
      '',
    ].join('\n'),
  );
  await chmod(path.join(dir, 'gh'), 0o755);
  try {
    const child = spawn(process.execPath, [CLI, ...args], { env: { PATH: `${dir}:${process.env.PATH}`, ...env } });
    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stdin.end(stdin);
    const status = await new Promise((resolve) => child.on('close', resolve));
    const ghCalls = existsSync(log) ? (await readFile(log, 'utf8')).trim().split('\n') : [];
    return { status, stdout, ghCalls };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('the CLI prints the skip line without calling gh when there is no key', async () => {
  const { status, stdout, ghCalls } = await runCli(['12']);
  assert.equal(status, 0);
  assert.equal(stdout, 'jev prune: skipped, TYPESAFE_API_KEY is not set; read the docs as normal\n');
  assert.deepEqual(ghCalls, []);
});

test('the CLI turns empty stdin into one error line, exit 0, with no request', async () => {
  const jev = await fakeJev();
  try {
    const env = { TYPESAFE_API_KEY: 'dummy-key', TYPESAFE_BASE_URL: jev.url };
    const { status, stdout } = await runCli([], { env, stdin: '  \n\n' });
    assert.equal(status, 0);
    assert.match(stdout, /^jev prune: error, [^\n]*no title[^\n]*\n$/);
    assert.equal(jev.requests.length, 0);
  } finally {
    jev.close();
  }
});

test('the CLI reads a PR with its changed files and prints the read list, AGENTS.md first', async () => {
  const jev = await fakeJev(0.9);
  try {
    const pr = { title: 'Outbox retries', body: 'Retry writes.', files: [{ path: 'src-tauri/src/sync/outbox.rs', additions: 3 }] };
    const env = { TYPESAFE_API_KEY: 'dummy-key', TYPESAFE_BASE_URL: jev.url, GH_PR: JSON.stringify(pr) };
    const { status, stdout, ghCalls } = await runCli(['12'], { env });
    assert.equal(status, 0);
    assert.deepEqual(ghCalls, ['pr view 12 --json title,body,files']);
    assert.ok(jev.requests.length >= 1);
    for (const request of jev.requests) {
      assert.deepEqual(request.state, {
        work: { title: 'Outbox retries', body: 'Retry writes.', changed_files: ['src-tauri/src/sync/outbox.rs'] },
      });
    }
    // Every unit was found relevant, so the list is AGENTS.md and then one line per question.
    const lines = stdout.trimEnd().split('\n');
    const questions = jev.requests.reduce((n, r) => n + Object.keys(r.questions).length, 0);
    assert.equal(lines[0], 'AGENTS.md');
    assert.equal(lines.length, questions + 1);
    assert.ok(lines.some((l) => /^docs\/idea\.md § \S/.test(l)), 'no docs/idea.md section line');
  } finally {
    jev.close();
  }
});

test('the CLI falls back to the issue when the number is not a PR, and prints JSON on --json', async () => {
  const jev = await fakeJev(0);
  try {
    const issue = { title: 'Doc pruner', body: 'Prune the docs.' };
    const env = { TYPESAFE_API_KEY: 'dummy-key', TYPESAFE_BASE_URL: jev.url, GH_ISSUE: JSON.stringify(issue) };
    const { status, stdout, ghCalls } = await runCli(['8', '--json'], { env });
    assert.equal(status, 0);
    assert.deepEqual(ghCalls, ['pr view 8 --json title,body,files', 'issue view 8 --json title,body']);
    assert.deepEqual(jev.requests[0].state, { work: { title: 'Doc pruner', body: 'Prune the docs.', changed_files: [] } });
    assert.deepEqual(JSON.parse(stdout), { status: 'ok', read: [{ path: 'AGENTS.md', reason: 'always' }] });
  } finally {
    jev.close();
  }
});

test('the CLI takes the first non-blank stdin line as the title', async () => {
  const jev = await fakeJev(0);
  try {
    const env = { TYPESAFE_API_KEY: 'dummy-key', TYPESAFE_BASE_URL: jev.url };
    const { status, stdout } = await runCli([], { env, stdin: '\n\nSome title\nthe body\n' });
    assert.equal(status, 0);
    assert.equal(stdout, 'AGENTS.md\n');
    assert.deepEqual(jev.requests[0].state, { work: { title: 'Some title', body: 'the body', changed_files: [] } });
  } finally {
    jev.close();
  }
});
