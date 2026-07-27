# Ultrapowers Layer 0 — Rebrand Patcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the upstream `superpowers@claude-plugins-official` plugin to "Ultrapowers" in prose only, via a re-appliable classification-table patcher that detects both lost patches and new upstream mentions its table does not cover.

**Architecture:** A pure classifier (`ultrapowers-rename-rules.mjs`) assigns every occurrence of the upstream name to exactly one bucket and rewrites only the buckets that carry a replacement; protective buckets run first and consume their matches so identifiers are never touched. An I/O layer applies the classifier across a plugin root and records before/after hashes in a version-keyed manifest. A drift detector compares live hashes against the manifest and scans for occurrences no rule covers, producing three states. A cost log turns "the patch is too expensive to maintain" into a pre-agreed numeric trigger rather than a judgement call.

**Tech Stack:** Node 18+ ESM, zero external dependencies, `node:test` + `node:assert/strict`. No package.json exists in this repository — modules are imported by relative path and tests are run with `node --test`.

**Spec:** `docs/superpowers/specs/2026-07-27-ultrapowers-rework-design.md`

## Global Constraints

- **Zero runtime dependencies.** This repository has no `package.json`; nothing may be added that requires one.
- **Never rename plugin identity.** Plugin directory names, `.claude-plugin/plugin.json`, `package.json` inside the plugin, `installed_plugins.json`, `known_marketplaces.json`, and `plugin-catalog-cache.json` are read-only for this work. Renaming them fabricates a marketplace identity and breaks `/plugin update` silently (`RISK-ULTRAPOWERS-002`, spec § "Naming and the rebrand boundary").
- **Skill invocations stay `superpowers:<skill>`.** The namespace derives from the plugin directory name. No rule may rewrite one (`RISK-ULTRAPOWERS-003`).
- **Bucket application order is load-bearing:** `ignored` -> `invocation` -> `plugin-path` -> `artifact-path` -> `brand`. Protective buckets consume their spans before `brand` runs.
- **Every ignore entry carries a `why`.** A silent skip is forbidden; `/up-doctor` prints them (`RISK-ULTRAPOWERS-004`).
- **ASCII-only script output**, matching `payload/add-risk.mjs`.
- **Hooks fail open.** A throw inside the drift detector must never break a session.
- **Tests are co-located** as `<module>.test.mjs` and run with `node --test <path>`.
- **Artifact language:** this repository's own code, comments, and docs are English (`~/.claude/CLAUDE.md`). Improvement 18's Russian rule applies to Ultrapowers-managed *project* artifacts, not here.
- **Measured baseline to preserve:** upstream 6.2.0 contains **119** occurrences of the name across **25** files — 78 in 22 skill files, 12 in `hooks/session-start`, 29 in two Codex packaging scripts.

---

## File Structure

| File | Responsibility |
|---|---|
| `payload/hooks/lib/ultrapowers-rename-rules.mjs` | **Pure.** Rule table, `classify(text)`, `rewrite(text)`. No I/O, no paths. |
| `payload/hooks/lib/ultrapowers-rename-rules.test.mjs` | String-level tests; runs with no plugin on disk. |
| `ultrapowers-patches/ignore.json` | Path globs excluded from patching, each with a reason. |
| `payload/hooks/lib/ultrapowers-patch-apply.mjs` | **I/O.** Walks a plugin root, applies `rewrite`, writes the version-keyed manifest. `checkUltrapowersPatches` (read-only) / `applyUltrapowersPatches` (writes). |
| `payload/hooks/lib/ultrapowers-patch-apply.test.mjs` | Tests against a synthetic plugin tree in a temp dir. |
| `payload/hooks/lib/ultrapowers-patch-drift.mjs` | Three-state detector: green / reapply / extend-the-table. |
| `payload/hooks/lib/ultrapowers-patch-drift.test.mjs` | One test per state. |
| `payload/hooks/lib/ultrapowers-patch-cost.mjs` | Appends `cost-log.jsonl`, evaluates the rollback trigger. |
| `payload/hooks/lib/ultrapowers-patch-cost.test.mjs` | Trigger boundary tests. |
| `payload/bin/apply-ultrapowers-patches.mjs` | CLI entry point, mirrors `apply-gsd-agent-patches.mjs`. |
| `payload/commands/up-doctor.md` | Slash command: run the detector, print the report and the ignore list. |
| `payload/hooks/lib/component-registry.mjs` | **Modify.** Add the plugin as a `version` component with `updateClass: "reinit"`. |
| `variants.json` | **Modify.** Classify the new payload files for `base` / `lite` / `full`. |
| `ultrapowers-patches/README.md` | What the directory is, how to re-apply, how to read the cost log. |

Manifest (`ultrapowers-patches/manifest/<version>.json`) and `cost-log.jsonl` are generated, not authored.

---

### Task 1: Probe D — which event fires on a plugin change

Reconnaissance, not code. The spec records that **no plugin-lifecycle hook event is documented**; `/reload-plugins` exists as a command but emits nothing. Three candidates may still reach us. This task turns three guesses into one recorded fact, exactly as пробы А/Б/В did in приложение И of the source analysis.

Hook registration is read at session startup, so this task requires a restart and the user's hands. Do not attempt it inside a running session.

