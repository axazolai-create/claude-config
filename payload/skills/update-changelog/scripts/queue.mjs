#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, rmSync } from 'node:fs';
import { resolve } from "node:path";
import { realpathSync } from "node:fs";
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { levelForCommit, accumulate } from './classify-bump.mjs';

const QUEUE = root => join(root, '.claude', 'changelog-queue');
const LOCK = root => join(root, '.claude', 'changelog.lock');
const LOCK_TTL_MS = 15 * 60 * 1000;
const ensureDir = p => mkdirSync(dirname(p), { recursive: true });
const serialise = entries => entries.map(e => (e.level ? `${e.hash} ${e.level}` : e.hash)).join('\n') + '\n';

export function readEntries(root) {
  const f = QUEUE(root);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).map(line => {
    const [hash, level] = line.trim().split(/\s+/);
    return { hash, level: level ?? null };
  });
}
export function readQueue(root) {
  return readEntries(root).map(e => e.hash);
}
export function appendHash(root, hash, level) {
  const f = QUEUE(root); ensureDir(f);
  const cur = readEntries(root);
  if (!cur.some(e => e.hash === hash)) cur.push({ hash, level: level ?? null });
  writeFileSync(f, serialise(cur));
  return cur.map(e => e.hash);
}
export function clearHashes(root, hashes) {
  const f = QUEUE(root); ensureDir(f);
  const cur = readEntries(root).filter(e => !hashes.includes(e.hash));
  writeFileSync(f, cur.length ? serialise(cur) : '');
  return cur.map(e => e.hash);
}

// A queue written before levels existed holds bare hashes, and that queue exists on every
// machine with the trigger already installed. Those entries are classified here instead.
export function resolveDrain(entries, lookup) {
  const results = entries.map(e => {
    if (e.level) return { level: e.level, major: false, reason: null, unrecognised: false };
    try { return levelForCommit(lookup(e.hash)); }
    catch { return { level: 'none', major: false, reason: null, unrecognised: true }; }
  });
  return { ...accumulate(results), hashes: entries.map(e => e.hash) };
}
export function isLocked(root) {
  const f = LOCK(root);
  if (!existsSync(f)) return false;
  if (Date.now() - statSync(f).mtimeMs > LOCK_TTL_MS) { rmSync(f, { force: true }); return false; }
  return true;
}
export function lock(root) { const f = LOCK(root); ensureDir(f); writeFileSync(f, JSON.stringify({ pid: process.pid })); }
export function unlock(root) { rmSync(LOCK(root), { force: true }); }

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
  const cmd = process.argv[2];
  const rest = process.argv.slice(3);
  const positionals = []; const flags = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) { flags[rest[i].slice(2)] = rest[i + 1]; i++; }
    else positionals.push(rest[i]);
  }
  const root = flags.root || process.cwd();
  if (cmd === 'append') {
    const hash = positionals[0];
    let level = flags.level ?? null;
    if (!level && 'classify' in flags) {
      try {
        const subject = execFileSync('git', ['-C', root, 'log', '-1', '--pretty=%s', hash], { encoding: 'utf8' }).trim();
        const body = execFileSync('git', ['-C', root, 'log', '-1', '--pretty=%b', hash], { encoding: 'utf8' });
        level = levelForCommit({ subject, body }).level;
      } catch { process.stderr.write(`changelog: could not classify ${hash}, queued unclassified\n`); }
    }
    appendHash(root, hash, level);
  }
  else if (cmd === 'read') process.stdout.write(readQueue(root).join('\n'));
  else if (cmd === 'clear') clearHashes(root, positionals);
  else if (cmd === 'lock') lock(root);
  else if (cmd === 'unlock') unlock(root);
  else if (cmd === 'is-locked') process.exit(isLocked(root) ? 0 : 1);
  else if (cmd === 'drain') {
    const lookup = (h) => ({
      subject: execFileSync('git', ['-C', root, 'log', '-1', '--pretty=%s', h], { encoding: 'utf8' }).trim(),
      body: execFileSync('git', ['-C', root, 'log', '-1', '--pretty=%b', h], { encoding: 'utf8' }),
    });
    process.stdout.write(JSON.stringify(resolveDrain(readEntries(root), lookup), null, 2) + '\n');
  }
}
