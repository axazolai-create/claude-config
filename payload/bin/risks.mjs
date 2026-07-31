#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRecordPaths } from "./lib/records-paths.mjs";
import { parseRegister, lintRegister, normalizeRegister, nextId } from "./lib/risk-register.mjs";

const USAGE = `usage:
  risks lint [--root DIR]
  risks normalize [--root DIR]
  risks add "<title>" --prefix PREFIX [--root DIR]`;

function knownAdrIds(adrDir) {
  if (!existsSync(adrDir)) return [];
  return readdirSync(adrDir)
    .map((n) => /^(\d{4})-/.exec(n))
    .filter(Boolean)
    .map((m) => `ADR-${m[1]}`);
}

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : null;
}

function main(argv) {
  const cmd = argv[0];
  const root = resolve(flag(argv, "--root") || process.cwd());
  const paths = resolveRecordPaths(root);
  const today = new Date().toISOString().slice(0, 10);
  if (!existsSync(paths.risks)) {
    console.error(`no register at ${paths.risks}`);
    return 2;
  }
  const parsed = parseRegister(readFileSync(paths.risks, "utf8"));

  if (cmd === "lint") {
    const problems = lintRegister(parsed, { knownAdrIds: knownAdrIds(paths.adrDir) });
    for (const p of problems) console.error(`${p.id}: ${p.problem}`);
    if (problems.length) console.error(`\n${problems.length} problem(s). Fix with: risks normalize`);
    return problems.length ? 1 : 0;
  }

  if (cmd === "normalize") {
    const out = normalizeRegister(parsed, { fallbackDate: today });
    const before = readFileSync(paths.risks, "utf8");
    if (out === before) { console.log("already normalised"); return 0; }
    writeFileSync(paths.risks, out, "utf8");
    console.log(`normalised ${parsed.entries.length} entries -> ${paths.risks}`);
    return 0;
  }

  if (cmd === "add") {
    const title = argv[1];
    const prefix = flag(argv, "--prefix");
    if (!title || !prefix || title.startsWith("--")) { console.error(USAGE); return 2; }
    const id = nextId(parsed, prefix.toUpperCase());
    const entry = `\n### ${id} — ${title}\n- **Status:** Active\n- **Context:** \n- **Mitigation:** \n- **Residual:** \n`;
    const text = readFileSync(paths.risks, "utf8");
    const at = text.indexOf("\n## Deferred");
    const out = at === -1 ? text + entry : text.slice(0, at) + entry + text.slice(at);
    writeFileSync(paths.risks, out, "utf8");
    console.log(id);
    return 0;
  }

  console.error(USAGE);
  return 2;
}

function isMainModule() {
  const a = process.argv[1];
  if (!a) return false;
  const self = fileURLToPath(import.meta.url);
  if (resolve(a) === self) return true;
  try { return realpathSync(a) === self; } catch { return false; }
}

if (isMainModule()) process.exit(main(process.argv.slice(2)));
