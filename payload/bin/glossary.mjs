#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync, statSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRecordPaths } from "./lib/records-paths.mjs";
import { parseGlossary, lintGlossary, suggestTerms } from "./lib/glossary-lib.mjs";

const USAGE = `usage:
  glossary lint [--root DIR]
  glossary suggest [--root DIR] [--min-count N]`;

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : null;
}

function collect(dir, out = [], depth = 0) {
  if (depth > 4 || !existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collect(full, out, depth + 1);
    else if (name.endsWith(".md")) out.push({ path: full, text: readFileSync(full, "utf8") });
  }
  return out;
}

function main(argv) {
  const cmd = argv[0];
  const root = resolve(flag(argv, "--root") || process.cwd());
  const paths = resolveRecordPaths(root);
  const text = existsSync(paths.glossary) ? readFileSync(paths.glossary, "utf8") : "";

  if (cmd === "lint") {
    if (!existsSync(paths.glossary)) { console.log("no glossary yet - nothing to lint"); return 0; }
    const problems = lintGlossary(text);
    for (const p of problems) console.error(p.problem);
    return problems.length ? 1 : 0;
  }

  if (cmd === "suggest") {
    const documents = collect(root);
    const found = suggestTerms({
      documents,
      defined: parseGlossary(text).map((e) => e.term),
      minCount: Number(flag(argv, "--min-count") || 5),
    });
    if (!found.length) { console.log("no undefined terms above the threshold"); return 0; }
    for (const f of found) console.log(`${String(f.count).padStart(4)}  ${f.term}  (${f.files.length} files)`);
    console.log("\nThese are gaps, not proposals. Define the ones that are genuinely overloaded; ignore the rest.");
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
