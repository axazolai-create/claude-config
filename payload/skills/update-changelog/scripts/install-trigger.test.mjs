import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensurePostCommitHook } from "./install-trigger.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TRIGGER = join(HERE, "install-trigger.mjs");

function withRepo() {
  return mkdtempSync(join(tmpdir(), "chlog-"));
}

// The skill installs into the user-scope config dir, never into <repo>/.claude/skills.
// A hook line resolved against the repo root therefore names a file that cannot exist.
test("post-commit hook names a queue.mjs that actually exists", async () => {
  const root = withRepo();
  try {
    const { ensurePostCommitHook } = await import(`file://${TRIGGER.replace(/\\/g, "/")}`);
    ensurePostCommitHook(root);
    const body = readFileSync(join(root, ".git", "hooks", "post-commit"), "utf8");
    const m = body.match(/q="([^"]+)"/);
    assert.ok(m, "hook does not define q=");
    const resolved = m[1].replace("$root", root);
    assert.ok(existsSync(resolved), `hook points at a non-existent queue.mjs: ${resolved}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The workspace probe is wrapped in try/catch, so a failed sibling resolve is silent: it
// degrades to "no workspaces" and scaffolds a config that names none of the real parts.
test("install-trigger finds its sibling scripts regardless of the repo it targets", () => {
  const root = withRepo();
  try {
    mkdirSync(join(root, "apps", "web"), { recursive: true });
    writeFileSync(join(root, "apps", "web", "package.json"), '{"name":"web"}');
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n");
    const out = execFileSync("node", [TRIGGER, "--root", root], { encoding: "utf8", cwd: tmpdir() });
    assert.match(out, /changelog trigger installed/);
    const cfg = JSON.parse(readFileSync(join(root, ".changelog.config.json"), "utf8"));
    assert.deepEqual(Object.keys(cfg.names), ["apps/web"], "workspace probe silently found nothing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the installed post-commit hook classifies the commit it queues", () => {
  const root = mkdtempSync(join(tmpdir(), "trigger-"));
  mkdirSync(join(root, ".git", "hooks"), { recursive: true });
  ensurePostCommitHook(root);
  const body = readFileSync(join(root, ".git", "hooks", "post-commit"), "utf8");
  assert.match(body, /queue\.mjs/);
  assert.match(body, /--classify/);
});
