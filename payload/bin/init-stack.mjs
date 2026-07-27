// init-stack: template inheritance resolver + gather (pure/read-only) PLUS the side-effecting
// CLI/apply/install half and the profile-aware plugin tier filter.
// Ported 1:1 from payload/bin/init-stack.py: _vertical_ancestors, _resolve_chain, load_json,
// classify, gather, gather_skills, resolved_autoenable, known_plugins, apply, install_missing,
// _run_cmd/_run_marketplace_add, print_report/print_present/print_skills, main() CLI dispatch,
// plus the small pure helpers those functions depend on (split_id, catalog_has, deep_merge,
// clean_nonplugin, commands_for, grab). The raw-keypress arrow-key TUI (_enable_vt/_getch/
// interactive_select) is deliberately NOT ported byte-for-byte: it is reimplemented as a
// readline numbered checklist (see checklistSelect below), matching setup.mjs's ask() style.
// The checklist's SEMANTICS are preserved (pre-checked = present ∪ autoenable; orphan-enabled
// preserved unless unchecked; install-missing → enable → remove) - only the raw-terminal
// interaction is simplified. Non-interactive paths (--status/--apply-all/--enable/--remove/
// report) are ported faithfully - these are what parity/scripts depend on.
// Self-contained: ships inside payload/ (installed standalone into ~/.claude), so this must
// NOT import from the repo-root variants.mjs (installer-meta, not shipped at runtime). Only
// payload-internal siblings (./lib/*) and node:* built-ins.
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { STACK_PATHS, detect } from "./lib/stack-markers.mjs";
import { migrateProjectModelConfig } from "./lib/model-migration.mjs";

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

// ---------- profile-aware plugin tier filter (spec §4) ----------
// A plugin entry may carry {tier: "core"|"full"}; absent -> "core". maxPluginTier undefined/
// absent -> no cap (keep everything, since "full" is the highest rank).
const TIER_RANK = { core: 0, full: 1 };
export function keepPlugin(entry, maxPluginTier) {
  const t = (entry && entry.tier) || "core";
  const max = maxPluginTier || "full";
  return (TIER_RANK[t] ?? 0) <= (TIER_RANK[max] ?? 1);
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
  {
    templatesDir = defaultTemplatesDir(),
    installed = new Set(),
    known = new Set(),
    marketplacesDir = defaultMarketplacesDir(),
    maxPluginTier,
  } = {},
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
        if (!keepPlugin(p, maxPluginTier)) continue;
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

// ==================================================================================
// Side-effecting half: state readers, apply/install, interactive checklist, CLI dispatch.
// ==================================================================================

// ---------- state readers (~/.claude/plugins/*, project settings, skills dirs) ----------
export function installedIds(configDirPath = configDir()) {
  const data = loadJson(join(configDirPath, "plugins", "installed_plugins.json"));
  const plugins = data && data.plugins;
  return plugins && typeof plugins === "object" && !Array.isArray(plugins) ? new Set(Object.keys(plugins)) : new Set();
}

export function knownMarketplaces(configDirPath = configDir()) {
  const names = new Set();
  const mpDir = join(configDirPath, "plugins", "marketplaces");
  if (existsSync(mpDir)) {
    for (const e of readdirSync(mpDir, { withFileTypes: true })) if (e.isDirectory()) names.add(e.name);
  }
  const km = loadJson(join(configDirPath, "plugins", "known_marketplaces.json"));
  const mps = km && typeof km === "object" && !Array.isArray(km) ? (km.marketplaces !== undefined ? km.marketplaces : km) : {};
  if (mps && typeof mps === "object" && !Array.isArray(mps)) {
    for (const k of Object.keys(mps)) names.add(k);
  } else if (Array.isArray(mps)) {
    for (const e of mps) if (e && typeof e === "object" && e.name) names.add(e.name);
  }
  return new Set([...names].filter(Boolean));
}

export function presentEnabled(settingsFile) {
  const s = loadJson(settingsFile);
  const ep = s && s.enabledPlugins;
  return ep && typeof ep === "object" && !Array.isArray(ep) ? Object.keys(ep) : [];
}

export function installedSkillNames(root, configDirPath = configDir()) {
  const names = new Set();
  for (const d of [join(configDirPath, "skills"), join(root, ".claude", "skills")]) {
    if (existsSync(d)) {
      for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) names.add(e.name);
    }
  }
  return names;
}

