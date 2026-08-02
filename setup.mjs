#!/usr/bin/env node
/*
 * Cross-platform installer for the curated ~/.claude config.
 * Principle: unpack the archive anywhere, then run `node setup.mjs`. All copying into your
 * home ~/.claude is done here, on Linux / macOS / Windows alike.
 *
 * Two tiers of bundle files, handled differently on purpose:
 *   - MANAGED content (.mjs scripts, and any .md/text file that does NOT carry a
 *     `<!-- CURATED:NOEDIT -->` line) - this is config-as-code: the bundle is the source of
 *     truth, so it is always refreshed to the bundled version on every run, no prompt. This is
 *     what makes "drop in a fresh package, run setup, old files get the new data" actually true
 *     for rules-src/, skills/, README.md, etc. - not just for scripts.
 *   - CURATED content (any file carrying a `<!-- CURATED:NOEDIT -->` line, anywhere in the
 *     file, whitespace-tolerant - in practice your `~/.claude/CLAUDE.md`) - never silently
 *     touched. Shows a unified diff and asks per file:
 *       (m)erge   - default. Curated text can't be auto-merged - the diff shown IS the merge
 *                   output. Nothing is written: your file stays exactly as-is.
 *       (r)eplace - overwrites your file with the bundle version. NO backup is made - the diff
 *                   shown above is your only record of what was there; recover via git/your own
 *                   backups if you need the old content back.
 *       (s)kip    - same as merge here (your file stays as-is); kept as a distinct choice for
 *                   clarity/scripting (--skip-all).
 *   - JSON files (settings.json, setting-templates/*.json) are a third case: real additive deep
 *     merge (your values kept, missing keys/array items added) - conflict-checked like curated
 *     files since they routinely hold real per-machine values (marketplace ids, your model
 *     choice, etc.) that must never be silently clobbered. Same no-backup rule on (r)eplace.
 *
 * Flags (non-interactive / CI): --merge-all | --replace-all | --skip-all | --dry-run
 *   --uninstall-gsd is deliberately NOT one of the bulk flags: those govern THIS bundle's own
 *   files, while gsd-core is a separate product, so removing it always needs its own consent.
 * In a non-TTY without a bulk flag, curated/JSON conflicts default to MERGE (additive for JSON;
 * a no-op that leaves your file untouched for curated text - see above). This installer never
 * writes `.new` or `.bak` side files anywhere under ~/.claude - a diff is either shown for you
 * to act on, or the change is applied directly with no backup.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, readdirSync, rmSync, realpathSync, copyFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { validateConfigDir } from "./payload/bin/lib/config-dir-validate.mjs";
import { findGraphifyPython } from "./payload/bin/lib/graphify-python.mjs";
import { assembleClaudeMd } from "./payload/bin/lib/assemble-claude-md.mjs";
import { migrateSettingsModel } from "./payload/bin/lib/model-migration.mjs";
import { gsdCorePresent, buildGsdInventory, filterGsdHooks, gsdCoreInstallPlan } from "./payload/bin/lib/gsd-core-detect.mjs";
import { applyPlan, purgeRetention, trashRoot } from "./payload/bin/lib/claude-cleanup-lib.mjs";
import { resolveVariant, filterPartialHooks, loadVariants, profilesOf, globToRe } from "./variants.mjs";
import { buildPluginPlan, formatPlan, selectActions, describeAction } from "./plugin-reconcile.mjs";
import { knownMarketplaces } from "./payload/bin/init-stack.mjs";

// REPO_ROOT = where setup.mjs itself lives (installer meta: setup.mjs, README.md,
// settings.partial.json, RISK_REGISTER*.md, bootstrap.sh/ps1, .gitignore - never mirrored).
// SRC = REPO_ROOT/payload - everything that actually gets installed into ~/.claude
// (hooks/, skills/, rules-src/, commands/, setting-templates/, bin/, add-risk.mjs,
// graphify-sync-all.mjs). Kept as two separate constants (not one) because
// settings.partial.json below is read from REPO_ROOT, not SRC - it configures the installer,
// it isn't itself installed. NOTE: payload/claude-md/ is a build input, not a copied rel -
// ~/.claude/CLAUDE.md is assembled per-profile from those fragments (assemble-claude-md.mjs),
// not mirrored 1:1 like the rest of SRC - see the assemble+write step after the placeFile loop.
const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(REPO_ROOT, "payload");
const HOME = homedir();
// Config dir honors CLAUDE_CONFIG_DIR (the official Claude Code relocation env var); falls back
// to ~/.claude. This lets the whole bundle be installed into a relocated config dir without a
// symlink. Runtime scripts/hooks below use the same fallback.
const CDIR = process.env.CLAUDE_CONFIG_DIR || join(HOME, ".claude");
const HOOKS = join(CDIR, "hooks");
const SKILL = join(CDIR, "skills", "using-git-worktrees");
const SETTINGS = join(CDIR, "settings.json");
const MANIFEST = join(CDIR, "state", "bundle-manifest.json");
// Files that OLDER bundles shipped and this one no longer does - seeded so a user upgrading from a
// pre-manifest bundle still gets them pruned. ONLY list files this package exclusively owns (never
// a path another tool manages, e.g. graphify's own skills/graphify/).
const SEED_REMOVED = ["graphify-sync-all.ps1"];
const sha = (s) => createHash("sha256").update(String(s)).digest("hex");

const argv = new Set(process.argv.slice(2));
const BULK = argv.has("--replace-all") ? "replace"
          : argv.has("--merge-all")   ? "merge"
          : argv.has("--skip-all")    ? "skip" : null;
const DRY = argv.has("--dry-run");
// Scripted consent for removing a FOREIGN gsd-core install. Never derived from BULK: --replace-all
// /--merge-all say what to do with this bundle's own files, and stretching them over another
// product would be consent the user never gave.
const UNINSTALL_GSD = argv.has("--uninstall-gsd");
const VARIANT_ARG = (() => {
  const a = [...argv].find((x) => x.startsWith("--variant="));
  return a ? a.slice("--variant=".length) : null;
})();
// Non-interactive augment/trim toggles (OI-5): --configure-<group>=on|off, applied IN-PROCESS to
// whichever `optional` group the active profile declares (today: only base's "neo4j") - so an
// install/CI run never needs a manual follow-up command, just this one flag. Unknown group names
// are silently inert (see the per-group loop in main()), same "no throw on stale input" idiom as
// resolveVariant()'s own activeOptional handling.
const CONFIGURE_FLAGS = {};
for (const a of argv) {
  const m = /^--configure-([A-Za-z0-9_-]+)=(on|off)$/.exec(a);
  if (m) CONFIGURE_FLAGS[m[1]] = m[2] === "on";
}
const ENABLE_UPDATE_CHECK_FLAG = argv.has("--enable-update-check");
const INTERACTIVE = !BULK && process.stdin.isTTY;
const MD = argv.has("--md");
const COLOR = !MD && !argv.has("--no-color") && !process.env.NO_COLOR && process.stdout.isTTY;
// Resolved variant, hoisted to module scope so pruneStale()/settings-merge (later tasks) can see
// them without threading through function args. Assigned (not re-declared) inside main().
let VARIANT = null, V = null;

const log = (s = "") => process.stdout.write(s + "\n");
const safe = (fn) => { try { return fn(); } catch { return undefined; } };

/* ---------- doctor: validate registered hook script paths ---------- */
if (argv.has("--doctor")) {
  log(`Doctor: checking hooks registered in ${SETTINGS}`);
  let s = {};
  try { s = JSON.parse(readFileSync(SETTINGS, "utf8")); }
  catch { log("  settings.json missing or invalid JSON."); process.exit(1); }
  let bad = 0;
  for (const ev of Object.keys(s.hooks || {})) {
    for (const grp of s.hooks[ev]) {
      for (const h of (grp.hooks || [])) {
        const p = (h.args && h.args[0]) || null;
        if (!p) { log(`  ${ev}: shell-form (${h.command}) - cannot validate a path`); continue; }
        if (!existsSync(p)) { bad++; log(`  ${ev}: MISSING -> ${p}   <-- this triggers the loader error; re-run setup.mjs`); continue; }
        const chk = spawnSync(process.execPath, ["--check", p], { encoding: "utf8" });
        log(`  ${ev}: ${chk.status === 0 ? "OK     " : "BROKEN "} ${p}`);
        if (chk.status !== 0) bad++;
      }
    }
  }
  log(bad ? `\n${bad} problem(s). Run: node setup.mjs   (it now removes stale entries and rewrites correct paths).`
          : "\nAll registered hook scripts resolve and parse.");
  process.exit(bad ? 1 : 0);
}
const read = (p) => safe(() => readFileSync(p, "utf8"));
const MARKER = "CURATED:NOEDIT";
const MARKER_LINE = `<!-- ${MARKER} -->`;
// Whole-line match only (never a substring inside a longer line, so prose that just NAMES the
// marker can't self-trigger "curated" handling) - but lenient on whitespace: any line, any
// amount of spaces/tabs around the line and between the `<!--`/`-->` brackets and the marker
// text itself. Mirrors deny-curated-claude-md.mjs's own detection exactly - keep both in sync.
const MARKER_RE = /^<!--\s*CURATED:NOEDIT\s*-->$/;
const isCurated = (content) =>
  typeof content === "string" && content.split(/\r?\n/).some((line) => MARKER_RE.test(line.trim()));
const write = (p, c) => { if (DRY) return true; try { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); return true; } catch { return false; } };

/* ---------- deep additive JSON merge (existing values win; arrays unioned) ---------- */
const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
function deepMerge(base, add) {
  if (Array.isArray(base) && Array.isArray(add)) {
    const seen = new Set(base.map((v) => JSON.stringify(v)));
    const out = base.slice();
    for (const v of add) { const k = JSON.stringify(v); if (!seen.has(k)) { out.push(v); seen.add(k); } }
    return out;
  }
  if (isObj(base) && isObj(add)) {
    const out = { ...base };
    for (const k of Object.keys(add)) out[k] = k in base ? deepMerge(base[k], add[k]) : add[k];
    return out;
  }
  return base; // scalar (or type) conflict: keep existing
}

