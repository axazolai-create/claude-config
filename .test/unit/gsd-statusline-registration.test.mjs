import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureStatuslineOverride } from "../../payload/hooks/lib/gsd-statusline-registration.mjs";

function withClaudeDir(fn) {
  const claudeDir = mkdtempSync(join(tmpdir(), "gsd-statusline-reg-test-"));
  try {
    return fn(claudeDir);
  } finally {
    rmSync(claudeDir, { recursive: true, force: true });
  }
}

test("ensureStatuslineOverride: no-op when settings.json is missing", () => {
  withClaudeDir((claudeDir) => {
    const result = ensureStatuslineOverride({ claudeDir });
    assert.equal(result.changed, false);
  });
});

test("ensureStatuslineOverride: sets statusLine when absent", () => {
  withClaudeDir((claudeDir) => {
    writeFileSync(join(claudeDir, "settings.json"), JSON.stringify({ model: "sonnet" }));
    const result = ensureStatuslineOverride({ claudeDir });
    assert.equal(result.changed, true);
    const written = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8"));
    assert.match(written.statusLine.command, /gsd-context-meter\.mjs/);
    assert.equal(written.model, "sonnet");
  });
});

test("ensureStatuslineOverride: takes over from gsd-core's own gsd-statusline.js", () => {
  withClaudeDir((claudeDir) => {
    writeFileSync(
      join(claudeDir, "settings.json"),
      JSON.stringify({ statusLine: { type: "command", command: `node "${claudeDir}/hooks/gsd-statusline.js"` } })
    );
    const result = ensureStatuslineOverride({ claudeDir });
    assert.equal(result.changed, true);
    const written = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8"));
    assert.match(written.statusLine.command, /gsd-context-meter\.mjs/);
  });
});

test("ensureStatuslineOverride: no-op when already pointing at our wrapper", () => {
  withClaudeDir((claudeDir) => {
    const wanted = `node "${join(claudeDir, "hooks", "gsd-context-meter.mjs").replace(/\\/g, "/")}"`;
    writeFileSync(join(claudeDir, "settings.json"), JSON.stringify({ statusLine: { type: "command", command: wanted } }));
    const result = ensureStatuslineOverride({ claudeDir });
    assert.equal(result.changed, false);
  });
});

test("ensureStatuslineOverride: leaves a genuinely custom statusLine command untouched", () => {
  withClaudeDir((claudeDir) => {
    writeFileSync(
      join(claudeDir, "settings.json"),
      JSON.stringify({ statusLine: { type: "command", command: "node /my/own/custom-statusline.js" } })
    );
    const result = ensureStatuslineOverride({ claudeDir });
    assert.equal(result.changed, false);
    const written = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8"));
    assert.equal(written.statusLine.command, "node /my/own/custom-statusline.js");
  });
});