**Files:**
- Create: `docs/superpowers/rework/probe-d-event-log.mjs`
- Modify: `~/.claude/settings.json` (temporary registration, removed in Step 8)
- Create: `docs/superpowers/rework/probe-d-results.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `docs/superpowers/rework/probe-d-results.md` — a table of `event -> fired? -> payload fields`. Task 8 reads it to decide whether the drift check gets an instant trigger in addition to `SessionStart`.

- [ ] **Step 1: Write the logging hook**

Every candidate event writes one JSONL line and exits 0. Fail-open: a throw here must not block anything.

```js
#!/usr/bin/env node
// Probe D (Ultrapowers layer 0): records which hook events actually fire around a plugin
// change. Temporary - registered by hand, removed after the probe. Fail-open by construction.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const OUT = join(homedir(), ".claude", "probe-d.jsonl");
try {
  let raw = "";
  try { raw = readFileSync(0, "utf8"); } catch { /* no stdin */ }
  let payload = {};
  try { payload = JSON.parse(raw || "{}"); } catch { payload = { unparsed: raw.slice(0, 400) }; }
  mkdirSync(dirname(OUT), { recursive: true });
  appendFileSync(OUT, JSON.stringify({
    at: new Date().toISOString(),
    argv: process.argv.slice(2),
    event: payload.hook_event_name || "(absent)",
    keys: Object.keys(payload).sort(),
    payload,
  }) + "\n");
} catch { /* fail open */ }
process.exit(0);
```

- [ ] **Step 2: Register the three candidate events**

Add to `~/.claude/settings.json` under `hooks`. Note the trap from У.3 of the source analysis: a tool name is a `matcher` *inside* `PreToolUse`, never an event name — a wrong event name is silently ignored with only a startup warning.

```json
"ConfigChange": [
  { "hooks": [{ "type": "command", "command": "node \"D:/6__Work/claude-config/docs/superpowers/rework/probe-d-event-log.mjs\" ConfigChange" }] }
],
"UserPromptSubmit": [
  { "hooks": [{ "type": "command", "command": "node \"D:/6__Work/claude-config/docs/superpowers/rework/probe-d-event-log.mjs\" UserPromptSubmit" }] }
],
"FileChanged": [
  { "hooks": [{ "type": "command", "command": "node \"D:/6__Work/claude-config/docs/superpowers/rework/probe-d-event-log.mjs\" FileChanged" }] }
]
```

- [ ] **Step 3: Verify the registration parsed as structure, not as text**

Checking that the line exists in the file is not enough — a wrong event name still leaves the line there.

Run (PowerShell):
```powershell
(Get-Content "$env:USERPROFILE\.claude\settings.json" -Raw | ConvertFrom-Json).hooks | ConvertTo-Json -Depth 8
```
Expected: `ConfigChange`, `UserPromptSubmit`, and `FileChanged` each appear as keys with a `hooks` array. If any is missing, the event name is not recognized — record that as the probe result for that event and drop it.

- [ ] **Step 4: Restart the session**

**User action.** Hook registration is resolved at startup; nothing below works without this.

- [ ] **Step 5: Trigger a plugin-content change**

Touch a patch-target file in the live plugin so a real change occurs, then reload.

Run (PowerShell):
```powershell
$p = "$env:USERPROFILE\.claude\plugins\cache\claude-plugins-official\superpowers\6.2.0\skills\brainstorming\SKILL.md"
Copy-Item $p "$p.probe-backup"
Add-Content -Path $p -Value "`n<!-- probe-d marker -->" -Encoding utf8
```

Then, **user action**, type in the session: `/reload-plugins`

- [ ] **Step 6: Read the log**

Run:
```bash
node -e "const l=require('fs').readFileSync(process.env.USERPROFILE+'/.claude/probe-d.jsonl','utf8').trim().split('\n').map(JSON.parse); console.log(l.map(e=>e.argv[0]+' | event='+e.event+' | keys='+e.keys.join(',')).join('\n'))"
```
Expected: one line per event that actually fired. An event that never appears did not fire — that is a valid and useful result.

- [ ] **Step 7: Restore the plugin file**

```powershell
$p = "$env:USERPROFILE\.claude\plugins\cache\claude-plugins-official\superpowers\6.2.0\skills\brainstorming\SKILL.md"
Move-Item "$p.probe-backup" $p -Force
```

- [ ] **Step 8: Write the result and unregister**

Create `docs/superpowers/rework/probe-d-results.md` with one row per event: fired yes/no, payload keys observed, and whether it is usable as an instant drift trigger. Then remove the three registrations from `~/.claude/settings.json` and delete `~/.claude/probe-d.jsonl`.

- [ ] **Step 9: Commit**

```bash
git add docs/superpowers/rework/probe-d-event-log.mjs docs/superpowers/rework/probe-d-results.md
git commit -F <message-file>
```

Commit message subject: `docs(ultrapowers): probe D - which hook events fire on a plugin change`

---

### Task 2: Pure classifier — buckets and rewrite

The heart of the patcher, and the only part where a mistake breaks skill resolution. Pure by design so it is testable on strings with no plugin on disk.

**Files:**
- Create: `payload/hooks/lib/ultrapowers-rename-rules.mjs`
- Test: `payload/hooks/lib/ultrapowers-rename-rules.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `RULES: Array<{ bucket, re: RegExp, replace: string|null, why: string }>` — ordered, protective buckets first.
  - `classify(text) -> { spans: Array<{start, end, bucket, match}>, unclassified: Array<{index, match, line}> }`
  - `rewrite(text) -> { text: string, histogram: Record<bucket, number>, unclassified: Array<...> }`
  - `BUCKET_ORDER: string[]`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, rewrite } from "./ultrapowers-rename-rules.mjs";

test("a skill invocation is classified as invocation and never rewritten", () => {
  const src = "Use superpowers:writing-plans to create the plan.";
  const { spans } = classify(src);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].bucket, "invocation");
  assert.equal(rewrite(src).text, src);
});

test("brand prose is rewritten", () => {
  assert.equal(rewrite("You have superpowers.").text, "You have ultrapowers.");
  assert.equal(rewrite("Superpowers' process skills").text, "Ultrapowers' process skills");
});

test("an invocation on the same line as brand prose survives the brand rule", () => {
  const src = "Superpowers ships superpowers:brainstorming for this.";
  const out = rewrite(src).text;
  assert.match(out, /^Ultrapowers ships /);
  assert.match(out, /superpowers:brainstorming/);
  assert.doesNotMatch(out, /ultrapowers:brainstorming/);
});

test("artifact paths are repointed at .ultrapowers", () => {
  assert.equal(
    rewrite("saved to docs/superpowers/plans/x.md").text,
    "saved to .ultrapowers/phases/x.md",
  );
  assert.equal(rewrite("ledger in .superpowers/sdd/").text, "ledger in .ultrapowers/sdd/");
});

test("a plugin-internal path is protected", () => {
  const src = "read skills/using-superpowers/references/pi-tools.md";
  assert.equal(rewrite(src).text, src);
});

test("an occurrence no rule covers is reported as unclassified", () => {
  const { unclassified } = rewrite("The SuperPowersRuntime class is new.");
  assert.equal(unclassified.length, 1);
  assert.match(unclassified[0].match, /SuperPowers/i);
});

test("the histogram counts every occurrence exactly once", () => {
  const src = "Superpowers uses superpowers:writing-plans and docs/superpowers/plans/a.md";
  const { histogram, unclassified } = rewrite(src);
  const total = Object.values(histogram).reduce((a, b) => a + b, 0) + unclassified.length;
  assert.equal(total, (src.match(/superpowers/gi) || []).length);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test payload/hooks/lib/ultrapowers-rename-rules.test.mjs`
Expected: FAIL — `Cannot find module './ultrapowers-rename-rules.mjs'`

- [ ] **Step 3: Write the implementation**

```js
// Pure classification + rewrite for the Ultrapowers rebrand. No I/O, no paths, no plugin on disk.
// Every occurrence of the upstream name lands in exactly one bucket. Protective buckets are
// applied FIRST and consume their spans, so `brand` can never eat the prefix of an invocation
// like `superpowers:writing-plans` - that failure is delayed (the file still reads correctly)
// and therefore the most expensive one available. See RISK-ULTRAPOWERS-003.
export const BUCKET_ORDER = ["invocation", "plugin-path", "artifact-path", "brand"];

export const RULES = [
  { bucket: "invocation", re: /superpowers:[a-z0-9-]+/gi, replace: null,
    why: "skill namespace derives from the plugin directory name; rewriting breaks resolution" },
  { bucket: "plugin-path", re: /skills\/using-superpowers(?:\/[\w.-]+)*/gi, replace: null,
    why: "path inside the upstream package; the directory is deliberately not renamed" },
  { bucket: "plugin-path", re: /\$\{CLAUDE_PLUGIN_ROOT\}[^\s)"']*superpowers[^\s)"']*/gi, replace: null,
    why: "resolved by the host against the real plugin root" },
  { bucket: "artifact-path", re: /docs\/superpowers\/(?:plans|specs)/gi, replace: ".ultrapowers/phases",
    why: "artifact home moves to .ultrapowers (layer 1)" },
  { bucket: "artifact-path", re: /\.superpowers\/sdd/gi, replace: ".ultrapowers/sdd",
    why: "scratch home moves with it" },
  { bucket: "brand", re: /\bSuperpowers\b/g, replace: "Ultrapowers", why: "brand prose" },
  { bucket: "brand", re: /\bsuperpowers\b/g, replace: "ultrapowers", why: "brand prose, lowercase" },
];

const ANY = /superpowers/gi;
const overlaps = (spans, s, e) => spans.some((x) => s < x.end && e > x.start);

export function classify(text) {
  const spans = [];
  for (const rule of RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags.includes("g") ? rule.re.flags : rule.re.flags + "g");
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      if (overlaps(spans, m.index, m.index + m[0].length)) continue;
      spans.push({ start: m.index, end: m.index + m[0].length, bucket: rule.bucket, match: m[0], rule });
    }
  }
  spans.sort((a, b) => a.start - b.start);

  const unclassified = [];
  let m;
  ANY.lastIndex = 0;
  while ((m = ANY.exec(text)) !== null) {
    if (overlaps(spans, m.index, m.index + m[0].length)) continue;
    unclassified.push({
      index: m.index,
      match: m[0],
      line: text.slice(0, m.index).split("\n").length,
    });
  }
  return { spans, unclassified };
}