// maxPluginTier is NOT installer-meta (variants.json isn't shipped into ~/.claude) - the
// effective cap for an installed bundle is stamped into the bundle manifest at install time
// (Task 8 writes it; older manifests simply lack the field -> undefined -> no cap, i.e. today's
// full behavior until setup.mjs starts writing it). A missing manifest is already fail-soft
// (loadJson returns {}); a CORRUPT (invalid-JSON) manifest must degrade the same way - init-stack
// should never hard-fail just because the cap can't be read - so this also swallows loadJson's
// parse-error throw and falls back to "no cap".
export function readMaxPluginTier(configDirPath = configDir()) {
  let manifest;
  try { manifest = loadJson(join(configDirPath, "state", "bundle-manifest.json")); }
  catch { return undefined; }
  return manifest && typeof manifest === "object" ? manifest.maxPluginTier : undefined;
}

// ---------- recursive template scan (for the "other known plugins" opt-in list) ----------
function allTemplateJsonFiles(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".json")) out.push(p);
    }
  };
  walk(dir);
  out.sort();
  return out;
}

// ---------- auto-enable set + full "known" plugin catalog (for interactive selection) ----------
// Ids the detected stacks' templates auto-enable (merge.enabledPlugins == true) across the full
// resolved inheritance chain, minus placeholders. Used to pre-check the right boxes in the
// interactive picker so the default selection matches what a plain --apply-all would enable.
export function resolvedAutoenable(stacks, { templatesDir = defaultTemplatesDir() } = {}) {
  const ids = new Set();
  for (const stack of stacks) {
    const relPath = STACK_PATHS[stack];
    if (!relPath || !existsSync(join(templatesDir, relPath))) continue;
    for (const [, tpl] of resolveChain(relPath, { templatesDir })) {
      const ep = (tpl.merge || {}).enabledPlugins || {};
      for (const [pid, on] of Object.entries(ep)) {
        if (on && !isPlaceholder(pid)) ids.add(pid);
      }
    }
  }
  return ids;
}

// Every plugin declared ANYWHERE under templatesDir that isn't already in excludeIds (the
// detected-stack set) - the "other known plugins" opt-in list. Deduped by id, classified,
// carrying description + install commands. Read straight off the template files (not the
// STACK_PATHS chain) so opt-in plugins that no stack auto-enables still surface. Subject to the
// same tier filter as gather() so a lite install's opt-in list never offers a full-tier plugin.
export function knownPlugins(
  excludeIds,
  {
    templatesDir = defaultTemplatesDir(),
    installed = new Set(),
    known = new Set(),
    marketplacesDir = defaultMarketplacesDir(),
    maxPluginTier,
  } = {},
) {
  const out = [];
  const seen = new Set();
  for (const tplPath of allTemplateJsonFiles(templatesDir)) {
    const tpl = loadJson(tplPath);
    const rel = relative(templatesDir, tplPath).replace(/\\/g, "/");
    for (const p of tpl.plugins || []) {
      const pid = p.id || "";
      if (!pid || excludeIds.has(pid) || seen.has(pid)) continue;
      if (!keepPlugin(p, maxPluginTier)) continue;
      seen.add(pid);
      const state = classify(pid, { installed, known, marketplacesDir });
      out.push({
        stack: "known",
        via: rel,
        id: pid,
        state,
        group: "known",
        description: p.description || "",
        commands: commandsFor(state, pid, p.install || {}),
      });
    }
  }
  return out;
}

// ---------- report (default, no-arg CLI mode) ----------
const SYMBOL = {
  installed: "[installed]",
  available: "[available] (install)",
  marketplace_missing: "[x] marketplace not added",
  unavailable: "[x] not in marketplace catalog (stale id?)",
  placeholder: "[ ] placeholder - fill template",
  no_template: "[ ] no template for this stack",
};

export function printReport(stacks, entries) {
  console.log("Detected stack:", stacks.join(", "));
  for (const e of entries) {
    const pid = e.id || `(stack: ${e.stack})`;
    const via = e.via || e.stack;
    const leafPath = STACK_PATHS[e.stack];
    const tag = via === leafPath || e.state === "no_template" ? `[${e.stack}]` : `[${e.stack} via ${via}]`;
    console.log(`  ${tag} ${pid}  ${SYMBOL[e.state] || e.state}`);
    const c = e.commands;
    if (!c) continue;
    if (c.marketplace_add) for (const [form, val] of Object.entries(c.marketplace_add)) console.log(`        marketplace_add.${form}: ${val}`);
    if (c.refresh) for (const [form, val] of Object.entries(c.refresh)) console.log(`        refresh.${form}: ${val}`);
    for (const [form, val] of Object.entries(c.install || {})) console.log(`        install.${form}: ${val}`);
  }
}

