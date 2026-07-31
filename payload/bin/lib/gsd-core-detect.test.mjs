import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gsdCorePresent, buildGsdInventory, filterGsdHooks, gsdCoreInstallPlan } from "./gsd-core-detect.mjs";

function claudeDir(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "gsd-detect-"));
  for (const [rel, text] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, text);
  }
  return dir;
}

test("presence is decided by gsd-core/VERSION alone", () => {
  assert.equal(gsdCorePresent(claudeDir({})), false);
  assert.equal(gsdCorePresent(claudeDir({ "gsd-core/VERSION": "1.8.0\n" })), true);
});

test("the inventory covers exactly the five surfaces", () => {
  const dir = claudeDir({
    "gsd-core/VERSION": "1.8.0\n",
    "skills/gsd-plan-phase/SKILL.md": "x",
    "agents/gsd-planner.md": "x",
    "agents/other.md": "x",
    "hooks/gsd-config-patch.mjs": "x",
    "hooks/lib/gsd-agent-patches.mjs": "x",
    "hooks/session-init.mjs": "x",
    "skills/update-changelog/SKILL.md": "x",
  });
  const { items, categories } = buildGsdInventory({ dir, manifestRels: [] });
  const rels = items.map((i) => i.absPath.slice(dir.length + 1).replace(/\\/g, "/")).sort();
  assert.deepEqual(rels, [
    "agents/gsd-planner.md",
    "gsd-core",
    "hooks/gsd-config-patch.mjs",
    "hooks/lib/gsd-agent-patches.mjs",
    "skills/gsd-plan-phase",
  ]);
  assert.equal(categories.find((c) => c.name === "agents").count, 1);
});

test("a path this bundle owns is never in the inventory", () => {
  const dir = claudeDir({
    "gsd-core/VERSION": "1.8.0\n",
    "hooks/gsd-context-meter.mjs": "x",
    "hooks/lib/gsd-context-meter-lib.mjs": "x",
  });
  const { items } = buildGsdInventory({
    dir,
    manifestRels: ["hooks/gsd-context-meter.mjs", "hooks/lib/gsd-context-meter-lib.mjs"],
  });
  assert.deepEqual(items.map((i) => i.absPath.slice(dir.length + 1).replace(/\\/g, "/")), ["gsd-core"]);
});

test("manifest subtraction matches directory-shaped categories by prefix, not just exact rel", () => {
  const dir = claudeDir({
    "gsd-core/VERSION": "1.8.0\n",
    "skills/gsd-bundle-owned/SKILL.md": "x",
    "skills/gsd-foreign/SKILL.md": "x",
  });
  const { items } = buildGsdInventory({ dir, manifestRels: ["skills/gsd-bundle-owned/SKILL.md"] });
  const rels = items.map((i) => i.absPath.slice(dir.length + 1).replace(/\\/g, "/")).sort();
  assert.deepEqual(rels, ["gsd-core", "skills/gsd-foreign"]);
});

test("every item carries what applyPlan needs", () => {
  const dir = claudeDir({ "gsd-core/VERSION": "1.8.0\n" });
  for (const it of buildGsdInventory({ dir, manifestRels: [] }).items)
    for (const k of ["absPath", "size", "category", "reason", "mtimeMs"])
      assert.ok(k in it, `${k} missing`);
});

test("only gsd hook registrations are dropped, and they are reported", () => {
  const settings = {
    hooks: {
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "node", args: ["/h/.claude/hooks/gsd-config-patch.mjs"] }] },
        { matcher: "Bash", hooks: [{ type: "command", command: "node", args: ["/h/.claude/hooks/secrets-gate.mjs"] }] },
      ],
      SessionStart: [{ hooks: [{ type: "command", command: "node", args: ["/h/.claude/hooks/gsd-session.mjs"] }] }],
    },
    model: "opus",
  };
  const { settings: out, removed } = filterGsdHooks(settings);
  assert.equal(out.hooks.PreToolUse.length, 1);
  assert.equal(out.hooks.SessionStart.length, 0);
  assert.equal(removed.length, 2);
  assert.equal(out.model, "opus");
  assert.equal(settings.hooks.PreToolUse.length, 2, "input must not be mutated");
});

// Verbatim shapes from the live gsd-core install this feature targets: one quoted command line,
// no args array at all. Matching only `args` left every real registration in place.
test("a gsd-core command-string registration is dropped even with no args array", () => {
  const settings = {
    hooks: {
      SessionStart: [
        { hooks: [{ type: "command", command: '"C:/Program Files/nodejs/node.exe" "C:/Users/Axa/.claude/hooks/gsd-check-update.js"' }] },
        { hooks: [{ type: "command", command: '"C:/Users/Axa/.claude/hooks/gsd-session-state.sh"' }] },
        { hooks: [{ type: "command", command: '"C:/Program Files/nodejs/node.exe" "C:/Users/Axa/.claude/hooks/session-init.mjs"' }] },
        { hooks: [{ type: "command", command: "node /h/.claude/hooks/lib/gsd-agent-patches.mjs" }] },
        { hooks: [{ type: "command", command: "node C:\\Users\\Axa\\.claude\\hooks\\gsd-phase-boundary.sh --quiet" }] },
      ],
    },
  };
  const { settings: out, removed } = filterGsdHooks(settings);
  assert.deepEqual(removed.map((r) => r.event), ["SessionStart", "SessionStart", "SessionStart"]);
  assert.equal(out.hooks.SessionStart.length, 2, "a non-gsd hook or a hooks/lib entry was dropped");
});

