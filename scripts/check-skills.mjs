#!/usr/bin/env node
// Checks the agent layer: skill frontmatter, relative links, and pointer integrity.
//
// This is the repo's deterministic check for the class of mistake an agent makes most often when
// editing skills or AGENTS.md: a renamed folder, a missing description, a pointer to a file that
// moved. It is deliberately dependency-free so it runs in CI and in any sandbox.

import { lstat, readFile, readdir, readlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = path.join(ROOT, '.agents', 'skills');
const AGENTS_MD = path.join(ROOT, 'AGENTS.md');
const CLAUDE_MD = path.join(ROOT, 'CLAUDE.md');
const DOCS_DIR = path.join(ROOT, 'docs');
const SKILLS_README = path.join(SKILLS_DIR, 'README.md');

const errors = [];
const warnings = [];
const err = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_DESCRIPTION = 1024;
const KNOWN_FRONTMATTER_KEYS = new Set([
  'name',
  'description',
  'disable-model-invocation',
  'argument-hint',
  'metadata',
  'license',
  'allowed-tools',
]);

// Minimal YAML frontmatter reader. Handles the flat `key: value` shape these skills use, plus
// block scalars and nested maps, which it skips rather than mis-parses.
function parseFrontmatter(source, label) {
  if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) {
    err(`${label}: missing YAML frontmatter (file must start with ---)`);
    return null;
  }
  const end = source.indexOf('\n---', 3);
  if (end === -1) {
    err(`${label}: frontmatter is not terminated with ---`);
    return null;
  }
  const raw = source.slice(source.indexOf('\n') + 1, end);
  const fields = {};
  let currentKey = null;
  for (const line of raw.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const topLevel = /^([A-Za-z][\w-]*):(.*)$/.exec(line);
    if (topLevel) {
      currentKey = topLevel[1];
      let value = topLevel[2].trim();
      if (value === '' || value === '|' || value === '>') {
        fields[currentKey] = undefined; // nested or block scalar; presence is what matters
      } else {
        if (
          (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
          (value.startsWith("'") && value.endsWith("'") && value.length > 1)
        ) {
          value = value.slice(1, -1);
        }
        fields[currentKey] = value;
      }
      continue;
    }
    if (currentKey && /^\s+\S/.test(line) && fields[currentKey] === undefined) {
      fields[currentKey] = fields[currentKey] ?? null;
    }
  }
  return fields;
}

// Collect relative link targets from markdown, ignoring anything with a scheme, a bare anchor, or a
// template placeholder. Fenced and inline code are stripped first: links there are examples.
function relativeLinks(markdown) {
  const out = [];
  const prose = markdown.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '');
  for (const match of prose.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    if (target.startsWith('#')) continue;
    out.push(target.split('#')[0]);
  }
  return out.filter(Boolean);
}

async function checkSkill(skillName) {
  const dir = path.join(SKILLS_DIR, skillName);
  const skillFile = path.join(dir, 'SKILL.md');
  const label = `.agents/skills/${skillName}/SKILL.md`;

  if (!existsSync(skillFile)) {
    err(`${label}: missing SKILL.md`);
    return;
  }

  const source = await readFile(skillFile, 'utf8');
  const fields = parseFrontmatter(source, label);
  if (fields) {
    if (!fields.name) {
      err(`${label}: frontmatter must set \`name\``);
    } else if (fields.name !== skillName) {
      err(`${label}: frontmatter name "${fields.name}" does not match folder "${skillName}"`);
    }
    if (!NAME_RE.test(fields.name ?? '')) {
      err(`${label}: name must be kebab-case ([a-z0-9-])`);
    }

    const description = fields.description;
    if (!description) {
      err(`${label}: frontmatter must set a non-empty \`description\``);
    } else {
      if (description.length > MAX_DESCRIPTION) {
        err(`${label}: description is ${description.length} chars, over the ${MAX_DESCRIPTION} limit`);
      }
      const userInvoked = fields['disable-model-invocation'] === 'true';
      // A model-invoked skill's description is its trigger, so it must say when to reach for it.
      // A user-invoked skill's description is human-facing, so it need not.
      if (!userInvoked && !/\buse when\b|\bwhen the user\b|\buse for\b/i.test(description)) {
        warn(`${label}: model-invoked description names no trigger ("Use when ...")`);
      }
    }

    const dmi = fields['disable-model-invocation'];
    if (dmi !== undefined && dmi !== 'true' && dmi !== 'false') {
      err(`${label}: disable-model-invocation must be true or false, got "${dmi}"`);
    }

    for (const key of Object.keys(fields)) {
      if (!KNOWN_FRONTMATTER_KEYS.has(key)) {
        warn(`${label}: unrecognised frontmatter key "${key}"`);
      }
    }
  }

}

