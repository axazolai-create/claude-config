import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
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

test("a snapshot whose markers match reports ok", () => {
  const root = repo({ "package.json": pkg });
  const fp = computeStackFingerprint(root);
  snapshot(root, `sourceHash: x\nstackFingerprint: ${fp}\nmarkers: {".": ["node"]}`);
  const r = checkStackRules(root, root);
  assert.equal(r.status, "ok");
  assert.deepEqual([r.added, r.removed], [[], []]);
});

test("a marker that appeared is named, with its workspace", () => {
  const root = repo({ "package.json": pkg, "next.config.ts": "" });
  snapshot(root, `sourceHash: x\nstackFingerprint: deadbeefdeadbeef\nmarkers: {".": ["node"]}`);
  const r = checkStackRules(root, root);
  assert.equal(r.status, "stale");
  assert.deepEqual(r.added, [{ workspace: ".", marker: "next" }]);
  assert.deepEqual(r.removed, []);
});

test("a marker that vanished is named too", () => {
  const root = repo({ "package.json": pkg });
  snapshot(root, `sourceHash: x\nstackFingerprint: deadbeefdeadbeef\nmarkers: {".": ["node","vite"]}`);
  const r = checkStackRules(root, root);
  assert.deepEqual(r.removed, [{ workspace: ".", marker: "vite" }]);
  assert.deepEqual(r.added, []);
});

test("a snapshot without a markers line is legacy, never stale", () => {
  const root = repo({ "package.json": pkg, "next.config.ts": "" });
  snapshot(root, "sourceHash: x\nstackFingerprint: deadbeefdeadbeef\nstacks: [next]");
  const r = checkStackRules(root, root);
  assert.equal(r.status, "legacy");
  assert.deepEqual([r.added, r.removed], [[], []]);
});

test("a stale sourceHash and a stale stackFingerprint do not by themselves mean drift", () => {
  const root = repo({ "package.json": pkg });
  snapshot(root, `sourceHash: 0000000000000000\nstackFingerprint: deadbeefdeadbeef\nmarkers: {".": ["node"]}`);
  const r = checkStackRules(root, emptySrc());
  assert.equal(r.status, "ok");
  assert.notEqual(r.sourceHash, "0000000000000000");
});

test("a workspace that appeared is named by its own key", () => {
  const root = repo({
    "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n",
    "package.json": pkg,
    "apps/web/package.json": pkg,
    "apps/web/next.config.ts": "",
  });
  snapshot(root, `sourceHash: x\nstackFingerprint: deadbeefdeadbeef\nmarkers: {".": ["node","pnpm-ws"]}`);
  const r = checkStackRules(root, root);
  assert.equal(r.status, "stale");
  assert.deepEqual(r.added, [
    { workspace: "apps/web", marker: "next" },
    { workspace: "apps/web", marker: "node" },
  ]);
  assert.deepEqual(r.removed, []);
});

test("a workspace that vanished is named by its own key", () => {
  const root = repo({ "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n", "package.json": pkg });
  snapshot(
    root,
    `sourceHash: x\nstackFingerprint: deadbeefdeadbeef\nmarkers: {".": ["node","pnpm-ws"], "apps/gone": ["node","vite"]}`,
  );
  const r = checkStackRules(root, root);
  assert.equal(r.status, "stale");
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.removed, [
    { workspace: "apps/gone", marker: "node" },
    { workspace: "apps/gone", marker: "vite" },
  ]);
});

test("an appearance, a disappearance and a changed workspace are reported together", () => {
  const root = repo({
    "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n",
    "package.json": pkg,
    "apps/api/package.json": pkg,
    "apps/api/nest-cli.json": "{}",
    "apps/web/package.json": pkg,
    "apps/web/next.config.ts": "",
  });
  snapshot(
    root,
    `sourceHash: x\nstackFingerprint: deadbeefdeadbeef\nmarkers: {".": ["node","pnpm-ws"], "apps/api": ["node","vite"], "apps/old": ["python"]}`,
  );
  const r = checkStackRules(root, root);
  assert.equal(r.status, "stale");
  assert.deepEqual(r.added, [
    { workspace: "apps/api", marker: "nest" },
    { workspace: "apps/web", marker: "next" },
    { workspace: "apps/web", marker: "node" },
  ]);
  assert.deepEqual(r.removed, [
    { workspace: "apps/api", marker: "vite" },
    { workspace: "apps/old", marker: "python" },
  ]);
});

// Pins the exact bytes that get hashed. The stability tests above compare the function against
// itself in one process, so they cannot see a comparator whose order depends on the machine's
// collation: under da-DK "aardvark" sorts last, under et-EE "z-utils" sorts before "tools", and
// under every locale a capitalised "Web" sorts after "tools" instead of before it.
test("workspace keys serialize in byte order, not the machine's collation order", () => {
  const root = repo({
    "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n  - 'packages/*'\n",
    "package.json": pkg,
    "apps/zebra/package.json": pkg,
    "apps/aardvark/package.json": pkg,
    "packages/z-utils/package.json": pkg,
    "packages/tools/package.json": pkg,
    "packages/Web/package.json": pkg,
  });
  assert.equal(
    JSON.stringify(detectMarkersByWorkspace(root)),
    '{".":["node","pnpm-ws"],"apps/aardvark":["node"],"apps/zebra":["node"],"packages/Web":["node"],"packages/tools":["node"],"packages/z-utils":["node"]}',
  );
});