/* ---------- unified diff (no external tools): hunks + line numbers + color/markdown ---------- */
function diffOps(a, b) {
  const n = a.length, m = b.length;
  if (n * m > 4_000_000) return null; // too large to diff cheaply
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push([" ", a[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push(["-", a[i++]]);
    else ops.push(["+", b[j++]]);
  }
  while (i < n) ops.push(["-", a[i++]]);
  while (j < m) ops.push(["+", b[j++]]);
  return ops;
}
function buildHunks(aStr, bStr, ctx = 3) {
  const ops = diffOps(aStr.split("\n"), bStr.split("\n"));
  if (ops === null) return null;
  const meta = []; let oldNo = 1, newNo = 1;
  for (const [t, line] of ops) {
    meta.push({ t, line, oldNo, newNo });
    if (t === " ") { oldNo++; newNo++; } else if (t === "-") oldNo++; else newNo++;
  }
  const keep = new Array(ops.length).fill(false);
  for (let k = 0; k < ops.length; k++) if (ops[k][0] !== " ") for (let c = -ctx; c <= ctx; c++) if (meta[k + c]) keep[k + c] = true;
  const hunks = []; let k = 0;
  while (k < ops.length) {
    if (!keep[k]) { k++; continue; }
    const s = k; while (k < ops.length && keep[k]) k++;
    const seg = meta.slice(s, k);
    const oldStart = (seg.find(x => x.t !== "+") || seg[0]).oldNo;
    const newStart = (seg.find(x => x.t !== "-") || seg[0]).newNo;
    const oldCount = seg.filter(x => x.t !== "+").length;
    const newCount = seg.filter(x => x.t !== "-").length;
    hunks.push({ header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, rows: seg });
  }
  return hunks;
}
const ANSI = { add: "\x1b[32m", del: "\x1b[31m", hdr: "\x1b[36m", num: "\x1b[2m", off: "\x1b[0m" };
function renderDiff(aStr, bStr, ctx = 3) {
  const hunks = buildHunks(aStr, bStr, ctx);
  if (hunks === null) return "    (files differ; too large to render a diff)";
  if (hunks.length === 0) return "    (no textual differences)";
  // Markdown mode: a fenced ```diff block (renderers colorize +/-/@@). No line-number gutter so
  // the diff syntax highlighter keeps working.
  if (MD) {
    const body = hunks.flatMap(h => [h.header, ...h.rows.map(r => r.t + r.line)]).join("\n");
    return "```diff\n" + body + "\n```";
  }
  // Terminal mode: line numbers in a dim gutter + optional ANSI colors.
  const c = COLOR ? ANSI : { add: "", del: "", hdr: "", num: "", off: "" };
  const out = [];
  for (const h of hunks) {
    out.push("    " + c.hdr + h.header + c.off);
    for (const r of h.rows) {
      const oldN = r.t === "+" ? "    " : String(r.oldNo).padStart(4);
      const newN = r.t === "-" ? "    " : String(r.newNo).padStart(4);
      const gutter = c.num + oldN + " " + newN + c.off + " ";
      const col = r.t === "+" ? c.add : r.t === "-" ? c.del : "";
      out.push("    " + gutter + col + r.t + " " + r.line + (col ? c.off : ""));
    }
  }
  return out.join("\n");
}

/* ---------- interactive prompt ---------- */
function ask(q) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => { rl.close(); res((a || "").trim().toLowerCase()); });
  });
}
async function choose(label, fallback = "skip") {
  if (BULK) return BULK;
  if (!INTERACTIVE) { log(`    non-interactive -> ${fallback} (${label})`); return fallback; }
  let a = "";
  while (!["m", "r", "s"].includes(a[0])) a = await ask(`    choose (m)erge / (r)eplace / (s)kip > `);
  return a[0] === "m" ? "merge" : a[0] === "r" ? "replace" : "skip";
}

/* ---------- offer to relocate the config dir via CLAUDE_CONFIG_DIR ---------- */
// Case-preserving prompt — ask() lowercases its answer, which would corrupt a filesystem path.
function askRaw(q) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => { rl.close(); res((a || "").trim()); });
  });
}

// CLAUDE_CONFIG_DIR is the (undocumented, CLI-only) env var that relocates the user config dir.
// We only READ it elsewhere; this step lets the user SET/change it. Default offered = the target
// of an existing ~/.claude symlink, if any. The symlink is deliberately NOT removed (a
// filesystem-level fallback that also covers the VS Code extension, which ignores the env var,
// and any tool that still hardcodes ~/.claude).
async function proposeConfigDir() {
  const current = process.env.CLAUDE_CONFIG_DIR || "";
  const home = join(HOME, ".claude");
  let symlinkTarget = "";
  try { const rp = realpathSync(home); if (rp !== home) symlinkTarget = rp; } catch { /* absent */ }

  log("");
  log("Config dir relocation (CLAUDE_CONFIG_DIR):");
  log(`  current : ${current || "(unset - using ~/.claude)"}`);
  if (symlinkTarget) log(`  ~/.claude is a symlink -> ${symlinkTarget}`);

  if (!INTERACTIVE) {
    if (!current) log(`  To relocate (CLI): setx CLAUDE_CONFIG_DIR "<dir>" (Windows), then restart + re-run.`);
    return;
  }

  // Enter = do NOT set/change (safe default). Setting is always an explicit action: type a path,
  // or 'y' to accept the suggested path. This avoids silently writing the symlink target on Enter.
  const suggestion = current || symlinkTarget || "";
  if (suggestion) log(`  suggested path: ${suggestion}`);
  log(`  Enter a path to set CLAUDE_CONFIG_DIR${suggestion ? ", or 'y' to use the suggested path" : ""},`);
  log(`  or press Enter to NOT set it (leave unchanged).`);
  let target = "";
  for (;;) {
    const ans = await askRaw("  > ");
    if (!ans) { log("  left unchanged (CLAUDE_CONFIG_DIR not set)."); return; }
    const cand = (suggestion && (ans === "y" || ans === "Y")) ? suggestion : ans;
    const v = validateConfigDir(cand);
    if (v.ok) { target = v.norm; break; }               // v.norm has normalized (fixed) slashes
    log(`  ! ${v.error} - try again, or press Enter to skip.`);
  }
  if (target === current) { log(`  already set to ${target} (no change).`); return; }

  if (platform() === "win32") {
    const r = spawnSync("setx", ["CLAUDE_CONFIG_DIR", target], { encoding: "utf8" });
    if (r.status === 0) log(`  set (persistent, user scope): CLAUDE_CONFIG_DIR=${target}`);
    else { log(`  could not run setx (${((r.stderr || (r.error && r.error.message)) || "").trim()}). Set it manually:`); log(`    setx CLAUDE_CONFIG_DIR "${target}"`); }
  } else {
    log(`  add to your shell profile (~/.bashrc, ~/.zshenv, ...):`);
    log(`    export CLAUDE_CONFIG_DIR="${target}"`);
  }

  if (symlinkTarget) {
    log(`  Keeping the ~/.claude symlink - a filesystem-level fallback that also covers the VS Code`);
    log(`  extension (which ignores CLAUDE_CONFIG_DIR) and any tool that hardcodes ~/.claude.`);
  }
  log(`  NOTE: the env var is read at launch - restart your terminal AND re-run 'node setup.mjs' to`);
  log(`  deploy into ${target}. This run still deploys into ${CDIR}. Marketplace plugins may need`);
  log(`  reinstalling under the new dir (their registry stores absolute paths).`);
}

/* ---------- copy any bundle file into ~/.claude with conflict resolution ---------- */
// Bundle-meta that must NOT be copied into ~/.claude (only matched at the archive root):
const META = new Set(["setup.mjs", "README.md", "settings.partial.json", "RISK_REGISTER.snippet.md", "RISK_REGISTER.md", "settings.json", "bootstrap.sh", "bootstrap.ps1"]);
const copiedScripts = [];
function* walkBundle(dir, rel = "") {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;             // skip .git, .DS_Store, etc. at any level
    if (e.name === "__pycache__" || e.name.endsWith(".pyc")) continue;  // never ship Python build artifacts
    if (rel === "" && META.has(e.name)) continue;     // skip installer-meta at the archive root
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) yield* walkBundle(join(dir, e.name), childRel);
    else yield childRel;
  }
}

