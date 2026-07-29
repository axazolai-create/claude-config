#!/usr/bin/env node
// stack-rules-check.mjs - decides whether a project's compiled rules snapshot
// (.claude/stack-rules.md) is current against the source rules in ~/.claude/rules-src/.
// Used by session-init.mjs (adds a rebuild instruction to additionalContext on desync,
// stays silent when in sync). Also runnable directly, for the compiler subagent to get
// the values to stamp into the snapshot's frontmatter:
//   node ~/.claude/hooks/lib/stack-rules-check.mjs [projectRoot]
// prints JSON: { status, sourceHash, stackFingerprint, markers, added, removed, snapshotPath },
// then a paste-ready one-line `markers: {...}` for the frontmatter (the JSON above is indented
// for reading, and an indented markers: block stamps a snapshot that reads back "legacy").
// status is "ok", "stale", "missing" or "legacy"; added/removed name the { workspace, marker }
// pairs that appeared and vanished. sourceHash is stamped but never decides status - it hashes
// mtime, so every setup.mjs deploy moves it with no rule text changing.
// Design: .ultrapowers/archive/specs/2026-07-12-stack-rules-design.md.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { listWorkspaces } from "../../bin/lib/workspaces.mjs";
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");

const sha16 = (s) => createHash("sha1").update(s).digest("hex").slice(0, 16);

// Byte order, never localeCompare: the sorted keys are hashed, and ICU collation reorders plain
// ASCII names per locale and per ICU build (da-DK folds "aa" to the last letter; any locale sorts
// "Web" before "tools" case-insensitively). A fingerprint that moves with someone's LANG cries
// drift on an identical tree - the exact false alarm this check exists to avoid.
const byteOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

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

// Root markers alone miss a monorepo's real stacks: in a pnpm workspace next.config.ts sits in
// apps/web/, so the frontend never registers and its rules never arrive. Keys are workspace-
// relative, "." for the root.
export function detectMarkersByWorkspace(root) {
  const out = { ".": detectMarkers(root) };
  for (const w of listWorkspaces(root).workspaces) out[w.relDir] = detectMarkers(w.dir);
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => byteOrder(a, b)));
}

export const computeStackFingerprint = (root) =>
  sha16(JSON.stringify(detectMarkersByWorkspace(root)));

// markers: is written as a YAML flow mapping, which is also valid JSON. That keeps the
// frontmatter a nested map without adding a YAML parser to a hook that must stay cheap.
// The whole frontmatter is sliced at its closing --- rather than read as a fixed byte window:
// the mapping is one line and `.` does not match a newline, so a window that cuts it short
// parses as null and leaves a large monorepo permanently, silently uncomparable.
function parseFlowMap(head, key) {
  const line = head.match(new RegExp(`^${key}:\\s*(\\{.*\\})\\s*$`, "m"));
  if (!line) return null;
  try { return JSON.parse(line[1]); } catch { return null; }
}

function diffMarkers(before, after) {
  const added = [];
  const removed = [];
  for (const ws of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const was = new Set(before[ws] ?? []);
    const is = new Set(after[ws] ?? []);
    for (const m of is) if (!was.has(m)) added.push({ workspace: ws, marker: m });
    for (const m of was) if (!is.has(m)) removed.push({ workspace: ws, marker: m });
  }
  const order = (a, b) => byteOrder(a.workspace, b.workspace) || byteOrder(a.marker, b.marker);
  return { added: added.sort(order), removed: removed.sort(order) };
}

export function checkStackRules(root, srcDir = join(CLAUDE_DIR, "rules-src")) {
  const sourceHash = computeSourceHash(srcDir);
  const markers = detectMarkersByWorkspace(root);
  const stackFingerprint = sha16(JSON.stringify(markers));
  const snapshotPath = join(root, ".claude", "stack-rules.md");
  const empty = { sourceHash, stackFingerprint, markers, added: [], removed: [], snapshotPath };
  if (!existsSync(snapshotPath)) return { status: "missing", ...empty };
  let text;
  try { text = readFileSync(snapshotPath, "utf8"); } catch { return { status: "missing", ...empty }; }
  const recorded = parseFlowMap((text.match(/^---\r?\n([\s\S]*?)\r?\n---/) || ["", ""])[1], "markers");
  // A snapshot predating workspace-aware markers cannot be compared: its stacks: was a flat root-
  // only list, so every project would report drift on first contact and the check would be
  // switched off a second time. Reported, never flagged; upgraded on the next explicit rebuild.
  if (!recorded) return { status: "legacy", ...empty };
  const { added, removed } = diffMarkers(recorded, markers);
  return { status: added.length || removed.length ? "stale" : "ok", ...empty, added, removed };
}

// CLI mode
// Symlink-robust entry-point check (match raw OR realpath'd argv[1]; Node realpaths
// import.meta.url, so under a symlinked ~/.claude the naive compare is false and main dies).
function isMainModule() {
  const a = process.argv[1];
  if (!a) return false;
  const self = fileURLToPath(import.meta.url);
  if (resolve(a) === self) return true;
  try { return realpathSync(a) === self; } catch { return false; }
}

if (isMainModule()) {
  const root = resolve(process.argv[2] || process.cwd());
  const result = checkStackRules(root);
  console.log(JSON.stringify(result, null, 2));
  // The report above is indented for reading; its `"markers": {` sits on its own line and would
  // stamp a snapshot that reads back "legacy" forever. Print the frontmatter line itself so the
  // compiler subagent copies bytes instead of re-serialising a nested map by hand.
  console.log(`\n# stamp this line verbatim into .claude/stack-rules.md frontmatter:`);
  console.log(`markers: ${JSON.stringify(result.markers)}`);
}
