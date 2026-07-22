// payload/bin/lib/config-dir-validate.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateConfigDir } from "./config-dir-validate.mjs";

const isWin = process.platform === "win32";
const FIXED = () => "Fixed"; // fake drive-type: treat as a local fixed disk

function tmp() { return realpathSync(mkdtempSync(join(tmpdir(), "cdv-"))); }

test("rejects empty and relative paths", () => {
  assert.equal(validateConfigDir("", FIXED).ok, false);
  assert.equal(validateConfigDir("relative/dir", FIXED).ok, false);
});

test("accepts a creatable path under an existing fixed dir + normalizes slashes", () => {
  const base = tmp();
  try {
    const r = validateConfigDir(join(base, "newcfg").replace(/\\/g, "/"), FIXED); // forward-slash input
    assert.equal(r.ok, true);
    if (isWin) assert.match(r.norm, /\\/); // normalized to backslashes
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("rejects a file component in the path", () => {
  const base = tmp();
  try {
    const f = join(base, "afile"); writeFileSync(f, "x");
    assert.equal(validateConfigDir(join(f, "sub"), FIXED).ok, false);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("rejects a symlink/junction in the path", (t) => {
  const base = tmp();
  try {
    const real = join(base, "real"); mkdirSync(real);
    const link = join(base, "link");
    try { symlinkSync(real, link, isWin ? "junction" : "dir"); } catch { return t.skip("symlink unavailable"); }
    const r = validateConfigDir(join(link, "config"), FIXED);
    assert.equal(r.ok, false);
    assert.match(r.error, /symlink|junction/i);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

if (isWin) {
  test("rejects Network / Removable / CDRom / nonexistent drives", () => {
    assert.equal(validateConfigDir("D:\\x", () => "Network").ok, false);
    assert.equal(validateConfigDir("D:\\x", () => "Removable").ok, false);
    assert.equal(validateConfigDir("D:\\x", () => "CDRom").ok, false);
    assert.equal(validateConfigDir("D:\\x", () => "NoRootDirectory").ok, false);
  });

  test("rejects UNC paths and Windows-illegal characters", () => {
    assert.equal(validateConfigDir("\\\\server\\share\\x", FIXED).ok, false);
    assert.equal(validateConfigDir("D:\\a<b", FIXED).ok, false);
  });
}
