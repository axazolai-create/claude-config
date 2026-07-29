#!/usr/bin/env node
import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readEntries } from './queue.mjs';
import { levelForCommit, accumulate } from './classify-bump.mjs';

// The drain's own bump commits, in both shapes the skill produces: `патч:`/`релиз:` from
// automated mode and a bare `vX.Y.Z` from the manual flow (SKILL.md step 6).
const BUMP = /^(релиз:|патч:|v\d+\.\d+\.\d+$)/;
const list = entries => entries.map(e => e.hash.slice(0, 7)).join(', ');

// Conventional Commits are a convention, not a constraint. A commit with no recognised type
// contributes no bump and would otherwise vanish without a trace - this is the only thing that
// says so out loud. Every entry is looked up, level or no level: a recorded level is what the
// trigger saw at commit time, and drift is precisely the gap between that and history now.
export function lintVersions({ entries, lookup }) {
  if (!entries.length) return [];
  const missing = [], bumps = [], unrecognised = [], results = [];
  for (const e of entries) {
    let subject, result;
    try {
      const commit = lookup(e.hash);
      subject = String(commit.subject ?? '').trim();
      result = levelForCommit(commit);
    } catch { missing.push(e); continue; }
    results.push(result);
    if (BUMP.test(subject)) bumps.push(e);
    else if (result.unrecognised) unrecognised.push(e);
  }
  const problems = [];
  if (missing.length)
    problems.push({ problem: `${missing.length} queued commit(s) no longer in this repository's history, so the queue has drifted from the version it implies: ${list(missing)}` });
  if (bumps.length)
    problems.push({ problem: `${bumps.length} version-bump commit(s) queued, so a version moved outside a drain: ${list(bumps)}` });
  if (unrecognised.length)
    problems.push({ problem: `${unrecognised.length} queued commit(s) with no recognised Conventional Commits type, so they bump nothing: ${list(unrecognised)}` });
  for (const p of accumulate(results).proposals)
    problems.push({ problem: `major proposed and awaiting approval — ${p.reason}` });
  return problems;
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
  const i = process.argv.indexOf('--root');
  const root = resolve(i !== -1 ? process.argv[i + 1] : process.cwd());
  const show = (fmt, h) => execFileSync('git', ['-C', root, 'log', '-1', `--pretty=${fmt}`, h],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const lookup = (h) => ({ subject: show('%s', h).trim(), body: show('%b', h) });
  const problems = lintVersions({ entries: readEntries(root), lookup });
  for (const p of problems) console.error(p.problem);
  process.exit(problems.length ? 1 : 0);
}