export function rewrite(text) {
  const { spans, unclassified } = classify(text);
  const histogram = Object.fromEntries(BUCKET_ORDER.map((b) => [b, 0]));
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    histogram[span.bucket] += 1;
    out += text.slice(cursor, span.start);
    out += span.rule.replace === null
      ? span.match
      : span.match.replace(new RegExp(span.rule.re.source, span.rule.re.flags.replace("g", "")), span.rule.replace);
    cursor = span.end;
  }
  out += text.slice(cursor);
  return { text: out, histogram, unclassified };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test payload/hooks/lib/ultrapowers-rename-rules.test.mjs`
Expected: PASS, 7 tests.

Two notes for the implementer:

**On `hooks/session-start`.** The spec anticipated that a rule might not express the banner's
change and that a stored post-patch copy could be needed there. No special case is added here on
purpose: if a rule cannot express it, the occurrence surfaces as `unclassified` and the detector
returns `extend`, which blocks. That is the correct outcome — a gap that announces itself beats a
special case that hides one. Task 10 settles it empirically.

**On the small glob matcher in Task 3.** `variants.mjs` at the repository root already exports a
`globToRe`. It is deliberately not reused: `variants.mjs` is installer-side and never ships to
`~/.claude`, while this module runs from the installed payload. Re-implementing eight lines is the
correct call across that deployment boundary — recorded here so a future duplication audit
(improvement 22) reads it as a decision rather than a clone.

- [ ] **Step 5: Commit**

```bash
git add payload/hooks/lib/ultrapowers-rename-rules.mjs payload/hooks/lib/ultrapowers-rename-rules.test.mjs
git commit -F <message-file>
```

Commit message subject: `feat(ultrapowers): pure rename classifier with protective bucket ordering`

---

### Task 3: Ignore list with mandatory reasons

29 of the 119 occurrences live in foreign-harness packaging and are skipped deliberately. Without an explicit list the detector red-flags them forever, and a permanently red flag stops being read — taking the genuine one with it (`RISK-ULTRAPOWERS-004`).

**Files:**
- Create: `ultrapowers-patches/ignore.json`
- Modify: `payload/hooks/lib/ultrapowers-rename-rules.mjs` (add `isIgnored`)
- Modify: `payload/hooks/lib/ultrapowers-rename-rules.test.mjs`

**Interfaces:**
- Consumes: `RULES` from Task 2.
- Produces: `isIgnored(relPath, entries) -> { ignored: boolean, why: string|null }`, and `IGNORE_SCHEMA_KEYS = ["glob", "why"]`.

- [ ] **Step 1: Write the failing test**

```js
import { isIgnored } from "./ultrapowers-rename-rules.mjs";
import { readFileSync } from "node:fs";

const ENTRIES = JSON.parse(readFileSync(new URL("../../../ultrapowers-patches/ignore.json", import.meta.url), "utf8")).entries;

test("every ignore entry carries a non-empty reason", () => {
  assert.ok(ENTRIES.length > 0);
  for (const e of ENTRIES) {
    assert.ok(e.glob, "entry missing glob");
    assert.ok(e.why && e.why.length > 10, `entry ${e.glob} has no usable reason`);
  }
});

test("codex packaging scripts are ignored with a reason", () => {
  const r = isIgnored("scripts/package-codex-plugin.sh", ENTRIES);
  assert.equal(r.ignored, true);
  assert.match(r.why, /codex/i);
});

test("a skill file is not ignored", () => {
  assert.equal(isIgnored("skills/writing-plans/SKILL.md", ENTRIES).ignored, false);
});

