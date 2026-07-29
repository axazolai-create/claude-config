import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "session-init.mjs");
const REGISTER = "# Risk Register\n\n## RISK-X-001 - a pre-existing entry\n\n- **Status:** Open\n";
const SIG = /deny-curated-claude-md\.mjs/g;
// Every other step of the hook is switched off, so the RISK_REGISTER step is the only one left
// that can write into the project tree - an assertion below therefore can't pass by accident.
const QUIET = {
  CLAUDE_GRAPHIFY_AUTOSYNC: "0", CLAUDE_GRAPHIFY_CLAUDE_INSTALL: "0",
  CLAUDE_COMPONENT_AUTOUPDATE: "0", CLAUDE_MCP_SUGGEST: "0", CLAUDE_GSD_INITSTACK_SUGGEST: "0",
  CLAUDE_STACK_RULES: "0", CLAUDE_LEANMODE: "0", CLAUDE_TOKEN_USAGE_LOG: "0",
  CLAUDE_CURATED_AUTOMARK_ROOT: "0", CLAUDE_GSD_CONTEXTMODE_SYNC: "0",
  CLAUDE_GSD_AGENT_PATCHES_CHECK: "0",
};

// `.planning/` is the gsdProject gate the register step sits behind, and `.git` is what findRoot
// latches onto - a migrating project keeps both while its register lives in `.ultrapowers/`.
function withProject(registerDirs) {
  const base = mkdtempSync(join(tmpdir(), "session-init-"));
  const root = join(base, "proj");
  mkdirSync(join(root, ".git"), { recursive: true });
  mkdirSync(join(root, ".planning"), { recursive: true });
  mkdirSync(join(base, "home", "state"), { recursive: true });
  for (const d of registerDirs) {
    const dir = d ? join(root, d) : root;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "RISK_REGISTER.md"), REGISTER);
  }
  return { base, root };
}
const registerAt = (root, d) => readFileSync(join(d ? join(root, d) : root, "RISK_REGISTER.md"), "utf8");
const risks = (text) => (text.match(SIG) || []).length;
const run = (base, root) => execFileSync("node", [HOOK], {
  input: JSON.stringify({ cwd: root }),
  encoding: "utf8",
  env: { ...process.env, ...QUIET, CLAUDE_CONFIG_DIR: join(base, "home") },
});

test("register under .ultrapowers/ gets the GSD-clobber risk, and only once", () => {
  const { base, root } = withProject([".ultrapowers"]);
  run(base, root);
  assert.equal(risks(registerAt(root, ".ultrapowers")), 1);
  run(base, root);
  assert.equal(risks(registerAt(root, ".ultrapowers")), 1, "second session must not re-append");
  rmSync(base, { recursive: true, force: true });
});

test("a root register still outranks the .ultrapowers one", () => {
  const { base, root } = withProject(["", ".ultrapowers"]);
  run(base, root);
  assert.equal(risks(registerAt(root, "")), 1);
  assert.equal(risks(registerAt(root, ".ultrapowers")), 0, "deeper register must be left alone");
  rmSync(base, { recursive: true, force: true });
});

test(".planning and .ultrapowers registers tie on depth -> both maintained", () => {
  const { base, root } = withProject([".planning", ".ultrapowers"]);
  run(base, root);
  assert.equal(risks(registerAt(root, ".planning")), 1);
  assert.equal(risks(registerAt(root, ".ultrapowers")), 1);
  rmSync(base, { recursive: true, force: true });
});
