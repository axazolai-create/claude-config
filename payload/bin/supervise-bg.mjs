#!/usr/bin/env node
// supervise-bg: run a long-running command under a wall-clock timeout AND an output-staleness
// watchdog. On breach it KILLS the child and EXITS (code 124) with a greppable `HANG` marker.
// Because the wrapper process always exits — on normal completion OR on hang-kill — the
// harness's run_in_background re-invocation fires in both cases, converting a hang (which
// otherwise emits no event) into a completion signal the model actually sees.
//
// Usage: node supervise-bg.mjs [--timeout <sec>] [--stale <sec>] [--label <name>] -- <command>
//   Pass the wrapped command as a SINGLE shell-quoted string after `--` (sh -c convention),
//   e.g.  node supervise-bg.mjs --stale 300 -- 'pnpm build'  — so quotes/metacharacters in the
//   command are interpreted by the child's shell, not mangled. Launch via the Bash tool with
//   run_in_background: true.
import { spawn, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseSuperviseArgs, hangCheck, formatHang, formatExit } from "./lib/supervise-lib.mjs";

function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"]);
    else process.kill(-pid, "SIGKILL");
  } catch { /* best-effort */ }
}

function main() {
  const { timeout, stale, label, cmd } = parseSuperviseArgs(process.argv.slice(2));
  if (!cmd.length) { console.error("[supervise] no command given"); process.exit(2); }

  const startTs = Date.now();
  let lastOutputTs = startTs;
  const timeoutMs = timeout * 1000;
  const staleMs = stale * 1000;

  // Run as a single shell command string (sh -c / cmd /c). Passing a single string — rather
  // than (file, args[], {shell:true}) — avoids shell re-interpreting concatenated argv tokens.
  const commandLine = cmd.join(" ");
  const child = spawn(commandLine, {
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32", // own process group on POSIX for reliable tree-kill
  });

  child.stdout.on("data", (d) => { lastOutputTs = Date.now(); process.stdout.write(d); });
  child.stderr.on("data", (d) => { lastOutputTs = Date.now(); process.stderr.write(d); });

  let done = false;
  const cadence = Math.max(1000, Math.min(staleMs || Infinity, timeoutMs || Infinity, 15000));
  const monitor = setInterval(() => {
    if (done) return;
    const hang = hangCheck({ now: Date.now(), startTs, lastOutputTs, timeoutMs, staleMs });
    if (!hang) return;
    done = true;
    clearInterval(monitor);
    process.stderr.write(formatHang(label, hang) + "\n");
    killTree(child.pid);
    process.exit(124);
  }, cadence);

  child.on("exit", (code, signal) => {
    if (done) return;
    done = true;
    clearInterval(monitor);
    const elapsedS = Math.round((Date.now() - startTs) / 1000);
    const c = code == null ? (signal ? `signal:${signal}` : 1) : code;
    process.stdout.write(formatExit(label, c, elapsedS) + "\n");
    process.exit(typeof c === "number" ? c : 1);
  });

  child.on("error", (e) => {
    if (done) return;
    done = true;
    clearInterval(monitor);
    process.stderr.write(`[supervise${label ? ":" + label : ""}] spawn error: ${e.message}\n`);
    process.exit(127);
  });
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
  main();
}
