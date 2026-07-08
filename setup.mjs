#!/usr/bin/env node
/*
 * Cross-platform installer for the curated ~/.claude config.
 * Principle: unpack the archive anywhere, then run `node setup.mjs`. All copying into your
 * home ~/.claude is done here, on Linux / macOS / Windows alike.
 *
 * Two tiers of bundle files, handled differently on purpose:
 *   - MANAGED content (.mjs scripts, and any .md/text file that is NOT marked
 *     `CURATED:NOEDIT`) - this is config-as-code: the bundle is the source of truth, so it is
 *     always refreshed to the bundled version on every run, no prompt. This is what makes "drop
 *     in a fresh package, run setup, old files get the new data" actually true for rules/,
 *     skills/, README.md, etc. - not just for scripts.
 *   - CURATED content (any file whose CURRENT on-disk content contains the `CURATED:NOEDIT`
 *     marker - in practice your `~/.claude/CLAUDE.md`) - never silently touched. Shows a unified
 *     diff and asks per file:
 *       (m)erge   - writes the bundle version next to yours as <name>.new (yours stays active).
 *       (r)eplace - backs your file up to <name>.<timestamp>.bak, then writes the bundle version.
 *       (s)kip    - leaves your file untouched.
 *   - JSON files (settings.json, setting-templates/*.json) are a third case: real additive deep
 *     merge (your values kept, missing keys/array items added) - conflict-checked like curated
 *     files since they routinely hold real per-machine values (marketplace ids, your model
 *     choice, etc.) that must never be silently clobbered.
 *
 * Flags (non-interactive / CI): --merge-all | --replace-all | --skip-all | --dry-run
 * In a non-TTY without a bulk flag, curated/JSON conflicts default to MERGE (additive for JSON;
 * bundle version written as <name>.new, alongside, for curated text) - nothing is ever silently
 * destroyed without a backup or a sidecar to review.
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, chmodSync, readdirSync, rmSync } from "node:fs";
import { homedir, platform } from "node:os";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

// REPO_ROOT = where setup.mjs itself lives (installer meta: setup.mjs, README.md,
// settings.partial.json, RISK_REGISTER*.md, bootstrap.sh/ps1, .gitignore - never mirrored).
// SRC = REPO_ROOT/payload - everything that actually gets installed into ~/.claude
// (hooks/, skills/, rules/, commands/, setting-templates/, bin/, add-risk.mjs,
// graphify-sync-all.mjs, CLAUDE.md). Kept as two separate constants (not one) because
// settings.partial.json below is read from REPO_ROOT, not SRC - it configures the installer,
// it isn't itself installed.
const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(REPO_ROOT, "payload");
const HOME = homedir();
const CDIR = join(HOME, ".claude");
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
const INTERACTIVE = !BULK && process.stdin.isTTY;
const MD = argv.has("--md");
const COLOR = !MD && !argv.has("--no-color") && !process.env.NO_COLOR && process.stdout.isTTY;

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
const isCurated = (content) => typeof content === "string" && content.includes("CURATED:NOEDIT");
const write = (p, c) => { if (DRY) return true; try { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); return true; } catch { return false; } };
const stamp = () => new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);

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
async function placeFile(rel) {
  const parts = rel.split("/");
  const src = join(SRC, ...parts);
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
        const bak = `${dst}.${stamp()}.bak`;
        if (!DRY) safe(() => copyFileSync(dst, bak));
        if (write(dst, srcContent)) summary.push(`replaced ${dst} (backup: ${bak})`);
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
  if (act === "skip") { summary.push(`skipped  ${dst}`); return; }
  if (act === "replace") {
    const bak = `${dst}.${stamp()}.bak`;
    if (!DRY) safe(() => copyFileSync(dst, bak));
    if (write(dst, srcContent)) summary.push(`replaced ${dst} (backup: ${bak})`);
    return;
  }
  const np = `${dst}.new`;
  if (write(np, srcContent)) summary.push(`merge -> wrote ${np} (curated; markdown can't auto-merge, yours kept)`);
}

/* ---------- prune: remove files an OLDER bundle installed that this one no longer ships ----------
 * Safe-gated per the "delete only if guaranteed unused" rule: a candidate is removed only if it is
 * (a) not curated, (b) not referenced by any name in the CURRENT bundle, and (c) unchanged since we
 * installed it (its hash still matches the previous manifest). Anything failing a gate is kept and
 * reported. Default: list + confirm (non-TTY lists only; --skip-all skips; --replace/--merge-all
 * imply cleanup). */
