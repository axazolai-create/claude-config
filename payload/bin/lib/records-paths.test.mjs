import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRecordPaths } from "./records-paths.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "records-paths-"));

test("without the tree, records live at the repository root", () => {
  const root = tmp();
  const p = resolveRecordPaths(root);
  assert.equal(p.base, root);
  assert.equal(p.risks, join(root, "RISK_REGISTER.md"));
  assert.equal(p.adrDir, join(root, "adr"));
  assert.equal(p.glossary, join(root, "GLOSSARY.md"));
});

test("with the tree, records live inside it", () => {
  const root = tmp();
  mkdirSync(join(root, ".ultrapowers"));
  const p = resolveRecordPaths(root);
  assert.equal(p.base, join(root, ".ultrapowers"));
  assert.equal(p.risks, join(root, ".ultrapowers", "RISK_REGISTER.md"));
  assert.equal(p.adrDir, join(root, ".ultrapowers", "adr"));
});
