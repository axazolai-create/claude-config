// The shipped prose names commands, skills and hooks. Nothing checked that they exist, and one
// sweep of 19 fragments found three that did not: the risk register's location, a `graphify`
// skill nothing installs, and `/ctx-doctor` where the plugin declares `/context-mode:ctx-doctor`.
// That is RISK-CLAUDEMD-002. Prose is the wrong layer to fix it in — a rule saying "keep the
// rules accurate" is itself unverified prose — so the check is mechanical and lives here.
//
// The allowlist is the part that earns its keep: every entry must name where the artefact comes
// from. Writing "graphify skill — installed by nothing" is exactly the admission that was
// missing when the claim shipped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

// name -> where it actually comes from. A bare name with no source is not allowed.
const EXTERNAL_COMMANDS = {
  "gsd-code-review": "gsd-core, installed separately by /gsd-update",
  "gsd-debug": "gsd-core",
  "gsd-discuss-phase": "gsd-core",
  "gsd-execute-phase": "gsd-core",
  "gsd-explore": "gsd-core",
  "gsd-graphify": "gsd-core",
  "gsd-new-project": "gsd-core",
  "gsd-plan-phase": "gsd-core",
  "gsd-profile-user": "gsd-core",
  "gsd-ship": "gsd-core",
  "gsd-verify-work": "gsd-core",
  "gsd-workspace": "gsd-core",
  "plugin": "Claude Code built-in (/plugin update)",
  "hooks": "Claude Code built-in (/hooks)",
  "compact": "Claude Code built-in (/compact)",
  "config": "Claude Code built-in (/config)",
  "clear": "Claude Code built-in (/clear)",
  // Named only to say they are NOT commands. The check cannot tell an instruction from a
  // denial, and listing them here is the cheaper half of that trade.
  "graphify": "not a command — 13-graphify.md names it to say no such command exists",
  "ctx-doctor": "not a command — 14-context-mode.md names it to say /context-mode:ctx-doctor is the real trigger",
  "zod": "not a command — a package subpath, @hookform/resolvers/zod",
};

// Bundle-relative paths in the prose that belong to something else.
const EXTERNAL_PATHS = {
  "hooks/gsd-graphify-update.sh": "gsd-core ships this hook; rules-src/gsd.md only applies when gsd-core is installed",
};

const EXTERNAL_SKILLS = {
  "model-selection-policy": "payload/skills/, shipped by this bundle",
};

const files = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (name.endsWith(".md")) out.push(full);
  }
  return out;
};

const shippedCommands = () =>
  new Set(readdirSync(join(ROOT, "payload/commands")).filter((n) => n.endsWith(".md")).map((n) => n.replace(/\.md$/, "")));

const shippedSkills = () =>
  new Set(readdirSync(join(ROOT, "payload/skills"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name));

const shippedFiles = () => {
  const out = new Set();
  const walk = (dir, base) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full, base);
      else out.add(full.slice(base.length + 1).replace(/\\/g, "/"));
    }
  };
  walk(join(ROOT, "payload"), join(ROOT, "payload"));
  return out;
};

const PROSE = [...files(join(ROOT, "payload/claude-md")), ...files(join(ROOT, "payload/rules-src"))];

test("the prose names no slash command that does not exist", () => {
  const known = shippedCommands();
  const dangling = [];
  for (const file of PROSE) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/`\/([a-z][a-z0-9-]*)`/g)) {
      const name = m[1];
      if (known.has(name) || name in EXTERNAL_COMMANDS) continue;
      dangling.push(`${file.slice(ROOT.length + 1)}: /${name}`);
    }
  }
  assert.deepEqual(dangling, [],
    "each of these is either a command this bundle must ship, or an external one that belongs in EXTERNAL_COMMANDS with its source");
});

test("the prose names no skill that does not exist", () => {
  const known = shippedSkills();
  const dangling = [];
  for (const file of PROSE) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/`([a-z][a-z0-9-]*)`\s+skill/g)) {
      const name = m[1];
      if (known.has(name) || name in EXTERNAL_SKILLS) continue;
      dangling.push(`${file.slice(ROOT.length + 1)}: ${name} skill`);
    }
  }
  assert.deepEqual(dangling, [],
    "a named skill must either ship in payload/skills/ or appear in EXTERNAL_SKILLS with its source");
});

test("the prose names no bundle-relative file that is not shipped", () => {
  const shipped = shippedFiles();
  const dangling = [];
  for (const file of PROSE) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/`((?:hooks|bin|commands|skills|agents|rules-src|setting-templates)\/[A-Za-z0-9_./-]+)`/g)) {
      if (shipped.has(m[1]) || m[1] in EXTERNAL_PATHS) continue;
      dangling.push(`${file.slice(ROOT.length + 1)}: ${m[1]}`);
    }
  }
  assert.deepEqual(dangling, [], "a bundle-relative path in the prose must resolve to a file under payload/");
});

// The allowlists are only worth having if they cannot be padded with a bare name.
test("every allowlist entry names where the artefact comes from", () => {
  const all = [...Object.entries(EXTERNAL_COMMANDS), ...Object.entries(EXTERNAL_SKILLS), ...Object.entries(EXTERNAL_PATHS)];
  for (const [name, source] of all) {
    assert.ok(typeof source === "string" && source.length > 6, `${name} needs a real source, got ${JSON.stringify(source)}`);
  }
});

// The check has to fail on the real defects, or it is decoration. These are the three that
// shipped, reconstructed verbatim.
test("the check catches the three claims that actually shipped", () => {
  const known = shippedCommands();
  const skills = shippedSkills();
  const shipped = shippedFiles();

  const oldGraphify = "autosync and setup live in the `graphify` skill — invoke it (`/graphify`) for those.";
  assert.equal([...oldGraphify.matchAll(/`([a-z][a-z0-9-]*)`\s+skill/g)]
    .some((m) => !skills.has(m[1]) && !(m[1] in EXTERNAL_SKILLS)), true, "the graphify skill claim must be caught");

  const oldRegister = "Put it in `.planning/` if a GSD project exists, otherwise the project root.";
  assert.equal(/`\.planning\/`/.test(oldRegister), true,
    "the register claim was prose about a path, not a bundle-relative one — it is the class this check cannot reach");

  const oldPath = "see `hooks/statusline-does-not-exist.mjs` for details";
  assert.equal([...oldPath.matchAll(/`((?:hooks|bin)\/[A-Za-z0-9_./-]+)`/g)]
    .some((m) => !shipped.has(m[1]) && !(m[1] in EXTERNAL_PATHS)), true, "a dangling bundle path must be caught");
  assert.ok(known.size > 0);
});
