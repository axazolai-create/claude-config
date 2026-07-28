import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectMarkers,
  detectMarkersByWorkspace,
  computeStackFingerprint,
  computeSourceHash,
  checkStackRules,
} from "./stack-rules-check.mjs";

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), "stack-rules-"));
  for (const [rel, text] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}
const pkg = JSON.stringify({ name: "x" });
const emptySrc = () => mkdtempSync(join(tmpdir(), "rules-src-"));

function snapshot(root, frontmatter) {
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "stack-rules.md"), `---\n${frontmatter}\n---\n\nrules\n`);
  return root;
}

test("a single-package repository reports only the root", () => {
  const root = repo({ "package.json": pkg, "next.config.ts": "" });
  assert.deepEqual(detectMarkersByWorkspace(root), { ".": ["next", "node"] });
});

test("a workspace's own markers are found and attributed to it", () => {
  const root = repo({
    "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n",
    "package.json": pkg,
    "apps/web/package.json": pkg,
    "apps/web/next.config.ts": "",
    "apps/api/package.json": pkg,
    "apps/api/nest-cli.json": "{}",
  });
  assert.deepEqual(detectMarkersByWorkspace(root), {
    ".": ["node", "pnpm-ws"],
    "apps/api": ["nest", "node"],
    "apps/web": ["next", "node"],
  });
});

test("a nested stack changes the fingerprint", () => {
  const base = {
    "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n",
    "package.json": pkg,
    "apps/web/package.json": pkg,
  };
  const before = computeStackFingerprint(repo(base));
  const after = computeStackFingerprint(repo({ ...base, "apps/web/next.config.ts": "" }));
  assert.notEqual(before, after);
});

test("the fingerprint is stable across two identical trees", () => {
  const files = { "package.json": pkg, "manage.py": "" };
  assert.equal(computeStackFingerprint(repo(files)), computeStackFingerprint(repo(files)));
});

test("detectMarkers still reads exactly one directory", () => {
  const root = repo({ "package.json": pkg, "apps/web/next.config.ts": "" });
  assert.deepEqual(detectMarkers(root), ["node"]);
});

test("the same tree fingerprinted twice yields the same value", () => {
  const root = repo({
    "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n",
    "package.json": pkg,
    "apps/web/package.json": pkg,
    "apps/web/vite.config.ts": "",
  });
  assert.equal(computeStackFingerprint(root), computeStackFingerprint(root));
});

test("a repository with no workspaces has a root entry and nothing else", () => {
  const root = repo({ "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n", "package.json": pkg });
  assert.deepEqual(Object.keys(detectMarkersByWorkspace(root)), ["."]);
});

test("a workspace with no stack of its own carries only node, and root markers do not leak in", () => {
  const root = repo({
    "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n",
    "package.json": pkg,
    "manage.py": "",
    "apps/blank/package.json": pkg,
  });
  assert.deepEqual(detectMarkersByWorkspace(root), {
    ".": ["django", "node", "pnpm-ws"],
    "apps/blank": ["node"],
  });
});

test("workspace keys are sorted and slash-separated, whatever order the tree was built in", () => {
  const ws = "packages:\n  - 'apps/*'\n";
  const a = repo({
    "pnpm-workspace.yaml": ws,
    "package.json": pkg,
    "apps/zeta/package.json": pkg,
    "apps/alpha/package.json": pkg,
  });
  const b = repo({
    "pnpm-workspace.yaml": ws,
    "package.json": pkg,
    "apps/alpha/package.json": pkg,
    "apps/zeta/package.json": pkg,
  });
  const keys = Object.keys(detectMarkersByWorkspace(a));
  assert.deepEqual(keys, [".", "apps/alpha", "apps/zeta"]);
  assert.deepEqual(Object.keys(detectMarkersByWorkspace(b)), keys);
  assert.equal(computeStackFingerprint(a), computeStackFingerprint(b));
});

test("an unreadable root yields an empty root entry rather than throwing", () => {
  assert.deepEqual(detectMarkersByWorkspace(join(repo({}), "does-not-exist")), { ".": [] });
});

test("no snapshot at all is missing", () => {
  const r = checkStackRules(repo({ "package.json": pkg }), emptySrc());
  assert.equal(r.status, "missing");
});

test("a legacy snapshot whose stacks is a flat list is reported, never flagged as drift", () => {
  const root = repo({ "package.json": pkg, "next.config.ts": "" });
  snapshot(root, "sourceHash: x\nstackFingerprint: deadbeefdeadbeef\nstacks: [next]");
  const r = checkStackRules(root, emptySrc());
  assert.equal(r.status, "legacy");
  assert.notEqual(r.status, "stale");
});

test("a malformed snapshot is legacy, not drift", () => {
  const root = repo({ "package.json": pkg, ".claude/stack-rules.md": "not frontmatter at all\n" });
  assert.equal(checkStackRules(root, emptySrc()).status, "legacy");
});

test("a workspace-aware snapshot that still matches reports ok", () => {
  const root = repo({ "package.json": pkg });
  const src = emptySrc();
  snapshot(
    root,
    `sourceHash: ${computeSourceHash(src)}\nstackFingerprint: ${computeStackFingerprint(root)}\nmarkers: ${JSON.stringify(detectMarkersByWorkspace(root))}`,
  );
  assert.equal(checkStackRules(root, src).status, "ok");
});

test("a workspace-aware snapshot whose stack moved on is stale", () => {
  const root = repo({ "package.json": pkg, "next.config.ts": "" });
  const src = emptySrc();
  snapshot(root, `sourceHash: ${computeSourceHash(src)}\nstackFingerprint: deadbeefdeadbeef\nmarkers: {".": ["node"]}`);
  assert.equal(checkStackRules(root, src).status, "stale");
});
