#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARK_START = '# >>> changelog-trigger >>>';
const MARK_END = '# <<< changelog-trigger <<<';

export function ensureGitignore(root, entries) {
  const f = join(root, '.gitignore');
  const cur = existsSync(f) ? readFileSync(f, 'utf8') : '';
  const lines = cur.split('\n');
  let changed = false;
  for (const e of entries) if (!lines.some(l => l.trim() === e)) { lines.push(e); changed = true; }
  if (changed) writeFileSync(f, lines.join('\n').replace(/\n+$/, '') + '\n');
}

export function ensurePostCommitHook(root) {
  const dir = join(root, '.git', 'hooks');
  const f = join(dir, 'post-commit');
  mkdirSync(dir, { recursive: true });
  let body = existsSync(f) ? readFileSync(f, 'utf8') : '#!/bin/sh\n';
  if (body.includes(MARK_START)) return;
  const block = [
    MARK_START,
    'if [ -z "$CHANGELOG_TRIGGER_SKIP" ]; then',
    '  root=$(git rev-parse --show-toplevel)',
    '  msg=$(git log -1 --pretty=%s)',
    '  case "$msg" in',
    '    релиз:*|патч:*) : ;;',
    '    *)',
    '      q="$root/.claude/skills/update-changelog/scripts/queue.mjs"',
    '      if [ -f "$q" ] && ! node "$q" is-locked --root "$root"; then',
    '        node "$q" append "$(git rev-parse HEAD)" --root "$root"',
    '      fi ;;',
    '  esac',
    'fi',
    MARK_END, '',
  ].join('\n');
  if (!body.endsWith('\n')) body += '\n';
  writeFileSync(f, body + block);
  try { chmodSync(f, 0o755); } catch { /* non-POSIX */ }
}

export function scaffoldConfig(root, workspaces = []) {
  const f = join(root, '.changelog.config.json');
  if (existsSync(f)) return;
  const names = {};
  for (const w of workspaces) names[w] = basename(w);
  writeFileSync(f, JSON.stringify({
    aggregate: { part: workspaces[0] || 'apps/web', file: 'changelog.all.json' },
    names,
  }, null, 2) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = Object.fromEntries(process.argv.slice(2).flatMap((x, i, xs) =>
    x.startsWith('--') ? [[x.slice(2), xs[i + 1]]] : []));
  const root = a.root || process.cwd();
  let workspaces = [];
  try {
    const out = execFileSync('node',
      [join(root, '.claude/skills/update-changelog/scripts/list-workspaces.mjs'), '--root', root],
      { encoding: 'utf8' });
    workspaces = (JSON.parse(out).workspaces || []).map(w => w.relDir);
  } catch { /* best-effort detection */ }
  ensureGitignore(root, ['.claude/changelog-queue', '.claude/changelog.lock']);
  ensurePostCommitHook(root);
  scaffoldConfig(root, workspaces);
  console.log('changelog trigger installed at ' + root);
}
