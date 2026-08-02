import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileLock, updateJsonFile, writeFileAtomic } from "./atomic-json.mjs";

const MODULE_URL = new URL("./atomic-json.mjs", import.meta.url).href;
const tmp = () => mkdtempSync(join(tmpdir(), "atomic-json-"));

test("updateJsonFile creates the file and applies the mutation", () => {
  const d = tmp();
  try {
    const f = join(d, "state.json");
    assert.equal(updateJsonFile(f, (o) => { o.a = 1; }), true);
    assert.deepEqual(JSON.parse(readFileSync(f, "utf8")), { a: 1 });
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("a mutation that changes nothing writes nothing", () => {
  const d = tmp();
  try {
    const f = join(d, "state.json");
    writeFileSync(f, JSON.stringify({ a: 1 }, null, 2) + "\n");
    assert.equal(updateJsonFile(f, (o) => o), false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("a corrupt target is treated as empty rather than throwing", () => {
  const d = tmp();
  try {
    const f = join(d, "state.json");
    writeFileSync(f, "{ not json");
    assert.equal(updateJsonFile(f, (o) => { o.a = 1; }), true);
    assert.deepEqual(JSON.parse(readFileSync(f, "utf8")), { a: 1 });
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("a BOM on the target does not break the read", () => {
  const d = tmp();
  try {
    const f = join(d, "state.json");
    writeFileSync(f, "﻿" + JSON.stringify({ a: 1 }));
    updateJsonFile(f, (o) => { o.b = 2; });
    assert.deepEqual(JSON.parse(readFileSync(f, "utf8")), { a: 1, b: 2 });
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("no temp sibling survives a write", () => {
  const d = tmp();
  try {
    const f = join(d, "state.json");
    writeFileAtomic(f, "{}\n");
    assert.deepEqual(readdirSync(d), ["state.json"]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("the lock is released when the guarded function throws", () => {
  const d = tmp();
  try {
    const f = join(d, "state.json");
    assert.throws(() => withFileLock(f, () => { throw new Error("boom"); }), /boom/);
    assert.equal(existsSync(`${f}.lock`), false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("a lock left behind by a crashed holder is broken, not waited out", () => {
  const d = tmp();
  try {
    const f = join(d, "state.json");
    writeFileSync(`${f}.lock`, "99999");
    const old = new Date(Date.now() - 60_000);
    utimesSync(`${f}.lock`, old, old);
    assert.equal(withFileLock(f, () => "ran"), "ran");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// The guarantee the module exists for: a writer that races in between must be merged onto, not
// clobbered. Both children hold the mutation open long enough to overlap, so an unlocked
// read-modify-write loses one key every time.
test("concurrent updaters do not lose each other's keys", async () => {
  const d = tmp();
  try {
    const f = join(d, "state.json");
    const child = (key) => new Promise((res) => {
      const code = `
        const { updateJsonFile } = await import(${JSON.stringify(MODULE_URL)});
        updateJsonFile(${JSON.stringify(f)}, (o) => {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
          o[${JSON.stringify(key)}] = true;
        });
      `;
      spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: "ignore" }).on("exit", res);
    });
    await Promise.all([child("first"), child("second")]);
    assert.deepEqual(JSON.parse(readFileSync(f, "utf8")), { first: true, second: true });
  } finally { rmSync(d, { recursive: true, force: true }); }
});
