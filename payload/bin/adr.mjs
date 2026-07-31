#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRecordPaths } from "./lib/records-paths.mjs";
import { nextAdrNumber, adrTemplate, lintAdr, lintCrossRefs } from "./lib/adr-lib.mjs";
import { parseRegister } from "./lib/risk-register.mjs";

const USAGE = `usage:
  adr new "<title>" [--root DIR]
  adr lint [--root DIR]`;

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : null;
}

function readAdrs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".md") && n !== "README.md")
    .map((file) => ({ file, id: `ADR-${file.slice(0, 4)}`, text: readFileSync(join(dir, file), "utf8") }));
}

function main(argv) {
  const cmd = argv[0];
  const root = resolve(flag(argv, "--root") || process.cwd());
  const paths = resolveRecordPaths(root);

  if (cmd === "new") {
    const title = argv[1];
    if (!title || title.startsWith("--")) { console.error(USAGE); return 2; }
    mkdirSync(paths.adrDir, { recursive: true });
    const number = nextAdrNumber(readdirSync(paths.adrDir));
    const file = join(paths.adrDir, `${number}-${slug(title)}.md`);
    writeFileSync(file, adrTemplate({ number, title, date: new Date().toISOString().slice(0, 10) }), "utf8");
    console.log(file);
    return 0;
  }

  if (cmd === "lint") {
    const adrs = readAdrs(paths.adrDir);
    const riskIds = existsSync(paths.risks)
      ? parseRegister(readFileSync(paths.risks, "utf8")).entries.map((e) => e.id)
      : [];
    const problems = [...adrs.flatMap((a) => lintAdr(a.text, a.file)), ...lintCrossRefs({ adrs, riskIds })];
    for (const p of problems) console.error(`${p.file}: ${p.problem}`);
    return problems.length ? 1 : 0;
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