export function printPresent(declared, present, opts = {}) {
  if (!present.length) return;
  const allDeclared = new Set([...declared, ...knownPlugins(new Set(), opts).map((e) => e.id)]);
  console.log("\nAlready enabled in project settings (removable via -i):");
  const orphaned = [];
  for (const pid of present) {
    let tag;
    if (declared.has(pid)) tag = "declared by this stack";
    else if (allDeclared.has(pid)) tag = "declared by another stack's template";
    else {
      tag = "ORPHANED - no template declares this (stale?)";
      orphaned.push(pid);
    }
    console.log(`  - ${pid}  [${tag}]`);
  }
  if (orphaned.length) {
    console.log("  Note: ORPHANED plugins are enabled but no current template declares them - likely");
    console.log("  stale. Uncheck them in the interactive flow (-i) to remove; not auto-removed, since");
    console.log("  you may have enabled them deliberately.");
  }
}

function short(desc, width = 100) {
  const d = (desc || "").split(/\s+/).filter(Boolean).join(" ");
  return d.length <= width ? d : d.slice(0, width - 3) + "...";
}

export function printSkills(skills) {
  if (!skills.length) return;
  console.log("\nStack skills (npx skills add - opt-in, not auto-installed; run -i to install):");
  for (const e of skills) {
    const mark = e.state === "installed" ? "[installed]" : "[available]";
    console.log(`  - ${e.id}  ${mark}`);
    if (e.description) console.log(`      ${short(e.description)}`);
  }
}

// ---------- apply (writes ./.claude/settings.json) ----------
export function apply(enableIds, removeIds, stacks, opts = {}) {
  const root = opts.root || process.cwd();
  const settingsFile = opts.settingsFile || opts.settingsPath || join(root, ".claude", "settings.json");
  const { nonpluginMerge } = gather(stacks, opts);
  const settings = loadJson(settingsFile);
  let ep = settings.enabledPlugins;
  if (!ep || typeof ep !== "object" || Array.isArray(ep)) ep = {};
  settings.enabledPlugins = ep;
  deepMerge(settings, nonpluginMerge); // stack settings (non-plugin keys)
  const enabled = [];
  const removed = [];
  for (const pid of enableIds) {
    if (pid && !isPlaceholder(pid)) {
      ep[pid] = true;
      enabled.push(pid);
    }
  }
  for (const pid of removeIds) {
    if (pid in ep) {
      delete ep[pid];
      removed.push(pid);
    }
  }
  settings.enabledPlugins = settings.enabledPlugins || {};
  mkdirSync(dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + "\n", "utf8");
  console.log("Enabled:", enabled.length ? enabled.join(", ") : "(none)");
  console.log("Removed:", removed.length ? removed.join(", ") : "(none)");
  console.log(`Wrote ${settingsFile}`);
  console.log("enabledPlugins resolves at startup - RESTART Claude Code to apply.");
  return 0;
}

// ---------- §6.3 project model-config re-migration (Phase 5 Part B) ----------
// Surgically bring a GSD project's .planning/config.json model_overrides up to the current Opus 5
// defaults (five roles haiku->sonnet, gsd-verifier sonnet->opus). Guarded on the file existing,
// so a non-GSD project (or a base/lite user) is a silent no-op. Non-clobber: only a value still
// holding the known-old default moves; a user-chosen value is left alone (see model-migration.mjs).
// Runs on every explicit /init-stack invocation, independent of gsd-config-patch.mjs's one-time
// gsdModelConfigPatched flag - a malformed config is left untouched, never corrupted.
export function migrateProjectModelConfigFile(root = process.cwd()) {
  const p = join(root, ".planning", "config.json");
  if (!existsSync(p)) return { changes: [] };
  let config;
  try { config = JSON.parse(readFileSync(p, "utf8") || "{}"); }
  catch { return { changes: [] }; }
  const { config: next, changes } = migrateProjectModelConfig(config);
  if (!changes.length) return { changes };
  writeFileSync(p, JSON.stringify(next, null, 2) + "\n", "utf8");
  console.log(`Re-migrated ${relative(root, p) || p} model_overrides to current defaults:`);
  for (const c of changes) console.log(`  - ${c.role}: ${c.from} -> ${c.to}`);
  return { changes };
}

