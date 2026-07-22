#!/usr/bin/env node
// leanmode shared resolver - see docs/superpowers/specs/2026-07-10-leanmode-design.md for the
// full off/lite/full/ultra rationale. Two independent axes: BASE level (resolveBaseLevel, which
// text tier this agent_type gets ignoring the project dial) and the project dial (resolveDial,
// a uniform shift applied to BASE). shift() combines them; resolveEffectiveLevel() is the one
// function callers actually need.
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
const readJSON = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));

export const LEVEL_ORDER = ["off", "lite", "full", "ultra"];

// Runtime map holds only the 11 non-"off" entries - "off" is already the global fallback, so a
// key that would just say "off" adds nothing at lookup time. The other 29 known agent_type
// values (GSD's remaining agents plus Explore/Plan/claude-code-guide) are deliberately NOT
// entries here - see docs/superpowers/specs/2026-07-10-leanmode-design.md for the full,
// per-agent accounting of what was considered and why each landed on "off".
export const DEFAULT_LEANMODE_MAP = {
  "general-purpose": "lite", // catch-all agent, code-writing is common but not certain - mild nudge only
  "claude": "lite", // default catch-all when no agent name given - same reasoning as general-purpose
  "statusline-setup": "lite", // narrow single-purpose config edit - small scope, minimal is naturally correct here
  "leanmode-executor": "full", // payload/agents/leanmode-executor.md - explicit per-task opt-in to lean implementation
  "gsd-executor": "full", // writes/edits application code implementing plans - primary target for this system
  "gsd-code-fixer": "full", // applies fixes to code review findings - writes application code
  "gsd-debugger": "full", // investigates bugs and writes fix code
  "gsd-pattern-mapper": "full", // maps existing code patterns for reuse - directly synergistic with YAGNI/reuse-first
  "gsd-codebase-mapper": "full", // maps codebase structure/tech for planning - reinforces "reuse what's already there"
  "gsd-nyquist-auditor": "lite", // generates tests to fill validation gaps - some minimalism helps, doesn't need the full push
  "gsd-debug-session-manager": "lite", // orchestrates debug cycles and applies fixes itself - code-touching but mostly a manager role
};

// Same root-finding walk as session-init.mjs/gsd-config-patch.mjs, duplicated on purpose (small
// helper, keeps this module independently readable without importing a sibling hook file).
export function findRoot(start) {
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

function readLeanmodeConfig(root) {
  const p = join(root, ".claude", "leanmode.json");
  if (!existsSync(p)) return {};
  return safe(() => readJSON(p)) || {};
}

// BASE level: which text tier this agent_type gets, ignoring the project dial. 4-step priority
// (highest first): project override -> global map -> project default -> "off".
export function resolveBaseLevel(agentType, root) {
  const cfg = readLeanmodeConfig(root);
  if (cfg.overrides && typeof cfg.overrides[agentType] === "string") return cfg.overrides[agentType];
  if (Object.prototype.hasOwnProperty.call(DEFAULT_LEANMODE_MAP, agentType)) return DEFAULT_LEANMODE_MAP[agentType];
  if (typeof cfg.default === "string") return cfg.default;
  return "off";
}

// Project dial: off|lite|full|ultra. Explicit leanmode.json.dial wins; otherwise "full" once
// /init-stack has run for this project (state[root].initStackRun, written by
// hooks/lib/mark-initstack-done.mjs from init-stack.md's step 9), else "off".
export function resolveDial(root) {
  const cfg = readLeanmodeConfig(root);
  if (typeof cfg.dial === "string") return cfg.dial;
  const stateFile = join(CLAUDE_DIR, "state", "project-init.json");
  const state = existsSync(stateFile) ? (safe(() => readJSON(stateFile)) || {}) : {};
  return (state[root] && state[root].initStackRun) ? "full" : "off";
}

// Applies the dial to BASE. "off" is pinned - it only ever changes via the "off" dial itself,
// never via a lite/ultra shift: every "off" agent_type writes plans, reports, docs, or specs,
// never application code (verified against the full map - see the design doc), so nudging it
// under `ultra` would be pure noise at best (a "before writing code" line landing on a research
// agent) or actively harmful at worst (diluting gsd-security-auditor/gsd-planner). Downward
// shifts need no such guard - "lite" naturally floors at "off" via the plain index clamp.
export function shift(base, dial) {
  if (dial === "off") return "off";
  const i = LEVEL_ORDER.indexOf(base);
  if (dial === "lite") return LEVEL_ORDER[Math.max(0, i - 1)]; // full->lite, lite->off, off->off
  if (dial === "full") return base; // identity - BASE as authored
  if (dial === "ultra") {
    if (base === "off") return "off"; // pinned - see comment above
    return LEVEL_ORDER[Math.min(LEVEL_ORDER.length - 1, i + 1)]; // lite->full, full->ultra
  }
  return base; // unknown dial value - fail safe to identity, never escalate
}

export function resolveEffectiveLevel(agentType, root) {
  return shift(resolveBaseLevel(agentType, root), resolveDial(root));
}

// Rule text loader. "off" -> "" (callers should skip emitting additionalContext entirely).
// lite/full/ultra -> the matching markdown file's content, trimmed. Files live next to this
// module so this works regardless of cwd.
const LIB_DIR = dirname(fileURLToPath(import.meta.url));
export function loadRuleText(level) {
  if (level !== "lite" && level !== "full" && level !== "ultra") return "";
  const p = join(LIB_DIR, `leanmode-${level}-rule.md`);
  return (safe(() => readFileSync(p, "utf8")) || "").trim();
}
