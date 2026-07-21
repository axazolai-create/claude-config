#!/usr/bin/env node
// PreToolUse guard (matcher: Bash). Cross-platform (Node).
// On `git commit`, scans STAGED changes for secrets. Block = exit 2.
// Zero-dependency regex baseline always runs; gitleaks used additionally if installed.
// Obvious placeholders (your_token, <password>, ghp_xxxx..., YOUR_API_KEY) are allowlisted.
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

const envRe = /process\.env|os\.environ|getenv|import\.meta\.env|\$\{?[A-Z_]+|secrets?\.|vault/i;

// Obvious placeholders / dummy values — skip so example config & docs don't false-positive.
// Word markers apply to every rule; they're too distinctive to collide with high-entropy tokens.
const placeholderRe = /your[_-]?|example|sample|placeholder|change[_-]?(me|this)|redacted|\bdummy\b|\btodo\b|replace[_-]?me|<[^>]+>|x{4,}|\*{3,}|\.{3,}|\bfoo(bar)?\b|\bbar\b|\bfake\b|test[_-]?(secret|token|key|pass|api)|not[_-]?real|_?here\b/i;
// Trivial dummy values — anchored to the START of the value so they can't match as a
// substring inside a real structured token. Applied ONLY to user-chosen values (grp > 0).
const weakPlaceholderRe = /^(?:0+|1+|1234|abcd|abc123|qwerty|letmein|password|secret|changeit)/i;

// [label, regex, valueGroup (0 = whole match), skipEnvLines]
const RULES = [
  ["AWS access key id",                 /AKIA[0-9A-Z]{16}/,                                   0, false],
  ["private key block",                 /-----BEGIN [A-Z ]*PRIVATE KEY-----/,                 0, false],
  ["Slack token",                       /xox[baprs]-[0-9A-Za-z-]{10,}/,                       0, false],
  ["GitHub token",                      /gh[pousr]_[0-9A-Za-z]{20,}/,                         0, false],
  ["credentials in connection string",  /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:@/\s]+:([^@/\s]+)@/,  1, false],
  ["hardcoded secret assignment",       /(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*['"`]?([A-Za-z0-9/+_.-]{12,})/i, 1, true],
];

const hits = [];
for (const [label, re, grp, skipEnv] of RULES) {
  for (const line of added) {
    if (skipEnv && envRe.test(line)) continue;
    const m = line.match(re);
    if (!m) continue;
    const val = grp ? m[grp] : m[0];
    if (placeholderRe.test(val)) continue;            // word marker anywhere in value
    if (grp && weakPlaceholderRe.test(val)) continue; // trivial dummy for user-chosen values
    hits.push(label);
    break;
  }
}

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
