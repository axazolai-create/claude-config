#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function upsertAggregate(existing, incoming) {
  const key = e => `${e.name}|${e.version}`;
  const byKey = new Map(existing.map(e => [key(e), e]));
  for (const e of incoming) byKey.set(key(e), e); // last write wins
  return [...byKey.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = Object.fromEntries(process.argv.slice(2).flatMap((x, i, xs) =>
    x.startsWith('--') ? [[x.slice(2), xs[i + 1] && !xs[i + 1].startsWith('--') ? xs[i + 1] : true]] : []));
  const file = a.file;
  const incoming = JSON.parse(readFileSync(a['entries-file'], 'utf8'));
  const existing = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  const merged = upsertAggregate(existing, incoming);
  if (a['dry-run'] !== true) writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
  console.log(JSON.stringify({ file, written: merged.length, dryRun: a['dry-run'] === true }));
}
