// payload/hooks/protected-guard.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "protected-guard.mjs");
const run = (payload) => spawnSync(process.execPath, [HOOK], { input: payload, encoding: "utf8" });
const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), "protguard-"));
  for (const [p, body] of Object.entries(files)) {
    const abs = join(root, p);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
};

test("editing a protected path exits 2 and explains", () => {
  const root = tree({ ".protected": "docs/spec.md\n" });
  const r = run(JSON.stringify({ cwd: root, tool_name: "Edit", tool_input: { file_path: join(root, "docs/spec.md") } }));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /is protected/);
});

test("editing an unprotected path exits 0 silently", () => {
  const root = tree({ ".protected": "docs/spec.md\n" });
  const r = run(JSON.stringify({ cwd: root, tool_name: "Edit", tool_input: { file_path: join(root, "docs/other.md") } }));
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
});

test("a destructive bash command against a protected path exits 2", () => {
  const root = tree({ ".protected": "docs/\n" });
  const r = run(JSON.stringify({ cwd: root, tool_name: "Bash", tool_input: { command: "rm -rf docs" } }));
  assert.equal(r.status, 2);
});

test("reading is never blocked", () => {
  const root = tree({ ".protected": "docs/\n" });
  const r = run(JSON.stringify({ cwd: root, tool_name: "Bash", tool_input: { command: "cat docs/spec.md" } }));
  assert.equal(r.status, 0);
});

// RISK-HOOKSTDIN-001: JSON.parse("null") returns null, and the property access after it throws
// in every hook that does not guard. This one is asserted against that whole input class.
test("input the hook cannot understand allows, and a literal null does not throw", () => {
  for (const payload of ["", "not json", "null", "[]", "42", '{"tool_input":null}']) {
    const r = run(payload);
    assert.equal(r.status, 0, `payload ${JSON.stringify(payload)} exited ${r.status}`);
    assert.equal(r.stderr, "", `payload ${JSON.stringify(payload)} wrote to stderr`);
  }
});
