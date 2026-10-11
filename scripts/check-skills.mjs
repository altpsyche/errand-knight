#!/usr/bin/env node
// Checks the agent layer: skill frontmatter, relative links, and pointer integrity.
//
// This is the repo's deterministic check for the class of mistake an agent makes most often when
// editing skills or AGENTS.md: a renamed folder, a missing description, a pointer to a file that
// moved. It is deliberately dependency-free so it runs in CI and in any sandbox.
//
// `checkRepo(root)` is exported for check-skills.test.mjs; running the file checks this repo.

import { lstat, readFile, readdir, readlink } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
function parseFrontmatter(source, label, { err }) {
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
export function relativeLinks(markdown) {
  const out = [];
  const prose = markdown.replace(/^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '');
  for (const match of prose.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    if (target.startsWith('#')) continue;
    out.push(target.split('#')[0]);
  }
  return out.filter(Boolean);
}

async function checkSkill(skillsDir, skillName, { err, warn }) {
  const dir = path.join(skillsDir, skillName);
  const skillFile = path.join(dir, 'SKILL.md');
  const label = `.agents/skills/${skillName}/SKILL.md`;

  if (!existsSync(skillFile)) {
    err(`${label}: missing SKILL.md`);
    return;
  }

  const source = await readFile(skillFile, 'utf8');
  const fields = parseFrontmatter(source, label, { err });
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

export function insideRoot(root, p) {
  const rel = path.relative(root, p);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

async function markdownFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) out.push(path.join(entry.parentPath, entry.name));
  }
  return out.sort();
}

// Every relative link in the agent layer must resolve: a moved doc breaks a pointer an agent follows.
async function checkLinks(root, file, { err }) {
  const label = path.relative(root, file);
  for (const link of relativeLinks(await readFile(file, 'utf8'))) {
    const resolved = path.resolve(path.dirname(file), link);
    if (!insideRoot(root, resolved)) {
      err(`${label}: link escapes the repo: ${link}`);
    } else if (!existsSync(resolved)) {
      err(`${label}: broken relative link -> ${link}`);
    }
  }
}

export async function checkRepo(root) {
  const skillsDir = path.join(root, '.agents', 'skills');
  const agentsMd = path.join(root, 'AGENTS.md');
  const claudeMd = path.join(root, 'CLAUDE.md');
  const docsDir = path.join(root, 'docs');
  const skillsReadme = path.join(skillsDir, 'README.md');

  const errors = [];
  const warnings = [];
  const err = (msg) => errors.push(msg);
  const warn = (msg) => warnings.push(msg);

  // A missing skills folder is one error, not a reason to skip the checks that follow.
  const hasSkills = existsSync(skillsDir);
  if (!hasSkills) err('.agents/skills/ does not exist');
  const skillNames = hasSkills
    ? (await readdir(skillsDir, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
    : [];

  if (hasSkills && skillNames.length === 0) err('.agents/skills/ contains no skill folders');

  for (const name of skillNames) await checkSkill(skillsDir, name, { err, warn });

  // AGENTS.md must exist and stay inside its own line budget.
  if (!existsSync(agentsMd)) {
    err('AGENTS.md does not exist');
  } else {
    const agents = await readFile(agentsMd, 'utf8');
    const lines = agents.split('\n').length;
    if (lines > 200) {
      err(`AGENTS.md is ${lines} lines, over its own 200-line budget (see its header)`);
    }
  }

  // CLAUDE.md is a symlink to AGENTS.md (ADR-0001). A regular file there would drift silently.
  if (!existsSync(claudeMd) || !(await lstat(claudeMd)).isSymbolicLink()) {
    err('CLAUDE.md must be a symlink to AGENTS.md (ADR-0001)');
  } else if ((await readlink(claudeMd)) !== 'AGENTS.md') {
    err(`CLAUDE.md points at "${await readlink(claudeMd)}", not AGENTS.md`);
  }

  const linked = [
    agentsMd,
    path.join(root, 'README.md'),
    ...(await markdownFiles(docsDir)),
    ...(await markdownFiles(skillsDir)),
  ];
  for (const file of linked) if (existsSync(file)) await checkLinks(root, file, { err });

  // Every skill must be indexed in the skills README, so none is silently unreachable.
  if (hasSkills && !existsSync(skillsReadme)) {
    err('.agents/skills/README.md does not exist');
  } else if (hasSkills) {
    const readme = await readFile(skillsReadme, 'utf8');
    for (const name of skillNames) {
      if (!readme.includes(`./${name}/`) && !readme.includes(`${name}/SKILL.md`)) {
        err(`.agents/skills/README.md: skill "${name}" is not indexed`);
      }
    }
  }

  return { skillCount: skillNames.length, errors, warnings };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { skillCount, errors, warnings } = await checkRepo(root);
  const report = [];
  if (errors.length) report.push(...errors.map((m) => `error   ${m}`));
  if (warnings.length) report.push(...warnings.map((m) => `warning ${m}`));
  if (report.length) console.log(report.join('\n'));

  console.log(
    `\nagent layer: ${skillCount} skills, ${errors.length} error(s), ${warnings.length} warning(s)`,
  );
  process.exit(errors.length ? 1 : 0);
}

// Node reports the main module by its realpath, so argv[1] must be resolved the same way. Without
// that, a run through a symlinked path never calls main() and exits 0 having checked nothing.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