// ---------- subprocess (install/marketplace-add) ----------
// CLAUDE_INIT_STACK_SKIP_SUBPROCESS=1 short-circuits every actual shell-out (tests; hermetic
// dry-runs) - mirrors setup.mjs's CLAUDE_SETUP_SKIP_PLUGINS=1 pattern for the same reason: never
// let a test suite run `claude plugin install`/marketplace add for real.
function subprocessSkipped() {
  return process.env.CLAUDE_INIT_STACK_SKIP_SUBPROCESS === "1";
}

// shell:true is safe here: every command string comes from our own setting-templates/*.json
// (trusted, static), never from user input, and shell:true is what lets a bare `claude` resolve
// to claude.cmd on Windows / the PATH entry on POSIX. capture:true buffers combined
// stdout+stderr (printed once the process exits) and returns it so callers can pattern-match a
// known retryable failure; only used for marketplace_add.
export function runCmd(cmd, { capture = false } = {}) {
  console.log(`    $ ${cmd}`);
  if (subprocessSkipped()) return { ok: true, out: "" };
  try {
    if (capture) {
      const proc = spawnSync(cmd, { shell: true, encoding: "utf8" });
      const out = (proc.stdout || "") + (proc.stderr || "");
      if (out) process.stdout.write(out);
      return { ok: proc.status === 0, out };
    }
    const proc = spawnSync(cmd, { shell: true, stdio: "inherit" });
    return { ok: proc.status === 0, out: "" };
  } catch (exc) {
    console.error(`    ! failed to launch: ${exc.message}`);
    return { ok: false, out: String(exc.message) };
  }
}

// Signature of a known upstream issue: some marketplace repos pin their OWN submodules to
// git@github.com: SSH URLs regardless of how the marketplace repo itself was cloned, so
// marketplace_add can fail with an SSH host-key/auth error even when its own URL is HTTPS. See
// setting-templates/README.md for the full writeup.
const SSH_SUBMODULE_FAILURE_MARKERS = [
  "host key is not in your known_hosts file",
  "Host key verification failed",
  "Permission denied (publickey)",
];

// Run a marketplace_add command; on a recognized SSH-submodule failure, retry once with a git
// URL rewrite scoped to just this subprocess call (GIT_CONFIG_COUNT/KEY/VALUE, git >= 2.31) so
// git@github.com: submodule fetches go over HTTPS instead. Never touches ~/.gitconfig - purely
// process-local, reverts the moment the call returns.
export function runMarketplaceAdd(cmd) {
  const { ok, out } = runCmd(cmd, { capture: true });
  if (ok || !SSH_SUBMODULE_FAILURE_MARKERS.some((m) => out.includes(m))) return ok;
  console.log(
    "    ! marketplace add failed on an SSH host-key/auth error - retrying with a " +
      "process-scoped git@github.com: -> https://github.com/ rewrite (no changes to your global git config)...",
  );
  console.log(`    $ ${cmd}`);
  if (subprocessSkipped()) return true;
  const env = {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "url.https://github.com/.insteadOf",
    GIT_CONFIG_VALUE_0: "git@github.com:",
  };
  try {
    const proc = spawnSync(cmd, { shell: true, env, stdio: "inherit" });
    const retryOk = proc.status === 0;
    if (!retryOk) {
      console.error(
        "    ! retry also failed - if this persists, run on this machine:\n" +
          '        git config --global url."https://github.com/".insteadOf "git@github.com:"',
      );
    }
    return retryOk;
  } catch (exc) {
    console.error(`    ! failed to launch: ${exc.message}`);
    return false;
  }
}

