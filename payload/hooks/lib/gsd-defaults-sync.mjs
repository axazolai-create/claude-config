// Deploys gsd-defaults.partial.json into gsd-core's own global-defaults file
// (~/.gsd/defaults.json) and into a project's .planning/config.json.
// Small helpers (deep merge, project-root walk) are deliberately duplicated from
// setup.mjs / gsd-config-patch.mjs rather than cross-imported - same convention
// gsd-config-patch.mjs itself already uses for findRoot().
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);

/** Deep-additive merge: existing `base` values win, missing keys/array items are added. */
export function deepMergeExistingWins(base, add) {
  if (Array.isArray(base) && Array.isArray(add)) {
    const seen = new Set(base.map((v) => JSON.stringify(v)));
    const out = base.slice();
    for (const v of add) {
      const k = JSON.stringify(v);
      if (!seen.has(k)) { out.push(v); seen.add(k); }
    }
    return out;
  }
  if (isObj(base) && isObj(add)) {
    const out = { ...base };
    for (const k of Object.keys(add)) out[k] = k in base ? deepMergeExistingWins(base[k], add[k]) : add[k];
    return out;
  }
  return base;
}

/** One-level-nested merge: `patch` wins on every key it defines; target's own keys survive. */
export function mergeReferenceWins(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== "object" || Array.isArray(target[k])) target[k] = {};
      Object.assign(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

/** Walks up from startDir looking for a project-root marker. Falls back to resolve(startDir). */
export function findProjectRoot(startDir) {
  let cur = resolve(startDir);
  for (let i = 0; i < 40; i++) {
    for (const m of [".planning", ".git", "package.json", "pyproject.toml", "go.mod", "build.gradle.kts"])
      if (existsSync(join(cur, m))) return cur;
    const up = dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return resolve(startDir);
}

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
const readJSON = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));

/** Deep-additive-merges `partial` into ~/.gsd/defaults.json. Existing user values win. */
export function syncGsdGlobalDefaults({ homeDir, partial }) {
  const dir = join(homeDir, ".gsd");
  const path = join(dir, "defaults.json");
  const cur = existsSync(path) ? (safe(() => readJSON(path)) ?? {}) : {};
  const merged = deepMergeExistingWins(cur, partial);
  const curStr = JSON.stringify(cur, null, 2);
  const mergedStr = JSON.stringify(merged, null, 2);
  if (curStr === mergedStr) return { path, changed: false };
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, mergedStr + "\n");
  return { path, changed: true };
}

/** Reference-wins-merges `partial` into <projectRoot>/.planning/config.json, if it exists. */
export function syncProjectConfig({ projectRoot, partial }) {
  const planningDir = join(projectRoot, ".planning");
  if (!existsSync(planningDir)) return { skipped: true, reason: "no .planning directory" };
  const path = join(planningDir, "config.json");
  if (!existsSync(path)) return { skipped: true, reason: "no .planning/config.json" };
  const cur = safe(() => readJSON(path));
  if (cur === undefined || typeof cur !== "object" || cur === null)
    return { skipped: true, reason: "config.json unreadable or invalid JSON" };
  const before = JSON.stringify(cur, null, 2);
  mergeReferenceWins(cur, partial);
  const after = JSON.stringify(cur, null, 2);
  if (before === after) return { path, changed: false };
  writeFileSync(path, after + "\n");
  return { path, changed: true };
}