const insideRoot = (p) => {
  const rel = path.relative(ROOT, p);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

async function markdownFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) out.push(path.join(entry.parentPath, entry.name));
  }
  return out.sort();
}

// Every relative link in the agent layer must resolve: a moved doc breaks a pointer an agent follows.
async function checkLinks(file) {
  const label = path.relative(ROOT, file);
  for (const link of relativeLinks(await readFile(file, 'utf8'))) {
    const resolved = path.resolve(path.dirname(file), link);
    if (!insideRoot(resolved)) {
      err(`${label}: link escapes the repo: ${link}`);
    } else if (!existsSync(resolved)) {
      err(`${label}: broken relative link -> ${link}`);
    }
  }
}

async function main() {
  if (!existsSync(SKILLS_DIR)) {
    err('.agents/skills/ does not exist');
    return finish(0);
  }
  const skillNames = (await readdir(SKILLS_DIR, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  if (skillNames.length === 0) err('.agents/skills/ contains no skill folders');

  for (const name of skillNames) await checkSkill(name);

  // AGENTS.md must exist and stay inside its own line budget.
  if (!existsSync(AGENTS_MD)) {
    err('AGENTS.md does not exist');
  } else {
    const agents = await readFile(AGENTS_MD, 'utf8');
    const lines = agents.split('\n').length;
    if (lines > 200) {
      err(`AGENTS.md is ${lines} lines, over its own 200-line budget (see its header)`);
    }
  }

  // CLAUDE.md is a symlink to AGENTS.md (ADR-0001). A regular file there would drift silently.
  if (!existsSync(CLAUDE_MD) || !(await lstat(CLAUDE_MD)).isSymbolicLink()) {
    err('CLAUDE.md must be a symlink to AGENTS.md (ADR-0001)');
  } else if ((await readlink(CLAUDE_MD)) !== 'AGENTS.md') {
    err(`CLAUDE.md points at "${await readlink(CLAUDE_MD)}", not AGENTS.md`);
  }

  const linked = [AGENTS_MD, path.join(ROOT, 'README.md'), ...(await markdownFiles(DOCS_DIR)), ...(await markdownFiles(SKILLS_DIR))];
  for (const file of linked) if (existsSync(file)) await checkLinks(file);

  // Every skill must be indexed in the skills README, so none is silently unreachable.
  if (!existsSync(SKILLS_README)) {
    err('.agents/skills/README.md does not exist');
  } else {
    const readme = await readFile(SKILLS_README, 'utf8');
    for (const name of skillNames) {
      if (!readme.includes(`./${name}/`) && !readme.includes(`${name}/SKILL.md`)) {
        err(`.agents/skills/README.md: skill "${name}" is not indexed`);
      }
    }
  }

  return finish(skillNames.length);
}

function finish(skillCount) {
  const report = [];
  if (errors.length) report.push(...errors.map((m) => `error   ${m}`));
  if (warnings.length) report.push(...warnings.map((m) => `warning ${m}`));
  if (report.length) console.log(report.join('\n'));

  console.log(
    `\nagent layer: ${skillCount} skills, ${errors.length} error(s), ${warnings.length} warning(s)`,
  );
  process.exit(errors.length ? 1 : 0);
}

await main();
