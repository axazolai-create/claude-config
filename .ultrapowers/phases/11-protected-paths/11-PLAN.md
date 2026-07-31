# .protected — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use ultrapowers:subagent-driven-development (recommended) or ultrapowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `PreToolUse` hook that refuses to edit, delete or move any path listed in a `.protected` file, while leaving reads and copies-from alone.

**Architecture:** `payload/hooks/lib/protected-lib.mjs` holds every decision as a pure function — the gitignore-subset matcher, the rule assembler, the bash heuristic and the verdict. `payload/hooks/protected-guard.mjs` is the entry point: parse stdin, call `decide`, exit 2 with the message or exit 0.

**Tech Stack:** Node ESM, `node:test`, no dependencies, no subprocesses (the suite asserts hooks never spawn one).

## Global Constraints

- Payload-only: all code under `payload/`. Registration in `settings.partial.json`.
- Exit 2 denies and feeds stderr back to Claude; exit 0 allows. Any failure to understand the input allows.
- The literal `null` stdin payload must not throw — guard with `d = (d && typeof d === "object") ? d : {}` immediately after the parse.
- Denial message, verbatim shape:
  ```
  Denied: <path> is protected.
  Rule: <file>:<line>  `<pattern>`
  Protected paths may be read and copied FROM, never edited, deleted or moved.
  ```
- `.protected` and `.gitignore` are always writable; deleting either is always denied.
- Paths compared POSIX-style relative to the project root.

---

### Task 1: The gitignore-subset matcher

**Files:**
- Create: `payload/hooks/lib/protected-lib.mjs`
- Test: `payload/hooks/lib/protected-lib.test.mjs`

**Interfaces:**
- Produces: `parseRules(text, base = "")` → `Array<{pattern, negated, base, line, re, dirOnly, anchored}>`; `matchRules(rules, relPath)` → the winning rule object or `null`. Last match wins; a negated winner yields `null`.

- [ ] **Step 1: Write the failing test**

```js
// payload/hooks/lib/protected-lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRules, matchRules } from "./protected-lib.mjs";

const hit = (rules, p) => { const h = matchRules(rules, p); return h ? h.pattern : null; };

test("an exact path matches only itself", () => {
  const r = parseRules("docs/spec.md\n");
  assert.equal(hit(r, "docs/spec.md"), "docs/spec.md");
  assert.equal(hit(r, "docs/other.md"), null);
});

test("an unanchored glob matches at any depth", () => {
  const r = parseRules("*.key\n");
  assert.equal(hit(r, "a/b/private.key"), "*.key");
  assert.equal(hit(r, "a/b/private.pem"), null);
});

test("a leading slash anchors to the declaring directory", () => {
  const r = parseRules("/root-only.md\n");
  assert.equal(hit(r, "root-only.md"), "/root-only.md");
  assert.equal(hit(r, "sub/root-only.md"), null);
});

test("a trailing slash covers the directory and everything under it", () => {
  const r = parseRules("secrets/\n");
  assert.equal(hit(r, "secrets"), "secrets/");
  assert.equal(hit(r, "secrets/a/b.txt"), "secrets/");
});

test("double star spans directories", () => {
  assert.equal(hit(parseRules("docs/**\n"), "docs/a/b/c.md"), "docs/**");
});

test("the last matching rule wins, so a later negation unprotects", () => {
  const r = parseRules("docs/\n!docs/draft.md\n");
  assert.equal(hit(r, "docs/draft.md"), null);
  assert.equal(hit(r, "docs/final.md"), "docs/");
});

test("comments and blank lines are skipped, and rules keep their line numbers", () => {
  const r = parseRules("# comment\n\n  \ndocs/spec.md\n");
  assert.equal(r.length, 1);
  assert.equal(r[0].line, 4);
});

test("character classes work", () => {
  const r = parseRules("file[0-9].md\n");
  assert.equal(hit(r, "file3.md"), "file[0-9].md");
  assert.equal(hit(r, "fileX.md"), null);
});

test("a rule declared in a subdirectory does not escape it", () => {
  const r = [...parseRules("a.md\n", ""), ...parseRules("b.md\n", "sub")];
  assert.equal(hit(r, "sub/b.md"), "b.md");
  assert.equal(hit(r, "b.md"), null);
  assert.equal(hit(r, "a.md"), "a.md");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test payload/hooks/lib/protected-lib.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

This code was executed against the assertions above before this plan was written.

```js
// Protected-path rules: a .gitignore-format subset, matched with last-rule-wins semantics.
const ESC = (s) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&");

