#!/usr/bin/env node
// leanmode - stamps state[root].initStackRun so leanmode's project dial can default to "full"
// once /init-stack has actually run for this project (see resolveDial() in leanmode-rules.mjs).
// Called as step 9 of payload/commands/init-stack.md's own instructions - NOT a registered
// Claude Code hook, just a plain script run once per /init-stack invocation.
// Idempotent: only writes if the flag isn't already set, matching every other one-time flag in
// the shared ~/.claude/state/project-init.json file (see session-init.mjs, gsd-config-patch.mjs).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
const writeFile = (p, content) => { try { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content); return true; } catch { return false; } };
const readJSON = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));

function findRoot(start) {
  let cur = resolve(start);
  for (let i = 0; i < 40; i++) {
    for (const m of [".git", ".planning", "package.json", "pyproject.toml", "go.mod", "build.gradle.kts"])
      if (existsSync(join(cur, m))) return cur;
    const up = dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return resolve(start);
}

const root = findRoot(process.cwd());
const stateFile = join(homedir(), ".claude", "state", "project-init.json");
let state = existsSync(stateFile) ? (safe(() => readJSON(stateFile)) || {}) : {};
if (!state[root]) state[root] = {};
if (!state[root].initStackRun) {
  state[root].initStackRun = new Date().toISOString();
  writeFile(stateFile, JSON.stringify(state, null, 2) + "\n");
}
