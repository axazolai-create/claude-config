// init-stack: core (pure, read-only) — template inheritance resolver + gather.
// Ported 1:1 from payload/bin/init-stack.py: _vertical_ancestors, _resolve_chain, load_json,
// classify, gather, gather_skills (py:347-508), plus the small pure helpers those functions
// depend on (split_id, catalog_has, deep_merge, clean_nonplugin, commands_for). No writes, no
// subprocess — the side-effecting CLI/apply/install lands in a follow-up task on top of this
// module.
// Self-contained: ships inside payload/ (installed standalone into ~/.claude), so this must
// NOT import from the repo-root variants.mjs (installer-meta, not shipped at runtime). Only
// payload-internal siblings (./lib/*) and node:* built-ins.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { STACK_PATHS } from "./lib/stack-markers.mjs";

export { STACK_PATHS };

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

// Installed-location defaults; tests inject templatesDir explicitly (payload/setting-templates
// from the repo, or a throwaway synthetic dir).
export function defaultTemplatesDir() {
  return join(configDir(), "setting-templates");
}

export function defaultMarketplacesDir() {
  return join(configDir(), "plugins", "marketplaces");
}

// ---------- io ----------
// {} if missing; invalid JSON is a hard error, matching init-stack.py:load_json (which prints
// and sys.exit(2) — here that's a thrown Error, since Node has no direct process-exit-from-a-
// pure-function equivalent and the caller/CLI layer is what should decide how to surface it).
export function loadJson(path) {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  try {
    return JSON.parse(text || "{}");
  } catch (e) {
    throw new Error(`${path} is not valid JSON: ${e.message}`);
  }
}

export function isPlaceholder(s) {
  return typeof s === "string" && (s.includes("<") || s.includes(">"));
}

// Mirrors Python's `name, _, mp = pid.rpartition("@")`: split on the LAST "@"; if absent,
// rpartition returns ("", "", pid) — i.e. name="" and mp=the whole original string, NOT the
// other way around.
export function splitId(pid) {
  const i = pid.lastIndexOf("@");
  return i === -1 ? ["", pid] : [pid.slice(0, i), pid.slice(i + 1)];
}

