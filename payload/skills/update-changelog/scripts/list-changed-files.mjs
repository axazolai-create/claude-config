#!/usr/bin/env node
// Lists changed file paths per commit in a range — used in Monorepo mode to attribute each
// commit to the workspace(s) it touched (by matching paths against each workspace's relDir
// prefix, from list-workspaces.mjs). Separate script from list-commits.mjs because git's
// --name-only output would collide with that script's \x1e record-separator parsing.
//
// Same two range modes as list-commits.mjs:
//   --branch <name> --since <hash>   full history reachable from <name> after <hash>
//   --branch <name> --recent <n>     last n commits on <branch>
//
// Prints { "<hash>": ["path/a.ts", "path/b.ts", ...], ... } — oldest-first key order isn't
// meaningful for an object, so callers should already have the commit order from
// list-commits.mjs and just look hashes up here.

import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)

function getArg(name) {
   const i = args.indexOf(name)
   return i === -1 ? null : args[i + 1]
}

const branch = getArg('--branch')
if (!branch) {
   console.error('Usage: list-changed-files.mjs --branch <name> (--since <hash> | --recent <n>)')
   process.exit(1)
}

try {
   execFileSync('git', ['rev-parse', '--verify', branch], { stdio: 'ignore' })
} catch {
   console.log(JSON.stringify({ error: `Local branch not found: ${branch}` }))
   process.exit(1)
}

const since = getArg('--since')
const recent = getArg('--recent')

// %H then our own separator, then --name-only appends the changed paths (one per line)
// before the next commit's %H line.
const format = '%H%x1f'
let logArgs

if (recent) {
   logArgs = ['log', branch, `-n${recent}`, '--name-only', `--pretty=format:${format}`]
} else if (since) {
   try {
      execFileSync('git', ['rev-parse', '--verify', since], { stdio: 'ignore' })
   } catch {
      console.log(JSON.stringify({ error: `Starting commit not found: ${since}` }))
      process.exit(1)
   }
   // same history walk as list-commits.mjs (NOT --first-parent) so hash keys line up
   logArgs = ['log', '--reverse', `${since}..${branch}`, '--name-only', `--pretty=format:${format}`]
} else {
   console.error('Usage: list-changed-files.mjs --branch <name> (--since <hash> | --recent <n>)')
   process.exit(1)
}

const raw = execFileSync('git', logArgs, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 32 })

// Each record looks like: "<hash>\x1f\npath/a.ts\npath/b.ts\n\n" (merge commits with
// --name-only can print zero paths). Split on the "<hash>\x1f" marker itself.
const result = {}
const parts = raw.split(/(?=[0-9a-f]{40}\x1f)/).filter(Boolean)
for (const part of parts) {
   const sepIdx = part.indexOf('\x1f')
   if (sepIdx === -1) continue
   const hash = part.slice(0, sepIdx)
   const files = part
      .slice(sepIdx + 1)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
   result[hash] = files
}

console.log(JSON.stringify(result))