function bundleAllText() {
  let t = "";
  for (const rel of walkBundle(SRC)) t += "\n" + (read(join(SRC, ...rel.split("/"))) || "");
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

async function pruneStale() {
  const oldManifest = safe(() => JSON.parse(readFileSync(MANIFEST, "utf8"))) || { files: [] };
  const currentRels = new Set(manifestNow.map((f) => f.rel));
  const oldByRel = new Map((oldManifest.files || []).map((f) => [f.rel, f.hash]));
  const candidates = new Set();
  for (const rel of oldByRel.keys()) if (!currentRels.has(rel)) candidates.add(rel);
  for (const rel of SEED_REMOVED) if (!currentRels.has(rel)) candidates.add(rel);
  if (!candidates.size) return;

  const allText = bundleAllText();
  const del = [], kept = [];
  for (const rel of candidates) {
    const dst = join(CDIR, ...rel.split("/"));
    if (!existsSync(dst)) continue;                                  // already gone
    const cur = read(dst);
    if (typeof cur === "string" && isCurated(cur)) { kept.push([rel, "curated"]); continue; }
    if (allText.includes(rel.split("/").pop())) { kept.push([rel, "still referenced in bundle"]); continue; }
    const oldHash = oldByRel.get(rel);
    if (oldHash && cur !== undefined && sha(cur) !== oldHash) { kept.push([rel, "modified since install"]); continue; }
    del.push({ rel, dst });
  }
  if (kept.length) { log("\n--- stale but KEPT (not safe to auto-remove) ---"); for (const [rel, why] of kept) log(`  ${rel} (${why})`); }
  if (!del.length) return;

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
}

async function main() {
  log(`Installing into ${CDIR}${DRY ? "  [DRY RUN]" : ""}`);
  mkdirSync(CDIR, { recursive: true });

  // Mirror the WHOLE archive tree into ~/.claude (minus installer-meta). This means any files or
  // folders you add to the bundle are copied too: new ones are created, existing .mjs are
  // refreshed, other existing files are conflict-checked via diff.
  for (const rel of walkBundle(SRC)) await placeFile(rel);

  // best-effort exec bits on POSIX for every script we copied (ignored on Windows)
  if (platform() !== "win32" && !DRY)
    for (const p of copiedScripts) safe(() => chmodSync(p, 0o755));

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
    : safe(() => JSON.parse(partialRaw.split("<HOME>").join(JSON.stringify(HOME).slice(1, -1))));
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

    for (const [ev, entries] of Object.entries(partial.hooks || {})) {
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
      if (partial.hooks && ev in partial.hooks) continue;
      merged.hooks[ev] = (merged.hooks[ev] || []).filter(e => !mentionsOurs(e));
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
        if (act === "replace" && !DRY) safe(() => copyFileSync(SETTINGS, `${SETTINGS}.${stamp()}.bak`));
        if (write(SETTINGS, mergedStr + "\n"))
          summary.push(`${act === "replace" ? "replaced" : "merged"} ${SETTINGS}${act === "replace" ? " (backup kept)" : " (additive; your keys preserved)"}`);
      }
    }
  }

  /* ---------- prune stale files + persist manifest ---------- */
  overwriteTemplatesDir();
  await pruneStale();
  if (!DRY) write(MANIFEST, JSON.stringify({ files: manifestNow }, null, 2) + "\n");

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

  log("\nAuto per-project init: a SessionStart hook bootstraps each new/unknown project ONCE");
  log("(marks an unmarked root CLAUDE.md unless GSD-looking; per-project exclude for a GSD-owned");
  log(".planning/CLAUDE.md; appends the GSD risk to an existing RISK_REGISTER.md).");
  log("  opt out: CLAUDE_CURATED_AUTOMARK_ROOT=0  |  disable all: CLAUDE_CURATED_AUTOINIT=0");
  log(`\n${DRY ? "DRY RUN complete (no files written)." : "Done."} Restart Claude Code (hooks load at startup).`);
  const hookCounts = partial && partial.hooks
    ? Object.entries(partial.hooks).map(([ev, entries]) => `${ev} x${entries.length}`).join(", ")
    : "see settings.partial.json";
  log(`Verify with /hooks (expect: ${hookCounts}).`);
}

main();
