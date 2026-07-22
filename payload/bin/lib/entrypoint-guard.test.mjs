// payload/bin/lib/entrypoint-guard.test.mjs
// Regression guard for the symlink-safe entry-point check used across the bundle's .mjs
// scripts/hooks. When ~/.claude is a symlink/junction, Node realpaths import.meta.url but
// process.argv[1] keeps the invocation path, so the NAIVE guard is false and main() never
// runs. These tests prove the robust guard survives that; the second documents the bug.
// Uses a junction on Windows (no admin needed) / a dir symlink on POSIX.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROBUST = `import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
function isMainModule(){const a=process.argv[1];if(!a)return false;if(import.meta.url===pathToFileURL(a).href)return true;try{return import.meta.url===pathToFileURL(realpathSync(a)).href}catch{return false}}
if (isMainModule()) console.log("MAIN_RAN");
`;
const NAIVE = `import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log("MAIN_RAN");
`;

function makeLinkedFixtures() {
  const root = mkdtempSync(join(tmpdir(), "ep-guard-"));
  const real = join(root, "real");
  mkdirSync(real);
  writeFileSync(join(real, "robust.mjs"), ROBUST);
  writeFileSync(join(real, "naive.mjs"), NAIVE);
  const link = join(root, "link");
  let linked = false;
  try { symlinkSync(real, link, process.platform === "win32" ? "junction" : "dir"); linked = true; } catch { /* unprivileged */ }
  return { root, real, link, linked };
}

const run = (f) => {
  try { return execFileSync(process.execPath, [f], { encoding: "utf8" }).trim(); }
  catch (e) { return (e.stdout || "").trim(); }
};

test("symlink-robust guard runs main() through a symlinked dir", (t) => {
  const fx = makeLinkedFixtures();
  try {
    if (!fx.linked || realpathSync(fx.link) === fx.link) return t.skip("symlink/reparse unavailable here");
    assert.equal(run(join(fx.real, "robust.mjs")), "MAIN_RAN");   // real path runs
    assert.equal(run(join(fx.link, "robust.mjs")), "MAIN_RAN");   // the fix: still runs via the link
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test("naive guard is skipped through a symlink (the bug this fix addresses)", (t) => {
  const fx = makeLinkedFixtures();
  try {
    if (!fx.linked || realpathSync(fx.link) === fx.link) return t.skip("symlink/reparse unavailable here");
    assert.equal(run(join(fx.real, "naive.mjs")), "MAIN_RAN");    // real path runs
    assert.equal(run(join(fx.link, "naive.mjs")), "");            // via the link: main() skipped
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});