export function ruleToRegExp(pattern) {
  let p = pattern;
  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.slice(0, -1);
  // A slash anywhere but the last position anchors the rule, exactly as .gitignore does.
  const anchored = p.startsWith("/") || p.slice(0, -1).includes("/");
  if (p.startsWith("/")) p = p.slice(1);
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        const before = i === 0 || p[i - 1] === "/";
        const after = p[i + 2] === "/" || i + 2 >= p.length;
        if (before && after) { re += "(?:.*)"; i += p[i + 2] === "/" ? 2 : 1; continue; }
        re += "[^/]*"; i += 1; continue;
      }
      re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "[") {
      const end = p.indexOf("]", i + 1);
      if (end === -1) { re += "\\["; continue; }
      let cls = p.slice(i + 1, end);
      if (cls.startsWith("!")) cls = "^" + cls.slice(1);
      re += `[${cls}]`;
      i = end;
    } else re += ESC(c);
  }
  return { re: new RegExp(`${anchored ? "^" : "^(?:.*/)?"}${re}(?:/.*)?$`), dirOnly, anchored };
}

export function parseRules(text, base = "") {
  const out = [];
  String(text ?? "").split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const negated = line.startsWith("!");
    const pattern = negated ? line.slice(1) : line;
    if (!pattern) return;
    out.push({ pattern, negated, base, line: i + 1, ...ruleToRegExp(pattern) });
  });
  return out;
}

export function matchRules(rules, relPath) {
  let hit = null;
  for (const r of rules) {
    const scoped = r.base ? (relPath === r.base || relPath.startsWith(r.base + "/")) : true;
    if (!scoped) continue;
    if (r.re.test(r.base ? relPath.slice(r.base.length + 1) : relPath)) hit = r;
  }
  return hit && !hit.negated ? hit : null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test payload/hooks/lib/protected-lib.test.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add payload/hooks/lib/protected-lib.mjs payload/hooks/lib/protected-lib.test.mjs
git commit -m "feat(protected): match a gitignore-format subset, last rule wins"
```

---

### Task 2: Assembling the rules from the tree

**Files:**
- Modify: `payload/hooks/lib/protected-lib.mjs`
- Test: `payload/hooks/lib/protected-lib.test.mjs`

**Interfaces:**
- Consumes: `parseRules` from Task 1.
- Produces: `collectRules(root, relPath)` → `{rules, hidden}`. `rules` is every `.protected` from the root down `relPath`'s own chain, concatenated root-first. `hidden` is the relative path of the first `.protected` that `.gitignore` would hide, or `null`.

- [ ] **Step 1: Write the failing test**

```js
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { collectRules } from "./protected-lib.mjs";

const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), "prot-"));
  for (const [p, body] of Object.entries(files)) {
    const abs = join(root, p);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
};

test("rules come from every .protected down the target's own chain", () => {
  const root = tree({ ".protected": "a.md\n", "sub/.protected": "b.md\n", "other/.protected": "c.md\n" });
  const { rules } = collectRules(root, "sub/b.md");
  assert.deepEqual(rules.map((r) => r.pattern), ["a.md", "b.md"]);
});

test("a nested file's negation beats an ancestor because it comes later", () => {
  const root = tree({ ".protected": "docs/\n", "docs/.protected": "!spec.md\n" });
  const { rules } = collectRules(root, "docs/spec.md");
  assert.equal(matchRules(rules, "docs/spec.md"), null);
});

test("a .protected hidden by .gitignore is reported", () => {
  const root = tree({ ".gitignore": ".protected\n", ".protected": "docs/\n" });
  assert.equal(collectRules(root, "docs/spec.md").hidden, ".protected");
});

