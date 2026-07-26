import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tpl = JSON.parse(readFileSync(join(ROOT, "payload/setting-templates/frontend/_base.json"), "utf8"));

test("frontend/_base.json no longer references frontend-design", () => {
  const raw = JSON.stringify(tpl);
  assert.ok(!raw.includes("frontend-design"), "frontend-design must be fully removed");
});

test("frontend/_base.json declares designStack with the locked Pro Max subset", () => {
  assert.ok(tpl.designStack, "designStack block missing");
  assert.match(tpl.designStack.impeccable.install, /impeccable install .*--scope=project.*--no-hooks/);
  assert.match(tpl.designStack.proMax.install, /uipro init .*--offline/);
  assert.deepEqual(tpl.designStack.proMax.keepSkills, ["ui-ux-pro-max", "ui-styling", "design-system"]);
});
