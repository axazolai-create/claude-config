#!/usr/bin/env node
// stack-rules-check.mjs - decides whether a project's compiled rules snapshot
// (.claude/stack-rules.md) is current against the source rules in ~/.claude/rules-src/.
// Used by session-init.mjs (adds a rebuild instruction to additionalContext on desync,
// stays silent when in sync). Also runnable directly, for the compiler subagent to get
// the values to stamp into the snapshot's frontmatter:
//   node ~/.claude/hooks/lib/stack-rules-check.mjs [projectRoot]
// prints JSON: { status, sourceHash, stackFingerprint, markers, snapshotPath }.
// Design: docs/superpowers/specs/2026-07-12-stack-rules-design.md.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");

const sha16 = (s) => createHash("sha1").update(s).digest("hex").slice(0, 16);

// Hash of the source rules: relative path + size + mtime per .md file. Cheap (no content
// read); any real edit deployed via setup.mjs or made by hand touches size/mtime.
export function computeSourceHash(srcDir) {
  const parts = [];
  const stack = [srcDir];
  while (stack.length) {
    const dir = stack.pop();
    let ents = [];
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const ap = join(dir, e.name);
      if (e.isDirectory()) stack.push(ap);
      else if (e.isFile() && e.name.endsWith(".md")) {
        try {
          const st = statSync(ap);
          parts.push(`${relative(srcDir, ap).replace(/\\/g, "/")}|${st.size}|${Math.floor(st.mtimeMs)}`);
        } catch { /* file vanished mid-scan - skip */ }
      }
    }
  }
  return sha16(parts.sort().join("\n"));
}

// Stack signature markers. This only needs to CHANGE when the project's stack changes -
// the compiler subagent does the real detection per rules-src/README.md; this is just a
// cheap desync signal. Keep in sync with the "Building stack-rules" section there.
const ROOT_PATTERNS = [
  ["node", /^package\.json$/],
  ["next", /^next\.config\./],
  ["vite", /^vite\.config\./],
  ["nest", /^nest-cli\.json$/],
  ["react-native", /^metro\.config\.js$|^app\.config\.(js|ts)$/],
  ["python", /^pyproject\.toml$|^requirements[^/]*\.txt$/],
  ["django", /^manage\.py$/],
  ["kotlin", /^(build|settings)\.gradle\.kts$/],
  ["swift", /^Package\.swift$|\.xcodeproj$|\.xcworkspace$/],
  ["dart", /^pubspec\.yaml$/],
  ["go", /^go\.mod$/],
  ["csharp", /\.(csproj|sln|xaml)$/],
  ["turbo", /^turbo\.json$/],
  ["nx", /^nx\.json$/],
  ["pnpm-ws", /^pnpm-workspace\.yaml$/],
  ["docker", /^Dockerfile|^docker-compose.*\.ya?ml$/],
  ["gsd", /^\.planning$/],
];
const NESTED_PATHS = [
  ["android", "app/src/main/AndroidManifest.xml"],
  ["android", "android/app/src/main/AndroidManifest.xml"],
  ["ci", ".github/workflows"],
  ["bot-node", "bot.ts"],
  ["bot-node", "bot.js"],
  ["bot-python", "bot.py"],
];

export function detectMarkers(root) {
  const found = new Set();
  let ents = [];
  try { ents = readdirSync(root); } catch { /* unreadable root - empty fingerprint */ }
  for (const name of ents)
    for (const [tag, re] of ROOT_PATTERNS) if (re.test(name)) found.add(tag);
  for (const [tag, rel] of NESTED_PATHS)
    if (existsSync(join(root, rel))) found.add(tag);
  return [...found].sort();
}

export const computeStackFingerprint = (root) => sha16(detectMarkers(root).join(","));

export function checkStackRules(root, srcDir = join(CLAUDE_DIR, "rules-src")) {
  const sourceHash = computeSourceHash(srcDir);
  const stackFingerprint = computeStackFingerprint(root);
  const snapshotPath = join(root, ".claude", "stack-rules.md");
  let status = "missing";
  if (existsSync(snapshotPath)) {
    let head = "";
    try { head = readFileSync(snapshotPath, "utf8").slice(0, 800); } catch { /* treat as missing */ }
    const oldSrc = (head.match(/^sourceHash:\s*(\S+)/m) || [])[1];
    const oldFp = (head.match(/^stackFingerprint:\s*(\S+)/m) || [])[1];
    status = oldSrc === sourceHash && oldFp === stackFingerprint ? "ok" : "stale";
  }
  return { status, sourceHash, stackFingerprint, snapshotPath };
}

// CLI mode
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] || process.cwd());
  const result = checkStackRules(root);
  console.log(JSON.stringify({ ...result, markers: detectMarkers(root) }, null, 2));
}
