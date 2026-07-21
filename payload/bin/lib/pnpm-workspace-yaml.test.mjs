// payload/bin/lib/pnpm-workspace-yaml.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { addOptionalPeers } from "./pnpm-workspace-yaml.mjs";

test("creates packageExtensions block when absent", () => {
  const r = addOptionalPeers("packages:\n  - 'apps/*'\n", new Map([["@hookform/resolvers", ["zod"]]]));
  assert.equal(r.safe, true);
  assert.deepEqual(r.added, [["@hookform/resolvers", "zod"]]);
  assert.match(r.text, /packageExtensions:/);
  assert.match(r.text, /"@hookform\/resolvers":/);
  assert.match(r.text, /peerDependenciesMeta:/);
  assert.match(r.text, /optional:\s*true/);
});

test("idempotent: does not re-add an existing P->Q", () => {
  const first = addOptionalPeers("packages: []\n", new Map([["@hookform/resolvers", ["zod"]]])).text;
  const second = addOptionalPeers(first, new Map([["@hookform/resolvers", ["zod"]]]));
  assert.deepEqual(second.added, []);
  assert.deepEqual(second.skipped, [["@hookform/resolvers", "zod"]]);
  assert.equal(second.text, first);
});

test("fail-safe on flow-style packageExtensions (no write)", () => {
  const flow = "packageExtensions: { '@a/b': { peerDependencies: { zod: '*' } } }\n";
  const r = addOptionalPeers(flow, new Map([["@a/b", ["yup"]]]));
  assert.equal(r.safe, false);
  assert.equal(r.text, flow); // unchanged
});
