#!/usr/bin/env node
// CLI entry point for payload/commands/init-stack.md (step 10) and for anyone re-running it
// standalone after editing gsd-defaults.partial.json. Mirrors apply-gsd-agent-patches.mjs's
// shape: thin argv-driven wrapper around the lib, prints a plain-text summary.
// Reads ./gsd-defaults.partial.json - the mirror copy setup.mjs writes into ~/.claude
// alongside this script (Task 9) - not the repo's own copy, which won't exist on a machine
// that only ever unpacked-and-ran once.
// Usage: node gsd-defaults-sync.mjs [homeDir] [projectDir]
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { syncGsdGlobalDefaults, syncProjectConfig, findProjectRoot } from "./hooks/lib/gsd-defaults-sync.mjs";
import { ensureStatuslineOverride } from "./hooks/lib/gsd-statusline-registration.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const homeDir = process.argv[2] || homedir();
const partial = JSON.parse(readFileSync(join(here, "gsd-defaults.partial.json"), "utf8"));

const g = syncGsdGlobalDefaults({ homeDir, partial });
console.log(g.changed
  ? `Updated ${g.path} (deep-additive merge; your existing values were kept).`
  : `${g.path}: already up to date.`);

const projectRoot = findProjectRoot(process.argv[3] || process.cwd());
const p = syncProjectConfig({ projectRoot, partial });
console.log(p.skipped
  ? `Project config: skipped (${p.reason}).`
  : p.changed
    ? `Updated ${p.path} (reference values applied; other keys untouched).`
    : `${p.path}: already up to date.`);

const s = ensureStatuslineOverride({ claudeDir: join(homeDir, ".claude") });
console.log(s.changed ? `statusLine: ${s.reason}.` : `statusLine: no change (${s.reason}).`);