const summary = [];
const manifestNow = [];   // {rel, hash} for every file THIS bundle ships - persisted for next run's prune
async function placeFile(rel, srcPath) {
  const parts = rel.split("/");
  const src = srcPath || join(SRC, ...parts);
  const dst = join(CDIR, ...parts);
  const srcContent = read(src);
  if (srcContent === undefined) { summary.push(`MISSING in bundle: ${rel}`); return; }
  manifestNow.push({ rel, hash: sha(srcContent) });

  // setting-templates/**: per its own README, this tree is pure bundle content (stack template
  // definitions authored by this repo) - never hand-edited by an end user, unlike settings.json
  // which legitimately holds per-machine values. So it skips the JSON-merge tier entirely and is
  // always refreshed to the bundled version, same as a script - a template fix (e.g. a marketplace
  // URL) always takes effect on the next run instead of being kept-as-is by additive merge.
  if (rel.startsWith("setting-templates/")) {
    if (!existsSync(dst)) { if (write(dst, srcContent)) summary.push(`created  ${dst}`); return; }
    const cur = read(dst);
    if (cur === srcContent) { summary.push(`unchanged ${dst}`); return; }
    if (write(dst, srcContent)) summary.push(`updated  ${dst}`);
    return;
  }

  if (!existsSync(dst)) {
    if (write(dst, srcContent)) { summary.push(`created  ${dst}`); if (dst.endsWith(".mjs")) copiedScripts.push(dst); }
    return;
  }
  const cur = read(dst);
  if (cur === srcContent) { summary.push(`unchanged ${dst}`); return; }

  // Scripts (.mjs) are managed code: always refreshed to the bundled version, no prompt.
  if (dst.toLowerCase().endsWith(".mjs")) {
    if (write(dst, srcContent)) { summary.push(`updated  ${dst}`); copiedScripts.push(dst); }
    return;
  }

  // JSON files: real deep additive merge (your values kept, missing keys/array items added).
  if (dst.toLowerCase().endsWith(".json")) {
    const baseObj = safe(() => JSON.parse(cur));
    const addObj = safe(() => JSON.parse(srcContent));
    if (baseObj !== undefined && addObj !== undefined) {
      const mergedStr = JSON.stringify(deepMerge(baseObj, addObj), null, 2);
      const curStr = JSON.stringify(baseObj, null, 2);
      if (curStr === mergedStr) { summary.push(`unchanged ${dst} (already a superset)`); return; }
      log(`\n~ conflict (json): ${dst}`);
      log("    (merge = deep additive: your values kept, missing keys/array items added)");
      log(renderDiff(curStr, mergedStr));
      const act = await choose(dst, "merge");
      if (act === "skip") { summary.push(`skipped  ${dst}`); return; }
      if (act === "replace") {
        if (write(dst, srcContent)) summary.push(`replaced ${dst} (no backup - see diff above if you need the old content)`);
        return;
      }
      if (write(dst, mergedStr + "\n")) summary.push(`merged   ${dst} (deep additive)`);
      return;
    }
    // not valid JSON on one side -> fall through to text handling
  }

  // Other non-script files (.md, text): two tiers.
  //   - NOT curated -> managed content, same as scripts: always refresh, no prompt. This is what
  //     makes rules/, skills/, README.md etc. actually pick up bundle updates on a plain re-run.
  if (!isCurated(cur)) {
    if (write(dst, srcContent)) { summary.push(`updated  ${dst}`); }
    return;
  }
  //   - Curated (marker present in the CURRENT file) -> never silently touched. Show diff, ask.
  log(`\n~ conflict (curated): ${dst}`);
  log(renderDiff(cur, srcContent));
  const act = await choose(dst, "merge");
  if (act === "replace") {
    if (write(dst, srcContent)) summary.push(`replaced ${dst} (no backup - see diff above if you need the old content)`);
    return;
  }
  // "skip" AND the default "merge" both land here: curated text can't be auto-merged, and no
  // side file is ever written for it (no `<name>.new`) - the diff printed above IS the merge
  // output. `dst` is left byte-for-byte untouched; apply it by hand, or re-run with
  // --replace-all to accept the bundle version outright (see "replace" above for the backup).
  summary.push(`${act === "skip" ? "skipped" : "kept (see diff above)"} ${dst}`);
}

/* ---------- prune: remove files an OLDER bundle installed that this one no longer ships ----------
 * Safe-gated per the "delete only if guaranteed unused" rule: a candidate is removed only if it is
 * (a) not curated, (b) not referenced by any name in the CURRENT bundle, and (c) unchanged since we
 * installed it (its hash still matches the previous manifest). Anything failing a gate is kept and
 * reported. Default: list + confirm (non-TTY lists only; --skip-all skips; --replace/--merge-all
 * imply cleanup). */
function bundleAllText() {
  let t = "";
  for (const rel of V.rels) t += "\n" + (read(V.srcFor(rel)) || "");
  return t;
}
/* ---------- setting-templates/: full folder overwrite (delete anything not in the bundle) ----------
 * This directory is pure bundle content (see payload/setting-templates/README.md) - no per-machine
 * values, never hand-edited - so unlike pruneStale() below it needs none of that function's safety
 * gates (curated? still referenced by name in the bundle? modified since install?). Those gates
 * actively misfire here anyway: every README.md under setting-templates/ mentions "_base.json" in
 * prose, so the generic "still referenced in bundle" text-search would forever protect a stale
 * _base.json from ever being pruned. Mirror semantics instead: destination becomes an exact copy. */
function walkDir(dir, rel = "") {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walkDir(join(dir, e.name), childRel));
    else out.push(childRel);
  }
  return out;
}
/* ---------- guided augment/trim (OI-5): per-profile `optional` groups ----------
 * Generalizes the old neo4j-only opt-in into a loop over ANY profile's `optional` map (today:
 * only base declares one, "neo4j"). fsGroupInstalled() is the ONE fallback path - it's the same
 * "does a file from this group already exist on disk?" idiom the old neo4j-only code used,
 * kept ONLY for manifests written before `activeOptional` existed. Once a manifest carries
 * `activeOptional`, that array is authoritative and this is never consulted. */
function fsGroupInstalled(globs) {
  const res = (globs || []).map(globToRe);
  if (!res.length) return false;
  return walkDir(CDIR).some((rel) => res.some((re) => re.test(rel)));
}
// A group toggled OFF this run (was active last run, per manifest or the fs fallback; not active
// now) is pruned directly here - deliberately NOT routed through pruneStale()'s BULK/interactive
// gate below, because `--configure-<group>=off` (or an explicit interactive "n") is already
// unambiguous consent to remove exactly those files; no second confirmation needed. Still safe-
// gated the same way pruneStale() is: never touches a curated file, never touches a file modified
// since install (a real edit wins over the toggle).
function pruneDroppedOptional(groups, def, oldByRel) {
  const globs = (groups || []).flatMap((g) => (def.optional && def.optional[g]) || []);
  if (!globs.length) return;
  const res = globs.map(globToRe);
  const matches = walkDir(CDIR).filter((rel) => res.some((re) => re.test(rel)));
  if (!matches.length) return;
  log(`\n--- augment: optional group(s) turned off [${groups.join(", ")}] - pruning their files ---`);
  for (const rel of matches) {
    const dst = join(CDIR, ...rel.split("/"));
    const cur = read(dst);
    if (typeof cur === "string" && isCurated(cur)) { log(`  kept (curated) ${dst}`); summary.push(`kept (curated) ${dst}`); continue; }
    const oldHash = oldByRel.get(rel);
    if (oldHash && cur !== undefined && sha(cur) !== oldHash) { log(`  kept (modified since install) ${dst}`); summary.push(`kept (modified since install) ${dst}`); continue; }
    if (DRY) { log(`  would-prune ${dst}`); summary.push(`would-prune ${dst} (optional group off)`); continue; }
    try { rmSync(dst, { force: true }); log(`  pruned   ${dst}`); summary.push(`pruned   ${dst} (optional group off)`); }
    catch { summary.push(`prune-failed ${dst}`); }
  }
}
function overwriteTemplatesDir() {
  const bundleRels = new Set(walkDir(join(SRC, "setting-templates")));
  const destDir = join(CDIR, "setting-templates");
  const staleRels = walkDir(destDir).filter((r) => !bundleRels.has(r));
  if (!staleRels.length) return;
  log("\n--- setting-templates/: stale files removed (full overwrite; pure bundle content, no gating) ---");
  for (const r of staleRels) {
    const dst = join(destDir, ...r.split("/"));
    log("  " + dst);
    if (DRY) { summary.push(`would-prune ${dst}`); continue; }
    try { rmSync(dst, { force: true }); summary.push(`pruned   ${dst}`); }
    catch { summary.push(`prune-failed ${dst}`); }
  }
}

/* ---------- one-time migration: ~/.claude/rules -> ~/.claude/rules-src ---------- */
// Rules moved out of ~/.claude/rules/ (auto-loaded by Claude Code with no off switch) into
// rules-src/ (compiled into per-project .claude/stack-rules.md - see payload/rules-src/README.md).
// Old bundle-owned copies left in ~/.claude/rules/ would keep auto-loading and double every
// rule, so remove each file whose relative path exists in the bundle's rules-src/, keep
// user-authored files, and drop directories that end up empty. pruneStale() can't cover this:
// its "still referenced in bundle" name gate misfires here (the rules-src README lists every
// rule filename in prose).
function migrateRulesDir() {
  const oldDir = join(CDIR, "rules");
  if (!existsSync(oldDir)) return;
  const bundleRels = new Set(walkDir(join(SRC, "rules-src")));
  for (const rel of walkDir(oldDir)) {
    if (!bundleRels.has(rel)) continue; // user-authored: keep (it still auto-loads)
    const dst = join(oldDir, ...rel.split("/"));
    if (DRY) { summary.push(`would-prune ${dst} (moved to rules-src)`); continue; }
    try { rmSync(dst, { force: true }); summary.push(`pruned   ${dst} (moved to rules-src)`); }
    catch { summary.push(`prune-failed ${dst}`); }
  }
  if (DRY) return;
  // Remove now-empty directories bottom-up (raw readdir, so hidden leftovers block deletion
  // rather than being silently destroyed), then report anything user-authored that remains.
  const rmEmptyDirs = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true }))
      if (e.isDirectory()) rmEmptyDirs(join(dir, e.name));
    if (!readdirSync(dir).length) { rmSync(dir, { recursive: true, force: true }); return true; }
    return false;
  };
  if (safe(() => rmEmptyDirs(oldDir))) summary.push(`pruned   ${oldDir} (empty after migration)`);
  else if (existsSync(oldDir))
    log(`\nNOTE: ~/.claude/rules still holds user files not from this bundle - they keep ` +
      `auto-loading path-scoped; move them into ~/.claude/rules-src by hand if that's not intended.`);
}

