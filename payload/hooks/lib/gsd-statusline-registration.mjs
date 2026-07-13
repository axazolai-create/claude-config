// Non-interactive counterpart to setup.mjs's own (diff+prompt-driven) statusLine handling
// in its settings.json merge block - used by the CLI wrapper invoked from /init-stack,
// which has no interactive prompt to fall back on, so it only ever takes over from an
// unset value or from gsd-core's own default (gsd-statusline.js); anything else is left
// untouched and reported, never silently clobbered.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const safe = (fn) => { try { return fn(); } catch { return undefined; } };

function desiredCommand(claudeDir) {
  const scriptPath = join(claudeDir, "hooks", "gsd-context-meter.mjs").replace(/\\/g, "/");
  return `node "${scriptPath}"`;
}

export function ensureStatuslineOverride({ claudeDir }) {
  const settingsPath = join(claudeDir, "settings.json");
  if (!existsSync(settingsPath)) return { changed: false, reason: "settings.json missing" };
  const parsed = safe(() => JSON.parse(readFileSync(settingsPath, "utf8")));
  if (parsed === undefined) return { changed: false, reason: "settings.json invalid JSON" };

  const wanted = desiredCommand(claudeDir);
  const currentCmd = parsed.statusLine && parsed.statusLine.command;
  const isOurs = typeof currentCmd === "string" && currentCmd.includes("gsd-context-meter");
  if (isOurs) return { changed: false, reason: "already set" };

  const isGsdCoreDefault = typeof currentCmd === "string" && currentCmd.includes("gsd-statusline.js");
  if (currentCmd && !isGsdCoreDefault)
    return { changed: false, reason: `statusLine.command points at a custom value (${currentCmd}) - left untouched` };

  parsed.statusLine = { type: "command", command: wanted };
  writeFileSync(settingsPath, JSON.stringify(parsed, null, 2) + "\n");
  return { changed: true, reason: currentCmd ? "took over from gsd-statusline.js" : "set (was unset)" };
}
