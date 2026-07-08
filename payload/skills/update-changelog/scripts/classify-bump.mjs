#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

export function classifyBump(oldV, newV) {
  const norm = v => String(v).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const [oMaj, oMin] = norm(oldV);
  const [nMaj, nMin] = norm(newV);
  return (nMaj > oMaj || (nMaj === oMaj && nMin > oMin)) ? 'релиз' : 'патч';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = Object.fromEntries(process.argv.slice(2).flatMap((x, i, xs) =>
    x.startsWith('--') ? [[x.slice(2), xs[i + 1]]] : []));
  process.stdout.write(classifyBump(a.old, a.new) + '\n');
}
