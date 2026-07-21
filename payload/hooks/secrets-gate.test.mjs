import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const GATE = join(dirname(fileURLToPath(import.meta.url)), "secrets-gate.mjs");

function gateOn(content) {
  const dir = mkdtempSync(join(tmpdir(), "secrets-gate-"));
  try {
    spawnSync("git", ["init", "-q"], { cwd: dir });
    writeFileSync(join(dir, "config.txt"), content);
    spawnSync("git", ["add", "-A"], { cwd: dir });
    const r = spawnSync(process.execPath, [GATE], {
      cwd: dir, encoding: "utf8",
      input: JSON.stringify({ tool_input: { command: "git commit -m x" }, cwd: dir }),
    });
    return { status: r.status, stderr: r.stderr || "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a placeholder value does not block a commit", () => {
  const r = gateOn('api_key = "YOUR_API_KEY_HERE"\n');
  assert.equal(r.status, 0, `blocked on a placeholder:\n${r.stderr}`);
});

test("an angle-bracket placeholder does not block a commit", () => {
  const r = gateOn('password: "<your-password-here>"\n');
  assert.equal(r.status, 0, `blocked on a placeholder:\n${r.stderr}`);
});

test("an x-run placeholder token does not block a commit", () => {
  const r = gateOn("token = ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n");
  assert.equal(r.status, 0, `blocked on a placeholder:\n${r.stderr}`);
});

test("a real AWS access key id still blocks", () => {
  assert.equal(gateOn("aws_key = AKIAIOSFODNN7EXAMPLQ\n").status, 2);
});

test("a real hardcoded secret assignment still blocks", () => {
  assert.equal(gateOn('password = "hunter2Kj9mPqW4xZ"\n').status, 2);
});

test("a secret read from the environment is not a hit", () => {
  assert.equal(gateOn('const token = process.env.GITHUB_TOKEN_VALUE_LONG;\n').status, 0);
});
