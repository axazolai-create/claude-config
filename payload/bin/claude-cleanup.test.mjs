import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "./claude-cleanup.mjs";

test("parseArgs: scan with excludes + temp-root", () => {
  const { cmd, opts } = parseArgs(["scan", "--temp-root", "C:/t", "--exclude-session", "u1", "--exclude-session", "u2", "--exclude-slug", "s"]);
  assert.equal(cmd, "scan"); assert.equal(opts.tempRoot, "C:/t");
  assert.deepEqual(opts.excludeSession, ["u1", "u2"]); assert.equal(opts.excludeSlug, "s");
});
test("parseArgs: restore --ts", () => {
  const { cmd, opts } = parseArgs(["restore", "--ts", "T1"]);
  assert.equal(cmd, "restore"); assert.equal(opts.ts, "T1");
});
test("parseArgs: bare command defaults to scan", () => {
  assert.equal(parseArgs([]).cmd, "scan");
});
