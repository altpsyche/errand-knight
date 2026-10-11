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

// A block-scalar header: style, then an optional chomping and indentation indicator in either
// order, then an optional comment, as in `>`, `|-`, `>2`, `|+1` or `> # note`.
const BLOCK_HEADER = /^([|>])(?:[1-9][+-]?|[+-][1-9]?)?(?:[ \t]+#.*)?$/;

// YAML line folding for a `>` block: a break between two text lines becomes a space, and each
// blank line becomes a break. More-indented lines are not special-cased: the reader trims indentation.
function fold(lines) {
  let out = '';
  lines.forEach((line, i) => {
    if (line === '') out += '\n';
    else out += (i > 0 && lines[i - 1] !== '' ? ' ' : '') + line;
  });
  return out;
}

// Minimal YAML frontmatter reader. Handles the flat `key: value` shape these skills use, block
// scalars (`|` keeps line breaks and blank lines, `>` folds them as `fold` does; indentation and
// surrounding blank lines are trimmed), and nested maps, which it skips rather than mis-parses.
// Exported for check-skills.test.mjs.
export function parseFrontmatter(source, label, { err }) {
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
  let block = null; // the style and lines of the block scalar being read, if any
  const endBlock = () => {
    if (block) fields[block.key] = (block.style === '>' ? fold(block.lines) : block.lines.join('\n')).trim();
    block = null;
  };
  for (const line of raw.split('\n')) {
    if (block && (/^\s+\S/.test(line) || !line.trim())) {
      block.lines.push(line.trim());
      continue;
    }
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const topLevel = /^([A-Za-z][\w-]*):(.*)$/.exec(line);
    if (topLevel) {
      endBlock();
      currentKey = topLevel[1];
      let value = topLevel[2].trim();
      const blockStyle = BLOCK_HEADER.exec(value);
      if (blockStyle) {
        block = { key: currentKey, style: blockStyle[1], lines: [] };
      } else if (value === '') {
        fields[currentKey] = undefined; // nested map; presence is what matters
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
  endBlock();
  return fields;
}

// Collect relative link targets from markdown, ignoring anything with a scheme or a bare anchor.
// Targets are percent-decoded, as GitHub resolves them. Code is stripped first: links there are
// examples. A fence closes only on a run of its own character at least as long as its opener, and an
// unclosed fence runs to the end of the file. Code spans pair backtick runs of equal length, so a
// stray backtick stays literal. Inline links, `[a](target)` or `[a](<target>)`, with any CommonMark
// title and with brackets or an image in the text, count; so do reference definitions, `[a]: target`,
// inside block quotes and list items but not where they would continue a paragraph. Indented code
// blocks are not detected, so a link in one is checked: that fails safe. Lines end in LF, CRLF or a lone
// CR, as in CommonMark, so a Windows checkout parses the same as a Unix one.
const CONTAINER = /^(?:[ \t]*(?:>|[-*+]|\d{1,9}[.)])(?=[ \t]|$))*[ \t]*/;
const FENCE_OPEN = /^(`{3,}|~{3,})/;
const ATX_HEADING = /^#{1,6}(?:[ \t]|$)/;
const TITLE = String.raw`(?:"[^"]*"|'[^']*'|\([^()]*\))`;
const REFERENCE_DEFINITION = new RegExp(
  String.raw`^\[(?!\^)(?:[^\[\]\\]|\\.)+\]:[ \t]*(?:<([^>\n]+)>|(\S+))(?:[ \t]+${TITLE})?[ \t]*$`,
);
const CODE_SPAN = /(?<!`)(`+)(?!`)(?:(?!\n[ \t]*\n)[\s\S])*?(?<!`)\1(?!`)/g;
const INLINE_LINK = new RegExp(
  String.raw`\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\((?:<([^>\n]+)>|((?:[^\s()]|\([^\s()]*\))+))(?:\s+${TITLE})?\s*\)`,
  'g',
);

function decode(target) {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function inlineTargets(text, out) {
  for (const match of text.matchAll(INLINE_LINK)) {
    out.push(match[2] ?? match[3]);
    inlineTargets(match[1], out); // an image or link inside the link text, as in a README badge
  }
}

export function relativeLinks(markdown) {
  const targets = [];
  const prose = [];
  let fence = null;
  let blockStart = true; // a definition cannot interrupt a paragraph
  let lastMarkers = '';
  for (const line of markdown.split(/\r\n?|\n/)) {
    const prefix = CONTAINER.exec(line)[0];
    const content = line.slice(prefix.length);
    const markers = prefix.replace(/[ \t]/g, '');
    if (fence) {
      const run = /^(`+|~+)[ \t]*$/.exec(content);
      if (run && run[1][0] === fence[0] && run[1].length >= fence.length) fence = null;
      blockStart = !fence;
      prose.push('');
      continue;
    }
    const opener = FENCE_OPEN.exec(content);
    if (opener && !(opener[1][0] === '`' && content.slice(opener[1].length).includes('`'))) {
      fence = opener[1];
      prose.push('');
      continue;
    }
    // A new block quote or list item starts a block even right after a paragraph line; a line that
    // drops its markers is a lazy continuation, so it does not.
    const newContainer = markers !== '' && (markers !== lastMarkers || /[^>]/.test(markers));
    lastMarkers = markers;
    const definition = (blockStart || newContainer) && REFERENCE_DEFINITION.exec(content);
    if (definition) {
      targets.push(definition[1] ?? definition[2]);
      blockStart = true;
      prose.push('');
      continue;
    }
    prose.push(content);
    blockStart = content.trim() === '' || ATX_HEADING.test(content);
  }
  inlineTargets(prose.join('\n').replace(CODE_SPAN, ''), targets);

  const out = [];
  for (const target of targets) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    if (target.startsWith('#')) continue;
    out.push(decode(target.split('#')[0]));
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

  // Every root-level .md (AGENTS.md, README.md, and GLOSSARY.md or CODING_STANDARDS.md once a skill
  // creates them), plus everything under docs/ and the skills. CLAUDE.md is a symlink, so it is skipped.
  const rootDocs = (await readdir(root, { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => path.join(root, e.name))
    .sort();
  const linked = [
    ...rootDocs,
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
