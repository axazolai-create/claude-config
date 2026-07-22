#!/usr/bin/env node
// Best-effort: nudge if the installed graphify lags PyPI. Fail-soft: no network / not
// installed / parse error => exit 0 silently. Never blocks setup or init-stack.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { get } from "node:https";
import { pathToFileURL } from "node:url";

export function cmpSemver(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    // A non-numeric/prerelease segment parses to NaN; `|| 0` intentionally coerces it to
    // 0 (fail-soft), not an oversight.
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

function installedVersion() {
  const r = spawnSync("graphify", ["--version"], { encoding: "utf8", timeout: 3000 });
  if (r.error || r.status !== 0 || !r.stdout) return null;
  const m = r.stdout.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

function latestVersion(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const req = get("https://pypi.org/pypi/graphifyy/json", (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => { try { resolve(JSON.parse(body).info.version); } catch { resolve(null); } });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
  });
}

async function main() {
  const installed = installedVersion();
  if (!installed) return;                 // graphify not installed -> nothing to nudge
  const latest = await latestVersion();
  if (!latest) return;                    // offline -> silent
  if (cmpSemver(installed, latest) < 0) {
    process.stdout.write(
      `\n[graphify] update available: ${installed} installed, ${latest} on PyPI.\n` +
      `  Upgrade: uv tool upgrade graphifyy  (or: python -m pip install -U graphifyy),\n` +
      `  then run 'graphify install' to refresh the skill files.\n`);
  }
}

// Only run the network path when invoked as a script, not when imported by the test.
// Symlink-robust entry-point check: Node realpaths import.meta.url, but process.argv[1]
// keeps the (possibly symlinked) invocation path — so a symlinked ~/.claude makes the naive
// equality FALSE and main() never runs. Match the raw OR the realpath'd argv[1] (covers the
// default resolver and --preserve-symlinks).
function isMainModule() {
  const a = process.argv[1];
  if (!a) return false;
  if (import.meta.url === pathToFileURL(a).href) return true;
  try { return import.meta.url === pathToFileURL(realpathSync(a)).href; } catch { return false; }
}

if (isMainModule()) {
  main().then(() => process.exit(0)).catch(() => process.exit(0));
}