test("foreign-harness reference docs are ignored", () => {
  assert.equal(isIgnored("skills/using-superpowers/references/pi-tools.md", ENTRIES).ignored, true);
  assert.equal(isIgnored("skills/using-superpowers/references/gemini-tools.md", ENTRIES).ignored, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test payload/hooks/lib/ultrapowers-rename-rules.test.mjs`
Expected: FAIL — `isIgnored is not a function`

- [ ] **Step 3: Write the ignore list**

```json
{
  "$comment": "Paths excluded from Ultrapowers rebranding. Every entry MUST carry a reason; /up-doctor prints them. A silent skip is forbidden - see RISK-ULTRAPOWERS-004.",
  "entries": [
    { "glob": "scripts/*codex*",
      "why": "Codex plugin packaging - a different harness, not our surface; 29 of the 119 measured occurrences live here" },
    { "glob": ".opencode/**",
      "why": "OpenCode harness bundle shipped inside the plugin; renaming would corrupt a foreign integration" },
    { "glob": ".pi/**",
      "why": "Pi harness extension, same reasoning as .opencode" },
    { "glob": ".codex-plugin/**",
      "why": "generated Codex mirror of the plugin; regenerated upstream, our edits would be discarded" },
    { "glob": ".cursor-plugin/**",
      "why": "generated Cursor mirror, same reasoning" },
    { "glob": ".kimi-plugin/**",
      "why": "generated Kimi mirror, same reasoning" },
    { "glob": ".agents/**",
      "why": "harness-agnostic agent bundle, regenerated upstream" },
    { "glob": "skills/using-superpowers/references/gemini-tools.md",
      "why": "Gemini harness instructions; the name there refers to the foreign integration, not our brand" },
    { "glob": "skills/using-superpowers/references/pi-tools.md",
      "why": "Pi harness instructions, same reasoning" },
    { "glob": "skills/brainstorming/scripts/**",
      "why": "visual companion server internals - process names and asset paths; a rename risks breaking the running server for no user-visible gain" },
    { "glob": "tests/**",
      "why": "upstream's own test suite; our edits would be reverted by any upstream change and cannot affect what a user reads" },
    { "glob": "docs/**",
      "why": "upstream's development history; not injected into any session" },
    { "glob": "*.json",
      "why": "manifests carry plugin identity - out of scope by the hard constraint in the spec" },
    { "glob": "README.md",
      "why": "upstream project README; describes the upstream project, not our installation" },
    { "glob": "RELEASE-NOTES.md",
      "why": "upstream changelog; rewriting history entries would make them wrong" },
    { "glob": "LICENSE",
      "why": "legal text - must remain verbatim" }
  ]
}
```

- [ ] **Step 4: Implement `isIgnored`**

Append to `ultrapowers-rename-rules.mjs`. A tiny glob matcher — `**`, `*`, and literals are all this needs; no dependency.

```js
export const IGNORE_SCHEMA_KEYS = ["glob", "why"];

function globToRe(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const body = esc.replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*");
  return new RegExp("^" + body + "$");
}

export function isIgnored(relPath, entries) {
  const p = relPath.replace(/\\/g, "/");
  for (const e of entries) {
    if (globToRe(e.glob).test(p)) return { ignored: true, why: e.why };
  }
  return { ignored: false, why: null };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test payload/hooks/lib/ultrapowers-rename-rules.test.mjs`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add payload/hooks/lib/ultrapowers-rename-rules.mjs payload/hooks/lib/ultrapowers-rename-rules.test.mjs ultrapowers-patches/ignore.json
git commit -F <message-file>
```

Commit message subject: `feat(ultrapowers): ignore list with mandatory per-entry reasons`

---

### Task 4: Apply layer and version-keyed manifest

**Files:**
- Create: `payload/hooks/lib/ultrapowers-patch-apply.mjs`
- Test: `payload/hooks/lib/ultrapowers-patch-apply.test.mjs`

**Interfaces:**
- Consumes: `rewrite`, `isIgnored` from Tasks 2-3.
- Produces:
  - `checkUltrapowersPatches({ pluginRoot, ignoreEntries }) -> { version, files: Array<{ rel, histogram, unclassified, before, after }>, totals }` — read-only, never writes.
  - `applyUltrapowersPatches({ pluginRoot, ignoreEntries, manifestDir }) -> { applied: string[], skippedIgnored: string[], unclassified: Array<{rel, line, match}>, manifestPath }`
  - Manifest shape: `{ version, generatedFrom, files: { "<rel>": { before: "<sha256>", after: "<sha256>" } }, totals: { byBucket, ignored, unclassified } }`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkUltrapowersPatches, applyUltrapowersPatches } from "./ultrapowers-patch-apply.mjs";

const ENTRIES = [{ glob: "scripts/*codex*", why: "foreign harness packaging, out of scope" }];

function fakePlugin() {
  const root = mkdtempSync(join(tmpdir(), "upp-"));
  mkdirSync(join(root, "skills", "writing-plans"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(join(root, ".claude-plugin", "plugin.json"), JSON.stringify({ version: "6.2.0" }));
  writeFileSync(join(root, "skills", "writing-plans", "SKILL.md"),
    "Superpowers plans. Use superpowers:brainstorming first.\n");
  writeFileSync(join(root, "scripts", "package-codex-plugin.sh"), "# superpowers packaging\n");
  return root;
}

test("check is read-only and reports without touching files", () => {
  const root = fakePlugin();
  const before = readFileSync(join(root, "skills", "writing-plans", "SKILL.md"), "utf8");
  const res = checkUltrapowersPatches({ pluginRoot: root, ignoreEntries: ENTRIES });
  assert.equal(readFileSync(join(root, "skills", "writing-plans", "SKILL.md"), "utf8"), before);
  assert.equal(res.files.length, 1);
  assert.equal(res.files[0].rel, "skills/writing-plans/SKILL.md");
  rmSync(root, { recursive: true, force: true });
});

test("apply rewrites brand prose and preserves the invocation", () => {
  const root = fakePlugin();
  const manifestDir = join(root, "_manifest");
  applyUltrapowersPatches({ pluginRoot: root, ignoreEntries: ENTRIES, manifestDir });
  const out = readFileSync(join(root, "skills", "writing-plans", "SKILL.md"), "utf8");
  assert.match(out, /^Ultrapowers plans\./);
  assert.match(out, /superpowers:brainstorming/);
  rmSync(root, { recursive: true, force: true });
});

test("ignored files are left alone and reported", () => {
  const root = fakePlugin();
  const res = applyUltrapowersPatches({ pluginRoot: root, ignoreEntries: ENTRIES, manifestDir: join(root, "_m") });
  assert.deepEqual(res.skippedIgnored, ["scripts/package-codex-plugin.sh"]);
  assert.match(readFileSync(join(root, "scripts", "package-codex-plugin.sh"), "utf8"), /superpowers/);
  rmSync(root, { recursive: true, force: true });
});

test("apply is idempotent - a second run changes nothing and adds no manifest churn", () => {
  const root = fakePlugin();
  const manifestDir = join(root, "_manifest");
  const first = applyUltrapowersPatches({ pluginRoot: root, ignoreEntries: ENTRIES, manifestDir });
  const m1 = readFileSync(first.manifestPath, "utf8");
  const body1 = readFileSync(join(root, "skills", "writing-plans", "SKILL.md"), "utf8");
  applyUltrapowersPatches({ pluginRoot: root, ignoreEntries: ENTRIES, manifestDir });
  assert.equal(readFileSync(first.manifestPath, "utf8"), m1);
  assert.equal(readFileSync(join(root, "skills", "writing-plans", "SKILL.md"), "utf8"), body1);
  rmSync(root, { recursive: true, force: true });
});

test("manifest records before and after hashes per file", () => {
  const root = fakePlugin();
  const res = applyUltrapowersPatches({ pluginRoot: root, ignoreEntries: ENTRIES, manifestDir: join(root, "_m") });
  const m = JSON.parse(readFileSync(res.manifestPath, "utf8"));
  const entry = m.files["skills/writing-plans/SKILL.md"];
  assert.match(entry.before, /^[0-9a-f]{64}$/);
  assert.match(entry.after, /^[0-9a-f]{64}$/);
  assert.notEqual(entry.before, entry.after);
  rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test payload/hooks/lib/ultrapowers-patch-apply.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// I/O layer for the Ultrapowers rebrand: walks a plugin root, applies the pure classifier, and
// records before/after sha256 per file in a version-keyed manifest. Idempotent: on a second run
// the "before" hash already equals the recorded "after", so nothing is rewritten.
// checkUltrapowersPatches never writes; applyUltrapowersPatches is the only writer.
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { createHash } from "node:crypto";
import { rewrite, isIgnored } from "./ultrapowers-rename-rules.mjs";

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const TEXT = /\.(md|mjs|js|cjs|ts|sh|cmd|txt|html)$/i;
const safe = (fn) => { try { return fn(); } catch { return undefined; } };

function walk(root, dir = root, out = []) {
  let ents = [];
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) walk(root, abs, out);
    else if (TEXT.test(e.name)) out.push(relative(root, abs).replace(/\\/g, "/"));
  }
  return out;
}

function pluginVersion(pluginRoot) {
  const p = join(pluginRoot, ".claude-plugin", "plugin.json");
  const j = safe(() => JSON.parse(readFileSync(p, "utf8")));
  return (j && j.version) || basename(pluginRoot);
}

export function checkUltrapowersPatches({ pluginRoot, ignoreEntries }) {
  const version = pluginVersion(pluginRoot);
  const files = [];
  const totals = { byBucket: {}, ignored: 0, unclassified: 0 };
  for (const rel of walk(pluginRoot)) {
    const content = safe(() => readFileSync(join(pluginRoot, rel), "utf8"));
    if (content === undefined || !/superpowers/i.test(content)) continue;
    if (isIgnored(rel, ignoreEntries).ignored) { totals.ignored += 1; continue; }
    const r = rewrite(content);
    for (const [b, n] of Object.entries(r.histogram)) totals.byBucket[b] = (totals.byBucket[b] || 0) + n;
    totals.unclassified += r.unclassified.length;
    files.push({ rel, histogram: r.histogram, unclassified: r.unclassified,
                 before: sha(content), after: sha(r.text), changed: r.text !== content });
  }
  return { version, files, totals };
}

export function applyUltrapowersPatches({ pluginRoot, ignoreEntries, manifestDir }) {
  const version = pluginVersion(pluginRoot);
  const applied = [], skippedIgnored = [], unclassified = [];
  const manifest = { version, generatedFrom: pluginRoot, files: {},
                     totals: { byBucket: {}, ignored: 0, unclassified: 0 } };

  for (const rel of walk(pluginRoot)) {
    const abs = join(pluginRoot, rel);
    const content = safe(() => readFileSync(abs, "utf8"));
    if (content === undefined || !/superpowers/i.test(content)) continue;
    if (isIgnored(rel, ignoreEntries).ignored) {
      skippedIgnored.push(rel);
      manifest.totals.ignored += 1;
      continue;
    }
    const r = rewrite(content);
    for (const u of r.unclassified) unclassified.push({ rel, line: u.line, match: u.match });
    for (const [b, n] of Object.entries(r.histogram)) {
      manifest.totals.byBucket[b] = (manifest.totals.byBucket[b] || 0) + n;
    }
    manifest.totals.unclassified += r.unclassified.length;
    manifest.files[rel] = { before: sha(content), after: sha(r.text) };
    if (r.text !== content) { writeFileSync(abs, r.text, "utf8"); applied.push(rel); }
  }

  mkdirSync(manifestDir, { recursive: true });
  const manifestPath = join(manifestDir, `${version}.json`);
  const serialized = JSON.stringify(manifest, null, 2) + "\n";
  if (!existsSync(manifestPath) || readFileSync(manifestPath, "utf8") !== serialized) {
    writeFileSync(manifestPath, serialized, "utf8");
  }
  return { applied, skippedIgnored, unclassified, manifestPath, totals: manifest.totals };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test payload/hooks/lib/ultrapowers-patch-apply.test.mjs`
Expected: PASS, 5 tests.

Note on idempotency: the second `apply` run reads already-patched content, in which `brand` occurrences no longer match, so `r.text === content` and nothing is written. The manifest's `before` hash for that run equals the previous `after` — which is exactly what the drift detector in Task 5 keys on.

- [ ] **Step 5: Commit**

```bash
git add payload/hooks/lib/ultrapowers-patch-apply.mjs payload/hooks/lib/ultrapowers-patch-apply.test.mjs
git commit -F <message-file>
```

Commit message subject: `feat(ultrapowers): apply layer with version-keyed hash manifest`

---

### Task 5: Drift detector — three states

**Files:**
- Create: `payload/hooks/lib/ultrapowers-patch-drift.mjs`
- Test: `payload/hooks/lib/ultrapowers-patch-drift.test.mjs`

**Interfaces:**
- Consumes: `checkUltrapowersPatches` (Task 4), manifests written by `applyUltrapowersPatches`.
- Produces: `detectDrift({ pluginRoot, ignoreEntries, manifestDir }) -> { state: "green"|"reapply"|"extend", reasons: string[], details: { missingManifest, revertedFiles, unclassified } }`

The three states, restated so the implementer does not have to re-derive them:

| State | Condition | Meaning |
|---|---|---|
| `green` | Manifest for this version exists and every live file hashes to its recorded `after` | Patches are in place |
| `reapply` | No manifest for the installed version, or a file hashes to its recorded `before` | Plugin updated, or patches were lost by a reinstall |
| `extend` | Any occurrence outside the ignore list matches no rule | Upstream describes itself in a new way our table does not know |

`extend` outranks `reapply`: a table that cannot classify the current text would produce a wrong patch if re-applied blindly.

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyUltrapowersPatches } from "./ultrapowers-patch-apply.mjs";
import { detectDrift } from "./ultrapowers-patch-drift.mjs";

const ENTRIES = [];

function plugin(body, version = "6.2.0") {
  const root = mkdtempSync(join(tmpdir(), "upd-"));
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(join(root, ".claude-plugin", "plugin.json"), JSON.stringify({ version }));
  mkdirSync(join(root, "skills", "s"), { recursive: true });
  writeFileSync(join(root, "skills", "s", "SKILL.md"), body);
  return root;
}

test("green after a successful apply", () => {
  const root = plugin("Superpowers is here.\n");
  const manifestDir = join(root, "_m");
  applyUltrapowersPatches({ pluginRoot: root, ignoreEntries: ENTRIES, manifestDir });
  assert.equal(detectDrift({ pluginRoot: root, ignoreEntries: ENTRIES, manifestDir }).state, "green");
  rmSync(root, { recursive: true, force: true });
});

test("reapply when no manifest exists for the installed version", () => {
  const root = plugin("Superpowers is here.\n");
  const d = detectDrift({ pluginRoot: root, ignoreEntries: ENTRIES, manifestDir: join(root, "_m") });
  assert.equal(d.state, "reapply");
  assert.equal(d.details.missingManifest, true);
  rmSync(root, { recursive: true, force: true });
});

test("reapply when a patched file reverts to its pre-patch content", () => {
  const root = plugin("Superpowers is here.\n");
  const manifestDir = join(root, "_m");
  applyUltrapowersPatches({ pluginRoot: root, ignoreEntries: ENTRIES, manifestDir });
  writeFileSync(join(root, "skills", "s", "SKILL.md"), "Superpowers is here.\n");
  const d = detectDrift({ pluginRoot: root, ignoreEntries: ENTRIES, manifestDir });
  assert.equal(d.state, "reapply");
  assert.deepEqual(d.details.revertedFiles, ["skills/s/SKILL.md"]);
  rmSync(root, { recursive: true, force: true });
});

test("extend when an occurrence matches no rule, and it outranks reapply", () => {
  const root = plugin("The SuperPowersRuntime shipped.\n");
  const d = detectDrift({ pluginRoot: root, ignoreEntries: ENTRIES, manifestDir: join(root, "_m") });
  assert.equal(d.state, "extend");
  assert.equal(d.details.unclassified.length, 1);
  assert.match(d.reasons.join(" "), /skills\/s\/SKILL\.md/);
  rmSync(root, { recursive: true, force: true });
});

test("detectDrift never throws on an unreadable plugin root", () => {
  const d = detectDrift({ pluginRoot: join(tmpdir(), "does-not-exist-upd"), ignoreEntries: [], manifestDir: join(tmpdir(), "nope") });
  assert.equal(typeof d.state, "string");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test payload/hooks/lib/ultrapowers-patch-drift.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// Three-state drift detector for the Ultrapowers rebrand. Fail-open: any internal error yields
// state "green" with a reason, because a broken detector must never block a session.
// "extend" outranks "reapply": re-applying a table that cannot classify the current text would
// write a wrong patch. See RISK-ULTRAPOWERS-004.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { checkUltrapowersPatches } from "./ultrapowers-patch-apply.mjs";

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

export function detectDrift({ pluginRoot, ignoreEntries, manifestDir }) {
  const details = { missingManifest: false, revertedFiles: [], unclassified: [] };
  const reasons = [];
  try {
    if (!existsSync(pluginRoot)) return { state: "green", reasons: ["plugin not installed"], details };

    const check = checkUltrapowersPatches({ pluginRoot, ignoreEntries });
    for (const f of check.files) {
      for (const u of f.unclassified) {
        details.unclassified.push({ rel: f.rel, line: u.line, match: u.match });
      }
    }
    if (details.unclassified.length) {
      for (const u of details.unclassified.slice(0, 10)) {
        reasons.push(`unclassified: ${u.rel}:${u.line} "${u.match}"`);
      }
      return { state: "extend", reasons, details };
    }

    const manifestPath = join(manifestDir, `${check.version}.json`);
    if (!existsSync(manifestPath)) {
      details.missingManifest = true;
      reasons.push(`no manifest for installed version ${check.version}`);
      return { state: "reapply", reasons, details };
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const f of check.files) {
      const rec = manifest.files[f.rel];
      if (!rec) { details.revertedFiles.push(f.rel); continue; }
      const live = sha(readFileSync(join(pluginRoot, f.rel), "utf8"));
      if (live !== rec.after) details.revertedFiles.push(f.rel);
    }
    if (details.revertedFiles.length) {
      reasons.push(`patched content missing in ${details.revertedFiles.length} file(s)`);
      return { state: "reapply", reasons, details };
    }
    return { state: "green", reasons: [], details };
  } catch (e) {
    return { state: "green", reasons: [`detector error, failing open: ${e.message}`], details };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test payload/hooks/lib/ultrapowers-patch-drift.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add payload/hooks/lib/ultrapowers-patch-drift.mjs payload/hooks/lib/ultrapowers-patch-drift.test.mjs
git commit -F <message-file>
```

Commit message subject: `feat(ultrapowers): three-state drift detector, extend outranks reapply`

---

### Task 6: Cost log and rollback trigger

The user accepted the maintenance risk on condition of being able to back out. "Too often" must be measurable in advance rather than judged in the moment of annoyance — the same discipline Ц.6 of the source analysis applies to Leanmode.

**Files:**
- Create: `payload/hooks/lib/ultrapowers-patch-cost.mjs`
- Test: `payload/hooks/lib/ultrapowers-patch-cost.test.mjs`

**Interfaces:**
- Consumes: nothing at runtime; entries are appended by the CLI in Task 7.
- Produces:
  - `recordUpdate({ logPath, from, to, rulesBroken, newMentions, manualMinutes }) -> void`
  - `evaluateTrigger(entries) -> { tripped: boolean, why: string|null }`
  - `readLog(logPath) -> entries[]`

Trigger, restated: **two consecutive updates requiring table rework, or one update costing more than 30 minutes.** "Requiring rework" means `rulesBroken > 0 || newMentions > 0`.

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordUpdate, readLog, evaluateTrigger } from "./ultrapowers-patch-cost.mjs";

const clean = (n) => ({ from: "6.2.0", to: "6.3.0", rulesBroken: 0, newMentions: 0, manualMinutes: n });

test("a clean update does not trip the trigger", () => {
  assert.equal(evaluateTrigger([clean(0), clean(0), clean(0)]).tripped, false);
});

test("one update over 30 minutes trips it", () => {
  const r = evaluateTrigger([clean(0), { ...clean(0), manualMinutes: 31 }]);
  assert.equal(r.tripped, true);
  assert.match(r.why, /31 min/);
});

test("exactly 30 minutes does not trip it", () => {
  assert.equal(evaluateTrigger([{ ...clean(0), manualMinutes: 30 }]).tripped, false);
});

test("two consecutive reworks trip it", () => {
  const rework = { ...clean(5), newMentions: 2 };
  assert.equal(evaluateTrigger([clean(0), rework, rework]).tripped, true);
});

test("two non-consecutive reworks do not trip it", () => {
  const rework = { ...clean(5), newMentions: 2 };
  assert.equal(evaluateTrigger([rework, clean(0), rework]).tripped, false);
});

test("recordUpdate appends one JSONL line per call and readLog round-trips", () => {
  const dir = mkdtempSync(join(tmpdir(), "upc-"));
  const logPath = join(dir, "cost-log.jsonl");
  recordUpdate({ logPath, ...clean(4) });
  recordUpdate({ logPath, ...clean(6) });
  const entries = readLog(logPath);
  assert.equal(entries.length, 2);
  assert.equal(entries[1].manualMinutes, 6);
  assert.ok(entries[0].at);
  rmSync(dir, { recursive: true, force: true });
});

test("readLog on a missing file returns an empty array, not a throw", () => {
  assert.deepEqual(readLog(join(tmpdir(), "no-such-cost-log.jsonl")), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test payload/hooks/lib/ultrapowers-patch-cost.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// Cost log for the Ultrapowers rebrand patcher. Turns "maintaining this is getting expensive"
// into a number agreed in advance, so the rollback decision (prose-only rebrand, or an honest
// fork) is made against evidence rather than accumulated irritation. See RISK-ULTRAPOWERS-001.
import { appendFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export const MINUTES_LIMIT = 30;          // one update costing MORE than this trips the trigger
export const CONSECUTIVE_REWORK_LIMIT = 2; // this many reworks in a row trips it

const needsRework = (e) => (e.rulesBroken || 0) > 0 || (e.newMentions || 0) > 0;

export function recordUpdate({ logPath, from, to, rulesBroken, newMentions, manualMinutes }) {
  mkdirSync(dirname(logPath), { recursive: true });
  const line = JSON.stringify({
    at: new Date().toISOString(),
    from, to,
    rulesBroken: rulesBroken || 0,
    newMentions: newMentions || 0,
    manualMinutes: manualMinutes || 0,
  });
  appendFileSync(logPath, line + "\n", "utf8");
}

export function readLog(logPath) {
  if (!existsSync(logPath)) return [];
  try {
    return readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

export function evaluateTrigger(entries) {
  for (const e of entries) {
    if ((e.manualMinutes || 0) > MINUTES_LIMIT) {
      return { tripped: true, why: `one update cost ${e.manualMinutes} min (limit ${MINUTES_LIMIT})` };
    }
  }
  let streak = 0;
  for (const e of entries) {
    streak = needsRework(e) ? streak + 1 : 0;
    if (streak >= CONSECUTIVE_REWORK_LIMIT) {
      return { tripped: true, why: `${streak} consecutive updates required table rework` };
    }
  }
  return { tripped: false, why: null };
}

export function triggerMessage(why) {
  return [
    `Ultrapowers rebrand patcher: ${why}.`,
    "Reconsider the approach: prose-only rebrand (drop the upstream patch), or an honest fork.",
    "Context: docs/superpowers/specs/2026-07-27-ultrapowers-rework-design.md, RISK-ULTRAPOWERS-001.",
  ].join(" ");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test payload/hooks/lib/ultrapowers-patch-cost.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add payload/hooks/lib/ultrapowers-patch-cost.mjs payload/hooks/lib/ultrapowers-patch-cost.test.mjs
git commit -F <message-file>
```

Commit message subject: `feat(ultrapowers): cost log and pre-agreed rollback trigger`

---

### Task 7: CLI and `/up-doctor`

**Files:**
- Create: `payload/bin/apply-ultrapowers-patches.mjs`
- Create: `payload/commands/up-doctor.md`
- Create: `ultrapowers-patches/README.md`

**Interfaces:**
- Consumes: everything from Tasks 2-6.
- Produces: `node apply-ultrapowers-patches.mjs [--check] [--claude-dir <dir>] [--repo <dir>]`, exit code 0 always (reporting tool, never a gate).

- [ ] **Step 1: Write the CLI**

```js
#!/usr/bin/env node
// CLI entry point for the Ultrapowers rebrand patcher. Mirrors apply-gsd-agent-patches.mjs:
// explicit human invocation only (via /init-stack or /up-doctor), never wired into an automatic
// path, because it rewrites files inside a third-party plugin.
//   node apply-ultrapowers-patches.mjs           apply
//   node apply-ultrapowers-patches.mjs --check   report only, write nothing
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { applyUltrapowersPatches, checkUltrapowersPatches } from "../hooks/lib/ultrapowers-patch-apply.mjs";
import { detectDrift } from "../hooks/lib/ultrapowers-patch-drift.mjs";
import { readLog, evaluateTrigger, triggerMessage } from "../hooks/lib/ultrapowers-patch-cost.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const CHECK_ONLY = argv.includes("--check");
const CLAUDE_DIR = flag("--claude-dir", process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"));
const REPO = flag("--repo", join(dirname(fileURLToPath(import.meta.url)), "..", ".."));

const PATCHES = join(REPO, "ultrapowers-patches");
const ignoreEntries = JSON.parse(readFileSync(join(PATCHES, "ignore.json"), "utf8")).entries;
const manifestDir = join(PATCHES, "manifest");

function installedRoot() {
  const f = join(CLAUDE_DIR, "plugins", "installed_plugins.json");
  if (!existsSync(f)) return null;
  try {
    const j = JSON.parse(readFileSync(f, "utf8"));
    const rec = (j.plugins || {})["superpowers@claude-plugins-official"];
    return rec && rec[0] ? rec[0].installPath : null;
  } catch { return null; }
}

const pluginRoot = installedRoot();
if (!pluginRoot || !existsSync(pluginRoot)) {
  console.log("superpowers plugin not installed - nothing to do.");
  process.exit(0);
}

const drift = detectDrift({ pluginRoot, ignoreEntries, manifestDir });
console.log(`Plugin: ${pluginRoot}`);
console.log(`Drift state: ${drift.state}`);
for (const r of drift.reasons) console.log(`  - ${r}`);

if (drift.state === "extend") {
  console.log("");
  console.log("The rename table does not cover every occurrence. Extend it before applying -");
  console.log("applying now would produce a partial rebrand and hide the gap.");
  console.log("Table: payload/hooks/lib/ultrapowers-rename-rules.mjs");
  process.exit(0);
}

if (CHECK_ONLY) {
  const c = checkUltrapowersPatches({ pluginRoot, ignoreEntries });
  console.log("");
  console.log(`Version: ${c.version}`);
  console.log(`Files with occurrences: ${c.files.length}   ignored: ${c.totals.ignored}`);
  for (const [b, n] of Object.entries(c.totals.byBucket)) console.log(`  ${b}: ${n}`);
} else {
  const r = applyUltrapowersPatches({ pluginRoot, ignoreEntries, manifestDir });
  console.log("");
  console.log(`Rewrote ${r.applied.length} file(s); skipped ${r.skippedIgnored.length} ignored.`);
  for (const [b, n] of Object.entries(r.totals.byBucket)) console.log(`  ${b}: ${n}`);
  console.log(`Manifest: ${r.manifestPath}`);
}

const trigger = evaluateTrigger(readLog(join(PATCHES, "cost-log.jsonl")));
if (trigger.tripped) {
  console.log("");
  console.log(triggerMessage(trigger.why));
}
```

- [ ] **Step 2: Verify the CLI runs read-only against the live plugin**

Run: `node payload/bin/apply-ultrapowers-patches.mjs --check`
Expected: prints the plugin path, a drift state, and a per-bucket histogram. **Nothing is written.** Confirm with `git status` inside the plugin cache is not applicable (it is not a repo) — instead re-run and confirm identical output.

- [ ] **Step 3: Write the slash command**

Create `payload/commands/up-doctor.md`:

```markdown
---
description: Report Ultrapowers rebrand patch status - drift state, bucket histogram, ignore list, and maintenance cost
---

Run the Ultrapowers patch checker and present its findings.

1. Run: `node ~/.claude/bin/apply-ultrapowers-patches.mjs --check`
2. Print the drift state and what it means:
   - `green` - patches in place, nothing to do.
   - `reapply` - the plugin was updated or reinstalled. Tell the user to run `/init-stack`.
   - `extend` - upstream has occurrences the rename table does not cover. Show the file:line list
     and stop; do NOT apply, because a partial rebrand hides the gap.
3. Print the ignore list with the reason for every entry, from
   `ultrapowers-patches/ignore.json`. Never summarize it away - a silent skip is the defect this
   list exists to prevent.
4. If the cost-log trigger has tripped, surface it verbatim: it means the rebrand approach itself
   should be reconsidered, not that patches should be reapplied.

Do not modify anything. This command reports only.
```

- [ ] **Step 4: Write the directory README**

Create `ultrapowers-patches/README.md`:

```markdown
# ultrapowers-patches

Rebrand patches applied to the upstream `superpowers@claude-plugins-official` plugin. Prose only:
the plugin's identity, directory names, and the `superpowers:` skill namespace are never touched.
Design: `docs/superpowers/specs/2026-07-27-ultrapowers-rework-design.md`.

## Contents

| Path | Authored or generated |
|---|---|
| `ignore.json` | authored - paths excluded from patching, each with a mandatory reason |
| `manifest/<version>.json` | generated - before/after sha256 per patched file, per plugin version |
| `cost-log.jsonl` | generated - one line per upstream update, the input to the rollback trigger |

The rename table itself lives in `payload/hooks/lib/ultrapowers-rename-rules.mjs`, not here: it is
shipped code with tests, not data.

## After an upstream plugin update

1. `node ~/.claude/bin/apply-ultrapowers-patches.mjs --check`
2. If the state is `extend`, the table does not cover every occurrence. Extend it first -
   applying now would produce a partial rebrand and hide the gap.
3. If the state is `reapply`, run `/init-stack`.
4. Append one line to `cost-log.jsonl` recording what it cost. This is not bookkeeping for its own
   sake: the rollback trigger reads it.

## Reading cost-log.jsonl

Each line: `{ at, from, to, rulesBroken, newMentions, manualMinutes }`. The trigger fires on two
consecutive updates with rework (`rulesBroken > 0 || newMentions > 0`), or one update over
30 minutes. When it fires, the question is not "reapply?" but "is the patch still worth keeping,
or should this become a prose-only rebrand or an honest fork?" (RISK-ULTRAPOWERS-001).

## Why every ignore entry carries a reason

Without the list, the detector red-flags 29 deliberately-untouched occurrences on every run. A flag
that is always red stops being read, and the genuine one dies with it. `/up-doctor` prints the
reasons so a skip can never be silent (RISK-ULTRAPOWERS-004).
```

- [ ] **Step 5: Commit**

```bash
git add payload/bin/apply-ultrapowers-patches.mjs payload/commands/up-doctor.md ultrapowers-patches/README.md
git commit -F <message-file>
```

Commit message subject: `feat(ultrapowers): patcher CLI and /up-doctor report command`

---

### Task 8: Wire into the component-update checker

The existing centralized notifier already carries "component updated, re-run X" messages. Adding an entry is cheaper and more consistent than a new hook.

**Files:**
- Modify: `payload/hooks/lib/component-registry.mjs` (the `COMPONENTS` array)
- Modify: `payload/hooks/lib/component-update-check-run.test.mjs`

**Interfaces:**
- Consumes: `detectDrift` (Task 5).
- Produces: a `COMPONENTS` entry `{ name: "ultrapowers-patches", scope: "global", kind: "version", updateClass: "reinit", legacyEnv: null }` whose version probe reports the installed plugin version, so a version change surfaces as "run /init-stack to apply".

- [ ] **Step 1: Write the failing test**

```js
test("ultrapowers-patches is registered as a reinit-class global component", () => {
  const c = COMPONENTS.find((x) => x.name === "ultrapowers-patches");
  assert.ok(c, "component not registered");
  assert.equal(c.scope, "global");
  assert.equal(c.kind, "version");
  assert.equal(c.updateClass, "reinit");
});

test("a reinit-class component tells the user to run /init-stack", async () => {
  const { formatUpdateNotes } = await import("./component-registry.mjs");
  const notes = formatUpdateNotes({
    "ultrapowers-patches": { updateAvailable: true, class: "reinit", installed: "6.2.0", latest: "6.3.0" },
  });
  assert.equal(notes.length, 1);
  assert.match(notes[0], /init-stack/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test payload/hooks/lib/component-update-check-run.test.mjs`
Expected: FAIL — `component not registered`

- [ ] **Step 3: Add the registry entry**

In `payload/hooks/lib/component-registry.mjs`, append to `COMPONENTS`:

```js
  { name: "ultrapowers-patches", scope: "global", kind: "version", updateClass: "reinit", legacyEnv: null },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test payload/hooks/lib/component-update-check-run.test.mjs`
Expected: PASS.

- [ ] **Step 5: Read probe D's result and decide on an instant trigger**

Open `docs/superpowers/rework/probe-d-results.md` from Task 1.

- If `ConfigChange` or `UserPromptSubmit` fired with a usable payload, add a note to
  `ultrapowers-patches/README.md` recording that an instant drift check is possible, and open a
  follow-up task. **Do not implement it in this task** — `SessionStart` is the load-bearing path
  and is already covered by the registry entry.
- If neither fired, record that in the README so the question is not re-opened later.

- [ ] **Step 6: Commit**

```bash
git add payload/hooks/lib/component-registry.mjs payload/hooks/lib/component-update-check-run.test.mjs ultrapowers-patches/README.md
git commit -F <message-file>
```

Commit message subject: `feat(ultrapowers): register the patcher with the component-update checker`

---

### Task 9: Profile membership in variants.json

New payload files default into every profile unless classified. The patcher is machine-wide and profile-independent — it must ship everywhere, including `lite`, because the rebrand is not a feature that can be half-installed.

**Files:**
- Modify: `variants.json`
- Modify: `variants.test.mjs`

**Interfaces:**
- Consumes: the file list from Tasks 2-7.
- Produces: an explicit assertion that the patcher files resolve into `full`, `base`, and `lite`.

- [ ] **Step 1: Write the failing test**

Add to `variants.test.mjs`, following the file's existing resolution-test pattern:

`variants.test.mjs` already imports `resolveVariant` from `./variants.mjs`; it returns `{ rels }`, the list of payload-relative paths that ship for a profile. Append:

```js
test("ultrapowers patcher files ship to every profile", () => {
  const files = [
    "hooks/lib/ultrapowers-rename-rules.mjs",
    "hooks/lib/ultrapowers-patch-apply.mjs",
    "hooks/lib/ultrapowers-patch-drift.mjs",
    "hooks/lib/ultrapowers-patch-cost.mjs",
    "bin/apply-ultrapowers-patches.mjs",
    "commands/up-doctor.md",
  ];
  for (const variant of ["full", "base", "lite"]) {
    const { rels } = resolveVariant({ repoRoot: ROOT, variant });
    for (const f of files) {
      assert.ok(rels.includes(f), `${f} missing from ${variant}`);
    }
  }
});
```

`ROOT` is already defined in the file as `dirname(fileURLToPath(import.meta.url))`. Note that `*.test.mjs` is in `alwaysExclude`, so the co-located test files are correctly absent from `rels` and must not be asserted on.

- [ ] **Step 2: Run the test to verify it fails or passes**

Run: `node --test variants.test.mjs`

If it already passes, the default-include behaviour is correct and no `variants.json` change is needed — record that in the commit message and skip Step 3. If it fails, continue.

- [ ] **Step 3: Adjust variants.json if required**

Only if Step 2 failed: remove whatever exclusion pattern is catching these files. Do not add an include list — the schema is exclusion-based.

- [ ] **Step 4: Run the full test suite**

Run: `node --test variants.test.mjs setup-variants.e2e.test.mjs plugin-reconcile.test.mjs`
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add variants.json variants.test.mjs
git commit -F <message-file>
```

Commit message subject: `test(ultrapowers): assert patcher ships to every profile`

---

### Task 10: Live run and arithmetic acceptance

The acceptance criterion for this layer is a sum, not a reading. Every one of the 119 measured occurrences must be accounted for by exactly one bucket or the ignore list. A lost occurrence shows up by subtraction.

**Files:**
- Create: `ultrapowers-patches/manifest/6.2.0.json` (generated)
- Modify: `ultrapowers-patches/README.md` (record the histogram)

**Interfaces:**
- Consumes: the complete patcher.
- Produces: a recorded baseline histogram for version 6.2.0, so the next upstream version can be diffed against it.

- [ ] **Step 1: Back up the live plugin**

```powershell
$src = "$env:USERPROFILE\.claude\plugins\cache\claude-plugins-official\superpowers\6.2.0"
Copy-Item $src "$src.pre-ultrapowers" -Recurse
```

This is the rollback path if the run goes wrong. Do not skip it — the plugin cache is not version-controlled.

- [ ] **Step 2: Run in check mode and record the histogram**

Run: `node payload/bin/apply-ultrapowers-patches.mjs --check`

Record the printed per-bucket counts plus the ignored-file count.

- [ ] **Step 3: Verify the arithmetic**

```bash
node -e "
const { execSync } = require('child_process');
const root = process.env.USERPROFILE + '/.claude/plugins/cache/claude-plugins-official/superpowers/6.2.0';
const out = execSync('grep -rio superpowers \"' + root + '\" | wc -l', { shell: '/bin/bash' }).toString().trim();
console.log('total occurrences on disk:', out);
"
```

Expected: the total equals `sum(byBucket) + unclassified + (occurrences inside ignored files)`.

If it does not balance, **stop**. A mismatch means an occurrence is neither patched, nor protected, nor ignored — which is precisely the condition this layer exists to make impossible. Extend the rule table or the ignore list until it balances, then re-run.

- [ ] **Step 4: Apply for real**

Run: `node payload/bin/apply-ultrapowers-patches.mjs`
Expected: files rewritten, manifest written to `ultrapowers-patches/manifest/6.2.0.json`.

- [ ] **Step 5: Verify no invocation was harmed**

```bash
grep -rn "ultrapowers:" "$USERPROFILE/.claude/plugins/cache/claude-plugins-official/superpowers/6.2.0/skills" || echo "OK: no rewritten invocations"
```

Expected: `OK: no rewritten invocations`. Any hit here is a defect in the rule ordering — revert from the backup and fix Task 2 before continuing.

- [ ] **Step 6: Verify the rebrand is visible**

Start a new session and confirm the session-start banner reads Ultrapowers. Skills hot-reload, but the plugin's own `hooks/session-start` does not — a restart, not `/reload-plugins`, is what proves this.

- [ ] **Step 7: Re-run the detector**

Run: `node payload/bin/apply-ultrapowers-patches.mjs --check`
Expected: `Drift state: green`.

- [ ] **Step 8: Record the baseline and remove the backup**

Append the histogram to `ultrapowers-patches/README.md` as the 6.2.0 baseline, then:

```powershell
Remove-Item "$env:USERPROFILE\.claude\plugins\cache\claude-plugins-official\superpowers\6.2.0.pre-ultrapowers" -Recurse -Force
```

- [ ] **Step 9: Commit**

```bash
git add ultrapowers-patches/manifest/6.2.0.json ultrapowers-patches/README.md
git commit -F <message-file>
```

Commit message subject: `feat(ultrapowers): apply the rebrand to 6.2.0 and record the baseline histogram`

---

## Layer 0 Definition of Done

- [ ] Probe D result recorded in `docs/superpowers/rework/probe-d-results.md`.
- [ ] `node --test payload/hooks/lib/ultrapowers-*.test.mjs variants.test.mjs` passes.
- [ ] Bucket histogram plus ignored occurrences balances against the 119 measured in 6.2.0.
- [ ] `grep -rn "ultrapowers:"` inside the plugin's `skills/` returns nothing.
- [ ] A fresh session shows the rebranded banner.
- [ ] `--check` reports `green`.
- [ ] `/up-doctor` prints the ignore list with reasons.