// ---------- merge helpers (used to build gather's nonplugin-settings merge) ----------
export function cleanNonplugin(block) {
  const out = {};
  for (const [k, v] of Object.entries(block || {})) {
    if (k.startsWith("_") || k === "enabledPlugins") continue;
    out[k] = v;
  }
  return out;
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function deepMerge(dst, src) {
  for (const [k, v] of Object.entries(src || {})) {
    if (isPlainObject(v) && isPlainObject(dst[k])) {
      deepMerge(dst[k], v);
    } else {
      dst[k] = v;
    }
  }
  return dst;
}

// ---------- extends resolution (vertical directory inheritance + explicit cross-branch extends) ----------
// Ancestor `_base.json` relative paths for a template at relPath, root-most first, EXCLUDING
// relPath itself. E.g. "backend/node/nest.json" -> ["_base.json", "backend/_base.json",
// "backend/node/_base.json"]; "backend/node/_base.json" itself -> ["_base.json",
// "backend/_base.json"].
export function verticalAncestors(relPath) {
  const dirs = relPath.replace(/\\/g, "/").split("/").slice(0, -1);
  const out = [];
  for (let i = 0; i <= dirs.length; i++) {
    const candidate = i > 0 ? [...dirs.slice(0, i), "_base.json"].join("/") : "_base.json";
    if (candidate !== relPath) out.push(candidate);
  }
  return out;
}

// Return [[relPath, tpl], ...] in application order: vertical ancestors first (root-most
// first, via verticalAncestors), then each explicit `extends` target fully resolved (filtered
// down to `pick`'s listed top-level keys when declared for that path), then relPath's own
// template LAST - so its own plugins/merge are what a diff would show as "added on top".
// Cycle-safe: `visited` is keyed by relative path, so a path already applied earlier in this
// resolution (e.g. the root _base.json, reachable both as a vertical ancestor and via some
// other branch's own vertical chain) is only ever applied once, and a template that (directly
// or via a cycle) extends itself is silently ignored rather than recursing forever.
export function resolveChain(relPath, { templatesDir = defaultTemplatesDir(), visited = new Set() } = {}) {
  if (visited.has(relPath)) return [];
  visited.add(relPath);
  const tplPath = join(templatesDir, relPath);
  if (!existsSync(tplPath)) return [];
  const tpl = loadJson(tplPath);

  const chain = [];
  for (const ancestor of verticalAncestors(relPath)) {
    chain.push(...resolveChain(ancestor, { templatesDir, visited }));
  }

  const pick = tpl.pick || {};
  for (const parent of tpl.extends || []) {
    let subChain = resolveChain(parent, { templatesDir, visited });
    const keys = pick[parent];
    if (keys && keys.length) {
      subChain = subChain.map(([label, t]) => [
        label,
        Object.fromEntries(Object.entries(t).filter(([k]) => keys.includes(k))),
      ]);
    }
    chain.push(...subChain);
  }

  chain.push([relPath, tpl]);
  return chain;
}

// ---------- plugin classification ----------
function catalogHas(marketplacesDir, mp, name) {
  const base = join(marketplacesDir, mp);
  for (const cand of [join(base, ".claude-plugin", "marketplace.json"), join(base, "marketplace.json")]) {
    if (existsSync(cand)) {
      const data = loadJson(cand);
      for (const p of data.plugins || []) {
        if (p && typeof p === "object" && p.name === name) return true;
      }
    }
  }
  return false;
}

// One of: placeholder | installed | marketplace_missing | available | unavailable.
export function classify(pid, { installed = new Set(), known = new Set(), marketplacesDir = defaultMarketplacesDir() } = {}) {
  if (isPlaceholder(pid)) return "placeholder";
  if (installed.has(pid)) return "installed";
  const [name, mp] = splitId(pid);
  if (!known.has(mp)) return "marketplace_missing";
  if (catalogHas(marketplacesDir, mp, name)) return "available";
  return "unavailable";
}

function commandsFor(state, pid, installBlock) {
  if (state === "installed" || state === "placeholder") return null;
  const [, mp] = splitId(pid);
  const ma = installBlock.marketplace_add || {};
  const out = {
    install: Object.fromEntries(["cmd", "bash", "slash"].filter((k) => installBlock[k]).map((k) => [k, installBlock[k]])),
  };
  if (state === "marketplace_missing") {
    out.marketplace_add = Object.fromEntries(["cmd", "slash"].filter((k) => ma[k]).map((k) => [k, ma[k]]));
  }
  if (state === "unavailable") {
    out.refresh = {
      cmd: `claude plugin marketplace update ${mp}`,
      slash: `/plugin marketplace update ${mp}`,
    };
  }
  return out;
}

// ---------- gather declared plugins across detected stacks ----------
export function gather(
  stacks,
  { templatesDir = defaultTemplatesDir(), installed = new Set(), known = new Set(), marketplacesDir = defaultMarketplacesDir() } = {},
) {
  const entries = [];
  const nonpluginMerge = {};
  const seen = new Set();
  for (const stack of stacks) {
    const relPath = STACK_PATHS[stack];
    if (!relPath || !existsSync(join(templatesDir, relPath))) {
      entries.push({ stack, via: stack, id: null, state: "no_template", commands: null });
      continue;
    }
    for (const [via, tpl] of resolveChain(relPath, { templatesDir })) {
      deepMerge(nonpluginMerge, cleanNonplugin(tpl.merge || {}));
      for (const p of tpl.plugins || []) {
        const pid = p.id || "";
        if (!pid || seen.has(pid)) continue;
        seen.add(pid);
        const state = classify(pid, { installed, known, marketplacesDir });
        entries.push({
          stack,
          via,
          id: pid,
          state,
          description: p.description || "",
          commands: commandsFor(state, pid, p.install || {}),
        });
      }
    }
  }
  return { entries, nonpluginMerge };
}

// ---------- skills (npx skills add ...; SKILL.md dirs, NOT marketplace plugins) ----------
// Skills declared by the detected stacks' templates (a template's optional skills[] array),
// deduped, each with a present/missing state (present == its `name` is in installedSkills,
// which the caller computes by scanning ~/.claude/skills / ./.claude/skills dir names).
export function gatherSkills(stacks, { templatesDir = defaultTemplatesDir(), installedSkills = new Set() } = {}) {
  const out = [];
  const seen = new Set();
  for (const stack of stacks) {
    const relPath = STACK_PATHS[stack];
    if (!relPath || !existsSync(join(templatesDir, relPath))) continue;
    for (const [, tpl] of resolveChain(relPath, { templatesDir })) {
      for (const s of tpl.skills || []) {
        const sid = s.id || "";
        if (!sid || seen.has(sid)) continue;
        seen.add(sid);
        const nm = s.name || sid.split("/").pop();
        out.push({
          id: sid,
          name: nm,
          stack,
          state: installedSkills.has(nm) ? "installed" : "available",
          description: s.description || "",
          install: s.install || {},
        });
      }
    }
  }
  return out;
}