async function pruneStale() {
  const oldManifest = safe(() => JSON.parse(readFileSync(MANIFEST, "utf8"))) || { files: [] };
  const currentRels = new Set(manifestNow.map((f) => f.rel));
  const oldByRel = new Map((oldManifest.files || []).map((f) => [f.rel, f.hash]));
  const candidates = new Set();
  for (const rel of oldByRel.keys()) if (!currentRels.has(rel)) candidates.add(rel);
  for (const rel of SEED_REMOVED) if (!currentRels.has(rel)) candidates.add(rel);
  if (VARIANT !== "full") candidates.add("gsd-defaults.partial.json"); // full-only mirror, never manifest-tracked
  if (!candidates.size) return [];

  const allText = bundleAllText();
  const del = [], kept = [];
  for (const rel of candidates) {
    const dst = join(CDIR, ...rel.split("/"));
    if (!existsSync(dst)) continue;                                  // already gone
    const cur = read(dst);
    if (typeof cur === "string" && isCurated(cur)) { kept.push([rel, "curated"]); continue; }
    const variantExcluded = V.excludedSet.has(rel) || (rel === "gsd-defaults.partial.json" && VARIANT !== "full");
    if (!variantExcluded && allText.includes(rel.split("/").pop())) { kept.push([rel, "still referenced in bundle"]); continue; }
    const oldHash = oldByRel.get(rel);
    if (oldHash && cur !== undefined && sha(cur) !== oldHash) { kept.push([rel, "modified since install"]); continue; }
    del.push({ rel, dst });
  }
  // Every rel this function took responsibility for, removed or not. detectForeignGsdCore()
  // subtracts it, so a file pruneStale() decided to KEEP (curated, still referenced, edited since
  // install) or that the user declined to prune cannot then be swept up as someone else's.
  const considered = [...del.map((d) => d.rel), ...kept.map(([rel]) => rel)];
  if (kept.length) { log("\n--- stale but KEPT (not safe to auto-remove) ---"); for (const [rel, why] of kept) log(`  ${rel} (${why})`); }
  if (!del.length) return considered;

  log("\n--- stale files no longer in the bundle ---");
  for (const d of del) log("  " + d.dst);
  let go = false;
  if (DRY) log("  (dry-run: not removed)");
  else if (BULK === "skip") log("  (--skip-all: not removed)");
  else if (BULK) go = true;                                          // --merge-all / --replace-all imply cleanup
  else if (INTERACTIVE) { const a = await ask("    remove these stale files? (y/N) > "); go = a[0] === "y"; }
  else log("  (non-interactive: not removed - re-run in a terminal, or pass --replace-all, to prune)");
  if (go) for (const d of del) {
    try { rmSync(d.dst, { recursive: true, force: true }); summary.push(`pruned   ${d.dst}`); }
    catch { summary.push(`prune-failed ${d.dst}`); }
  }
  return considered;
}

/* The settings.json diff and the stale prune are two independent decisions, so answering (s) to the
 * diff and yes to the prune repoints nothing and deletes the file the old command named - a blank
 * statusline with no visible cause. Report it: silently rewriting settings the user chose to skip
 * would be the worse answer, and naming the re-run that repairs it is the whole fix. */