// Install each not-yet-installed plugin: marketplace add first when its marketplace is missing
// (refresh first when the catalog is stale), then the plugin itself. Returns {ok, failed} id
// lists. Placeholders / entries with no install command are skipped.
export function installMissing(entries) {
  const ok = [];
  const failed = [];
  for (const e of entries) {
    const pid = e.id;
    const c = e.commands || {};
    const installCmd = (c.install || {}).cmd;
    if (isPlaceholder(pid) || !installCmd) {
      console.log(`  - ${pid}: no install command available (skipped)`);
      failed.push(pid);
      continue;
    }
    console.log(`  Installing ${pid} ...`);
    const refreshCmd = (c.refresh || {}).cmd;
    if (refreshCmd) runCmd(refreshCmd); // state 'unavailable': try to refresh the catalog first
    const maCmd = (c.marketplace_add || {}).cmd;
    if (maCmd && !runMarketplaceAdd(maCmd)) { // state 'marketplace_missing': add first
      console.error(`  ! ${pid}: marketplace add failed - skipping install`);
      failed.push(pid);
      continue;
    }
    if (runCmd(installCmd).ok) ok.push(pid);
    else {
      console.error(`  ! ${pid}: install failed`);
      failed.push(pid);
    }
  }
  return { ok, failed };
}

// Run `npx skills add <id>` for each chosen skill. Returns {ok, failed} id lists.
export function installSkills(entries) {
  const ok = [];
  const failed = [];
  for (const e of entries) {
    const cmd = (e.install || {}).cmd;
    if (!cmd) {
      console.log(`  - ${e.id}: no install command (skipped)`);
      failed.push(e.id);
      continue;
    }
    console.log(`  Installing skill ${e.id} ...`);
    if (runCmd(cmd).ok) ok.push(e.id);
    else {
      console.error(`  ! ${e.id}: install failed`);
      failed.push(e.id);
    }
  }
  return { ok, failed };
}

// ---------- interactive checklist (readline numbered checklist; replaces the Python raw-
// keypress arrow-key TUI - see the module header note on the simplification) ----------
function askLine(q) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => {
      rl.close();
      resolve((a || "").trim());
    });
  });
}

// labels[]; preselected = Set of pre-checked indices; returns Promise<Set<number>|null>
// (null = cancelled via 'q'). Typing space/comma-separated numbers toggles them; Enter with no
// input confirms the current selection.
async function checklistSelect(labels, preselected, title) {
  const sel = new Set(preselected || []);
  if (labels.length === 0) return sel;
  if (title) console.log(title);
  for (;;) {
    labels.forEach((lab, i) => console.log(`  ${sel.has(i) ? "[x]" : "[ ]"} ${i + 1}. ${lab}`));
    const ans = await askLine("  (numbers to toggle, Enter to confirm, 'q' to cancel) > ");
    const low = ans.toLowerCase();
    if (low === "q") return null;
    if (low === "") return sel;
    let sawInvalid = false;
    for (const tok of ans.split(/[\s,]+/).filter(Boolean)) {
      const n = Number(tok);
      if (!Number.isInteger(n) || n < 1 || n > labels.length) {
        sawInvalid = true;
        continue;
      }
      const idx = n - 1;
      if (sel.has(idx)) sel.delete(idx);
      else sel.add(idx);
    }
    if (sawInvalid) console.log(`  (ignored out-of-range entries; valid range 1-${labels.length})`);
  }
}

const STATE_MARK = {
  installed: "[installed]",
  available: "[needs install]",
  marketplace_missing: "[needs install + marketplace]",
  unavailable: "[needs install (stale catalog?)]",
  placeholder: "[placeholder - can't install]",
};

function printPluginList(title, entries, present) {
  console.log(title);
  for (const e of entries) {
    const mark = present.includes(e.id) ? "  <-- enabled now" : "";
    console.log(`  - ${e.id}  ${STATE_MARK[e.state] || e.state}${mark}`);
    if (e.description) console.log(`      ${short(e.description)}`);
  }
}

