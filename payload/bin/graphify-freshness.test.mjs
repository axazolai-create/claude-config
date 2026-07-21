import { test } from "node:test";
import assert from "node:assert/strict";
import { cmpSemver } from "./graphify-freshness.mjs";

test("cmpSemver orders versions", () => {
  assert.equal(cmpSemver("0.9.5", "0.9.22"), -1);
  assert.equal(cmpSemver("0.9.22", "0.9.5"), 1);
  assert.equal(cmpSemver("1.0.0", "0.9.99"), 1);
  assert.equal(cmpSemver("0.9.5", "0.9.5"), 0);
});
