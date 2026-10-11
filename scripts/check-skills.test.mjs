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
  assert.equal(insideRoot('/r/repo', '/r/repo/..notes/a.md'), true);
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

test('reference-style link definitions are extracted', () => {
  assert.deepEqual(relativeLinks('See [doc][d].\n\n[d]: ./missing-ref.md\n'), ['./missing-ref.md']);
  assert.deepEqual(relativeLinks('[d]: <./spaced ref.md> "Title"\n'), ['./spaced ref.md']);
  assert.deepEqual(relativeLinks('[^1]: A footnote, not a link.\n'), []);
});

test('angle-bracket link targets are extracted', () => {
  assert.deepEqual(relativeLinks('[a](<./with space.md>)\n'), ['./with space.md']);
});

test('a longer fence is not closed by a shorter fence inside it', () => {
  const md = '````md\n```\n[x](./inner.md)\n```\n[y](./after-inner.md)\n````\n[z](./real.md)\n';
  assert.deepEqual(relativeLinks(md), ['./real.md']);
});

test('a broken link in any root-level markdown file is reported', () =>
  withRepo(async (root) => {
    await writeFile(path.join(root, 'GLOSSARY.md'), '[gone](./nope.md)\n');
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, ['GLOSSARY.md: broken relative link -> ./nope.md']);
  }));

test('code spans pair backtick runs of equal length', () => {
  assert.deepEqual(relativeLinks('A `` ` `` tick. See [a](./after-double.md) and `x`.\n'), ['./after-double.md']);
  assert.deepEqual(relativeLinks('A stray ` here.\n\nSee [b](./after-stray.md).\n'), ['./after-stray.md']);
  // CommonMark §6.1: a code span binds tighter than a link, so this link is code.
  assert.deepEqual(relativeLinks('A ` tick. See [c](./in-span.md) and `x`.\n'), []);
});

test('inline links with an image, nested brackets or any title form are extracted', () => {
  const badge = '[![License](https://img.shields.io/badge/License-MIT.svg)](./LICENSE)';
  assert.deepEqual(relativeLinks(badge), ['./LICENSE']);
  assert.deepEqual(relativeLinks('[![logo](./logo.png)](./home.md)'), ['./home.md', './logo.png']);
  assert.deepEqual(relativeLinks('[see [1]](./nested.md)'), ['./nested.md']);
  assert.deepEqual(relativeLinks(`[a](./sq.md 'Title') [b](./paren.md (Title)) [c](./dq.md "T")`), [
    './sq.md',
    './paren.md',
    './dq.md',
  ]);
});

test('reference definitions inside containers are extracted', () => {
  assert.deepEqual(relativeLinks('> [d]: ./quote.md\n'), ['./quote.md']);
  assert.deepEqual(relativeLinks('- item\n\n    [d]: ./deep.md\n'), ['./deep.md']);
  assert.deepEqual(relativeLinks('[a]: ./one.md\n[b]: ./two.md "T"\n'), ['./one.md', './two.md']);
});

test('prose shaped like a reference definition is not one', () => {
  assert.deepEqual(relativeLinks('[WIP]: finish later\n'), []);
  assert.deepEqual(relativeLinks('[status:in-review]: means a Reviewer picks it up\n'), []);
  assert.deepEqual(relativeLinks('Text line\n[d]: ./para-ref.md\n'), []);
  assert.deepEqual(relativeLinks('> Quoted line\n> [d]: ./para-quote.md\n'), []);
});

test('a fence closes only on its own character, and an unclosed fence runs to the end', () => {
  assert.deepEqual(relativeLinks('```\n[x](./in.md)\n```~~\n[y](./after.md)\n'), []);
  assert.deepEqual(relativeLinks('```\n[x](./unclosed.md)\n'), []);
  assert.deepEqual(relativeLinks('~~~\n[x](./in.md)\n```\n~~~~\n[y](./out.md)\n'), ['./out.md']);
});

test('percent-encoded targets are decoded before resolving', () =>
  withRepo(async (root) => {
    await writeFile(path.join(root, 'docs', 'with space.md'), '# Spaced\n');
    await writeFile(path.join(root, 'docs', 'guide.md'), '[a](./with%20space.md) [b](./bad%zz.md)\n');
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, ['docs/guide.md: broken relative link -> ./bad%zz.md']);
  }));

test('CRLF and CR line endings close fences and end reference definitions', () => {
  assert.deepEqual(relativeLinks('```\r\ncode\r\n```\r\n[a](./after-fence.md)\r\n'), ['./after-fence.md']);
  assert.deepEqual(relativeLinks('[a]: ./crlf-ref.md\r\n'), ['./crlf-ref.md']);
  assert.deepEqual(relativeLinks('~~~\rcode\r~~~\r[b]: ./cr-ref.md\r'), ['./cr-ref.md']);
});

test('a block-scalar description is read, as upstream skills write it', () =>
  withRepo(async (root) => {
    const skill = '---\nname: demo\ndescription: >\n  Fetch the thing.\n  Use when testing the checker.\n---\n\nBody.\n';
    await writeFile(path.join(root, '.agents', 'skills', 'demo', 'SKILL.md'), skill);
    const { errors, warnings } = await checkRepo(root);
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  }));

test('block-scalar headers with an indentation indicator or a comment are read', async () => {
  for (const header of ['>2', '>-2', '|2-', '|+', '> # note', '|-1 # note']) {
    await withRepo(async (root) => {
      const skill = `---\nname: demo\ndescription: ${header}\n  Use when testing the checker.\n---\n\nBody.\n`;
      await writeFile(path.join(root, '.agents', 'skills', 'demo', 'SKILL.md'), skill);
      const { errors, warnings } = await checkRepo(root);
      assert.deepEqual({ header, errors, warnings }, { header, errors: [], warnings: [] });
    });
  }
});
