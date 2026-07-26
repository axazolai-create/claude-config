import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleUpdateAvailable } from "./config-update-check-run.mjs";

test("bundleUpdateAvailable: true only when both SHAs present and differ", () => {
  assert.equal(bundleUpdateAvailable("aaa", "bbb"), true);
  assert.equal(bundleUpdateAvailable("aaa", "aaa"), false);
  assert.equal(bundleUpdateAvailable("", "bbb"), false);
  assert.equal(bundleUpdateAvailable("aaa", ""), false);
  assert.equal(bundleUpdateAvailable(undefined, undefined), false);
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
