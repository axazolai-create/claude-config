#!/usr/bin/env node
// PostToolUse guard (matcher: Bash). After a `git push` in a repo with GitHub Actions, inject
// a non-blocking reminder to watch the CI run to completion via a backgrounded
// `gh run watch <id> --exit-status` — which EXITS when CI finishes (pass/fail) and thereby
// re-invokes me. That turns "did CI pass?" into a guaranteed push event instead of something
// I must remember to poll. Fail-open: any error => exit 0, no output.
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// First non-flag token after `git`, honouring the value-taking globals `-C <path>` / `-c <kv>`.
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

export function isGitPush(cmd) {
  for (const seg of String(cmd || "").split(/&&|\|\||;|\|/)) {
    const tokens = seg.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    if (tokens[0] !== "git" && tokens[0] !== "git.exe") continue;
    if (gitSubcommand(tokens) === "push") return true;
  }
  return false;
}

function hasGithubActions(start) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ".github", "workflows"))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

function main() {
  let d = {};
  try { d = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { return; }
  const cmd = ((d.tool_input || {}).command) || "";
  if (!isGitPush(cmd)) return;
  const cwd = d.cwd || process.cwd();
  if (!hasGithubActions(cwd)) return; // no GitHub Actions => nothing to watch

  const msg =
    "Pushed to a repo with GitHub Actions. For a guaranteed CI-completion signal, launch in the " +
    "background (run_in_background: true): " +
    "gh run watch \"$(gh run list -L1 --json databaseId -q '.[0].databaseId')\" --exit-status . " +
    "It exits when the run finishes (pass/fail) and re-invokes me — then report the result. " +
    "Don't poll manually; the exit is the signal.";
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: msg },
  }));
}

// Symlink-robust entry-point check: Node realpaths import.meta.url, but process.argv[1]
// keeps the (possibly symlinked) invocation path — so a symlinked ~/.claude makes the naive
// equality FALSE and main() never runs. Match the raw OR the realpath'd argv[1] (covers the
// default resolver and --preserve-symlinks).
function isMainModule() {
  const a = process.argv[1];
  if (!a) return false;
  if (import.meta.url === pathToFileURL(a).href) return true;
  try { return import.meta.url === pathToFileURL(realpathSync(a)).href; } catch { return false; }
}

if (isMainModule()) {
  try { main(); } catch { /* fail-open */ }
  process.exit(0);
}
