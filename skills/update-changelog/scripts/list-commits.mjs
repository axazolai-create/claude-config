#!/usr/bin/env node
// Lists commits in a range as oldest-first JSON. Two modes:
//   --branch <name> --since <hash>   full history reachable from <name> after <hash> (git log since..branch)
//   --branch <name> --recent <n>     last n commits on <branch>, newest-first, for the operator to pick a start point
//
// Uses ASCII record/unit separators (0x1e / 0x1f) so multi-line commit bodies can't
// collide with the parsing delimiters.

import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)

function getArg(name) {
   const i = args.indexOf(name)
   return i === -1 ? null : args[i + 1]
}

const branch = getArg('--branch')
if (!branch) {
   console.error('Usage: list-commits.mjs --branch <name> (--since <hash> | --recent <n>)')
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

const format = '%H%x1f%s%x1f%b%x1e'
let logArgs

if (recent) {
   logArgs = ['log', branch, `-n${recent}`, `--pretty=format:${format}`]
} else if (since) {
   try {
      execFileSync('git', ['rev-parse', '--verify', since], { stdio: 'ignore' })
   } catch {
      console.log(JSON.stringify({ error: `Starting commit not found: ${since}` }))
      process.exit(1)
   }
   // Full history reachable from branch tip after `since`, in first-commit-first order —
   // deliberately NOT --first-parent, so commits brought in by a regular (non-squash) merge
   // are included individually rather than collapsed into the merge commit.
   logArgs = ['log', '--reverse', `${since}..${branch}`, `--pretty=format:${format}`]
} else {
   console.error('Usage: list-commits.mjs --branch <name> (--since <hash> | --recent <n>)')
   process.exit(1)
}

const raw = execFileSync('git', logArgs, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 32 })

const commits = raw
   .split('\x1e')
   .map(record => record.replace(/^\n/, '').trim())
   .filter(record => record.length > 0)
   .map(record => {
      const [hash, subject, body] = record.split('\x1f')
      return { hash, subject: subject ?? '', body: (body ?? '').trim() }
   })

console.log(JSON.stringify(commits, null, 2))