export async function runInteractive(stacks, opts = {}) {
  const stackEntries = gather(stacks, opts)
    .entries.filter((e) => e.id)
    .map((e) => ({ ...e, group: "stack" }));
  const stackIds = new Set(stackEntries.map((e) => e.id));
  const known = knownPlugins(stackIds, opts);
  const settingsFile = opts.settingsFile || opts.settingsPath || join(opts.root || process.cwd(), ".claude", "settings.json");
  const present = presentEnabled(settingsFile);
  const autoenable = resolvedAutoenable(stacks, opts);

  console.log("Detected stack:", stacks.join(", "));
  printPluginList("\nStack plugins (detected for this project):", stackEntries, present);
  if (known.length) printPluginList("\nOther known plugins (optional - pick only if you want them):", known, present);
  const knownIds = new Set(known.map((e) => e.id));
  const foreign = present.filter((p) => !stackIds.has(p) && !knownIds.has(p));
  if (foreign.length) console.log("\n(also enabled, not declared by any template: " + foreign.join(", ") + ")");

  const selectable = [...stackEntries, ...known].filter((e) => e.state !== "placeholder");
  // Currently-enabled plugins that NO template declares (orphaned/stale, or user-added): make
  // them selectable and PRE-checked so they are preserved by default and only removed if the
  // user unchecks - never silently dropped just because no template mentions them anymore.
  const covered = new Set(selectable.map((e) => e.id));
  for (const pid of present) {
    if (!covered.has(pid)) {
      selectable.push({
        id: pid,
        state: "installed",
        group: "enabled",
        description: "(enabled; not declared by any template - orphaned/stale?)",
      });
    }
  }
  if (!selectable.length) {
    console.log("\nNothing to configure. No changes.");
    return 0;
  }

  const labels = selectable.map((e) => `[${e.group}] ${e.id}${e.state === "installed" ? "" : `  (${e.state})`}`);
  const preselect = new Set(
    selectable
      .map((e, i) => (present.includes(e.id) || (e.group === "stack" && autoenable.has(e.id)) ? i : -1))
      .filter((i) => i !== -1),
  );

  const sel = await checklistSelect(
    labels,
    preselect,
    "\nCheck plugins to be ACTIVE in this project (missing ones get installed on confirm):",
  );
  if (sel === null) {
    console.log("\nCancelled - no changes.");
    return 0;
  }
  const chosen = [...sel].sort((a, b) => a - b).map((i) => selectable[i]);
  const chosenIds = new Set(chosen.map((e) => e.id));

  const toInstall = chosen.filter((e) => e.state !== "installed");
  let installedNow = [];
  let installFailed = [];
  if (toInstall.length) {
    console.log("\nInstalling missing plugins:");
    ({ ok: installedNow, failed: installFailed } = installMissing(toInstall));
  }

  const enableIds = chosen.filter((e) => e.state === "installed" || installedNow.includes(e.id)).map((e) => e.id);
  const removeIds = present.filter((p) => !chosenIds.has(p));

  if (installFailed.length) {
    console.log("\n! Failed to install (NOT enabled): " + installFailed.join(", "));
    console.log("  Fix/install them by hand, then re-run  node ~/.claude/bin/init-stack.mjs -i");
  }

  if (enableIds.length || removeIds.length) apply(enableIds, removeIds, stacks, opts);
  else console.log("\nNo plugin changes to project settings.");

  await offerSkills(stacks, opts);
  return 0;
}

// Interactive skill step: show the stack's declared skills and offer to `npx skills add` the
// MISSING ones. None pre-checked (skills are opt-in). Skills have no enable/disable - install
// only.
export async function offerSkills(stacks, opts = {}) {
  const skills = gatherSkills(stacks, opts);
  if (!skills.length) return;
  const missing = skills.filter((e) => e.state !== "installed");
  console.log("\nStack skills:");
  for (const e of skills) console.log(`  - ${e.id}  [${e.state === "installed" ? "installed" : "available"}]`);
  if (!missing.length) return;
  const labels = missing.map((e) => e.id);
  const sel = await checklistSelect(labels, new Set(), "\nSkills to INSTALL now (npx skills add; none pre-checked):");
  if (!sel || !sel.size) return;
  const chosen = [...sel].sort((a, b) => a - b).map((i) => missing[i]);
  console.log("\nInstalling skills:");
  const { ok, failed } = installSkills(chosen);
  console.log("Installed:", ok.length ? ok.join(", ") : "(none)");
  if (failed.length) console.log("Failed:", failed.join(", "), "- verify the `npx skills add` slug and retry.");
}

// ---------- gsd-* agents: context-mode MCP tool sync (best-effort, cross-tool, no-op if the
// standalone gsd-core tool/script isn't present) ----------
function syncGsdContextModeAgents(configDirPath) {
  if (subprocessSkipped()) return;
  const script = join(configDirPath, "sync-gsd-context-mode-tool.mjs");
  if (!existsSync(script)) return;
  try {
    const r = spawnSync("node", [script], { encoding: "utf8", timeout: 10000 });
    const out = (r && r.stdout ? r.stdout : "").trim();
    if (out) console.log(out);
  } catch {
    /* best-effort - never blocks stack detection/setup */
  }
}

