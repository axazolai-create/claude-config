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
 * In a non-TTY without a bulk flag, curated/JSON conflicts default to MERGE (additive for JSON;
 * a no-op that leaves your file untouched for curated text - see above). This installer never
 * writes `.new` or `.bak` side files anywhere under ~/.claude - a diff is either shown for you
 * to act on, or the change is applied directly with no backup.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, readdirSync, rmSync } from "node:fs";
import { homedir, platform } from "node:os";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

// REPO_ROOT = where setup.mjs itself lives (installer meta: setup.mjs, README.md,
// settings.partial.json, RISK_REGISTER*.md, bootstrap.sh/ps1, .gitignore - never mirrored).
// SRC = REPO_ROOT/payload - everything that actually gets installed into ~/.claude
// (hooks/, skills/, rules-src/, commands/, setting-templates/, bin/, add-risk.mjs,
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
const ENABLE_UPDATE_CHECK_FLAG = argv.has("--enable-update-check");
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
    const res = await fetch("https://api.github.com/repos/axazolai-create/claude-config/commits/master",
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
  log(`Installing into ${CDIR}${DRY ? "  [DRY RUN]" : ""}`);
  mkdirSync(CDIR, { recursive: true });

  // Mirror the WHOLE archive tree into ~/.claude (minus installer-meta). This means any files or
  // folders you add to the bundle are copied too: new ones are created, existing .mjs are
  // refreshed, other existing files are conflict-checked via diff.
  for (const rel of walkBundle(SRC)) await placeFile(rel);

  // best-effort exec bits on POSIX for every script we copied (ignored on Windows)
  if (platform() !== "win32" && !DRY)
    for (const p of copiedScripts) safe(() => chmodSync(p, 0o755));

  /* ---------- always ensure ~/.claude/CLAUDE.md carries the curated marker ---------- */
  // deny-curated-claude-md.mjs has no hardcoded path check for the global file anymore -
  // authority lives entirely in the marker, one mechanism instead of two. So THIS is what
  // guarantees ~/.claude/CLAUDE.md is always protected: independent of whatever merge/replace/
  // skip choice the placeFile() conflict flow above made for its body content, unconditionally
  // check whether the marker is present as a standalone line ANYWHERE in the file (not just the
  // first line - a title or other content may legitimately come first) and prepend it if not.
  // Never a merge/replace/skip question - the marker itself is not negotiable, only the prose
  // around it is.
  if (!DRY) {
    const globalClaudeMd = join(CDIR, "CLAUDE.md");
    const curGlobal = read(globalClaudeMd);
    if (curGlobal !== undefined) {
      const bodyNoBom = curGlobal.replace(/^﻿/, "");
      const alreadyMarked = bodyNoBom.split(/\r?\n/).some((line) => MARKER_RE.test(line.trim()));
      if (!alreadyMarked) {
        if (write(globalClaudeMd, MARKER_LINE + "\n" + curGlobal))
          summary.push(`updated  ${globalClaudeMd} (prepended ${MARKER} - was missing)`);
      }
    }
  }

  /* ---------- gsd-* agents: add the context-mode MCP tool, only if that plugin is active ----------
   * gsd-* agents (~/.claude/agents/gsd-*.md) belong to the separate gsd-core tool, not this
   * bundle - this is best-effort cross-tool maintenance, same idea as the graphify CLAUDE.md
   * step in session-init.mjs. Imports the just-installed copy of the lib (not the repo's own
   * payload/ copy) so behavior always matches what actually landed in ~/.claude this run. */
  if (!DRY) {
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
   * ~/.claude so /init-stack's standalone CLI (payload/gsd-defaults-sync.mjs, which has no
   * access to REPO_ROOT once installed) can re-read it later - so this step always
   * overwrites the installed mirror copy, then applies it via the just-installed lib. */
  if (!DRY) {
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
   * via /gsd-update, not setup.mjs. gsd-core-patches/<name>/ holds hand-applied backports of
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

    // statusLine: only take over from an absent value or from gsd-core's own default
    // (gsd-statusline.js) - this path IS shown to the user via the diff+prompt below, so
    // (unlike the non-interactive CLI's ensureStatuslineOverride) it's safe to compute the
    // desired value unconditionally and let the existing diff make the change visible.
    if (partial.statusLine) {
      const curCmd = merged.statusLine && merged.statusLine.command;
      const isOurs = typeof curCmd === "string" && curCmd.includes("gsd-context-meter");
      const isGsdCoreDefault = typeof curCmd === "string" && curCmd.includes("gsd-statusline.js");
      if (!curCmd || isGsdCoreDefault || isOurs) {
        // Built from CDIR directly (not the <HOME>-substituted partial.statusLine.command
        // string) so the written command is byte-identical to gsd-statusline-registration.mjs's
        // desiredCommand() - quoted + forward-slash, safe if HOME ever contains a space.
        const scriptPath = join(CDIR, "hooks", "gsd-context-meter.mjs").replace(/\\/g, "/");
        merged.statusLine = { ...partial.statusLine, command: `node "${scriptPath}"` };
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

  /* ---------- opt-in: daily background check for new claude-config releases ---------- */
  // Deliberately NOT part of settings.partial.json's additive merge above (that would silently
  // flip a background network check on for everyone) - this is a one-time y/N decision, written
  // straight into `env`, exactly like the manual PowerShell-tool opt-in documented in README.md.
  // Once decided either way (yes -> "1", no -> "0") this never asks again on this machine, no
  // matter how many times setup.mjs re-runs - mirrors the `fallow` decline pattern in
  // init-stack.md (step 8): an explicit "no" is recorded, not re-nagged. This offer itself is
  // machine-wide only (setup.mjs) - init-stack.md has no per-project equivalent of it.
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

  /* ---------- opt-in: one-time, machine-wide graphify -> Neo4j (LAN) ---------- */
  // Same "decide once, record in settings.json.env, never re-ask" idiom as the update-check
  // block above. Non-secret decision recorded in settings.json.env; the password is written
  // ONLY to ~/.graphify/neo4j.env (chmod 600), never into the repo or settings.json.
  if (!DRY) {
    let neo4jSettings = {};
    try { neo4jSettings = JSON.parse(readFileSync(SETTINGS, "utf8")); } catch { neo4jSettings = {}; }
    const neo4jDecided = neo4jSettings.env && "GRAPHIFY_NEO4J" in neo4jSettings.env;
    if (!neo4jDecided && INTERACTIVE) {
      const a = await ask("\nConfigure graphify -> Neo4j (LAN) for the global knowledge graph? " +
        "Writes connection + password to ~/.graphify/neo4j.env (never committed). [y/N] > ");
      neo4jSettings.env = neo4jSettings.env || {};
      if (a[0] === "y") {
        const uri = (await ask("  Neo4j bolt URI [bolt://localhost:7687] > ")).trim() || "bolt://localhost:7687";
        const user = (await ask("  Neo4j user [neo4j] > ")).trim() || "neo4j";
        const pw = (await ask("  Neo4j password > ")).trim();
        const envPath = join(HOME, ".graphify", "neo4j.env");
        mkdirSync(dirname(envPath), { recursive: true });
        writeFileSync(envPath, `NEO4J_URI=${uri}\nNEO4J_USER=${user}\nNEO4J_PASSWORD=${pw}\n`);
        try { chmodSync(envPath, 0o600); } catch { /* best-effort - no-op on Windows */ }
        neo4jSettings.env.GRAPHIFY_NEO4J = "1";
        if (write(SETTINGS, JSON.stringify(neo4jSettings, null, 2) + "\n"))
          summary.push(`updated  ${SETTINGS} (graphify-neo4j: enabled)`);
        log("  Wrote ~/.graphify/neo4j.env. Next: run '/init-mcp neo4j' (+ restart) for reads, and");
        log("  'node ~/.claude/graphify-sync-all.mjs --neo4j-push' (or the push script) to write.");
      } else {
        neo4jSettings.env.GRAPHIFY_NEO4J = "0";
        if (write(SETTINGS, JSON.stringify(neo4jSettings, null, 2) + "\n"))
          summary.push(`updated  ${SETTINGS} (graphify-neo4j: declined - won't ask again here)`);
      }
    }
  }

  /* ---------- prune stale files + persist manifest ---------- */
  migrateRulesDir();
  overwriteTemplatesDir();
  await pruneStale();
  if (!DRY) {
    const installedSha = await resolveInstalledSha();
    const manifestPayload = { files: manifestNow };
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
  const hookCounts = partial && partial.hooks
    ? Object.entries(partial.hooks).map(([ev, entries]) => `${ev} x${entries.length}`).join(", ")
    : "see settings.partial.json";
  log(`Verify with /hooks (expect: ${hookCounts}).`);

  log("\n=== Project setup: what to run, and when ===");
  log("");
  log("Step 1 - RESTART Claude Code now. Machine-level setup (hooks, rules, skills,");
  log("         CLAUDE.md, settings.json) only loads at startup.");
  log("");
  log("Step 2 - Open a Claude Code session in the project. On its FIRST session there,");
  log("         a SessionStart hook configures it AUTOMATICALLY - nothing to run:");
  log("           - marks an unmarked root CLAUDE.md as curated (skipped if it looks");
  log("             GSD-generated)");
  log("           - excludes a GSD-owned .planning/CLAUDE.md from auto-load (per project)");
  log("           - appends the GSD-clobber risk to an existing RISK_REGISTER.md (every");
  log("             session, not just the first)");
  log("           - if graphify is installed: registers the project in the global graph,");
  log("             installs a native post-commit hook, and (once) runs");
  log("             'graphify claude install' for its own CLAUDE.md section");
  log("           - checks whether the compiled rules snapshot (.claude/stack-rules.md)");
  log("             exists; if not, suggests running /init-stack to generate it (no");
  log("             automatic staleness check - opt out: CLAUDE_STACK_RULES=0)");
  log("           - if the git remote is GitHub/GitLab or a DB dependency is detected");
  log("             with no matching MCP wired: suggests /init-mcp (suggestion only,");
  log("             installs nothing, rechecked every session)");
  log("           - for GSD projects (.planning/ present): patches model_profile to your");
  log("             personal default (once), and flags config gaps (e.g. fallow enabled");
  log("             but not installed) every session");
  log("         Toggles: CLAUDE_CURATED_AUTOINIT=0 (disables all of the above),");
  log("         CLAUDE_CURATED_AUTOMARK_ROOT=0, CLAUDE_MCP_SUGGEST=0,");
  log("         CLAUDE_GRAPHIFY_AUTOSYNC=0.");
  log("");
  log("Step 3 - ONLY if the project needs stack-specific plugins (React, FastAPI, ...) -");
  log("         this does NOT happen automatically. Run /init-stack in that project's");
  log("         Claude Code session. It detects the stack, then asks you to run");
  log("         'python3 ~/.claude/bin/init-stack.py -i' yourself in a real terminal");
  log("         (interactive checklist) to install and enable the matching plugins.");
  log("");
  log("Step 4 - RESTART Claude Code again after /init-stack writes settings.json -");
  log("         enabledPlugins resolves at startup too, same as step 1.");
  log("");
  log("Full reference (including the reconfigure/update table): README.md, section");
  log("'Order of operations'.");
}

main();
