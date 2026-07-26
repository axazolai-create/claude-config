// Stack detection: file/dep markers -> stack ids, and stack id -> setting-template relpath.
// Ported 1:1 from payload/bin/init-stack.py (STACK_PATHS :320-343, detect() :151-225 + helpers).
// Self-contained: this module ships inside payload/ (installed standalone into ~/.claude), so it
// must not import from the repo-root variants.mjs (installer-meta, not shipped at runtime).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// Directory names never descended into during a marker walk (mirrors init-stack.py PRUNE).
const PRUNE = new Set([
  ".git", "node_modules", ".venv", "venv", "dist", "build",
  "__pycache__", ".next", "target", ".gradle", ".idea", "obj", "bin",
]);

function readText(p) {
  try { return readFileSync(p, "utf8"); } catch { return ""; }
}

function readJson(p) {
  try { return JSON.parse(readText(p) || "{}"); } catch { return {}; }
}

// Minimal fnmatch-equivalent (local, no repo-root import): "*" -> any run of chars, "?" -> one
// char, case-insensitive (mirrors Python's fnmatch.fnmatch on Windows, our primary target).
// Patterns here are always matched against a bare file/dir NAME, never a path, so unlike
// variants.mjs's path-aware globToRe there's no "*" vs "/" distinction to make.
function fnmatchOne(name, pattern) {
  const re = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${re}$`, "i").test(name);
}
function fnmatchAny(name, patterns) {
  return patterns.some((p) => fnmatchOne(name, p));
}

// Depth-first walk mirroring os.walk(), with PRUNE applied to dirnames before recursing.
function walk(root, visit) {
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return; }
  const dirnames = [];
  const filenames = [];
  for (const e of entries) {
    if (e.isDirectory()) dirnames.push(e.name);
    else if (e.isFile()) filenames.push(e.name);
  }
  const pruned = dirnames.filter((d) => !PRUNE.has(d));
  visit(root, pruned, filenames);
  for (const d of pruned) walk(join(root, d), visit);
}

function globAny(root, ...patterns) {
  let found = false;
  walk(root, (_dirpath, _dirnames, filenames) => {
    if (!found && filenames.some((fn) => fnmatchAny(fn, patterns))) found = true;
  });
  return found;
}

// Same as globAny but matches directory NAMES, not filenames - needed for signals like an
// Xcode project (MyApp.xcodeproj/), which is a directory, not a file.
function globAnyDir(root, ...patterns) {
  let found = false;
  walk(root, (_dirpath, dirnames) => {
    if (!found && dirnames.some((dn) => fnmatchAny(dn, patterns))) found = true;
  });
  return found;
}

function nodeDeps(root) {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return new Set();
  const data = readJson(pkgPath);
  const deps = {};
  for (const k of ["dependencies", "devDependencies", "peerDependencies"]) Object.assign(deps, data[k] || {});
  return new Set(Object.keys(deps));
}

function pyRequirements(root) {
  let text = readText(join(root, "pyproject.toml"));
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { entries = []; }
  for (const e of entries) {
    if (e.isFile() && fnmatchOne(e.name, "requirements*.txt")) text += "\n" + readText(join(root, e.name));
  }
  return text.toLowerCase();
}

function csprojText(root) {
  let text = "";
  walk(root, (dirpath, _dirnames, filenames) => {
    for (const fn of filenames) if (fn.endsWith(".csproj")) text += "\n" + readText(join(dirpath, fn));
  });
  return text.toLowerCase();
}

// ---------- detector-id -> template path (paths no longer mirror the id 1:1 - see
// setting-templates/README.md) ----------
export const STACK_PATHS = {
  react: "frontend/react.json",
  next: "frontend/next.json",
  "react-native": "frontend/react-native.json",
  nest: "backend/node/nest.json",
  node: "backend/node/_base.json",
  django: "backend/python/django.json",
  fastapi: "backend/python/fastapi.json",
  flask: "backend/python/flask.json",
  python: "backend/python/_base.json",
  android: "mobile/android.json",
  swift: "mobile/swift.json",
  dart: "mobile/dart.json",
  kotlin: "CLI/kotlin.json",
  sql: "DB/_base.json",
  turbo: "monorepo/turbo.json",
  nx: "monorepo/nx.json",
  "telegram-node": "bots/node.json",
  "telegram-python": "bots/python.json",
  csharp: "backend/csharp/_base.json",
  aspnet: "backend/csharp/aspnet.json",
  "csharp-cli": "CLI/csharp.json",
  wpf: "desktop/wpf.json",
};

// Ordered, de-duplicated stack-id detection. `root` is a parameter (never a module-global cwd)
// so callers/tests can point it at any directory, including temp roots.
export function detect(root) {
  const found = [];
  const node = nodeDeps(root);

  if (node.has("@nestjs/core") || existsSync(join(root, "nest-cli.json"))) found.push("nest");
  if (node.has("next") || globAny(root, "next.config.*")) found.push("next");
  // react-native/Expo checked BEFORE plain "react" (react-native itself depends on react, so
  // without this ordering an RN project would get double-tagged as both "react" and
  // "react-native"). Expo apps in managed workflow may not ship metro.config.*, so the "expo"
  // dep and app.config.{js,ts} are checked too, not just metro.config.*.
  if (
    node.has("react-native") || node.has("expo") ||
    globAny(root, "metro.config.js", "metro.config.ts", "metro.config.mjs", "app.config.js", "app.config.ts")
  ) {
    found.push("react-native");
  } else if (node.has("react")) {
    found.push("react");
  }
  // Bare "node" stack: package.json exists but no frontend/backend framework matched above - a
  // plain Node/TS script, library, or unopinionated backend. Mirrors "sql": "DB/_base.json"
  // (see STACK_PATHS) - reuses the direction's own _base.json as a framework-less leaf.
  if (node.size && !["nest", "next", "react", "react-native"].some((s) => found.includes(s))) found.push("node");

  const py = pyRequirements(root);
  if (py.includes("django") || existsSync(join(root, "manage.py"))) found.push("django");
  if (py.includes("fastapi")) found.push("fastapi");
  if (py.includes("flask")) found.push("flask");

  if (globAny(root, "*.kt", "*.kts", "build.gradle.kts")) found.push("kotlin");
  // Android is its own stack (extends the "mobile" direction), separate from generic Kotlin/JVM
  // (a Kotlin/Ktor backend service is not mobile) - gated on the one signal that's actually
  // Android-specific rather than "any Kotlin file exists".
  if (globAny(root, "AndroidManifest.xml")) found.push("android");

  // Flutter checked before Swift: a Flutter/RN repo's vendored ios/ folder also contains a
  // native Xcode project + Info.plist, which would otherwise false-positive as a standalone
  // native-iOS ("swift") project. Only tag "swift" when this ISN'T already Flutter or RN.
  if (existsSync(join(root, "pubspec.yaml"))) found.push("dart");
  if (
    !found.includes("dart") && !found.includes("react-native") &&
    (globAny(root, "Package.swift") || globAnyDir(root, "*.xcodeproj", "*.xcworkspace"))
  ) {
    found.push("swift");
  }

  if (existsSync(join(root, "turbo.json"))) found.push("turbo");
  if (existsSync(join(root, "nx.json"))) found.push("nx");

  const nodeBotLibs = new Set(["telegraf", "grammy", "node-telegram-bot-api"]);
  if ([...node].some((d) => nodeBotLibs.has(d))) found.push("telegram-node");
  if (["aiogram", "python-telegram-bot", "pytelegrambotapi"].some((lib) => py.includes(lib))) found.push("telegram-python");
  // Bare "python" stack: pyproject.toml/requirements*.txt exists but no framework or bot lib
  // matched above - a plain script, library, or unopinionated backend. Same fallback pattern as
  // "node" above.
  if (py && !["django", "fastapi", "flask", "telegram-python"].some((s) => found.includes(s))) found.push("python");

  const cs = csprojText(root);
  const hasXaml = globAny(root, "*.xaml");
  if (cs) {
    if (cs.includes('sdk="microsoft.net.sdk.web"') || cs.includes("microsoft.aspnetcore")) found.push("aspnet");
    if (cs.includes("<usewpf>true") || cs.includes("<usewindowsforms>true") || hasXaml) found.push("wpf");
    if (cs.includes("outputtype>exe") && !["aspnet", "wpf"].some((s) => found.includes(s))) found.push("csharp-cli");
    if (!["aspnet", "wpf", "csharp-cli"].some((s) => found.includes(s))) found.push("csharp");
  } else if (hasXaml || globAny(root, "*.cs")) {
    found.push(hasXaml ? "wpf" : "csharp");
  }

  if (globAny(root, "*.sql")) found.push("sql");

  const seen = new Set();
  return found.filter((s) => (seen.has(s) ? false : (seen.add(s), true)));
}

// Thin object-arg wrapper for call sites that pass a params object (bin/init-stack.mjs).
export function detectStacks({ root }) {
  return detect(root);
}
