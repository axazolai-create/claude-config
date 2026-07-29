#!/usr/bin/env node
// Enumerates monorepo workspace directories from the repo root. Used by the Monorepo mode
// section of SKILL.md to find candidate parts (web/backend/mobile/...) before running
// detect-project.mjs / write-changelog.mjs against each one with --root.
// The logic lives in ~/.claude/bin/lib/workspaces.mjs: the stack-rules fingerprint needs the
// same enumeration, and two implementations of "what are this repo's workspaces" would drift.
import { listWorkspaces } from "../../../bin/lib/workspaces.mjs";

const args = process.argv.slice(2);
const i = args.indexOf("--root");
console.log(JSON.stringify(listWorkspaces(i !== -1 && args[i + 1] ? args[i + 1] : process.cwd())));
