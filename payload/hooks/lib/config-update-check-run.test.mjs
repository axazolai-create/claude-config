import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleUpdateAvailable, reconcileBundleInstall } from "./config-update-check-run.mjs";

test("bundleUpdateAvailable: true only when both SHAs present and differ", () => {
  assert.equal(bundleUpdateAvailable("aaa", "bbb"), true);
  assert.equal(bundleUpdateAvailable("aaa", "aaa"), false);
  assert.equal(bundleUpdateAvailable("", "bbb"), false);
  assert.equal(bundleUpdateAvailable("aaa", ""), false);
  assert.equal(bundleUpdateAvailable(undefined, undefined), false);
});

const stale = (over = {}) => ({
  graphify: { class: "safe", updateAvailable: false, lastCheckedAt: "2026-08-02T15:10:54.914Z" },
  "claude-config": { class: "reinit", installed: "old", latest: "remote",
    updateAvailable: true, lastCheckedAt: "2026-08-02T15:10:54.916Z", ...over },
});

test("reconcileBundleInstall: clears the notice once the install catches up to the checked remote", () => {
  const out = reconcileBundleInstall(stale(), "remote");
  assert.equal(out["claude-config"].installed, "remote");
  assert.equal(out["claude-config"].updateAvailable, false);
});

test("reconcileBundleInstall: keeps the notice when the install is still behind the remote", () => {
  const out = reconcileBundleInstall(stale(), "middle");
  assert.equal(out["claude-config"].installed, "middle");
  assert.equal(out["claude-config"].updateAvailable, true);
});

test("reconcileBundleInstall: drops lastCheckedAt so the next session re-checks", () => {
  const out = reconcileBundleInstall(stale(), "remote");
  assert.equal("lastCheckedAt" in out["claude-config"], false);
});

test("reconcileBundleInstall: claims nothing when no remote SHA was ever recorded", () => {
  const out = reconcileBundleInstall(stale({ latest: undefined }), "fresh");
  assert.equal(out["claude-config"].updateAvailable, false);
});

test("reconcileBundleInstall: leaves other components untouched", () => {
  const before = stale();
  const out = reconcileBundleInstall(before, "remote");
  assert.deepEqual(out.graphify, before.graphify);
});

test("reconcileBundleInstall: returns state unchanged without an entry or a SHA", () => {
  assert.deepEqual(reconcileBundleInstall({ graphify: {} }, "remote"), { graphify: {} });
  assert.deepEqual(reconcileBundleInstall(stale(), ""), stale());
  assert.equal(reconcileBundleInstall(null, "remote"), null);
});

test("importing the module does not run main() / write update-check.json", () => {
  const tmp = mkdtempSync(join(tmpdir(), "config-update-check-run-"));
  try {
    mkdirSync(join(tmp, "state"), { recursive: true });
    writeFileSync(join(tmp, "state", "bundle-manifest.json"), JSON.stringify({ installedSha: "deadbeef" }));

    const moduleUrl = new URL("./config-update-check-run.mjs", import.meta.url).href;
    execFileSync(
      process.execPath,
      ["-e", "import(process.env.M).then(()=>setTimeout(()=>process.exit(0),200))"],
      { env: { ...process.env, CLAUDE_CONFIG_DIR: tmp, M: moduleUrl }, timeout: 15000 }
    );

    // main() unconditionally writes update-check.json via writeState(), even offline. Its
    // absence proves main() did not run just from importing the module.
    assert.equal(existsSync(join(tmp, "state", "update-check.json")), false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
