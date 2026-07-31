#!/usr/bin/env node
// PreToolUse guard (matcher: Bash). Before a `git commit` that stages a decision record, run the
// matching lint and print what is wrong and the command that fixes it. NON-BLOCKING by design:
// this follows ci-watch-nudge and graphify-grep-nudge, not secrets-gate - an unnormalised
// register is untidy, not dangerous. Fail-open: any error => exit 0, no output.
//
// It inspects the STAGED INDEX and never the commit message. db-live-access-gate already
// false-positives on SQL keywords inside messages; a second hook making that mistake would make
// `git commit -F` the only usable form.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRecordPaths } from "../bin/lib/records-paths.mjs";
import { parseRegister, lintRegister } from "../bin/lib/risk-register.mjs";
import { lintAdr, lintCrossRefs } from "../bin/lib/adr-lib.mjs";
import { lintGlossary } from "../bin/lib/glossary-lib.mjs";

function gitSubcommand(tokens) {
  let i = 1;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "-C" || t === "-c") { i += 2; continue; }
    if (t.startsWith("-")) { i++; continue; }
    return t;
  }
  return null;
}

export function isGitCommit(cmd) {
  for (const seg of String(cmd || "").split(/&&|\|\||;|\|/)) {
    const tokens = seg.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    if (tokens[0] !== "git" && tokens[0] !== "git.exe") continue;
    if (gitSubcommand(tokens) === "commit") return true;
  }
  return false;
}

const staged = (cwd) =>
  execFileSync("git", ["-C", cwd, "diff", "--cached", "--name-only"], { encoding: "utf8" })
    .split("\n").filter(Boolean).map((p) => p.replace(/\\/g, "/"));

function readAdrs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".md") && n !== "README.md")
    .map((file) => ({ file, id: `ADR-${file.slice(0, 4)}`, text: readFileSync(join(dir, file), "utf8") }));
}

function main() {
  let d;
  try { d = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { return; }
  // JSON.parse("null") returns null; the property reads below would throw. RISK-HOOKSTDIN-001.
  d = (d && typeof d === "object" && !Array.isArray(d)) ? d : {};
  const input = (d.tool_input && typeof d.tool_input === "object") ? d.tool_input : {};
  if (!isGitCommit(input.command || "")) return;

  const cwd = d.cwd || process.cwd();
  const root = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const paths = resolveRecordPaths(root);
  const rel = (p) => resolve(p).replace(/\\/g, "/").slice(resolve(root).replace(/\\/g, "/").length + 1);

  const files = staged(cwd);
  const touchesRisks = files.includes(rel(paths.risks));
  const touchesAdr = files.some((f) => f.startsWith(`${rel(paths.adrDir)}/`));
  const touchesGlossary = files.includes(rel(paths.glossary));
  if (!touchesRisks && !touchesAdr && !touchesGlossary) return;

  const notes = [];
  if (touchesRisks && existsSync(paths.risks)) {
    const adrIds = readAdrs(paths.adrDir).map((a) => a.id);
    const problems = lintRegister(parseRegister(readFileSync(paths.risks, "utf8")), { knownAdrIds: adrIds });
    if (problems.length)
      notes.push(`RISK_REGISTER.md: ${problems.length} problem(s) — ${problems.slice(0, 3).map((p) => `${p.id}: ${p.problem}`).join("; ")}. Fix: node ~/.claude/bin/risks.mjs normalize`);
  }
  if (touchesAdr) {
    const adrs = readAdrs(paths.adrDir);
    const riskIds = existsSync(paths.risks) ? parseRegister(readFileSync(paths.risks, "utf8")).entries.map((e) => e.id) : [];
    const problems = [...adrs.flatMap((a) => lintAdr(a.text, a.file)), ...lintCrossRefs({ adrs, riskIds })];
    if (problems.length)
      notes.push(`adr/: ${problems.length} problem(s) — ${problems.slice(0, 3).map((p) => `${p.file}: ${p.problem}`).join("; ")}. Check: node ~/.claude/bin/adr.mjs lint`);
  }
  if (touchesGlossary && existsSync(paths.glossary)) {
    const problems = lintGlossary(readFileSync(paths.glossary, "utf8"));
    if (problems.length)
      notes.push(`GLOSSARY.md: ${problems.length} problem(s) — ${problems.slice(0, 3).map((p) => p.problem).join("; ")}. Check: node ~/.claude/bin/glossary.mjs lint`);
  }
  if (notes.length) process.stderr.write(`decision records need a pass:\n- ${notes.join("\n- ")}\n`);
}

// Guarded, or importing `isGitCommit` for a test runs main() and blocks on an empty stdin.
function isMainModule() {
  const a = process.argv[1];
  if (!a) return false;
  const self = fileURLToPath(import.meta.url);
  if (resolve(a) === self) return true;
  try { return realpathSync(a) === self; } catch { return false; }
}

if (isMainModule()) {
  try { main(); } catch { /* fail-open: a nudge that breaks a commit is worse than a missed nudge */ }
  process.exit(0);
}