// Boundary of the command-string match, including the one over-reach RISK-ULTRAPOWERS-009 documents:
// a gsd path passed as an ARGUMENT to some other script is dropped too. Pinned rather than fixed -
// the alternative is parsing command lines - so a future narrowing has to face it deliberately.
test("the command-string match holds its boundary in both directions", () => {
  const cases = [
    ['"C:/nodejs/node.exe" "C:/Users/a/.claude/hooks/gsd-x.js"', true, "quoted absolute path"],
    ["node C:\\Users\\a\\.claude\\hooks\\gsd-x.js --flag", true, "backslashes, unquoted, trailing arg"],
    ["node hooks/gsd-x.js", true, "space-preceded relative path"],
    ["hooks/gsd-x.js", true, "relative path at the start of the string"],
    ["node 'hooks/gsd-x.js'", true, "single-quoted"],
    ['node "/h/.claude/hooks/lib/other.mjs" --patch "/h/.claude/hooks/gsd-x.js"', true, "gsd path as an argument (documented over-reach)"],
    ['node "/h/.claude/hooks/lib/gsd-agent-patches.mjs"', false, "hooks/lib is never a registered hook"],
    ['node "/h/.claude/my-hooks/gsd-x.js"', false, "a different directory ending in hooks"],
    ['node "/h/.claude/xhooks/gsd-x.js"', false, "no separator before hooks"],
    ['node "/h/.hooks/gsd-x.js"', false, "dot-prefixed directory"],
    ['node "/h/.claude/hooks/gsd/x.js"', false, "gsd is a directory, not a gsd- prefix"],
    ['node "/h/.claude/hooks/session-init.mjs"', false, "an unrelated hook"],
  ];
  for (const [command, shouldDrop, why] of cases) {
    const { removed } = filterGsdHooks({ hooks: { X: [{ hooks: [{ type: "command", command }] }] } });
    assert.equal(removed.length, shouldDrop ? 1 : 0, `${why}: ${command}`);
  }
});

test("a hooks-less settings object survives untouched", () => {
  const { settings, removed } = filterGsdHooks({ model: "opus" });
  assert.deepEqual(settings, { model: "opus" });
  assert.deepEqual(removed, []);
});

// The full profile ships the GSD machinery (agents, hooks, rules) but gsd-core itself comes from
// npx, never a marketplace. Detecting it by VERSION on disk is the only honest check: an enabled
// plugin entry proved nothing, and that was the old mistake.
test("full without gsd-core installed asks, and the command installs globally for Claude", () => {
  const plan = gsdCoreInstallPlan({ variant: "full", present: false, interactive: true });
  assert.equal(plan.action, "ask");
  assert.match(plan.command, /^npx -y @opengsd\/gsd-core@latest /);
  assert.match(plan.command, /--global/);
  assert.match(plan.command, /--claude/);
});

test("without a TTY the same situation only prints the command", () => {
  const plan = gsdCoreInstallPlan({ variant: "full", present: false, interactive: false });
  assert.equal(plan.action, "print");
  assert.match(plan.command, /@opengsd\/gsd-core/);
});

test("gsd-core already on disk means nothing to do", () => {
  assert.equal(gsdCoreInstallPlan({ variant: "full", present: true, interactive: true }).action, "none");
});

// base and lite deliberately exclude the GSD machinery; offering to install the tool there would
// contradict the detector that offers to REMOVE it.
test("base and lite never offer to install it", () => {
  for (const variant of ["base", "lite"]) {
    assert.equal(gsdCoreInstallPlan({ variant, present: false, interactive: true }).action, "none");
  }
});

test("a non-default config dir is passed through, and omitted when default", () => {
  const custom = gsdCoreInstallPlan({
    variant: "full", present: false, interactive: true,
    configDir: "D:/alt/.claude", defaultConfigDir: "C:/Users/x/.claude",
  });
  assert.match(custom.command, /--config-dir "D:\/alt\/\.claude"/);
  const plain = gsdCoreInstallPlan({
    variant: "full", present: false, interactive: true,
    configDir: "C:/Users/x/.claude", defaultConfigDir: "C:/Users/x/.claude",
  });
  assert.doesNotMatch(plain.command, /--config-dir/);
});
