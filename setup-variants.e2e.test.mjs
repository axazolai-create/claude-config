import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { resolveVariant } from "./variants.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const run = (dir, args) => spawnSync(process.execPath, [join(ROOT, "setup.mjs"), ...args],
  { encoding: "utf8", env: { ...process.env, CLAUDE_CONFIG_DIR: dir, CLAUDE_SETUP_SKIP_PLUGINS: "1" }, timeout: 120000 });

function walk(dir, rel = "") {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(join(dir, e.name), r));
    else out.push(r);
  }
  return out;
}
const FOREIGN = ["settings.local.json", "projects/p/notes.md", "memory/MEMORY.md", "skills/graphify/SKILL.md"];
function plantForeign(dir) {
  for (const f of FOREIGN) { mkdirSync(join(dir, dirname(f)), { recursive: true }); writeFileSync(join(dir, f), `foreign:${f}`); }
}

test("lite install: exact tree, 6 hooks, no statusLine, manifest.variant", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-lite-"));
  plantForeign(dir);
  const r = run(dir, ["--variant=lite", "--replace-all"]);
  assert.equal(r.status, 0, r.stderr);
  const v = resolveVariant({ repoRoot: ROOT, variant: "lite" });
  const installed = new Set(walk(dir));
  for (const rel of v.rels) assert.ok(installed.has(rel), `missing: ${rel}`);
  for (const rel of installed)
    if (!rel.startsWith("state/") && rel !== "settings.json" && !FOREIGN.includes(rel))
      assert.ok(v.rels.includes(rel), `unexpected: ${rel}`);
  const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
  const scripts = new Set();
  for (const entries of Object.values(settings.hooks || {}))
    for (const e of entries) for (const h of (e.hooks || []))
      for (const a of (h.args || [])) scripts.add(String(a).split(/[\\/]/).pop());
  assert.equal(scripts.size, 6);
  assert.ok(!("statusLine" in settings));
  assert.equal(JSON.parse(readFileSync(join(dir, "state/bundle-manifest.json"), "utf8")).variant, "lite");
  // lite CLAUDE.md is the overlay version
  assert.match(readFileSync(join(dir, "CLAUDE.md"), "utf8"), /lite variant/);
  for (const f of FOREIGN) assert.equal(readFileSync(join(dir, f), "utf8"), `foreign:${f}`);
  rmSync(dir, { recursive: true, force: true });
});

test("switch full->lite prunes surplus; lite->full restores; foreign untouched", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-sw-"));
  plantForeign(dir);
  assert.equal(run(dir, ["--variant=full", "--replace-all"]).status, 0);
  assert.ok(existsSync(join(dir, "hooks/gsd-context-meter.mjs")));
  assert.equal(run(dir, ["--variant=lite", "--replace-all"]).status, 0);
  assert.ok(!existsSync(join(dir, "hooks/gsd-context-meter.mjs")), "gsd hook not pruned");
  assert.ok(!existsSync(join(dir, "hooks/lib/context-mode-gsd-agents.mjs")), "gsd lib not pruned (name-gate bypass broken?)");
  assert.ok(!existsSync(join(dir, "gsd-defaults.partial.json")), "gsd-defaults mirror not pruned");
  assert.equal(run(dir, ["--variant=full", "--replace-all"]).status, 0);
  assert.ok(existsSync(join(dir, "hooks/gsd-context-meter.mjs")), "full files not restored");
  assert.equal(JSON.parse(readFileSync(join(dir, "state/bundle-manifest.json"), "utf8")).variant, "full");
  for (const f of FOREIGN) assert.equal(readFileSync(join(dir, f), "utf8"), `foreign:${f}`);
  rmSync(dir, { recursive: true, force: true });
});

test("manifest without variant field = full (no surplus prune on full reinstall)", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-legacy-"));
  assert.equal(run(dir, ["--variant=full", "--replace-all"]).status, 0);
  const mPath = join(dir, "state/bundle-manifest.json");
  const m = JSON.parse(readFileSync(mPath, "utf8"));
  delete m.variant;                      // simulate pre-variant bundle
  writeFileSync(mPath, JSON.stringify(m, null, 2));
  const r = run(dir, ["--replace-all"]); // no flag, non-TTY -> detected = full
  assert.equal(r.status, 0);
  assert.ok(existsSync(join(dir, "hooks/gsd-context-meter.mjs")));
  rmSync(dir, { recursive: true, force: true });
});

test("lite build ships the AI-dev-mode (A) files", () => {
  const v = resolveVariant({ repoRoot: ROOT, variant: "lite" });
  for (const p of [
    "hooks/inject-axes.mjs",
    "hooks/lib/inject-axes.mjs",
    "hooks/lib/verbosity-rules.mjs",
    "hooks/lib/verbosity-lite-rule.md",
    "commands/aidev.md",
  ]) {
    assert.ok(v.rels.includes(p), `${p} must be in lite`);
  }
});

test("--dry-run writes nothing for both variants", () => {
  for (const variant of ["lite", "full"]) {
    const dir = mkdtempSync(join(tmpdir(), "cc-dry-"));
    const r = run(dir, [`--variant=${variant}`, "--dry-run", "--skip-all"]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(walk(dir), [], `dry-run wrote files (${variant})`);
    rmSync(dir, { recursive: true, force: true });
  }
});
