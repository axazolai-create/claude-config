#!/usr/bin/env node
// Enumerates monorepo workspace directories from the repo root. Used by the Monorepo mode
// section of SKILL.md to find candidate parts (web/backend/mobile/...) before running
// detect-project.mjs / write-changelog.mjs against each one with --root.
//
// Detection order (first match wins — these tools normally sit on top of one workspace
// list, not several conflicting ones):
//   1. pnpm-workspace.yaml            "packages:" list (simple YAML — hand-parsed, no dep)
//   2. package.json "workspaces"      array form, or { packages: [...] } object form
//   3. turbo.json / nx.json present, but neither of the above found -> conventional
//      fallback globs: apps/*, packages/*  (only directories that actually exist)
//
// A glob entry is only expanded if it ends in "/*" (list immediate subdirectories) or names
// an exact existing directory — this deliberately does NOT implement full glob syntax
// (no "**", no brace expansion) since real-world workspace lists are almost always one of
// those two shapes. Prints a single JSON object to stdout.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const rootArg = args.indexOf('--root')
const root = resolve(rootArg !== -1 && args[rootArg + 1] ? args[rootArg + 1] : process.cwd())

function readJsonSafe(path) {
   try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

// --- 1. pnpm-workspace.yaml: hand-parse the "packages:" list ---
function parsePnpmWorkspaceYaml(path) {
   const text = readFileSync(path, 'utf8')
   const lines = text.split(/\r?\n/)
   const globs = []
   let inPackages = false
   for (const line of lines) {
      if (/^packages\s*:/.test(line)) { inPackages = true; continue }
      if (inPackages) {
         const m = line.match(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/)
         if (m) { globs.push(m[1]); continue }
         if (/^\S/.test(line)) break // dedented to a new top-level key — packages list ended
      }
   }
   return globs
}

let workspaceGlobs = null
let source = null

const pnpmWsPath = join(root, 'pnpm-workspace.yaml')
if (existsSync(pnpmWsPath)) {
   const globs = parsePnpmWorkspaceYaml(pnpmWsPath)
   if (globs.length > 0) { workspaceGlobs = globs; source = 'pnpm-workspace.yaml' }
}

const rootPkgPath = join(root, 'package.json')
const rootPkg = existsSync(rootPkgPath) ? readJsonSafe(rootPkgPath) : null

if (!workspaceGlobs && rootPkg && rootPkg.workspaces) {
   const w = rootPkg.workspaces
   const globs = Array.isArray(w) ? w : Array.isArray(w.packages) ? w.packages : null
   if (globs && globs.length > 0) { workspaceGlobs = globs; source = 'package.json#workspaces' }
}

const turboPresent = existsSync(join(root, 'turbo.json'))
const nxPresent = existsSync(join(root, 'nx.json'))

if (!workspaceGlobs && (turboPresent || nxPresent)) {
   const fallback = ['apps/*', 'packages/*'].filter((g) => existsSync(join(root, g.replace('/*', ''))))
   if (fallback.length > 0) { workspaceGlobs = fallback; source = 'conventional-fallback' }
}

// --- expand globs: "dir/*" -> immediate subdirectories, exact path -> itself ---
function expandGlob(glob) {
   if (glob.endsWith('/*')) {
      const base = join(root, glob.slice(0, -2))
      if (!existsSync(base)) return []
      return readdirSync(base, { withFileTypes: true })
         .filter((e) => e.isDirectory())
         .map((e) => join(base, e.name))
   }
   const exact = join(root, glob)
   return existsSync(exact) && statSync(exact).isDirectory() ? [exact] : []
}

const dirs = new Set()
for (const g of workspaceGlobs ?? []) for (const d of expandGlob(g)) dirs.add(d)

const workspaces = [...dirs]
   .map((dir) => {
      const pkgPath = join(dir, 'package.json')
      return {
         dir,
         relDir: dir.slice(root.length + 1).split('\\').join('/'),
         hasPackageJson: existsSync(pkgPath),
      }
   })
   .filter((w) => w.hasPackageJson) // a workspace this skill can version needs its own package.json
   .sort((a, b) => a.relDir.localeCompare(b.relDir))

console.log(JSON.stringify({
   root,
   isMonorepo: workspaces.length > 1,
   detectionSource: source,
   workspaceGlobsUsed: workspaceGlobs ?? [],
   workspaces,
}, null, 2))
