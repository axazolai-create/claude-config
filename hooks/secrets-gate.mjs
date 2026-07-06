#!/usr/bin/env node
// PreToolUse guard (matcher: Bash). Cross-platform (Node).
// On `git commit`, scans STAGED changes for secrets. Block = exit 2.
// Zero-dependency regex baseline always runs; gitleaks used additionally if installed.
// Fires only on commits made through Claude's Bash tool, not your manual terminal commits.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function stdin() { try { return readFileSync(0, "utf8"); } catch { return ""; } }

let d = {};
try { d = JSON.parse(stdin() || "{}"); } catch { process.exit(0); }

const cmd = (((d.tool_input || {}).command) || "").replace(/\s+/g, " ");
if (!cmd) process.exit(0);
if (!/(^|[;&|\s])git(\s+-[^\s]+)*\s+commit(\s|$)/.test(cmd)) process.exit(0);

const cwd = d.cwd || process.cwd();
const git = (args) => spawnSync("git", args, { cwd, encoding: "utf8" });

// git missing or not a repo -> let the real command fail naturally
const inside = git(["rev-parse", "--is-inside-work-tree"]);
if (inside.error || inside.status !== 0) process.exit(0);

const diff = git(["diff", "--cached", "-U0", "--no-color"]);
if (diff.error || diff.status !== 0) process.exit(0);

const added = (diff.stdout || "").split("\n").filter(l => l.startsWith("+") && !l.startsWith("+++"));
if (added.length === 0) process.exit(0);

const text = added.join("\n");
const envRe = /process\.env|os\.environ|getenv|import\.meta\.env|\$\{?[A-Z_]+|secrets?\.|vault/i;
const noenvNoQuotes = added.filter(l => !envRe.test(l)).join("\n").replace(/["'`]/g, "");

const hits = [];
if (/AKIA[0-9A-Z]{16}/.test(text)) hits.push("AWS access key id");
if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) hits.push("private key block");
if (/xox[baprs]-[0-9A-Za-z-]{10,}/.test(text)) hits.push("Slack token");
if (/gh[pousr]_[0-9A-Za-z]{20,}/.test(text)) hits.push("GitHub token");
if (/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:@/\s]+:[^@/\s]+@/.test(text)) hits.push("credentials in connection string");
if (/(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*[A-Za-z0-9/+_.-]{12,}/i.test(noenvNoQuotes)) hits.push("hardcoded secret assignment");

// gitleaks (authoritative, additive) if present
const gl = spawnSync("gitleaks", ["protect", "--staged", "--no-banner"], { cwd, encoding: "utf8" });
if (!gl.error && gl.status !== 0) hits.push("gitleaks flagged staged changes");

if (hits.length) {
  process.stderr.write(
    "Denied: possible secrets in staged changes. Remove/unstage them before committing.\n" +
    "Matched rules:\n" + hits.map(h => "- " + h).join("\n") + "\n"
  );
  process.exit(2);
}
process.exit(0);
