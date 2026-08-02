import { test } from "node:test";
import assert from "node:assert/strict";
import { findGraphifyPython } from "./graphify-python.mjs";

const fail = () => ({ status: 1, error: new Error("nope") });

test("GRAPHIFY_PYTHON wins when it points at a file that exists", () => {
  const self = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  assert.equal(findGraphifyPython({ run: fail, env: { GRAPHIFY_PYTHON: self } }), self);
});

test("a GRAPHIFY_PYTHON that does not exist is ignored, not returned", () => {
  assert.equal(findGraphifyPython({ run: fail, env: { GRAPHIFY_PYTHON: "/no/such/python" } }), null);
});

test("a PATH python that can import graphify is accepted", () => {
  const run = (cmd, argv) =>
    cmd === "python3" && argv[0] === "-c" ? { status: 0 } : fail();
  assert.equal(findGraphifyPython({ run, env: {} }), "python3");
});

test("nothing found is null, never a throw", () => {
  assert.equal(findGraphifyPython({ run: fail, env: {} }), null);
});