// ---------- CLI arg parsing ----------
// Collect tokens after `flag` until the next --flag.
export function grab(args, flag) {
  const i = args.indexOf(flag);
  if (i === -1) return [];
  const out = [];
  let j = i + 1;
  while (j < args.length && !args[j].startsWith("--")) {
    out.push(args[j]);
    j += 1;
  }
  return out;
}

// ---------- main ----------
function mainInner(argv, opts) {
  const configDirPath = opts.configDir || configDir();
  syncGsdContextModeAgents(configDirPath);
  const root = opts.root || process.cwd();
  // Derived from configDirPath (which may be a test override), NOT defaultTemplatesDir()/
  // defaultMarketplacesDir() - those two fall back to the REAL configDir() (env var/homedir)
  // independently of a configDir override passed in here, which would leak a test into the
  // real ~/.claude.
  const templatesDir = opts.templatesDir || join(configDirPath, "setting-templates");
  const marketplacesDir = opts.marketplacesDir || join(configDirPath, "plugins", "marketplaces");
  const settingsFile = opts.settingsFile || opts.settingsPath || join(root, ".claude", "settings.json");

  const installed = opts.installed || installedIds(configDirPath);
  const known = opts.known || knownMarketplaces(configDirPath);

  if (argv[0] === "--status") {
    if (argv.length < 2) {
      console.log('{"error":"--status needs a plugin id"}');
      return 2;
    }
    const pid = argv[1];
    const state = classify(pid, { installed, known, marketplacesDir });
    console.log(JSON.stringify({ id: pid, state }));
    return 0;
  }

  // §6.3 re-migration: refresh this project's .planning/config.json model_overrides to current
  // defaults (GSD projects only; silent no-op otherwise). Runs before stack work so it still
  // fires in a GSD project with no detectable code stack.
  migrateProjectModelConfigFile(root);

  const stacks = detect(root);
  if (!stacks.length) {
    console.log(`No known stack detected in ${root}`);
    return 0;
  }

  const maxPluginTier = opts.maxPluginTier !== undefined ? opts.maxPluginTier : readMaxPluginTier(configDirPath);
  const gatherOpts = { templatesDir, installed, known, marketplacesDir, maxPluginTier, settingsFile, root };

  if (argv[0] === "--apply-all") {
    const { entries } = gather(stacks, gatherOpts);
    const ids = entries.filter((e) => e.id && e.state !== "placeholder").map((e) => e.id);
    return apply(ids, [], stacks, gatherOpts);
  }

  if (argv.includes("-i") || argv.includes("--interactive")) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      return runInteractive(stacks, gatherOpts);
    }
    console.error(
      "Interactive mode needs a real terminal (TTY). Run it directly:\n  node ~/.claude/bin/init-stack.mjs -i",
    );
    // fall through to the text report below
  }

  if (argv.includes("--enable") || argv.includes("--remove")) {
    return apply(grab(argv, "--enable"), grab(argv, "--remove"), stacks, gatherOpts);
  }

  // default: report only
  const { entries } = gather(stacks, gatherOpts);
  const declared = new Set(entries.filter((e) => e.id).map((e) => e.id));
  const present = presentEnabled(settingsFile);
  const skills = gatherSkills(stacks, { templatesDir, installedSkills: installedSkillNames(root, configDirPath) });
  printReport(stacks, entries);
  printPresent(declared, present, gatherOpts);
  printSkills(skills);
  console.log("\n=== STATUS_JSON ===");
  console.log(
    JSON.stringify({
      stacks,
      plugins: entries,
      present: present.map((pid) => ({ id: pid, declared: declared.has(pid) })),
      skills,
    }),
  );
  return 0;
}

// CLI entry point. Mirrors init-stack.py:main's process-boundary behavior: loadJson throws a
// plain Error on invalid JSON (see loadJson's doc comment) rather than exiting the process
// itself, so this top-level boundary is what converts an uncaught error - sync OR from the
// interactive path's async tail - into exit code 2, matching Python's sys.exit(2).
export function main(argv = process.argv.slice(2), opts = {}) {
  try {
    const result = mainInner(argv, opts);
    if (result && typeof result.then === "function") {
      return result.catch((e) => {
        console.error(`! ${e.message}`);
        return 2;
      });
    }
    return result;
  } catch (e) {
    console.error(`! ${e.message}`);
    return 2;
  }
}

function isMainModule() {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  Promise.resolve(main()).then((code) => {
    process.exitCode = code ?? 0;
  });
}