function warnStatuslineNamesMissingFile() {
  const cmd = safe(() => JSON.parse(readFileSync(SETTINGS, "utf8")).statusLine.command);
  if (typeof cmd !== "string") return;
  const fwd = cmd.replace(/\\/g, "/");
  const under = CDIR.replace(/\\/g, "/").replace(/\/+$/, "") + "/";
  // Quoted first (the shape every generated command uses, and the only one safe for a path with a
  // space in it), bare whitespace-split as a fallback for a hand-written unquoted command.
  const tokens = [...[...fwd.matchAll(/"([^"]+)"/g)].map((m) => m[1]), ...fwd.split(/\s+/)];
  const missing = tokens.find((t) => t.startsWith(under) && !existsSync(t));
  if (!missing) return;
  log(`\nWARNING: settings.json statusLine.command names a file that is not on disk:`);
  log(`  ${missing}`);
  log(`  The statusline will render an empty line until the command is repointed. Re-run`);
  log(`  'node setup.mjs' and answer (r) or (m) at the settings.json diff - or pass --replace-all /`);
  log(`  --merge-all - to point it at hooks/statusline.mjs.`);
}

/* ---------- foreign gsd-core: report it, and offer a reversible removal (base/lite only) ----------
 * gsd-core is a separate product installed by `npx @opengsd/gsd-core`, not from a marketplace and
 * not by this bundle beyond the offer below. On base/lite it has
 * no place here, but nothing about that justifies deleting it: every removal is a MOVE into the
 * same .cleanup-trash batch /claude-cleanup already restores and expires after 7 days, and the
 * decision is always the user's (default no; a bulk flag or a non-TTY run reports and stops).
 * Reach is bounded by buildGsdInventory, which only enumerates paths under CDIR - so ~/.gsd/ and
 * every project's .planning/ are out of range by construction. What it must never claim is a file
 * THIS bundle owns, which is three sets, not one: what this run ships (manifestNow), what any
 * profile can ship (a base install that was full yesterday still has full's gsd-* files on disk,
 * and the manifest that named them is overwritten later in main()), and whatever pruneStale() just
 * took responsibility for. Without the second and third, a full -> base downgrade whose stale
 * prune was declined would move ~12 of this bundle's own paths under a banner reading "not part of
 * this bundle" - consent obtained under a false description. */
/* ---------- full without gsd-core: offer the npx install ----------
 * The mirror image of detectForeignGsdCore. full ships the GSD machinery - agents, hooks, rules -
 * and all of it is inert without the tool those files talk to. gsd-core is an npx package, never a
 * marketplace plugin, so presence is a filesystem question (gsd-core/VERSION), never an
 * enabledPlugins entry. Consent is explicit and per-run: the command is printed either way, and
 * only a TTY plus a "y" runs it. */
async function offerGsdCoreInstall() {
  const plan = gsdCoreInstallPlan({
    variant: VARIANT, present: gsdCorePresent(CDIR), interactive: INTERACTIVE,
    configDir: CDIR, defaultConfigDir: join(HOME, ".claude"),
  });
  if (plan.action === "none" || DRY) return;
  log(`\ngsd-core is not installed, and the full profile ships its agents, hooks and rules:`);
  log(`  ${plan.command}`);
  if (plan.action === "print") { log("  Non-interactive run - nothing was installed. Run it yourself."); return; }
  if ((await ask("  Install it now? (y/N) > "))[0] !== "y") { log("  Skipped."); return; }
  const r = spawnSync(plan.command, { shell: true, stdio: "inherit" });
  if (r.status === 0 && gsdCorePresent(CDIR)) {
    const v = safe(() => readFileSync(join(CDIR, "gsd-core", "VERSION"), "utf8").trim()) || "unknown";
    summary.push(`installed gsd-core ${v} (npx)`);
    log(`  gsd-core ${v} installed.`);
  } else {
    log(`  Install did not complete (exit ${r.status}). Nothing else changed.`);
  }
}

async function detectForeignGsdCore(prunedRels = []) {
  if (VARIANT === "full" || !gsdCorePresent(CDIR)) return;
  const everOurs = safe(() => Object.keys(profilesOf(loadVariants(REPO_ROOT)))
    .flatMap((p) => resolveVariant({ repoRoot: REPO_ROOT, variant: p }).rels));
  // Fail-safe, the same shape as pluginPruneCandidates' "never prune when we can't tell what's
  // active": if the set of files this bundle can own is unknown, every gsd-* path on disk looks
  // foreign. Say so and remove nothing, rather than lose the protection silently.
  if (!everOurs) {
    log(`\ngsd-core is installed here, but this bundle's own file list could not be resolved`);
    log(`  - skipping the removal offer entirely rather than risk claiming our own files.`);
    return;
  }
  const { items, categories, totalBytes } = buildGsdInventory({
    dir: CDIR,
    manifestRels: [...manifestNow.map((f) => f.rel), ...everOurs, ...prunedRels],
  });
  if (!items.length) return;

  const version = safe(() => readFileSync(join(CDIR, "gsd-core", "VERSION"), "utf8").trim()) || "unknown";
  log(`\ngsd-core ${version} is installed here and is not part of this bundle:`);
  for (const c of categories) log(`  ${c.name.padEnd(10)} ${String(c.count).padStart(3)}  ${Math.round(c.bytes / 1024)} KB`);
  log(`  total ${Math.round(totalBytes / 1024)} KB`);
  log(`  ~/.gsd/ and every project's .planning/ are never touched.`);

  // BULK counts as non-interactive here exactly as it does everywhere else in this file
  // (INTERACTIVE = !BULK && isTTY): a bulk flag must never ask, and must never consent either, so
  // the two meet at report-only. Without the BULK arm, `--replace-all` in a terminal stops on a
  // question and a CI runner that allocates a PTY hangs on it with no timeout.
  if ((!process.stdin.isTTY || BULK) && !UNINSTALL_GSD) {
    log(`  Reporting only (non-interactive). Run with --uninstall-gsd to remove it.`);
    return;
  }
  if (DRY) { log(`  [dry-run] would move ${items.length} path(s)`); return; }
  if (!UNINSTALL_GSD && (await ask("  Move all of it to the cleanup trash? (y/N) > "))[0] !== "y") return;

  const fwd = (p) => p.replace(/\\/g, "/");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const batchDir = join(trashRoot(CDIR), ts);
  mkdirSync(batchDir, { recursive: true });
  // Printed before any move, so a crash further down still leaves the user the one string the
  // rollback needs.
  log(`  trash batch: ${fwd(batchDir)}`);
  // Written BEFORE anything is edited, and into the batch itself so it ages out with it. This is a
  // copy, not a moved file, which is why restoreBatch cannot put it back - see the rollback below.
  const backup = join(batchDir, "settings.json.pre-gsd-uninstall");
  if (existsSync(SETTINGS)) copyFileSync(SETTINGS, backup);

  const res = applyPlan({ dir: CDIR, items, nowMs: Date.now(), ts });
  log(`  moved ${res.moved} path(s), ${Math.round(res.bytes / 1024)} KB, skipped ${res.skipped}`);

  if (existsSync(SETTINGS)) {
    const curSettings = safe(() => JSON.parse(readFileSync(SETTINGS, "utf8")));
    // safe() twice, because this runs AFTER applyPlan: filterGsdHooks throws on a malformed hooks
    // shape (a null entry, a non-array event value, a non-object `hooks`), and a throw here would
    // leave the files in the trash batch with the rollback below never printed.
    const filtered = curSettings && safe(() => filterGsdHooks(curSettings));
    if (filtered && filtered.removed.length) {
      const { settings, removed } = filtered;
      if (write(SETTINGS, JSON.stringify(settings, null, 2) + "\n")) {
        summary.push(`updated  ${SETTINGS} (${removed.length} gsd-* hook registration(s) removed)`);
        log(`  removed ${removed.length} gsd-* hook registration(s) from settings.json`);
      } else {
        log(`  COULD NOT rewrite settings.json - ${removed.length} gsd-* hook registration(s) still point at moved files; roll back below or edit by hand`);
      }
    }
  }

  // Order is load-bearing: a clean restoreBatch deletes the whole batch directory, backup included,
  // so the settings copy has to be taken back first. It is also deliberately manual - replaying it
  // automatically would revert every unrelated settings edit made since. And claude-cleanup.mjs
  // resolves its target from CLAUDE_CONFIG_DIR, never from its own location, so under a relocated
  // config dir the variable has to travel with the command or it restores from ~/.claude and
  // reports "Restored 0" as though there were nothing to restore.
  // Carrying it takes two labelled lines, not one: `VAR="x" cmd` is a POSIX env prefix, and
  // PowerShell reads it as a command NAMED `VAR=x` and dies with "is not recognized" - on the one
  // platform where most users will paste this. The `cp` above needs no such split (PowerShell
  // aliases it to Copy-Item) and neither does the default config dir, whose command carries no
  // environment at all.
  const relocated = CDIR !== join(HOME, ".claude");
  const restore = `node "${fwd(join(CDIR, "bin", "claude-cleanup.mjs"))}" restore --ts ${ts}`;
  log(`  Rollback within 7 days, in this order:`);
  log(`    cp "${fwd(backup)}" "${fwd(SETTINGS)}"`);
  if (!relocated) log(`    ${restore}`);
  else {
    log(`    bash:       CLAUDE_CONFIG_DIR="${fwd(CDIR)}" ${restore}`);
    log(`    PowerShell: $env:CLAUDE_CONFIG_DIR="${fwd(CDIR)}"; ${restore}`);
  }
  purgeRetention({ dir: CDIR, nowMs: Date.now() });
}

// Best-effort: resolve the commit we just installed, for the update-check hook's baseline.
// Prefers a local git checkout (REPO_ROOT has .git -> exact, no network); falls back to asking
// GitHub what master currently points at (covers the bootstrap-tarball install path, where
// GitHub's archive endpoint strips .git entirely). Any failure (offline, rate-limited, blocked)
// just leaves installedSha unset - the update-check hook has no baseline yet and stays silent
// until a later run succeeds. Never throws, never blocks the install on network access.
async function resolveInstalledSha() {
  const g = spawnSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (!g.error && g.status === 0) {
    const sha = (g.stdout || "").trim();
    if (/^[0-9a-f]{40}$/.test(sha)) return sha;
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch("https://api.github.com/repos/axazolai/claude-config/commits/master",
      { signal: ctrl.signal, headers: { "User-Agent": "claude-config-setup" } });
    clearTimeout(t);
    if (res.ok) {
      const j = await res.json();
      if (j && typeof j.sha === "string") return j.sha;
    }
  } catch { /* offline / rate-limited / blocked - fine, resolved on a later run instead */ }
  return undefined;
}

async function main() {
  await proposeConfigDir();

  // ---------- variant selection (spec § 9) ----------
  const oldManifestEarly = safe(() => JSON.parse(readFileSync(MANIFEST, "utf8")));
  const installedVariant = oldManifestEarly ? (oldManifestEarly.profile || oldManifestEarly.variant || "full") : null;
  const known = Object.keys(profilesOf(loadVariants(REPO_ROOT)));
  VARIANT = VARIANT_ARG;
  if (VARIANT && !known.includes(VARIANT)) {
    log(`Unknown --variant=${VARIANT}. Known: ${known.join(", ")}`);
    process.exit(1);
  }
  if (!VARIANT && INTERACTIVE) {
    const def = installedVariant || "full";
    const a = (await ask(`  bundle profile [full/base/lite] (Enter = ${def}) > `)).trim().toLowerCase();
    VARIANT = known.includes(a) ? a : def;
  }
  if (!VARIANT) VARIANT = installedVariant || "full";   // non-TTY: detected, or full on fresh

  // ---------- guided per-profile augment/trim (OI-5): one guided flow, never a manual chain ----------
  // Any profile's `optional` groups (today: only base's "neo4j") are toggled HERE, in-process,
  // BEFORE resolveVariant - either via --configure-<group>=on|off (non-interactive/CI, e.g. the
  // e2e suite - this is the key OI-5 path: an install applies the toggle itself, it never tells
  // the user to go run a follow-up command) or, in a TTY, one y/n prompt per group. The manifest's
  // `activeOptional` is the primary source for "what was active last run" (read back below as
  // `prevActiveOptional`, default for both the non-TTY case and the interactive Y/n hint); the old
  // filesystem-sniff idiom (a group's marker file already present on disk) is kept ONLY as a
  // fallback for a manifest written before that field existed. Full always ships neo4j (identity
  // variant, no exclude/optional at all); lite never offers it (no optional.neo4j group).
  const profileDef = profilesOf(loadVariants(REPO_ROOT))[VARIANT] || {};
  // "$comment" is variants.json's own documentation-key convention (see the top-level
  // $comment there too) - not a real group, so it must never be treated as one here.
  const optionalGroups = Object.keys(profileDef.optional || {}).filter((k) => k !== "$comment");
  const prevActiveOptional = Array.isArray(oldManifestEarly && oldManifestEarly.activeOptional)
    ? oldManifestEarly.activeOptional : null;
  const GROUP_LABELS = {};
  let activeOptional = [], droppedOptional = [];
  for (const group of optionalGroups) {
    const globs = profileDef.optional[group];
    const wasActive = prevActiveOptional ? prevActiveOptional.includes(group) : fsGroupInstalled(globs);
    let on;
    if (group in CONFIGURE_FLAGS) {
      on = CONFIGURE_FLAGS[group];
    } else if (INTERACTIVE) {
      const label = GROUP_LABELS[group] || `the "${group}" group`;
      const a = (await ask(`  include ${label}? [${wasActive ? "Y/n" : "y/N"}] > `)).trim().toLowerCase();
      on = a ? a[0] === "y" : wasActive;
    } else {
      on = wasActive;                                     // non-TTY, no flag: keep whatever was active
    }
    if (on) activeOptional.push(group);
    else if (wasActive) droppedOptional.push(group);
  }
  V = resolveVariant({ repoRoot: REPO_ROOT, variant: VARIANT, activeOptional });
  if (installedVariant && installedVariant !== VARIANT)
    log(`Switching variant: ${installedVariant} -> ${VARIANT} (surplus files listed for removal below)`);
  log(`Variant: ${VARIANT} (${V.rels.length} files)`);

  log(`Installing into ${CDIR}${DRY ? "  [DRY RUN]" : ""}`);
  mkdirSync(CDIR, { recursive: true });

  // Mirror the resolved variant's file set into ~/.claude (minus installer-meta). This means any
  // files or folders the variant covers are copied too: new ones are created, existing .mjs are
  // refreshed, other existing files are conflict-checked via diff.
  for (const rel of V.rels) await placeFile(rel, V.srcFor(rel));

  // best-effort exec bits on POSIX for every script we copied (ignored on Windows)
  if (platform() !== "win32" && !DRY)
    for (const p of copiedScripts) safe(() => chmodSync(p, 0o755));

  /* ---------- assemble + write ~/.claude/CLAUDE.md from per-profile fragments ----------
   * Replaces the old per-variant CLAUDE.md monoliths (payload/CLAUDE.md, payload-lite/CLAUDE.md):
   * the assembled text is built fresh every run from payload/claude-md/ fragments for VARIANT
   * (assemble-claude-md.mjs), which already starts with the CURATED:NOEDIT marker + a GENERATED
   * header - so this single step both installs the file AND guarantees the marker, no separate
   * "ensure marker" pass needed anymore. CLAUDE.md is deliberately NOT part of V.rels (payload/
   * claude-md/** is in alwaysExclude - it's a build input, never copied 1:1), so it is placed
   * here instead of through the placeFile() loop above - but it still goes through the same
   * curated-conflict tiering as any other curated file (unchanged -> no-op; new -> create; changed
   * -> diff + merge/replace/skip) so a hand-edited ~/.claude/CLAUDE.md is never silently clobbered.
   */
  {
    const assembled = assembleClaudeMd(join(SRC, "claude-md"), VARIANT);
    manifestNow.push({ rel: "CLAUDE.md", hash: sha(assembled) });
    const globalClaudeMd = join(CDIR, "CLAUDE.md");
    const curGlobal = read(globalClaudeMd);
    if (curGlobal === undefined) {
      if (write(globalClaudeMd, assembled)) summary.push(`created  ${globalClaudeMd}`);
    } else if (curGlobal === assembled) {
      summary.push(`unchanged ${globalClaudeMd}`);
    } else {
      log(`\n~ conflict (curated): ${globalClaudeMd}`);
      log(renderDiff(curGlobal, assembled));
      const act = await choose(globalClaudeMd, "merge");
      if (act === "replace") {
        if (write(globalClaudeMd, assembled))
          summary.push(`replaced ${globalClaudeMd} (no backup - see diff above if you need the old content)`);
      } else {
        summary.push(`${act === "skip" ? "skipped" : "kept (see diff above)"} ${globalClaudeMd}`);
      }
    }
  }

  /* ---------- gsd-* agents: add the context-mode MCP tool, only if that plugin is active ----------
   * gsd-* agents (~/.claude/agents/gsd-*.md) belong to the separate gsd-core tool, not this
   * bundle - this is best-effort cross-tool maintenance, same idea as the graphify CLAUDE.md
   * step in session-init.mjs. Imports the just-installed copy of the lib (not the repo's own
   * payload/ copy) so behavior always matches what actually landed in ~/.claude this run. */
  if (VARIANT === "full" && !DRY) {
    const libPath = join(CDIR, "hooks", "lib", "context-mode-gsd-agents.mjs");
    if (existsSync(libPath)) {
      try {
        const mod = await import(pathToFileURL(libPath).href);
        const r = mod.syncGsdAgentsContextMode({ claudeDir: CDIR });
        if (r && r.active && r.updated.length)
          summary.push(`updated  ${r.updated.length} gsd-* agent(s) with context-mode tool (${r.updated.join(", ")})`);
      } catch { /* best-effort; never blocks install */ }
    }
  }

  /* ---------- gsd-defaults.partial.json: mirror + apply to ~/.gsd/defaults.json ----------
   * gsd-defaults.partial.json is REPO_ROOT meta (same treatment as settings.partial.json -
   * source of truth, not walked by placeFile()). Its content must also persist inside
   * ~/.claude so the standalone `gsd-defaults-sync.mjs` CLI (manual-only; no longer wired into
   * /init-stack; has no access to REPO_ROOT once installed) can re-read it later - so this step always
   * overwrites the installed mirror copy, then applies it via the just-installed lib. */
  if (VARIANT === "full" && !DRY) {
    const partialDefaultsRaw = read(join(REPO_ROOT, "gsd-defaults.partial.json"));
    if (partialDefaultsRaw !== undefined) {
      const mirrorPath = join(CDIR, "gsd-defaults.partial.json");
      if (write(mirrorPath, partialDefaultsRaw)) summary.push(`updated  ${mirrorPath} (mirror copy)`);
      const gsdSyncLibPath = join(CDIR, "hooks", "lib", "gsd-defaults-sync.mjs");
      if (existsSync(gsdSyncLibPath)) {
        try {
          const mod = await import(pathToFileURL(gsdSyncLibPath).href);
          const gsdDefaultsPartial = safe(() => JSON.parse(partialDefaultsRaw));
          if (gsdDefaultsPartial) {
            const r = mod.syncGsdGlobalDefaults({ homeDir: HOME, partial: gsdDefaultsPartial });
            if (r.changed) summary.push(`merged   ${r.path} (deep additive; your values kept)`);
          }
        } catch { /* best-effort; never blocks install */ }
      }
    }
  }

  /* ---------- gsd-core hand-patches (backports of confirmed upstream fixes) ----------
   * gsd-core (~/.claude/gsd-core) is a separate tool, not owned by this bundle - it updates
   * via `npx @opengsd/gsd-core@latest` or its own /gsd-update skill, not setup.mjs.
   * gsd-core-patches/<name>/ holds hand-applied backports of
   * a real, confirmed upstream fix that hasn't reached a tagged release yet - see
   * gsd-core-patches/README.md for the manifest.json schema and how to add a new one. Generic
   * over every subdirectory found there - adding a new backport needs no change here, just a
   * new subdirectory. Version-gated per patch (skip silently on any mismatch - not a
   * per-session nag) and per-file hash-gated (only touches a file whose current hash matches
   * the known pre-patch baseline; already-patched or diverged files are left alone, never
   * clobbered). Retire a subdirectory entirely once its fix ships in a real gsd-core release.
   */
  // `.pre-<name>` backups (written just below, once, before the first overwrite of a given
  // file) used to accumulate forever - nothing ever removed them once the patch had proven
  // stable. Removed only once it's safe to say the backup is no longer needed:
  //   - installedVersion no longer matches manifest.targetVersion: gsd-core moved on (upstream
  //     fix likely shipped, or the user rolled back) - the backup is orphaned either way, since
  //     it was paired with a specific pre-patch baseline that no longer describes this install.
  //   - OR every file is already at afterSha256 AND this run did no new patching (patched === 0):
  //     the patch survived at least one full run untouched since it was applied, so the backup
  //     has done its job. Deliberately NOT removed in the same run that just created it
  //     (patched > 0) - that would defeat the point of having a same-run rollback option.
  if (VARIANT === "full") {
    const prunePatchBackups = (name, files) => {
      let removed = 0;
      for (const f of files) {
        const backup = join(gsdCoreDir, ...f.rel.split("/")) + `.pre-${name}`;
        if (!existsSync(backup)) continue;
        try { rmSync(backup, { force: true }); removed++; summary.push(`pruned   ${backup} (patch backup no longer needed)`); }
        catch { summary.push(`prune-failed ${backup}`); }
      }
      return removed;
    };
    const gsdCoreDir = join(CDIR, "gsd-core");
    if (!DRY) {
      const patchesRoot = join(REPO_ROOT, "gsd-core-patches");
      if (existsSync(gsdCoreDir) && existsSync(patchesRoot)) {
        const patchNames = readdirSync(patchesRoot, { withFileTypes: true })
          .filter((e) => e.isDirectory()).map((e) => e.name);
        for (const name of patchNames) {
          const patchDir = join(patchesRoot, name);
          const manifest = safe(() => JSON.parse(readFileSync(join(patchDir, "manifest.json"), "utf8")));
          if (!manifest) continue;
          const label = manifest.issue ? `#${manifest.issue}` : name;
          const installedVersion = (read(join(gsdCoreDir, "VERSION")) || "").trim();
          if (installedVersion !== manifest.targetVersion) {
            summary.push(`skipped  gsd-core ${label} patch (installed version "${installedVersion || "unknown"}", patch targets "${manifest.targetVersion}")`);
            prunePatchBackups(name, manifest.files);
            continue;
          }
          let patched = 0, alreadyDone = 0, diverged = 0;
          for (const f of manifest.files) {
            const dst = join(gsdCoreDir, ...f.rel.split("/"));
            const cur = read(dst);
            if (cur === undefined) { diverged++; continue; }
            const curHash = sha(cur);
            if (curHash === f.afterSha256) { alreadyDone++; continue; }
            if (curHash !== f.beforeSha256) { diverged++; continue; }
            const afterContent = read(join(patchDir, "after", ...f.rel.split("/")));
            if (afterContent === undefined) { diverged++; continue; }
            write(dst + `.pre-${name}`, cur); // backup original, once, before first overwrite
            if (write(dst, afterContent)) patched++;
          }
          if (patched) summary.push(`patched  gsd-core ${label} (${patched} file(s) in ${gsdCoreDir}; originals saved as *.pre-${name})`);
          else if (alreadyDone === manifest.files.length) { summary.push(`unchanged gsd-core ${label} patch (already applied)`); prunePatchBackups(name, manifest.files); }
          else if (diverged) summary.push(`skipped  gsd-core ${label} patch (${diverged} file(s) diverge from the known ${manifest.targetVersion} baseline - not touching)`);
        }
      }
    }
  }

  /* ---------- settings.json: structured additive merge ---------- */
  // Source of truth for "what hooks/permissions we want" is settings.partial.json itself - NOT a
  // second hardcoded copy in here. That duplication is exactly how this used to drift (a hook
  // added to settings.partial.json without a matching edit here would silently never get wired
  // into a real ~/.claude/settings.json, even though its .mjs file was correctly copied).
  let cur = {};
  if (existsSync(SETTINGS)) {
    try { cur = JSON.parse(readFileSync(SETTINGS, "utf8")); }
    catch { summary.push("settings.json: INVALID JSON - left untouched"); cur = null; }
  }
  const partialRaw = read(join(REPO_ROOT, "settings.partial.json"));
  const partial = partialRaw === undefined ? null
    : safe(() => JSON.parse(partialRaw
        .split("<HOME>/.claude").join(JSON.stringify(CDIR).slice(1, -1))
        .split("<HOME>").join(JSON.stringify(HOME).slice(1, -1))));
  if (partialRaw !== undefined && partial === null) summary.push("settings.partial.json: failed to parse - settings.json hooks left untouched");

  if (cur !== null && partial !== null) {
    const merged = JSON.parse(JSON.stringify(cur));
    merged.hooks = merged.hooks || {};

    // "Ours" = every hook script filename declared anywhere in settings.partial.json, collected
    // dynamically - so adding/renaming/moving a hook there (e.g. db-live-access-gate.mjs moving
    // from SessionStart to PreToolUse) is automatically picked up here with no hand-sync needed.
    const ourFiles = new Set();
    for (const entries of Object.values(partial.hooks || {}))
      for (const e of entries) for (const h of (e.hooks || []))
        for (const a of (h.args || [])) ourFiles.add(String(a).split(/[\\/]/).pop());
    const mentionsOurs = (e) => (e.hooks || []).some(h => (h.args || []).some(a => ourFiles.has(String(a).split(/[\\/]/).pop())));

    // Re-add side is variant-filtered: a lite install must not re-add gsd-only hook entries even
    // though they're still present in the FULL partial used above to strip stale entries.
    const variantBasenames = new Set(V.rels.map((r) => r.split("/").pop()));
    const partialHooksForVariant = filterPartialHooks(partial.hooks, variantBasenames);

    for (const [ev, entries] of Object.entries(partialHooksForVariant)) {
      // claim our slots: drop any prior entry that references one of our hook files (stale paths,
      // old .sh, wrong home, or an event type it used to live under) - this both repairs the
      // "cannot find module" loader error on re-run and prevents duplicates when a hook's event
      // changes - then add back the correct, current entries from the partial.
      const arr = (merged.hooks[ev] || []).filter(e => !mentionsOurs(e));
      for (const w of entries) arr.push(w);
      merged.hooks[ev] = arr;
    }
    // Also strip our entries from any event the partial no longer declares them under (handles a
    // hook moving OUT of an event entirely, not just being re-added to a different one above).
    for (const ev of Object.keys(merged.hooks)) {
      if (ev in partialHooksForVariant) continue;
      merged.hooks[ev] = (merged.hooks[ev] || []).filter(e => !mentionsOurs(e));
      // NOTE: deliberately NOT deleting now-empty event arrays here - delete+later-readd
      // moves the key to the object tail and breaks the byte-identical full->lite->full
      // settings.json round trip. An empty `TaskCreated: []` on lite is harmless residue.
    }

    merged.permissions = merged.permissions || {};
    for (const [k, v] of Object.entries(partial.permissions || {})) {
      if (Array.isArray(v)) {
        const s = new Set(merged.permissions[k] || []);
        v.forEach((x) => s.add(x));
        merged.permissions[k] = [...s];
      } else if (!(k in merged.permissions)) {
        merged.permissions[k] = v;
      }
    }
    // Normalize file-permission rules: Claude Code now matches ALL file-editing tools via the
    // Edit(path) form, so Write(x)/MultiEdit(x) path rules are ignored ("not matched by file
    // permission checks") and MultiEdit is no longer a known tool. Rewrite those to Edit(x) and
    // dedup, migrating stale rules (from older bundles or hand-added settings) that would
    // otherwise keep emitting startup warnings. Non-file rules (Bash(...), mcp__*, …) untouched.
    for (const k of Object.keys(merged.permissions)) {
      if (!Array.isArray(merged.permissions[k])) continue;
      const seen = new Set();
      merged.permissions[k] = merged.permissions[k].reduce((acc, r) => {
        const nr = typeof r === "string" ? r.replace(/^(?:Write|MultiEdit)\(/, "Edit(") : r;
        const key = typeof nr === "string" ? nr : JSON.stringify(nr);
        if (!seen.has(key)) { seen.add(key); acc.push(nr); }
        return acc;
      }, []);
    }

    // Either historical renderer counts as ours, in both directions: a profile switch prunes the
    // file the old entry pointed at, so a takeover that recognised only one would leave statusLine
    // aimed at nothing and render an empty line on every prompt.
    const ourStatusLine = (cmd) => typeof cmd === "string"
      && (cmd.includes("gsd-context-meter") || cmd.includes("hooks/statusline.mjs"));
    if (partial.statusLine) {
      const curCmd = merged.statusLine && merged.statusLine.command;
      const isGsdCoreDefault = typeof curCmd === "string" && curCmd.includes("gsd-statusline.js");
      if (!curCmd || isGsdCoreDefault || ourStatusLine(curCmd)) {
        const scriptPath = join(CDIR, "hooks", "statusline.mjs").replace(/\\/g, "/");
        merged.statusLine = { type: "command", ...partial.statusLine, command: `node "${scriptPath}"` };
      }
    }

    // §6.3 Part B: a superseded session model (e.g. claude-opus-4-8) migrates to the current
    // tier-preserving id. Aliases (opus/sonnet/...) and current ids are left as-is. Interactive:
    // prompt, and on yes the new value rides the unified settings diff+choose below. BULK/non-TTY:
    // report only - never rewrite the user's chosen session model unattended.
    if (typeof merged.model === "string") {
      const mm = migrateSettingsModel(merged.model);
      if (mm.changed) {
        if (INTERACTIVE) {
          const yes = await ask(`\n    model "${mm.from}" looks superseded - migrate to "${mm.value}"? (y/N) > `);
          if (yes.startsWith("y")) { merged.model = mm.value; summary.push(`model    ${mm.from} -> ${mm.value}`); }
          else summary.push(`model    kept ${mm.from} (superseded; set ${mm.value} by hand to migrate)`);
        } else {
          summary.push(`model    ${mm.from} looks superseded - re-run interactively or set ${mm.value} by hand`);
        }
      }
    }

    const curStr = JSON.stringify(cur, null, 2);
    const mergedStr = JSON.stringify(merged, null, 2);
    // settings.json IS conflict-checked (it is not a script). The computed result is the additive
    // merge: it preserves your model / enabledPlugins / language and any unrelated keys, removes
    // stale/duplicate entries that reference our hooks, and adds the correct ones. Re-running is
    // therefore idempotent (no duplicates). On a real diff you choose how to apply it.
    if (curStr === mergedStr) {
      summary.push(`unchanged ${SETTINGS}`);
    } else if (!existsSync(SETTINGS)) {
      if (write(SETTINGS, mergedStr + "\n")) summary.push(`created  ${SETTINGS}`);
    } else {
      log(`\n~ conflict: ${SETTINGS}`);
      log("    (merge = additive: your keys kept, stale hook entries removed, correct ones added)");
      log(renderDiff(curStr, mergedStr));
      const act = await choose(SETTINGS, "merge"); // non-interactive default: apply the safe merge
      if (act === "skip") { summary.push(`skipped  ${SETTINGS}`); }
      else {
        if (write(SETTINGS, mergedStr + "\n"))
          summary.push(`${act === "replace" ? "replaced" : "merged"} ${SETTINGS}${act === "replace" ? " (no backup - see diff above)" : " (additive; your keys preserved)"}`);
      }
    }
  }

  /* ---------- plugin reconciliation (spec § 4): only managedPlugins are ever touched ---------- */
  {
    const variantsFile = loadVariants(REPO_ROOT);
    const managed = variantsFile.managedPlugins;
    const keepInstalled = variantsFile.keepInstalled || [];
    const cliProbe = process.env.CLAUDE_SETUP_SKIP_PLUGINS === "1"
      ? undefined   // hermetic mode (tests): no shell-out; falls to the notes path below
      : safe(() => spawnSync("claude", ["plugin", "list", "--json"], { encoding: "utf8" }));
    const parsedList = cliProbe && cliProbe.status === 0 ? safe(() => JSON.parse(cliProbe.stdout)) : undefined;
    const installedIds = Array.isArray(parsedList)
      ? parsedList.map((p) => p.id || p.name).filter(Boolean)
      : null;   // CLI unavailable, errored, or emitted non-array/invalid JSON -> fallback notes
    const curSettings = safe(() => JSON.parse(readFileSync(SETTINGS, "utf8"))) || {};
    const { actions, notes } = buildPluginPlan({
      required: V.plugins, managed, enabledPlugins: curSettings.enabledPlugins, installedIds, keepInstalled,
      marketplaces: variantsFile.marketplaces,
      knownMarketplaces: safe(() => [...knownMarketplaces(CDIR)]) });
    if (actions.length || notes.length) {
      log("\n--- plugin reconciliation ---");
      log(formatPlan(actions, notes));
      // `go` = apply the enable/disable (enabledPlugins JSON) side. `execInstall` = ALSO actually
      // run `claude plugin install/uninstall`. These are split on purpose (spec § 4): under BULK
      // (non-interactive, e.g. the documented --replace-all bootstrap path) install/uninstall must
      // never auto-execute - only the local, reversible enabledPlugins edit does. Interactive
      // aggregate y/N still executes everything, unchanged.
      let go = false, execInstall = false;
      let chosen = actions;
      if (DRY) log("  (dry-run: no plugin changes)");
      else if (process.env.CLAUDE_SETUP_SKIP_PLUGINS === "1") log("  (skipped: CLAUDE_SETUP_SKIP_PLUGINS=1)");
      else if (BULK === "skip") log("  (--skip-all: no plugin changes)");
      else if (BULK) go = true;   // enabledPlugins edits only; install/uninstall printed as manual commands below
      else if (INTERACTIVE) {
        const a = await ask(`    apply ${actions.length} plugin action(s)? (y = all / n = none / s = choose) > `);
        if (a[0] === "y") { go = execInstall = true; }
        else if (a[0] === "s") {
          const yes = new Set();
          for (const act of actions) {
            const r = await ask(`      ${describeAction(act)}? (y/N) > `);
            if (r[0] === "y") yes.add(act);
          }
          const { selected, dropped } = selectActions(actions, (act) => yes.has(act));
          for (const d of dropped) if (d.reason !== "declined") log(`      skipped ${d.action.id}: ${d.reason}`);
          chosen = selected;
          go = execInstall = chosen.length > 0;
          if (!chosen.length) log("  (nothing selected)");
        }
      }
      else log("  (non-interactive: printed only - re-run in a terminal or with --replace-all)");
      if (go) {
        const s = safe(() => JSON.parse(readFileSync(SETTINGS, "utf8"))) || {};
        s.enabledPlugins = s.enabledPlugins || {};
        for (const a of chosen) {
          // Registering a marketplace fetches and trusts remote code, so it gets the SAME gate as
          // install - never a weaker one just because it is a prerequisite.
          if (a.type === "marketplace_add") {
            if (execInstall) {
              const r = spawnSync("claude", ["plugin", "marketplace", "add", a.source], { encoding: "utf8", stdio: "inherit" });
              summary.push(`${r.status === 0 ? "marketplace-add" : "marketplace-add-FAILED"} ${a.source}`);
            } else {
              log(`  run manually: claude plugin marketplace add ${a.source}`);
              summary.push(`marketplace-add-manual ${a.source}`);
            }
            continue;
          }
          if (a.type === "install" || a.type === "uninstall") {
            if (execInstall) {
              const r = spawnSync("claude", ["plugin", a.type, a.id], { encoding: "utf8", stdio: "inherit" });
              summary.push(`${r.status === 0 ? "plugin-" + a.type : "plugin-" + a.type + "-FAILED"} ${a.id}`);
            } else {
              log(`  run manually: claude plugin ${a.type} ${a.id}`);
              summary.push(`plugin-${a.type}-manual ${a.id}`);
            }
            continue;
          }
          if (a.type === "enable") s.enabledPlugins[a.id] = true;
          if (a.type === "disable") delete s.enabledPlugins[a.id];
        }
        if (write(SETTINGS, JSON.stringify(s, null, 2) + "\n")) summary.push(`updated  ${SETTINGS} (enabledPlugins reconciled)`);
        log("  NOTE: restart Claude Code - enabledPlugins does not hot-reload.");
      }
    }
  }

  /* ---------- opt-in: daily background check for new claude-config releases ---------- */
  // Deliberately NOT part of settings.partial.json's additive merge above (that would silently
  // flip a background network check on for everyone) - this is a one-time y/N decision, written
  // straight into `env`, exactly like the manual PowerShell-tool opt-in documented in README.md.
  // Once decided either way (yes -> "1", no -> "0") this never asks again on this machine, no
  // matter how many times setup.mjs re-runs - an explicit "no" is recorded, not re-nagged
  // (the same "decide once, don't re-ask" pattern used elsewhere for one-time opt-ins). This
  // offer itself is machine-wide only (setup.mjs) - init-stack.md has no per-project equivalent of it.
  if (!DRY) {
    let curEnvSettings = {};
    try { curEnvSettings = JSON.parse(readFileSync(SETTINGS, "utf8")); } catch { curEnvSettings = {}; }
    const updateCheckDecided = curEnvSettings.env && "CLAUDE_CONFIG_UPDATE_CHECK" in curEnvSettings.env;
    if (!updateCheckDecided) {
      let enable = ENABLE_UPDATE_CHECK_FLAG;
      if (!enable && INTERACTIVE) {
        const a = await ask("\nEnable a daily background check for new claude-config releases? " +
          "Read-only GitHub API call (no auth, no data sent); if master has moved, you'll get " +
          "step-by-step update instructions in a future Claude Code session - never applies " +
          "anything itself. [y/N] > ");
        enable = a[0] === "y";
      }
      if (enable) {
        curEnvSettings.env = curEnvSettings.env || {};
        curEnvSettings.env.CLAUDE_CONFIG_UPDATE_CHECK = "1";
        if (write(SETTINGS, JSON.stringify(curEnvSettings, null, 2) + "\n"))
          summary.push(`updated  ${SETTINGS} (update-check: enabled)`);
      } else if (INTERACTIVE) {
        curEnvSettings.env = curEnvSettings.env || {};
        curEnvSettings.env.CLAUDE_CONFIG_UPDATE_CHECK = "0";
        if (write(SETTINGS, JSON.stringify(curEnvSettings, null, 2) + "\n"))
          summary.push(`updated  ${SETTINGS} (update-check: declined - won't ask again here)`);
      } else {
        log("\n(update-check opt-in left undecided - non-interactive run. Enable explicitly with " +
          "'node setup.mjs --enable-update-check', or accept the offer next time /init-stack runs)");
      }
    }
  }

  /* ---------- ensure graphify is installed (underpins the global graph) ---------- */
  // graphify itself is a PyPI tool, not bundle content. If it is missing, offer to install it now via
  // the bundled graphify-setup.mjs. Already installed -> skip silently (the freshness nudge near the end
  // handles upgrades). Interactive + non-DRY only: the &&-short-circuit means CI / e2e (non-TTY) runs
  // never even probe for graphify, let alone shell out to uv/pip.
  if (!DRY && INTERACTIVE && !findGraphifyPython()) {
    const a = await ask("\ngraphify (code knowledge graph) is not installed - it powers the global graph. " +
      "Install it now? [Y/n] > ");
    if (a[0] !== "n") {
      const gsetup = join(CDIR, "bin", "graphify-setup.mjs");
      if (existsSync(gsetup)) {
        log("  installing graphify (this can take a minute) ...");
        const r = spawnSync(process.execPath, [gsetup, "--yes"], { stdio: "inherit" });
        if (r.status === 0 && findGraphifyPython()) summary.push("installed graphify (code knowledge graph)");
        else log("  graphify install did not finish - open a NEW shell and run 'node ~/.claude/bin/graphify-setup.mjs'.");
      } else {
        log("  (graphify-setup.mjs is not part of this profile - skipping)");
      }
    }
  }

  /* ---------- Claude Code auto-update ---------- */
  // The state file moves into CLAUDE_CONFIG_DIR when that var is set, so probe both and take
  // whichever exists; writing a fresh one would create a file Claude Code never reads.
  if (!DRY) {
    const stateFile = [join(CDIR, ".claude.json"), join(HOME, ".claude.json")].find((p) => existsSync(p));
    if (!stateFile) {
      summary.push("autoUpdates: no Claude Code state file found - left untouched");
    } else {
      try {
        const st = JSON.parse(readFileSync(stateFile, "utf8"));
        if (st.autoUpdates !== true) {
          st.autoUpdates = true;
          writeFileSync(stateFile, JSON.stringify(st, null, 2) + "\n");
          summary.push("autoUpdates: enabled");
        }
      } catch {
        summary.push("autoUpdates: state file is not valid JSON - left untouched");
      }
      let envSettings = {};
      try { envSettings = JSON.parse(readFileSync(SETTINGS, "utf8")); } catch { envSettings = {}; }
      if (envSettings.env && envSettings.env.DISABLE_AUTOUPDATER) {
        summary.push("autoUpdates: settings.json env sets DISABLE_AUTOUPDATER - remove it by hand to let updates run");
      }
    }
  }

  /* ---------- prune stale files + persist manifest ---------- */
  migrateRulesDir();
  overwriteTemplatesDir();
  {
    const oldByRelEarly = new Map(((oldManifestEarly && oldManifestEarly.files) || []).map((f) => [f.rel, f.hash]));
    pruneDroppedOptional(droppedOptional, profileDef, oldByRelEarly);
  }
  // After pruneStale, never before it, and the data dependency now says so rather than a comment:
  // a file this bundle installed under `full` and no longer ships under base/lite is pruneStale's
  // to remove, under pruneStale's own gates, so the detector is handed what it already claimed.
  await detectForeignGsdCore(await pruneStale());
  await offerGsdCoreInstall();
  // After the prune, which is what can delete the file the command names.
  warnStatuslineNamesMissingFile();
  if (!DRY) {
    const installedSha = await resolveInstalledSha();
    const maxPluginTier = profilesOf(loadVariants(REPO_ROOT))[VARIANT]?.maxPluginTier;
    const manifestPayload = { files: manifestNow, profile: VARIANT, variant: VARIANT, activeOptional };
    if (maxPluginTier !== undefined) manifestPayload.maxPluginTier = maxPluginTier;
    if (installedSha) {
      manifestPayload.installedSha = installedSha;
      manifestPayload.installedAt = new Date().toISOString();
      manifestPayload.repoRoot = existsSync(join(REPO_ROOT, ".git")) ? REPO_ROOT : null;
    }
    write(MANIFEST, JSON.stringify(manifestPayload, null, 2) + "\n");
  }

  /* ---------- summary ---------- */
  log("\n--- summary ---");
  for (const s of summary) log("  " + s);

  // Categorized digest - the detailed list above is easy to lose track of on a large bundle
  // ("did rules/ actually update, or just plugins?" was the whole reason this exists).
  const digest = {};
  for (const s of summary) {
    const verb = s.split(/\s+/)[0];
    const pathMatch = s.match(/^\S+\s+(.+?)(?:\s\(|$)/);
    const p = pathMatch ? pathMatch[1] : "";
    const rel = p.startsWith(CDIR) ? p.slice(CDIR.length + 1) : p;
    const top = rel.split(/[\\/]/)[0] || "(root)";
    digest[top] = digest[top] || {};
    digest[top][verb] = (digest[top][verb] || 0) + 1;
  }
  log("\n--- by category ---");
  for (const [top, verbs] of Object.entries(digest)) {
    log(`  ${top}: ` + Object.entries(verbs).map(([v, n]) => `${n} ${v}`).join(", "));
  }
  log("  (this installer only touches ~/.claude - stack plugins are separate, see /init-stack)");

  /* ---------- tool checks ---------- */
  const has = (bin, a = ["--version"]) => { const r = spawnSync(bin, a, { encoding: "utf8" }); return !r.error && (r.status === 0 || (r.stdout || r.stderr || "").length > 0); };
  const os = platform();
  const hint = (l, w, m) => os === "win32" ? w : os === "darwin" ? m : l;
  log("\n--- tools ---");
  log("node: present (required; Claude Code guarantees it)");
  if (has("git")) log("git:  present");
  else {
    log("git:  MISSING (needed by secrets-gate.mjs)");
    log("  install: " + hint("sudo apt install git | sudo dnf install git", "winget install Git.Git | choco install git | scoop install git", "brew install git"));
    log("  fallback: without git, secrets-gate is a no-op (a git commit can't run anyway); other hooks unaffected.");
  }
  if (has("gitleaks")) log("gitleaks: present (authoritative scanner)");
  else {
    log("gitleaks: not found (OPTIONAL; built-in regex baseline still runs)");
    log("  install: " + hint("release binary or brew", "winget install gitleaks | choco install gitleaks", "brew install gitleaks"));
  }

  log(`\n${DRY ? "DRY RUN complete (no files written)." : "Done."} Restart Claude Code (hooks load at startup).`);
  log(`Variant: ${VARIANT}`);
  const hookCounts = partial && partial.hooks
    ? Object.entries(partial.hooks).map(([ev, entries]) => `${ev} x${entries.length}`).join(", ")
    : "see settings.partial.json";
  log(`Verify with /hooks (expect: ${hookCounts}).`);

  // Best-effort graphify staleness nudge (never blocks; exits 0 on any error/offline).
  if (!DRY) {
    const fresh = join(CDIR, "bin", "graphify-freshness.mjs");
    if (existsSync(fresh)) spawnSync(process.execPath, [fresh], { stdio: "inherit" });
  }

  log("\n=== Project setup: what to run, and when ===");
  log("");
  log("Step 1 - RESTART Claude Code now. Machine-level setup (hooks, rules, skills,");
  log("         CLAUDE.md, settings.json) only loads at startup.");
  log("");
  log("Step 2 - Open a Claude Code session in the project. On its FIRST session there,");
  log("         a SessionStart hook configures it AUTOMATICALLY - nothing to run:");
  log("           - marks an unmarked root CLAUDE.md as curated (skipped if it looks");
  log("             GSD-generated)");
  if (VARIANT === "full") {
    log("           - excludes a GSD-owned .planning/CLAUDE.md from auto-load (per project)");
    log("           - appends the GSD-clobber risk to an existing RISK_REGISTER.md (every");
    log("             session, not just the first)");
  }
  log("           - if graphify is installed: registers the project in the global graph,");
  log("             installs a native post-commit hook, and (once) runs");
  log("             'graphify claude install' for its own CLAUDE.md section");
  log("           - checks whether the compiled rules snapshot (.claude/stack-rules.md)");
  log("             exists; if not, suggests running /init-stack to generate it (no");
  log("             automatic staleness check - opt out: CLAUDE_STACK_RULES=0)");
  if (VARIANT === "full") {
    log("           - if the git remote is GitHub/GitLab or a DB dependency is detected");
    log("             with no matching MCP wired: suggests /init-mcp (suggestion only,");
    log("             installs nothing, rechecked every session)");
    log("           - for GSD projects (.planning/ present): patches model_profile to your");
    log("             personal default (once), and flags config gaps (e.g. fallow enabled");
    log("             but not installed) every session");
  }
  log("         Toggles: CLAUDE_CURATED_AUTOINIT=0 (disables all of the above),");
  log("         CLAUDE_CURATED_AUTOMARK_ROOT=0, CLAUDE_MCP_SUGGEST=0,");
  log("         CLAUDE_GRAPHIFY_AUTOSYNC=0.");
  log("");
  if (VARIANT === "full") {
    log("Step 3 - ONLY if the project needs stack-specific plugins (React, FastAPI, ...) -");
    log("         this does NOT happen automatically. Run /init-stack in that project's");
    log("         Claude Code session. It detects the stack, then asks you to run");
    log("         'node ~/.claude/bin/init-stack.mjs -i' yourself in a real terminal");
    log("         (interactive checklist) to install and enable the matching plugins.");
    log("");
    log("Step 4 - RESTART Claude Code again after /init-stack writes settings.json -");
    log("         enabledPlugins resolves at startup too, same as step 1.");
  } else {
    log("Step 3 - For per-project stack rules run /init-stack in that project's session");
    log("         (compiles .claude/stack-rules.md; no plugin machinery in lite).");
  }
  log("");
  log("Full reference (including the reconfigure/update table): README.md, section");
  log("'Order of operations'.");
}

main();
