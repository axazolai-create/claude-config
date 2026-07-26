import { test } from "node:test";
import assert from "node:assert/strict";
import { bundleUpdateAvailable } from "./config-update-check-run.mjs";

test("bundleUpdateAvailable: true only when both SHAs present and differ", () => {
  assert.equal(bundleUpdateAvailable("aaa", "bbb"), true);
  assert.equal(bundleUpdateAvailable("aaa", "aaa"), false);
  assert.equal(bundleUpdateAvailable("", "bbb"), false);
  assert.equal(bundleUpdateAvailable("aaa", ""), false);
  assert.equal(bundleUpdateAvailable(undefined, undefined), false);
});
