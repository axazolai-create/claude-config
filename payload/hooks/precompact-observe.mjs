#!/usr/bin/env node
// payload/hooks/precompact-observe.mjs
// PreCompact carries no context_window, so the compaction point cannot be read where it
// fires. The transcript's last assistant usage is that point, in tokens. Recorded unkeyed;
// statusline.mjs promotes it once it knows the model id and window size.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { safe, readJSON, writeFile, readJSONLRecords } from "./lib/token-usage-shared.mjs";
import { observationFrom } from "./lib/autocompact.mjs";

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const STATE = join(CLAUDE_DIR, "state", "autocompact.json");

let d = {};
try { d = JSON.parse(safe(() => readFileSync(0, "utf8")) || "{}"); } catch { process.exit(0); }
d = (d && typeof d === "object") ? d : {};
if (d.trigger !== "auto" || !d.transcript_path) process.exit(0);

const seen = safe(() => observationFrom(readJSONLRecords(d.transcript_path)));
if (!seen) process.exit(0);

const state = safe(() => readJSON(STATE)) || {};
state.pending = { tokens: seen.tokens, model: seen.model, at: new Date().toISOString() };
writeFile(STATE, JSON.stringify(state, null, 2));
process.exit(0);
