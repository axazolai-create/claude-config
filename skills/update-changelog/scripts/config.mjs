// skills/update-changelog/scripts/config.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

export function loadConfig(repoRoot) {
  const p = join(repoRoot, '.changelog.config.json');
  if (!existsSync(p)) return null;
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  const agg = raw.aggregate && raw.aggregate.part && raw.aggregate.file
    ? { part: raw.aggregate.part, file: raw.aggregate.file } : null;
  return { aggregate: agg, names: (raw.names && typeof raw.names === 'object') ? raw.names : {} };
}

export function partName(config, relDir) {
  const names = (config && config.names) || {};
  return names[relDir] || basename(relDir);
}

export function aggregatePath(config) {
  if (!config || !config.aggregate) return null;
  return join(config.aggregate.part, config.aggregate.file);
}
