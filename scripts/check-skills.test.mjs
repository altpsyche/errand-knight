// Tests for check-skills.mjs. Each case builds a minimal repo in a temp dir, so a check is proven
// to fire on a real tree rather than on a mocked filesystem.

import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRepo, insideRoot, relativeLinks } from './check-skills.mjs';

const SKILL = `---
name: demo
description: "Use when testing the checker."
---

Body.
`;

// A repo that passes every check. Each test breaks exactly one thing.
async function validRepo() {
  const root = await mkdtemp(path.join(tmpdir(), 'check-skills-'));
  await mkdir(path.join(root, '.agents', 'skills', 'demo'), { recursive: true });
  await mkdir(path.join(root, 'docs'));
  await writeFile(path.join(root, '.agents', 'skills', 'demo', 'SKILL.md'), SKILL);
  await writeFile(path.join(root, '.agents', 'skills', 'README.md'), '[demo](./demo/SKILL.md)\n');
  await writeFile(path.join(root, 'AGENTS.md'), '# Agents\n\n[docs](docs/guide.md)\n');
  await writeFile(path.join(root, 'docs', 'guide.md'), '# Guide\n');
  await symlink('AGENTS.md', path.join(root, 'CLAUDE.md'));
  return root;
}

async function withRepo(fn) {
  const root = await validRepo();
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('a valid repo has no errors', () =>
  withRepo(async (root) => {
    const { skillCount, errors } = await checkRepo(root);
    assert.equal(skillCount, 1);
    assert.deepEqual(errors, []);
  }));

test('a broken link in docs/ is reported', () =>
  withRepo(async (root) => {
    await writeFile(path.join(root, 'docs', 'guide.md'), '[gone](./nope.md)\n');
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, ['docs/guide.md: broken relative link -> ./nope.md']);
  }));

test('a broken link in a skill support file is reported', () =>
  withRepo(async (root) => {
    await writeFile(path.join(root, '.agents', 'skills', 'demo', 'extra.md'), '[gone](./gone.md)\n');
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, ['.agents/skills/demo/extra.md: broken relative link -> ./gone.md']);
  }));

test('a link into a sibling directory sharing the repo name prefix escapes the repo', () =>
  withRepo(async (root) => {
    const sibling = `../${path.basename(root)}-x/a.md`;
    await writeFile(path.join(root, 'docs', 'guide.md'), `[sib](../${sibling})\n`);
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, [`docs/guide.md: link escapes the repo: ../${sibling}`]);
  }));

test('CLAUDE.md as a regular file is reported', () =>
  withRepo(async (root) => {
    await rm(path.join(root, 'CLAUDE.md'));
    await writeFile(path.join(root, 'CLAUDE.md'), '# Agents\n');
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, ['CLAUDE.md must be a symlink to AGENTS.md (ADR-0001)']);
  }));

test('CLAUDE.md pointing elsewhere is reported', () =>
  withRepo(async (root) => {
    await rm(path.join(root, 'CLAUDE.md'));
    await symlink('docs/guide.md', path.join(root, 'CLAUDE.md'));
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, ['CLAUDE.md points at "docs/guide.md", not AGENTS.md']);
  }));

test('links inside inline and fenced code are ignored', () => {
  const md = '`[a](./inline.md)`\n\n```md\n[b](./fenced.md)\n```\n\n~~~\n[c](./tilde.md)\n~~~\n';
  assert.deepEqual(relativeLinks(md), []);
});

test('links with a scheme or a bare anchor are ignored; anchors are stripped', () => {
  const md = '[w](https://x.dev) [m](mailto:a@b.c) [h](#top) [d](./doc.md#part)';
  assert.deepEqual(relativeLinks(md), ['./doc.md']);
});

test('insideRoot rejects parents and prefix-sharing siblings', () => {
  assert.equal(insideRoot('/r/repo', '/r/repo'), true);
  assert.equal(insideRoot('/r/repo', '/r/repo/docs/a.md'), true);
  assert.equal(insideRoot('/r/repo', '/r/repo-x/a.md'), false);
  assert.equal(insideRoot('/r/repo', '/r/a.md'), false);
});

test('links inside a fence indented under a list item are ignored', () => {
  const md = '1. Step:\n\n   ```ts\n   [a](./indented.md)\n   ```\n';
  assert.deepEqual(relativeLinks(md), []);
});

test('a link to the repo root resolves', () =>
  withRepo(async (root) => {
    await writeFile(path.join(root, 'docs', 'guide.md'), '[repo](../)\n');
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, []);
  }));

test('a missing skills folder does not hide the other checks', () =>
  withRepo(async (root) => {
    await rm(path.join(root, '.agents'), { recursive: true });
    await writeFile(path.join(root, 'docs', 'guide.md'), '[gone](./nope.md)\n');
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, [
      '.agents/skills/ does not exist',
      'docs/guide.md: broken relative link -> ./nope.md',
    ]);
  }));

test('running the checker through a symlinked path still runs it', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'check-skills-link-'));
  try {
    const scripts = path.dirname(fileURLToPath(import.meta.url));
    await symlink(scripts, path.join(dir, 'scripts'));
    const run = spawnSync(process.execPath, [path.join(dir, 'scripts', 'check-skills.mjs')], { encoding: 'utf8' });
    assert.match(run.stdout, /agent layer: \d+ skills/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
