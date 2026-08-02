#!/usr/bin/env node
// Node front end for graph-semantic.py: owns the venv so graphify's own environment is never
// touched, then delegates.
//   node graph-semantic.mjs --build          refresh the corpus, then embed it (~2-3 min)
//   node graph-semantic.mjs "<question>"     nearest symbols by meaning (~1 s)
import { existsSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const VENV = join(homedir(), ".graphify", "embed-venv");
const PY = platform() === "win32"
  ? join(VENV, "Scripts", "python.exe")
  : join(VENV, "bin", "python");
const log = (s = "") => process.stdout.write(s + "\n");

function ensureVenv() {
  if (existsSync(PY)) return true;
  const uv = spawnSync("uv", ["--version"], { encoding: "utf8" });
  if (uv.error || uv.status !== 0) {
    log("uv is not installed - it provides the isolated python this needs.");
    log("  install: node ~/.claude/bin/graphify-setup.mjs --bootstrap-uv");
    return false;
  }
  mkdirSync(dirname(VENV), { recursive: true });
  log("creating the embedding environment (once, ~150 MB) ...");
  if (spawnSync("uv", ["venv", VENV, "--python", "3.12"], { stdio: "inherit" }).status !== 0) return false;
  if (spawnSync("uv", ["pip", "install", "--python", PY, "fastembed", "numpy"], { stdio: "inherit" }).status !== 0) return false;
  return existsSync(PY);
}

const argv = process.argv.slice(2);
if (!argv.length) { log('usage: graph-semantic.mjs --build | graph-semantic.mjs "<question>"'); process.exit(0); }
if (!ensureVenv()) process.exit(0);

const script = join(HERE, "graph-semantic.py");
if (argv.includes("--build")) {
  for (const step of ["graph-find.mjs", "graph-docs.mjs"]) {
    const s = join(HERE, step);
    if (existsSync(s)) spawnSync(process.execPath, [s, "--build"], { stdio: "inherit" });
  }
  log("embedding (first run also downloads a ~130 MB model) ...");
  process.exit(spawnSync(PY, [script, "--build"], { stdio: "inherit" }).status ?? 1);
}

const question = argv.filter((a) => !a.startsWith("--")).join(" ");
const limit = (argv.find((a) => a.startsWith("--limit=")) || "--limit=8").slice(8);
process.exit(spawnSync(PY, [script, "--query", question, "--limit", limit], { stdio: "inherit" }).status ?? 1);
