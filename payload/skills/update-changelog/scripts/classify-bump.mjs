#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { resolve } from "node:path";
import { realpathSync } from "node:fs";

export function classifyBump(oldV, newV) {
  const norm = v => String(v).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const [oMaj, oMin] = norm(oldV);
  const [nMaj, nMin] = norm(newV);
  return (nMaj > oMaj || (nMaj === oMaj && nMin > oMin)) ? 'релиз' : 'патч';
}

const ORDER = { none: 0, patch: 1, minor: 2 };
const PATCH = new Set(['fix', 'perf', 'refactor', 'build']);
const NONE = new Set(['docs', 'chore', 'test', 'style', 'ci']);
const SUBJECT = /^([a-z]+)(\([^)]*\))?(!)?:\s*(.+)$/;

export function levelForCommit({ subject, body }) {
  const m = SUBJECT.exec(String(subject ?? '').trim());
  if (!m) return { level: 'none', major: false, reason: null, unrecognised: true };
  const [, type, , bang] = m;
  const breakingFooter = /^BREAKING CHANGE:\s*(.+)$/m.exec(String(body ?? ''));
  const level = type === 'feat' ? 'minor' : PATCH.has(type) ? 'patch' : NONE.has(type) ? 'none' : 'none';
  const unrecognised = type !== 'feat' && !PATCH.has(type) && !NONE.has(type);
  if (bang || breakingFooter) {
    const reason = bang ? `"${subject}" carries a ! breaking marker` : `BREAKING CHANGE: ${breakingFooter[1]}`;
    // minor, not major: a major is a promise to consumers, and an unwanted one is effectively
    // irreversible once published. The proposal waits for a human.
    return { level: 'minor', major: true, reason, unrecognised: false };
  }
  return { level, major: false, reason: null, unrecognised };
}

export function accumulate(results) {
  let level = 'none';
  const proposals = [];
  let unrecognised = 0;
  for (const r of results) {
    if (ORDER[r.level] > ORDER[level]) level = r.level;
    if (r.major) proposals.push({ reason: r.reason });
    if (r.unrecognised) unrecognised += 1;
  }
  return { level, proposals, unrecognised };
}

// Symlink-robust entry-point check (match raw OR realpath'd argv[1]; Node realpaths
// import.meta.url, so under a symlinked ~/.claude the naive compare is false and main dies).
function isMainModule() {
  const a = process.argv[1];
  if (!a) return false;
  const self = fileURLToPath(import.meta.url);
  if (resolve(a) === self) return true;
  try { return realpathSync(a) === self; } catch { return false; }
}

if (isMainModule()) {
  const a = Object.fromEntries(process.argv.slice(2).flatMap((x, i, xs) =>
    x.startsWith('--') ? [[x.slice(2), xs[i + 1]]] : []));
  process.stdout.write(classifyBump(a.old, a.new) + '\n');
}