// The compiler is prose, one copy per profile, and the snapshot it stamps is the only thing this
// checker can read. A template that omits markers: - or writes it as a YAML block map - makes every
// project it compiles permanently legacy, which no test of the checker alone can see.
const repoRoot = join(import.meta.dirname, "..", "..", "..");
const compilerDocs = ["payload/rules-src/README.md", "payload-lite/rules-src/README.md"];

function frontmatterTemplate(relPath) {
  const text = readFileSync(join(repoRoot, relPath), "utf8");
  const m = text.match(/```yaml\r?\n---\r?\n([\s\S]*?)\r?\n---\r?\n```/);
  assert.ok(m, `${relPath} documents no snapshot frontmatter`);
  return m[1];
}

function stamp(template, root, srcDir) {
  const markers = JSON.stringify(detectMarkersByWorkspace(root));
  return template
    .split(/\r?\n/)
    .map((line) => {
      if (line.startsWith("sourceHash:")) return `sourceHash: ${computeSourceHash(srcDir)}`;
      if (line.startsWith("stackFingerprint:")) return `stackFingerprint: ${computeStackFingerprint(root)}`;
      if (line.startsWith("markers:")) return `markers: ${markers}`;
      if (line.startsWith("generatedAt:")) return "generatedAt: 2026-07-28T00:00:00.000Z";
      return line;
    })
    .join("\n");
}

const compilableTrees = {
  "a repository with no workspaces": { "package.json": pkg, "next.config.ts": "" },
  "a monorepo with several workspaces": {
    "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n",
    "package.json": pkg,
    "apps/web/package.json": pkg,
    "apps/web/next.config.ts": "",
    "apps/api/package.json": pkg,
    "apps/api/nest-cli.json": "{}",
  },
  "a workspace with no stack of its own": {
    "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n",
    "package.json": pkg,
    "apps/blank/package.json": pkg,
  },
};

for (const doc of compilerDocs) {
  test(`${doc} documents stacks and markers as workspace-keyed flow mappings`, () => {
    const template = frontmatterTemplate(doc);
    for (const key of ["stacks", "markers"]) {
      const line = template.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
      assert.ok(line, `${doc} documents no ${key}: line`);
      const value = JSON.parse(line[1]);
      assert.ok(value && typeof value === "object" && !Array.isArray(value), `${doc}: ${key} is not a mapping`);
      assert.ok("." in value, `${doc}: ${key} has no root key`);
    }
  });

  for (const [tree, files] of Object.entries(compilableTrees)) {
    test(`a snapshot compiled from ${doc} reads ok for ${tree}`, () => {
      const root = repo(files);
      const src = emptySrc();
      snapshot(root, stamp(frontmatterTemplate(doc), root, src));
      const r = checkStackRules(root, src);
      assert.equal(r.status, "ok");
      assert.deepEqual([r.added, r.removed], [[], []]);
    });
  }
}

// /init-stack is the path a rebuild is actually driven down, and it tells the compiler subagent
// which fields to stamp. A field the command forgets to hand over is a field the snapshot never
// records - and a snapshot missing markers: reads back legacy, which at the call site is
// indistinguishable from a successful rebuild.
test("the /init-stack command documents the checker's real output shape and every status it reaches", () => {
  const doc = readFileSync(join(repoRoot, "payload", "commands", "init-stack.md"), "utf8");
  const src = emptySrc();
  const okRoot = repo({ "package.json": pkg });
  snapshot(okRoot, `markers: ${JSON.stringify(detectMarkersByWorkspace(okRoot))}`);
  const roots = [
    repo({ "package.json": pkg }),
    snapshot(repo({ "package.json": pkg }), "stacks: [node]"),
    snapshot(repo({ "package.json": pkg, "next.config.ts": "" }), 'markers: {".": ["node"]}'),
    okRoot,
  ];
  const results = roots.map((r) => checkStackRules(r, src));
  const documented = doc.match(/Prints `\{([^`]*)\}`/);
  assert.ok(documented, "init-stack.md documents no output shape");
  assert.deepEqual(
    documented[1].split(",").map((s) => s.trim()).sort(),
    Object.keys(results[0]).sort(),
  );
  for (const { status } of results)
    assert.ok(doc.includes(`"${status}"`), `init-stack.md has no branch for status "${status}"`);
});

test("a markers line that runs past two kilobytes is still compared", () => {
  const files = { "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n", "package.json": pkg };
  for (let i = 0; i < 80; i++) files[`packages/module-${String(i).padStart(2, "0")}/package.json`] = pkg;
  const root = repo(files);
  const frontmatter = `sourceHash: x\nstackFingerprint: ${computeStackFingerprint(root)}\nmarkers: ${JSON.stringify(detectMarkersByWorkspace(root))}`;
  assert.ok(frontmatter.length > 2000);
  snapshot(root, frontmatter);
  const r = checkStackRules(root, root);
  assert.equal(r.status, "ok");
  assert.deepEqual([r.added, r.removed], [[], []]);
});
