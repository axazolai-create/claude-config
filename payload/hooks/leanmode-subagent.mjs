#!/usr/bin/env node
// leanmode - SubagentStart hook. Reads agent_type from stdin, resolves the effective level via
// lib/leanmode-rules.mjs, and injects the matching rule text as additionalContext. No matcher in
// settings.partial.json on purpose - filtering happens here so adding a new agent_type to
// DEFAULT_LEANMODE_MAP never requires touching the hook registration.
// Master kill switch: CLAUDE_LEANMODE=0 disables this hook entirely.
import { readFileSync } from "node:fs";
import { findRoot, resolveEffectiveLevel, loadRuleText } from "./lib/leanmode-rules.mjs";

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
function emit(ctx) {
  try {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: ctx || "" }
    }));
  } catch { /* ignore */ }
  process.exit(0);
}

if (process.env.CLAUDE_LEANMODE === "0") process.exit(0);

let d = {};
try { d = JSON.parse(safe(() => readFileSync(0, "utf8")) || "{}"); } catch { process.exit(0); }

const agentType = d.agent_type;
if (!agentType) process.exit(0);

const root = findRoot(d.cwd || process.cwd());
const level = resolveEffectiveLevel(agentType, root);
if (level === "off") process.exit(0);

const text = loadRuleText(level);
if (!text) process.exit(0);

emit(text);
