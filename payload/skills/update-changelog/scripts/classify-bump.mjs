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
