#!/usr/bin/env node
// Applies a batch of already-authored changelog entries: prepends them to changelog.json
// (creating it at repo root if it doesn't exist anywhere) and bumps package.json /
// version.json to the final version. Never touches git itself — the calling skill stages
// and commits exactly these files afterward (see SKILL.md step 6).
//
// Input file shape (--entries-file <path>):
// {
//   "entries": [ { "version": "v0.3.5", "changes": ["feat: ..."] }, ... ],  // newest-first
//   "finalVersion": "0.3.5"                                                // no "v" prefix
// }
//
// --root <path> (optional, default process.cwd()): write into a specific directory instead
// of cwd. Added for Monorepo mode (SKILL.md) — called once per destination workspace, each
// with its own entries file, without needing to `cd` between calls.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const entriesFileArg = args.indexOf('--entries-file')
if (entriesFileArg === -1 || !args[entriesFileArg + 1]) {
   console.error('Usage: write-changelog.mjs --entries-file <path> [--root <path>]')
   process.exit(1)
}

const rootArgIdx = args.indexOf('--root')
const cwd = resolve(rootArgIdx !== -1 && args[rootArgIdx + 1] ? args[rootArgIdx + 1] : process.cwd())
const input = JSON.parse(readFileSync(args[entriesFileArg + 1], 'utf8'))

if (!Array.isArray(input.entries) || input.entries.length === 0) {
   console.log(JSON.stringify({ error: 'entries[] is empty — nothing to write' }))
   process.exit(1)
}
if (!input.finalVersion || !/^\d+\.\d+\.\d+$/.test(input.finalVersion)) {
   console.log(JSON.stringify({ error: `finalVersion must be "X.Y.Z" without a "v" prefix, got: ${input.finalVersion}` }))
   process.exit(1)
}
for (const entry of input.entries) {
   if (!/^v\d+\.\d+\.\d+$/.test(entry.version) || !Array.isArray(entry.changes) || entry.changes.length === 0) {
      console.log(JSON.stringify({ error: `Malformed entry: ${JSON.stringify(entry)}` }))
      process.exit(1)
   }
}

// --- changelog.json ---
const candidates = [join(cwd, 'changelog.json'), join(cwd, 'src', 'changelog.json')]
const changelogPath = candidates.find(existsSync) ?? join(cwd, 'changelog.json')

let existing = []
if (existsSync(changelogPath)) {
   const parsed = JSON.parse(readFileSync(changelogPath, 'utf8'))
   existing = Array.isArray(parsed) ? parsed : []
}

const merged = [...input.entries, ...existing]
writeFileSync(changelogPath, `${JSON.stringify(merged, null, 2)}\n`, { encoding: 'utf8' })

// --- package.json (targeted top-level "version" replace — preserves everything else) ---
const packageJsonPath = join(cwd, 'package.json')
const packageJsonRaw = readFileSync(packageJsonPath, 'utf8')
const versionFieldRe = /"version":\s*"[^"]*"/
if (!versionFieldRe.test(packageJsonRaw)) {
   console.log(JSON.stringify({ error: 'package.json has no "version" field to update' }))
   process.exit(1)
}
writeFileSync(
   packageJsonPath,
   packageJsonRaw.replace(versionFieldRe, `"version": "${input.finalVersion}"`),
   { encoding: 'utf8' },
)

// --- version.json (only if it already exists) ---
const versionJsonPath = join(cwd, 'version.json')
const versionJsonUpdated = existsSync(versionJsonPath)
if (versionJsonUpdated) {
   writeFileSync(versionJsonPath, `{\n  "version": "${input.finalVersion}"\n}\n`, { encoding: 'utf8' })
}

console.log(JSON.stringify({
   changelogPath,
   entriesAdded: input.entries.length,
   topVersion: input.entries[0].version,
   packageJsonPath,
   packageJsonUpdated: true,
   versionJsonPath: versionJsonUpdated ? versionJsonPath : null,
   versionJsonUpdated,
}, null, 2))