test("an unhidden .protected reports nothing", () => {
  const root = tree({ ".gitignore": "node_modules/\n", ".protected": "docs/\n" });
  assert.equal(collectRules(root, "docs/spec.md").hidden, null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test payload/hooks/lib/protected-lib.test.mjs`
Expected: FAIL — `collectRules is not a function`.

- [ ] **Step 3: Implement**

```js
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

export function collectRules(root, relPath) {
  const segs = relPath.split("/").filter(Boolean);
  const dirs = [""];
  for (let i = 0; i < segs.length - 1; i++) dirs.push(segs.slice(0, i + 1).join("/"));
  const rules = [];
  let hidden = null;
  for (const dir of dirs) {
    const rel = dir ? `${dir}/.protected` : ".protected";
    const text = read(join(root, rel.split("/").join("/")));
    if (text == null) continue;
    rules.push(...parseRules(text, dir));
    if (!hidden && isHidden(root, rel)) hidden = rel;
  }
  return { rules, hidden };
}

// Same matcher, applied to .gitignore: a protection that git would not carry to another
// machine is not a project rule. No `git check-ignore` — hooks never spawn a subprocess.
function isHidden(root, rel) {
  const segs = rel.split("/");
  const dirs = [""];
  for (let i = 0; i < segs.length - 1; i++) dirs.push(segs.slice(0, i + 1).join("/"));
  for (const dir of dirs) {
    const text = read(join(root, dir ? `${dir}/.gitignore` : ".gitignore"));
    if (text == null) continue;
    if (matchRules(parseRules(text, dir), rel)) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test payload/hooks/lib/protected-lib.test.mjs`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add payload/hooks/lib/protected-lib.mjs payload/hooks/lib/protected-lib.test.mjs
git commit -m "feat(protected): assemble rules down the chain and flag a hidden list"
```

---

### Task 3: The bash heuristic and the verdict

**Files:**
- Modify: `payload/hooks/lib/protected-lib.mjs`
- Test: `payload/hooks/lib/protected-lib.test.mjs`

**Interfaces:**
- Produces: `bashTargets(command)` → `{destructive, parseable, paths, dests}`; `decide({root, tool, path, command})` → `null` when allowed, or `{message}` when denied.

Rules `decide` implements, from the spec:
1. `.gitignore` and `.protected` files are always writable; deleting or moving either is denied.
2. A hidden `.protected` denies every write in its scope (except rule 1).
3. Path tools are judged exactly. `Bash` is judged by `bashTargets`.
4. `cp` destination protected → deny; source alone → allow; unparseable + a protected path mentioned → deny.

- [ ] **Step 1: Write the failing test**

```js
import { bashTargets, decide } from "./protected-lib.mjs";

test("reads are never destructive", () => {
  assert.equal(bashTargets("cat docs/spec.md").destructive, false);
});

test("rm, mv, git rm, sed -i, find -delete and redirection are destructive", () => {
  for (const c of ["rm docs/a.md", "mv a b", "git rm x", "sed -i s/a/b/ f", "find . -delete", "echo x > f"])
    assert.equal(bashTargets(c).destructive, true, c);
});

test("a redirection names its destination, glued or spaced", () => {
  assert.deepEqual(bashTargets("echo x > docs/spec.md").dests, ["docs/spec.md"]);
  assert.deepEqual(bashTargets("echo x >docs/spec.md").dests, ["docs/spec.md"]);
});

test("cp takes its destination from -t or from the last operand", () => {
  assert.deepEqual(bashTargets("cp -t docs/ a.md b.md").dests, ["docs/"]);
  assert.deepEqual(bashTargets("cp draft.md docs/spec.md").dests, ["docs/spec.md"]);
});

test("substitutions and globs make a command unparseable", () => {
  assert.equal(bashTargets("cp $SRC docs/x.md").parseable, false);
  assert.equal(bashTargets("rm docs/*.md").parseable, false);
});

test("editing a protected path is denied and the message names the rule", () => {
  const root = tree({ ".protected": "docs/spec.md\n" });
  const v = decide({ root, tool: "Edit", path: join(root, "docs/spec.md") });
  assert.match(v.message, /^Denied: docs\/spec\.md is protected\./m);
  assert.match(v.message, /Rule: \.protected:1  `docs\/spec\.md`/);
  assert.match(v.message, /read and copied FROM, never edited, deleted or moved/);
});

test("editing an unprotected path is allowed", () => {
  const root = tree({ ".protected": "docs/spec.md\n" });
  assert.equal(decide({ root, tool: "Edit", path: join(root, "docs/other.md") }), null);
});

test("copying FROM a protected path is allowed, copying ONTO it is not", () => {
  const root = tree({ ".protected": "docs/spec.md\n" });
  assert.equal(decide({ root, tool: "Bash", command: "cp docs/spec.md /tmp/" }), null);
  assert.ok(decide({ root, tool: "Bash", command: "cp draft.md docs/spec.md" }));
});

test("an unparseable command mentioning a protected path is denied", () => {
  const root = tree({ ".protected": "docs/spec.md\n" });
  const v = decide({ root, tool: "Bash", command: "rm -rf $TARGET/docs/spec.md" });
  assert.ok(v);
  assert.match(v.message, /could not be parsed/);
});

// This is the intrinsic rule, and it is why .protected must not be listed inside itself:
// no entry could express "editable but undeletable", and one that tried would be negatable.
test(".protected may be edited but never deleted", () => {
  const root = tree({ ".protected": "docs/\n" });
  assert.equal(decide({ root, tool: "Edit", path: join(root, ".protected") }), null);
  const v = decide({ root, tool: "Bash", command: "rm .protected" });
  assert.ok(v);
  assert.match(v.message, /intrinsic to the mechanism/);
});

// A path lifted out of an unparseable command carries junk ahead of the real one, so the
// suffixes are tried too — without this the protection switches off exactly where it matters.
test("a protected path is found inside an unparseable command", () => {
  const root = tree({ ".protected": "docs/spec.md\n" });
  assert.ok(decide({ root, tool: "Bash", command: "rm -rf $TARGET/docs/spec.md" }));
});

test("a hidden list denies every write in scope, but not the repair", () => {
  const root = tree({ ".gitignore": ".protected\n", ".protected": "docs/\n" });
  const denied = decide({ root, tool: "Edit", path: join(root, "anything.md") });
  assert.ok(denied);
  assert.match(denied.message, /hidden by `\.gitignore`/);
  assert.equal(decide({ root, tool: "Edit", path: join(root, ".gitignore") }), null);
  assert.equal(decide({ root, tool: "Edit", path: join(root, ".protected") }), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test payload/hooks/lib/protected-lib.test.mjs`
Expected: FAIL — `bashTargets is not a function`.

- [ ] **Step 3: Implement**

`bashTargets` is the prototype verified before this plan; `decide` composes it with Task 2.

```js
import { relative, resolve, basename } from "node:path";

const DESTRUCTIVE = /\b(rm|mv|truncate|dd|shred)\b|\bgit\s+(rm|mv)\b|\bsed\b[^|;]*\s-i\b|\bfind\b[^|;]*(-delete|-exec\s+rm)|\b(tar|unzip)\b/;
const UNPARSEABLE = /[$`]|\*|\?|\[|\bxargs\b/;
const ALWAYS_WRITABLE = new Set([".gitignore", ".protected"]);

export function bashTargets(command) {
  const cmd = String(command ?? "");
  const v = { destructive: false, parseable: true, paths: [], dests: [] };
  if (!DESTRUCTIVE.test(cmd) && !/>>?\s*\S/.test(cmd) && !/\bcp\b/.test(cmd)) return v;
  v.destructive = true;
  if (UNPARSEABLE.test(cmd)) v.parseable = false;
  const toks = cmd.split(/\s+/).filter(Boolean);
  const unquote = (t) => t.replace(/^["']|["']$/g, "");
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === ">" || t === ">>") { if (toks[i + 1]) v.dests.push(unquote(toks[i + 1])); continue; }
    const rd = /^>>?(\S+)$/.exec(t);
    if (rd) { v.dests.push(unquote(rd[1])); continue; }
    if (/[/.]/.test(t) && !t.startsWith("-")) v.paths.push(unquote(t));
  }
  if (/\bcp\b/.test(cmd)) {
    const ti = toks.findIndex((t) => t === "-t" || t === "--target-directory");
    if (ti !== -1 && toks[ti + 1]) v.dests.push(unquote(toks[ti + 1]));
    else if (v.paths.length) v.dests.push(v.paths[v.paths.length - 1]);
  }
  return v;
}

const MSG = (p, rule, extra) =>
  [`Denied: ${p} is protected.`,
   `Rule: ${rule.base ? rule.base + "/" : ""}.protected:${rule.line}  \`${rule.pattern}\``,
   "Protected paths may be read and copied FROM, never edited, deleted or moved.",
   ...extra].join("\n");

const REMOVES = /\b(rm|mv|shred)\b|\bgit\s+(rm|mv)\b/;
const INTRINSIC = "`.protected` may be edited but never deleted or moved. That rule is intrinsic to the mechanism, not an entry in any list.";
// A path lifted out of an unparseable command may carry junk ahead of the real one
// ($TARGET/docs/spec.md). Trying each suffix is what makes "deny anything suspicious" bite.
const suffixes = (p) => { const s = p.split("/").filter(Boolean); return s.map((_, i) => s.slice(i).join("/")); };

export function decide({ root, tool, path, command }) {
  const rel = (abs) => relative(root, resolve(root, abs)).split("\\").join("/");
  const isRepairFile = (p) => ALWAYS_WRITABLE.has(basename(p));

  if (tool !== "Bash") {
    if (!path) return null;
    const r = rel(path);
    if (isRepairFile(r)) return null;                       // rule 1: edits stay open
    const { rules, hidden } = collectRules(root, r);
    if (hidden) return { message: hiddenMsg(hidden) };      // rule 2
    const rule = matchRules(rules, r);
    return rule ? { message: MSG(r, rule, []) } : null;
  }

  const t = bashTargets(command);
  if (!t.destructive) return null;
  const cmd = String(command);
  const removing = REMOVES.test(cmd);
  const cpOnly = /\bcp\b/.test(cmd) && !DESTRUCTIVE.test(cmd);
  const considered = cpOnly && t.parseable
    ? [...new Set(t.dests)].map(rel)
    : [...new Set([...t.paths, ...t.dests])].map(rel);

  for (const c of considered) {
    for (const cand of t.parseable ? [c] : suffixes(c)) {
      if (isRepairFile(cand)) {
        // The intrinsic rule: editing stays open, removal never does.
        if (removing) return { message: `Denied: ${cand} may not be deleted or moved.\n${INTRINSIC}` };
        continue;
      }
      const { rules, hidden } = collectRules(root, cand);
      if (hidden) return { message: hiddenMsg(hidden) };
      const rule = matchRules(rules, cand);
      if (rule) return { message: MSG(cand, rule, t.parseable ? [] : [UNPARSED]) };
    }
  }
  return null;
}

const UNPARSED = "This command could not be parsed. Rephrase it with literal paths and it will be judged exactly.";
const hiddenMsg = (rel) => [
  `Denied: \`${rel}\` is hidden by \`.gitignore\`, so this protection would not exist on another machine.`,
  "Every write in its scope is denied until that is fixed.",
  "Remove the entry from .gitignore — that file and .protected stay writable for exactly this repair.",
].join("\n");
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test payload/hooks/lib/protected-lib.test.mjs`
Expected: PASS, 24 tests.

- [ ] **Step 5: Commit**

```bash
git add payload/hooks/lib/protected-lib.mjs payload/hooks/lib/protected-lib.test.mjs
git commit -m "feat(protected): judge bash heuristically and produce the verdict"
```

---

### Task 4: The hook and its registration

**Files:**
- Create: `payload/hooks/protected-guard.mjs`
- Create: `payload/hooks/protected-guard.test.mjs`
- Modify: `settings.partial.json`

**Interfaces:**
- Consumes: `decide` from Task 3.
- Produces: a registered `PreToolUse` hook. No exports.

- [ ] **Step 1: Write the failing test**

```js
// payload/hooks/protected-guard.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "protected-guard.mjs");
const run = (payload) => spawnSync(process.execPath, [HOOK], { input: payload, encoding: "utf8" });
const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), "protguard-"));
  for (const [p, body] of Object.entries(files)) {
    const abs = join(root, p);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
};

test("editing a protected path exits 2 and explains", () => {
  const root = tree({ ".protected": "docs/spec.md\n" });
  const r = run(JSON.stringify({ cwd: root, tool_name: "Edit", tool_input: { file_path: join(root, "docs/spec.md") } }));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /is protected/);
});

test("editing an unprotected path exits 0 silently", () => {
  const root = tree({ ".protected": "docs/spec.md\n" });
  const r = run(JSON.stringify({ cwd: root, tool_name: "Edit", tool_input: { file_path: join(root, "docs/other.md") } }));
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
});

test("a destructive bash command against a protected path exits 2", () => {
  const root = tree({ ".protected": "docs/\n" });
  const r = run(JSON.stringify({ cwd: root, tool_name: "Bash", tool_input: { command: "rm -rf docs" } }));
  assert.equal(r.status, 2);
});

test("reading is never blocked", () => {
  const root = tree({ ".protected": "docs/\n" });
  const r = run(JSON.stringify({ cwd: root, tool_name: "Bash", tool_input: { command: "cat docs/spec.md" } }));
  assert.equal(r.status, 0);
});

test("input the hook cannot understand allows, and a literal null does not throw", () => {
  for (const payload of ["", "not json", "null", "[]", "42"]) {
    const r = run(payload);
    assert.equal(r.status, 0, `payload ${JSON.stringify(payload)}`);
    assert.equal(r.stderr, "", `payload ${JSON.stringify(payload)} wrote to stderr`);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test payload/hooks/protected-guard.test.mjs`
Expected: FAIL — hook file missing.

- [ ] **Step 3: Implement the hook**

```js
#!/usr/bin/env node
// PreToolUse guard (matcher: Edit|Write|MultiEdit|NotebookEdit|Bash). Refuses to edit, delete
// or move any path a .protected file lists; reading and copying FROM stay allowed. Every
// decision lives in lib/protected-lib.mjs — this file only reads stdin and sets the exit code.
// Block = exit 2 (stderr fed back to Claude). Anything it cannot understand => allow (exit 0).
import { readFileSync } from "node:fs";
import { decide } from "./lib/protected-lib.mjs";

let d;
try { d = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { process.exit(0); }
// JSON.parse("null") returns null and JSON.parse("[]") an array; both would throw on the
// property reads below. This is RISK-HOOKSTDIN-001, guarded here rather than inherited.
d = (d && typeof d === "object" && !Array.isArray(d)) ? d : {};

const input = (d.tool_input && typeof d.tool_input === "object") ? d.tool_input : {};
const verdict = (() => {
  try {
    return decide({
      root: d.cwd || process.cwd(),
      tool: d.tool_name || "",
      path: input.file_path || input.notebook_path || "",
      command: input.command || "",
    });
  } catch { return null; }
})();

if (verdict) { process.stderr.write(verdict.message + "\n"); process.exit(2); }
process.exit(0);
```

- [ ] **Step 4: Register it**

In `settings.partial.json`, add to `hooks.PreToolUse`, following the exec form every other entry uses:

```json
{
  "matcher": "Edit|Write|MultiEdit|NotebookEdit|Bash",
  "hooks": [{ "type": "command", "command": "node", "args": ["<CLAUDE_DIR>/hooks/protected-guard.mjs"] }]
}
```

Copy the `<CLAUDE_DIR>` placeholder form from the neighbouring entries verbatim — `setup.mjs` rewrites it.

- [ ] **Step 5: Run both test files and the whole suite**

Run: `node --test payload/hooks/protected-guard.test.mjs payload/hooks/lib/protected-lib.test.mjs`
Then: `node --test` and `node --test .test/unit/*.test.mjs`
Expected: PASS everywhere. The suite-wide "no hook spawns a subprocess" assertion must still hold — `protected-lib.mjs` imports only `node:fs` and `node:path`.

- [ ] **Step 6: Commit**

```bash
git add payload/hooks/protected-guard.mjs payload/hooks/protected-guard.test.mjs settings.partial.json
git commit -m "feat(protected): register the PreToolUse guard"
```

---

### Task 5: Document it

**Files:**
- Modify: `README.md`, `README.en.md`

- [ ] **Step 1: Write the section**

Describe: the file and its format, that it binds downward, that a nested file may extend or override (with the accepted escape hatch stated plainly), the intrinsic rule about `.protected` itself, what is intercepted, that copying FROM is allowed, and that a `.gitignore`-hidden list denies everything in scope except the two repair files.

- [ ] **Step 2: Verify the hook count line**

Run: `grep -n "PreToolUse x" README.md README.en.md setup.mjs`
Expected: every place that counts registered hooks is updated — the count rises by one.

- [ ] **Step 3: Commit**

```bash
git add README.md README.en.md setup.mjs
git commit -m "docs(readme): describe .protected"
```

---

## Verification before the phase closes

- [ ] `node --test` and `node --test .test/unit/*.test.mjs` both green.
- [ ] `node --test payload/hooks/protected-guard.test.mjs` green, including the malformed-input cases.
- [ ] A real `.protected` in this repository is NOT added by this phase — the mechanism ships unarmed, and arming it is the user's decision.
- [ ] `11-STATE.md` updated: `tasks_done: 5`, `tasks_total: 5`, `status: complete`, `delivery: branch`.
