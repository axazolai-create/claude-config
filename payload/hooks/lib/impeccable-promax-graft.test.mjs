import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPromaxGraft, SENTINEL, ANCHORS } from "./impeccable-promax-graft.mjs";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "graft-"));
  const refDir = join(dir, "impeccable", "reference");
  mkdirSync(refDir, { recursive: true });
  for (const [file, anchor] of Object.entries(ANCHORS))
    writeFileSync(join(refDir, file), `# ${file}\n\n${anchor}\nbody\n`);
  return { dir, refDir };
}

test("graft inserts the sentinel into every anchored reference file", () => {
  const { dir, refDir } = fixture();
  const r = applyPromaxGraft({ skillsDir: dir });
  assert.deepEqual(r.applied.sort(), Object.keys(ANCHORS).sort());
  for (const file of Object.keys(ANCHORS))
    assert.ok(readFileSync(join(refDir, file), "utf8").includes(SENTINEL));
  rmSync(dir, { recursive: true, force: true });
});

test("graft is idempotent — second run inserts nothing", () => {
  const { dir } = fixture();
  applyPromaxGraft({ skillsDir: dir });
  const r2 = applyPromaxGraft({ skillsDir: dir });
  assert.deepEqual(r2.applied, []);
  assert.deepEqual(r2.already.sort(), Object.keys(ANCHORS).sort());
  rmSync(dir, { recursive: true, force: true });
});

test("graft re-applies after an update clobber restores the file", () => {
  const { dir, refDir } = fixture();
  applyPromaxGraft({ skillsDir: dir });
  const file = Object.keys(ANCHORS)[0];
  writeFileSync(join(refDir, file), `# ${file}\n\n${ANCHORS[file]}\nbody\n`); // simulate `impeccable update`
  const r = applyPromaxGraft({ skillsDir: dir });
  assert.ok(r.applied.includes(file));
  assert.ok(readFileSync(join(refDir, file), "utf8").includes(SENTINEL));
  rmSync(dir, { recursive: true, force: true });
});

test("missing/renamed reference file is skipped, never corrupted", () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-empty-"));
  mkdirSync(join(dir, "impeccable", "reference"), { recursive: true });
  const r = applyPromaxGraft({ skillsDir: dir });
  assert.deepEqual(r.applied, []);
  assert.deepEqual(r.skippedNoAnchor.sort(), Object.keys(ANCHORS).sort());
  rmSync(dir, { recursive: true, force: true });
});

test("file present but anchor absent is skipped, never corrupted", () => {
  // distinct from the missing-file case above: the file EXISTS with content but has no `## `
  // heading, so applyPromaxGraft's `at < 0` branch must skip it (not insert at offset 0).
  const dir = mkdtempSync(join(tmpdir(), "graft-noanchor-"));
  const refDir = join(dir, "impeccable", "reference");
  mkdirSync(refDir, { recursive: true });
  for (const file of Object.keys(ANCHORS))
    writeFileSync(join(refDir, file), `# ${file}\n\nprose with no level-two heading\n`);
  const r = applyPromaxGraft({ skillsDir: dir });
  assert.deepEqual(r.applied, []);
  assert.deepEqual(r.skippedNoAnchor.sort(), Object.keys(ANCHORS).sort());
  for (const file of Object.keys(ANCHORS))
    assert.ok(!readFileSync(join(refDir, file), "utf8").includes(SENTINEL), `${file} must be untouched`);
  rmSync(dir, { recursive: true, force: true });
});
