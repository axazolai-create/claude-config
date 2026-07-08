#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const QUEUE = root => join(root, '.claude', 'changelog-queue');
const LOCK = root => join(root, '.claude', 'changelog.lock');
const LOCK_TTL_MS = 15 * 60 * 1000;
const ensureDir = p => mkdirSync(dirname(p), { recursive: true });

export function readQueue(root) {
  const f = QUEUE(root);
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
}
export function appendHash(root, hash) {
  const f = QUEUE(root); ensureDir(f);
  const cur = readQueue(root);
  if (!cur.includes(hash)) cur.push(hash);
  writeFileSync(f, cur.join('\n') + '\n');
  return cur;
}
export function clearHashes(root, hashes) {
  const f = QUEUE(root); ensureDir(f);
  const cur = readQueue(root).filter(h => !hashes.includes(h));
  writeFileSync(f, cur.length ? cur.join('\n') + '\n' : '');
  return cur;
}
export function isLocked(root) {
  const f = LOCK(root);
  if (!existsSync(f)) return false;
  if (Date.now() - statSync(f).mtimeMs > LOCK_TTL_MS) { rmSync(f, { force: true }); return false; }
  return true;
}
export function lock(root) { const f = LOCK(root); ensureDir(f); writeFileSync(f, JSON.stringify({ pid: process.pid })); }
export function unlock(root) { rmSync(LOCK(root), { force: true }); }

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cmd = process.argv[2];
  const rest = process.argv.slice(3);
  const positionals = []; const flags = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) { flags[rest[i].slice(2)] = rest[i + 1]; i++; }
    else positionals.push(rest[i]);
  }
  const root = flags.root || process.cwd();
  if (cmd === 'append') appendHash(root, positionals[0]);
  else if (cmd === 'read') process.stdout.write(readQueue(root).join('\n'));
  else if (cmd === 'clear') clearHashes(root, positionals);
  else if (cmd === 'lock') lock(root);
  else if (cmd === 'unlock') unlock(root);
  else if (cmd === 'is-locked') process.exit(isLocked(root) ? 0 : 1);
}
