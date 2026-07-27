import { fileURLToPath } from "node:url";
import { realpathSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { claudeDir, buildPlan, applyPlan, purgeRetention, restoreBatch, listTrashBatches, trashRoot }
  from "./lib/claude-cleanup-lib.mjs";
import { rmSync } from "node:fs";

export function parseArgs(argv) {
  const opts = { excludeSession: [] };
  const cmd = (argv[0] && !argv[0].startsWith("--")) ? argv[0] : "scan";
  for (let i = (cmd === argv[0] ? 1 : 0); i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === "--temp-root") opts.tempRoot = next();
    else if (a === "--exclude-session") opts.excludeSession.push(next());
    else if (a === "--ts") opts.ts = next();
    else if (a === "--plan") opts.plan = next();
  }
  return { cmd, opts };
}

function isMain() {
  const a = process.argv[1]; if (!a) return false;
  const self = fileURLToPath(import.meta.url);
  if (resolve(a) === self) return true;
  try { return realpathSync(a) === self; } catch { return false; }
}

function stamp(nowMs) { return new Date(nowMs).toISOString().replace(/[:.]/g, "").replace(/-/g, ""); }

export function main(argv = process.argv.slice(2), nowMs = Date.now()) {
  const dir = claudeDir();
  const { cmd, opts } = parseArgs(argv);
  if (cmd === "scan") {
    const plan = buildPlan({ dir, tempRoot: opts.tempRoot, nowMs, excludeUuids: opts.excludeSession });
    process.stdout.write(JSON.stringify(plan, null, 2));
  } else if (cmd === "apply") {
    if (!opts.plan) { process.stderr.write("apply requires --plan <file>\n"); process.exitCode = 1; return; }
    const finalized = JSON.parse(readFileSync(opts.plan, "utf8")); // { items, ts? }
    const res = applyPlan({ dir, items: finalized.items, nowMs, ts: finalized.ts || stamp(nowMs) });
    process.stdout.write(`Moved ${res.moved} items (${res.bytes} bytes) to ${res.batchDir}; skipped ${res.skipped}.\n`);
  } else if (cmd === "purge-retention") {
    const removed = purgeRetention({ dir, nowMs });
    process.stdout.write(`Purged ${removed.length} trash batch(es): ${removed.join(", ") || "none"}.\n`);
  } else if (cmd === "empty-trash") {
    for (const b of listTrashBatches(dir)) rmSync(b.dir, { recursive: true, force: true });
    rmSync(trashRoot(dir), { recursive: true, force: true });
    process.stdout.write("Trash emptied.\n");
  } else if (cmd === "restore") {
    if (!opts.ts) { process.stderr.write("restore requires --ts <ts>\n"); process.exitCode = 1; return; }
    const res = restoreBatch({ dir, ts: opts.ts });
    process.stdout.write(`Restored ${res.restored}; skipped ${res.skipped}.\n`);
  }
}

if (isMain()) main();
