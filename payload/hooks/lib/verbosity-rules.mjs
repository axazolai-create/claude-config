// Verbosity axis — terse-code rule. A single project-level dial (off|lite|full|ultra) applied to
// the main loop and all subagents, with optional per-agent overrides. Deliberately simpler than
// leanmode: verbosity is uniform across code-writing contexts, so no per-agent base map and no
// dial-shift table. Reads <root>/.claude/verbosity.json.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
const readJSON = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));
const LEVELS = ["off", "lite", "full", "ultra"];

function readConfig(root) {
  const p = join(root, ".claude", "verbosity.json");
  if (!existsSync(p)) return {};
  return safe(() => readJSON(p)) || {};
}

export function resolveVerbosityLevel(agentType, root) {
  const cfg = readConfig(root);
  if (cfg.overrides && typeof cfg.overrides[agentType] === "string") return cfg.overrides[agentType];
  if (typeof cfg.level === "string") return cfg.level;
  return "off";
}

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
export function loadVerbosityRule(level) {
  if (!LEVELS.includes(level) || level === "off") return "";
  const p = join(LIB_DIR, `verbosity-${level}-rule.md`);
  return (safe(() => readFileSync(p, "utf8")) || "").trim();
}
