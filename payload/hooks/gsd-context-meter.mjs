#!/usr/bin/env node
// Registered as statusLine.command (see settings.partial.json) instead of gsd-core's own
// ~/.claude/hooks/gsd-statusline.js directly. Calls the original as a black box - so the
// model/task/milestone-bar segments always match whatever gsd-core currently ships - and
// rewrites only the context-window bar segment to a token-count display. Must never break
// the statusline: any failure falls through to the original's raw output (or nothing).
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeUsedTokenMetrics, rewriteContextBar } from "./lib/gsd-context-meter-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  let output = "";
  try {
    const original = spawnSync(process.execPath, [join(here, "gsd-statusline.js")], {
      input,
      encoding: "utf8",
    });
    output = original.stdout || "";
  } catch {
    // Original script missing/broken - nothing to rewrite, print nothing rather than throw.
  }

  try {
    const data = JSON.parse(input);
    const metrics = computeUsedTokenMetrics(data);
    if (metrics) output = rewriteContextBar(output, metrics);
  } catch {
    // Bad input JSON or compute failure - keep the original's output unmodified.
  }

  process.stdout.write(output);
});
