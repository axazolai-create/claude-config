import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderDetectedCommands } from "./detect-stack-commands.mjs";

test("emits a well-formed section for a node project", () => {
  const d = mkdtempSync(join(tmpdir(), "detect-cmd-"));
  writeFileSync(join(d, "package.json"), "{}");
  const block = renderDetectedCommands(d);
  assert.match(block, /^## Detected commands/m);
  assert.match(block, /pnpm test/);
  assert.match(block, /pnpm build/);
  rmSync(d, { recursive: true, force: true });
});

test("unknown stack → explicit no-confident-default line", () => {
  const d = mkdtempSync(join(tmpdir(), "detect-cmd-"));
  const block = renderDetectedCommands(d);
  assert.match(block, /^## Detected commands/m);
  assert.match(block, /no confident default/i);
  rmSync(d, { recursive: true, force: true });
});
