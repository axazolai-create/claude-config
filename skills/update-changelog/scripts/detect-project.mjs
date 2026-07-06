#!/usr/bin/env node
// Detects project type, locates changelog.json / version.json, and computes the
// baseline (current) version to bump from. Prints a single JSON object to stdout.
//
// --root <path> (optional, default process.cwd()): run against a specific directory
// instead of cwd. Added for Monorepo mode (SKILL.md) — called once per workspace returned
// by list-workspaces.mjs, without needing to `cd` between calls.

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const rootArgIdx = args.indexOf('--root')
const cwd = resolve(rootArgIdx !== -1 && args[rootArgIdx + 1] ? args[rootArgIdx + 1] : process.cwd())

function readJson(path) {
   return JSON.parse(readFileSync(path, 'utf8'))
}

const packageJsonPath = join(cwd, 'package.json')
if (!existsSync(packageJsonPath)) {
   console.log(JSON.stringify({ error: 'package.json not found at repo root — not a Node project.' }))
   process.exit(1)
}

const pkg = readJson(packageJsonPath)
const deps = { ...pkg.dependencies, ...pkg.devDependencies }
const isReact = Boolean(deps.react)
const isNext = Boolean(deps.next)

const candidates = [join(cwd, 'changelog.json'), join(cwd, 'src', 'changelog.json')]
const changelogPath = candidates.find(existsSync) ?? null
const changelogExists = changelogPath !== null

let changelogEntries = []
if (changelogExists) {
   const parsed = readJson(changelogPath)
   changelogEntries = Array.isArray(parsed) ? parsed : []
}

const versionJsonPath = join(cwd, 'version.json')
const versionJsonExists = existsSync(versionJsonPath)

// Baseline version: top entry of changelog.json (newest-first), else package.json version.
let baselineVersion = pkg.version
if (changelogEntries.length > 0 && typeof changelogEntries[0].version === 'string') {
   baselineVersion = changelogEntries[0].version.replace(/^v/, '')
}

console.log(JSON.stringify({
   isReactOrNext: isReact || isNext,
   reactDetected: isReact,
   nextDetected: isNext,
   packageJsonPath,
   packageJsonVersion: pkg.version,
   changelogPath: changelogPath ?? join(cwd, 'changelog.json'),
   changelogExists,
   changelogEntryCount: changelogEntries.length,
   versionJsonPath: versionJsonExists ? versionJsonPath : null,
   baselineVersion,
}, null, 2))
