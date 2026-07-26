#!/usr/bin/env node
// Multi-axis rule injector. Registered on SessionStart (main loop) and SubagentStart (agents).
// Reads stdin JSON, resolves every axis in lib/inject-axes.mjs independently, and injects the
// composed rule blocks as additionalContext. No matcher in settings — filtering happens here.
import { readFileSync } from "node:fs";
import { AXES } from "./lib/inject-axes.mjs";
import { findRoot } from "./lib/leanmode-rules.mjs";

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
let d = {};
try { d = JSON.parse(safe(() => readFileSync(0, "utf8")) || "{}"); } catch { process.exit(0); }

const event = d.hook_event_name || (d.agent_type ? "SubagentStart" : "SessionStart");
if (event === "SubagentStart" && !d.agent_type) process.exit(0);
const agentType = d.agent_type || "main";
const root = findRoot(d.cwd || process.cwd());

const blocks = [], labels = [];
for (const axis of AXES) {
  if (process.env[axis.killSwitchEnv] === "0") continue;
  if (!axis.events.includes(event)) continue;
  const level = safe(() => axis.resolve(agentType, root)) || "off";
  if (level === "off") continue;
  const text = safe(() => axis.loadRuleText(level)) || "";
  if (text) { blocks.push(text); labels.push(`${axis.name}: ${level}`); }
}
if (!blocks.length) process.exit(0);

process.stdout.write(JSON.stringify({
  systemMessage: labels.join(" · "),
  hookSpecificOutput: { hookEventName: event, additionalContext: blocks.join("\n\n") },
}));
