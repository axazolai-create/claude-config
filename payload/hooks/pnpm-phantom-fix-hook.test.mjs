// payload/hooks/pnpm-phantom-fix-hook.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPnpmCommand } from "./pnpm-phantom-fix-hook.mjs";

test("classifies install-family and scope", () => {
  assert.deepEqual(classifyPnpmCommand("pnpm install"), { run: true, packages: null });
  assert.deepEqual(classifyPnpmCommand("pnpm i"), { run: true, packages: null });
  assert.deepEqual(classifyPnpmCommand("pnpm add zod react"), { run: true, packages: ["zod", "react"] });
  assert.deepEqual(classifyPnpmCommand("pnpm i -w @hookform/resolvers"), { run: true, packages: ["@hookform/resolvers"] });
  assert.equal(classifyPnpmCommand("pnpm remove zod").run, false);
  assert.equal(classifyPnpmCommand("pnpm uninstall zod").run, false);
  assert.equal(classifyPnpmCommand("pnpm rm zod").run, false);
  assert.equal(classifyPnpmCommand("pnpm run build").run, false);
  assert.equal(classifyPnpmCommand("npm install").run, false); // pnpm only
  assert.equal(classifyPnpmCommand("echo pnpm install").run, false); // not a leading pnpm cmd
});
