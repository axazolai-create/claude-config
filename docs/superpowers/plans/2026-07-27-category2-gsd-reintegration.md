# Category-II GSD-Capability Reintegration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reinstate the fallow structural pre-pass (into Superpowers review) and stack-aware test/build command detection (into the compiled `stack-rules.md`), decoupled per profile; retire the `claude_orchestration` pilot ask.

**Architecture:** #1 fallow is a `.planning/`-guarded anchored+sentinel graft into Superpowers' `code-reviewer.md`, re-applied idempotently from `session-init` (self-healing across plugin updates), resolved from the plugin manifest. #2 test/build commands are pure `markers → {test,build}` data emitted into `stack-rules.md` by the rules compiler (rebuild-safe by construction), reusing the existing `detectMarkers()`. #3 is a documentation-only decision (retire).

**Tech Stack:** Node ESM (`.mjs`), `node:test` + `node:assert`, no new dependencies.

## Global Constraints

- New libs/bins are ESM `.mjs`, matching repo style. Mirror `payload/hooks/lib/impeccable-promax-graft.mjs` for the graft (sentinel guard, anchor insert, missing anchor/file → skip, never corrupt).
- Every `session-init` addition is defensive never-throw (a failure must not break SessionStart).
- Respect `CLAUDE_CONFIG_DIR` (fall back to `~/.claude`) wherever the `~/.claude` root is resolved.
- Membership = **all profiles**. `variants.json` is a denylist: default-include, so new non-test files need **no** entry; `**.test.mjs` is already globally excluded by `alwaysExclude`. Do **not** add the new files to any `exclude`.
- Graft target is verified against Superpowers 6.2.0 `requesting-code-review/code-reviewer.md`, anchor `## What to Check`; a missing file/anchor degrades to `skippedNoAnchor`.
- The active Superpowers install path is authoritative from `plugins/installed_plugins.json` → `plugins["superpowers@claude-plugins-official"][*].installPath`; highest-semver cache dir is a defensive fallback only.
- Full-profile behavior via GSD's own `code_quality.fallow.enabled` flag is unchanged. The graft self-skips in `.planning/` projects.

---

## File Structure

**New**
- `payload/hooks/lib/superpowers-fallow-graft.mjs` — graft + resolver + `regraftFallow()`
- `payload/hooks/lib/superpowers-fallow-graft.test.mjs`
- `payload/bin/lib/stack-commands.mjs` — pure `commandsForMarkers()`
- `payload/bin/lib/stack-commands.test.mjs`
- `payload/bin/detect-stack-commands.mjs` — CLI printing the `## Detected commands` block

**Modified**
- `payload/hooks/session-init.mjs` — one guarded `regraftFallow()` call
- `payload/rules-src/README.md` — compiler directive to emit `## Detected commands`
- `RISK_REGISTER.md` — RISK-INITSTACK-001 → Resolved; RISK-FALLOW-001 → Resolved
- `setup-variants.e2e.test.mjs` (or the existing variants regression test file) — assert new files are all-profiles, tests excluded

---

### Task 1: `superpowers-fallow-graft.mjs` — graft lib, resolver, re-graft entry

**Files:**
- Create: `payload/hooks/lib/superpowers-fallow-graft.mjs`
- Test: `payload/hooks/lib/superpowers-fallow-graft.test.mjs`

**Interfaces:**
- Produces: `SENTINEL: string`, `ANCHOR: string`, `GRAFT: string`, `applyFallowGraft({skillFile}) → {applied,already,skippedNoAnchor}`, `resolveSuperpowersReviewerFile(claudeDir?) → string|null`, `regraftFallow({claudeDir?}) → {ok, applied?, already?, skippedNoAnchor?, reason?}`

- [ ] **Step 1: Write the failing tests**

```javascript
// payload/hooks/lib/superpowers-fallow-graft.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SENTINEL, ANCHOR, GRAFT,
  applyFallowGraft, resolveSuperpowersReviewerFile, regraftFallow,
} from "./superpowers-fallow-graft.mjs";

const REVIEWER = `# Code Reviewer Prompt Template\n\n## What to Check\n\n**Plan alignment:**\n- match?\n`;
function tmp() { return mkdtempSync(join(tmpdir(), "fallow-graft-")); }

test("GRAFT constant carries guard, run, and install-nudge prose", () => {
  assert.ok(GRAFT.includes(SENTINEL));
  assert.ok(GRAFT.includes(".planning/"));               // GSD guard
  assert.ok(/fallow/.test(GRAFT));                        // runs fallow
  assert.ok(GRAFT.includes("pnpm add -D fallow"));        // install nudge
});

test("applyFallowGraft inserts under the anchor on a clean file", () => {
  const d = tmp(); const f = join(d, "code-reviewer.md");
  writeFileSync(f, REVIEWER);
  const r = applyFallowGraft({ skillFile: f });
  assert.deepEqual(r, { applied: true, already: false, skippedNoAnchor: false });
  const out = readFileSync(f, "utf8");
  assert.ok(out.includes(SENTINEL));
  assert.ok(out.indexOf(ANCHOR) < out.indexOf(SENTINEL));         // graft is AFTER the heading
  assert.ok(out.indexOf(SENTINEL) < out.indexOf("**Plan alignment:**")); // and before first check
  rmSync(d, { recursive: true, force: true });
});

test("applyFallowGraft is idempotent (already on second call)", () => {
  const d = tmp(); const f = join(d, "code-reviewer.md");
  writeFileSync(f, REVIEWER);
  applyFallowGraft({ skillFile: f });
  const before = readFileSync(f, "utf8");
  const r = applyFallowGraft({ skillFile: f });
  assert.deepEqual(r, { applied: false, already: true, skippedNoAnchor: false });
  assert.equal(readFileSync(f, "utf8"), before);                 // no double-insert
  rmSync(d, { recursive: true, force: true });
});

test("applyFallowGraft skips (no corruption) when anchor absent", () => {
  const d = tmp(); const f = join(d, "code-reviewer.md");
  writeFileSync(f, "# No checklist heading here\n");
  const r = applyFallowGraft({ skillFile: f });
  assert.deepEqual(r, { applied: false, already: false, skippedNoAnchor: true });
  assert.ok(!readFileSync(f, "utf8").includes(SENTINEL));
  rmSync(d, { recursive: true, force: true });
});

test("applyFallowGraft skips when file missing", () => {
  const r = applyFallowGraft({ skillFile: join(tmp(), "nope.md") });
  assert.deepEqual(r, { applied: false, already: false, skippedNoAnchor: true });
});

test("self-heals: a clobbered (sentinel-stripped) file re-grafts", () => {
  const d = tmp(); const f = join(d, "code-reviewer.md");
  writeFileSync(f, REVIEWER);
  applyFallowGraft({ skillFile: f });
  writeFileSync(f, REVIEWER);                                     // simulate plugin update clobber
  const r = applyFallowGraft({ skillFile: f });
  assert.equal(r.applied, true);
  assert.ok(readFileSync(f, "utf8").includes(SENTINEL));
  rmSync(d, { recursive: true, force: true });
});

test("resolveSuperpowersReviewerFile reads installPath from the manifest", () => {
  const d = tmp();
  const install = join(d, "cacheX", "superpowers", "6.2.0");
  const rev = join(install, "skills", "requesting-code-review");
  mkdirSync(rev, { recursive: true });
  writeFileSync(join(rev, "code-reviewer.md"), REVIEWER);
  mkdirSync(join(d, "plugins"), { recursive: true });
  writeFileSync(join(d, "plugins", "installed_plugins.json"), JSON.stringify({
    plugins: { "superpowers@claude-plugins-official": [{ scope: "user", installPath: install, version: "6.2.0" }] },
  }));
  const got = resolveSuperpowersReviewerFile(d);
  assert.equal(got, join(rev, "code-reviewer.md"));
  rmSync(d, { recursive: true, force: true });
});

test("resolveSuperpowersReviewerFile falls back to highest semver cache dir", () => {
  const d = tmp();
  const base = join(d, "plugins", "cache", "claude-plugins-official", "superpowers");
  for (const v of ["6.1.1", "6.2.0"]) {
    const rev = join(base, v, "skills", "requesting-code-review");
    mkdirSync(rev, { recursive: true });
    writeFileSync(join(rev, "code-reviewer.md"), REVIEWER);
  }
  // no installed_plugins.json → fallback path
  const got = resolveSuperpowersReviewerFile(d);
  assert.ok(got.includes(join("superpowers", "6.2.0")));         // highest, not 6.1.1
  rmSync(d, { recursive: true, force: true });
});

test("regraftFallow never throws and no-ops when nothing resolves", () => {
  const r = regraftFallow({ claudeDir: join(tmp(), "empty") });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-skill-file");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test payload/hooks/lib/superpowers-fallow-graft.test.mjs`
Expected: FAIL (module not found / exports undefined).

- [ ] **Step 3: Implement the lib**

```javascript
// payload/hooks/lib/superpowers-fallow-graft.mjs
// Anchored, idempotent graft of a fallow structural pre-pass into Superpowers'
// requesting-code-review reviewer prompt. Survives Superpowers plugin updates (which land a
// fresh, unpatched code-reviewer.md at a new version dir) via idempotent re-apply from
// session-init. Same shape as impeccable-promax-graft.mjs / gsd-agent-patches.mjs: sentinel =
// already-applied guard, anchor = insert point, missing anchor/file = skip (never corrupt).
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const SENTINEL = "<!-- fallow-graft:v1 -->";

// The reviewer prompt's checklist heading. The graft is inserted immediately AFTER this heading
// line so the pre-pass reads before the first check. Verified 2026-07-27 against Superpowers
// 6.2.0 requesting-code-review/code-reviewer.md.
export const ANCHOR = "## What to Check";

export const GRAFT = `${SENTINEL}
**Structural pre-pass (fallow):** Before the checks below —
- If this repo is a GSD project (a \`.planning/\` directory exists), SKIP this pre-pass: GSD's own review owns the fallow pass there. Do not run fallow.
- Otherwise, if the \`fallow\` binary is resolvable (\`node_modules/.bin/fallow\`, or on PATH), run it over the changed files and fold any dead-code / duplication / circular-dependency findings into the Issues section, at the severity fallow reports.
- Otherwise (fallow not installed), add ONE Minor note: "Structural pre-pass skipped — install with \`pnpm add -D fallow\` (workspace root: \`pnpm add -D fallow -w\`)." Never fail the review over a missing fallow binary.
`;

export function applyFallowGraft({ skillFile }) {
  if (!existsSync(skillFile)) return { applied: false, already: false, skippedNoAnchor: true };
  const txt = readFileSync(skillFile, "utf8");
  if (txt.includes(SENTINEL)) return { applied: false, already: true, skippedNoAnchor: false };
  const at = txt.indexOf(ANCHOR);
  if (at < 0) return { applied: false, already: false, skippedNoAnchor: true };
  const eol = txt.indexOf("\n", at);
  const insertAt = eol < 0 ? txt.length : eol + 1;
  writeFileSync(skillFile, txt.slice(0, insertAt) + "\n" + GRAFT + "\n" + txt.slice(insertAt), "utf8");
  return { applied: true, already: false, skippedNoAnchor: false };
}

function cmpSemver(a, b) {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

// Authoritative: plugins/installed_plugins.json installPath. Fallback: highest semver cache dir.
export function resolveSuperpowersReviewerFile(
  claudeDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
) {
  const rel = join("skills", "requesting-code-review", "code-reviewer.md");
  try {
    const manifest = JSON.parse(readFileSync(join(claudeDir, "plugins", "installed_plugins.json"), "utf8"));
    const entries = manifest && manifest.plugins && manifest.plugins["superpowers@claude-plugins-official"];
    if (Array.isArray(entries) && entries.length) {
      const e = entries.find((x) => x && x.installPath) || entries[0];
      if (e && e.installPath) {
        const f = join(e.installPath, rel);
        if (existsSync(f)) return f;
      }
    }
  } catch { /* fall through to semver scan */ }
  try {
    const base = join(claudeDir, "plugins", "cache", "claude-plugins-official", "superpowers");
    const dirs = readdirSync(base).filter((d) => /^\d+\.\d+\.\d+/.test(d)).sort(cmpSemver).reverse();
    for (const d of dirs) {
      const f = join(base, d, rel);
      if (existsSync(f)) return f;
    }
  } catch { /* none */ }
  return null;
}

// Never-throw entry for session-init: resolve + graft, swallowing all errors.
export function regraftFallow({ claudeDir } = {}) {
  try {
    const f = resolveSuperpowersReviewerFile(claudeDir);
    if (!f) return { ok: false, reason: "no-skill-file" };
    return { ok: true, ...applyFallowGraft({ skillFile: f }) };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e) };
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test payload/hooks/lib/superpowers-fallow-graft.test.mjs`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add payload/hooks/lib/superpowers-fallow-graft.mjs payload/hooks/lib/superpowers-fallow-graft.test.mjs
git commit -m "feat(fallow): superpowers review graft lib + active-version resolver"
```

---

### Task 2: Wire `regraftFallow()` into `session-init.mjs`

**Files:**
- Modify: `payload/hooks/session-init.mjs`

**Interfaces:**
- Consumes: `regraftFallow` from `./lib/superpowers-fallow-graft.mjs` (Task 1)

**Context:** `session-init.mjs` runs at SessionStart in all profiles. Add one guarded call among the existing session-start steps (near the other patch/graft steps such as gsd-agent-patches / component re-graft), following the file's established defensive pattern. `regraftFallow()` already swallows all errors, so a bare call is safe; still, place it where a thrown import error cannot abort the rest (the file already imports sibling libs at top — add the import there).

- [ ] **Step 1: Add the import**

At the top of `session-init.mjs`, with the other `./lib/*.mjs` imports:

```javascript
import { regraftFallow } from "./lib/superpowers-fallow-graft.mjs";
```

- [ ] **Step 2: Add the guarded call**

In the main SessionStart flow, alongside the existing graft/patch steps:

```javascript
// Re-apply the fallow structural pre-pass into Superpowers' review prompt (idempotent;
// self-heals after a Superpowers plugin update lands a fresh code-reviewer.md). The graft
// self-skips in GSD projects at review time via its `.planning/` guard. Never-throw.
try { regraftFallow(); } catch { /* never break SessionStart */ }
```

- [ ] **Step 3: Verify the whole suite still runs**

Run (bash): `shopt -s globstar; node --test payload/**/*.test.mjs`
Expected: PASS, unchanged count plus Task 1's file. (Windows PowerShell has no `globstar`; use the bash tool for this glob or pass explicit paths — see the plan note on globstar.)

- [ ] **Step 4: Commit**

```bash
git add payload/hooks/session-init.mjs
git commit -m "feat(fallow): re-graft superpowers review pre-pass on SessionStart"
```

---

### Task 3: `stack-commands.mjs` — `commandsForMarkers()` lookup

**Files:**
- Create: `payload/bin/lib/stack-commands.mjs`
- Test: `payload/bin/lib/stack-commands.test.mjs`

**Interfaces:**
- Produces: `commandsForMarkers(markers: string[]) → { test: string|null, build: string|null }`

**Design note (priority):** native/mobile markers are strong signals; JS is the fallback default. Priority order (first match wins): `dart` → `kotlin`/`android` → `swift` → `go` → `csharp` → `django`/`python`/`bot-python` → JS (`next`/`vite`/`nest`/`node`/`turbo`/`nx`/`bot-node`). For JS, `pnpm-ws` present ⇒ workspace-root script form (`pnpm -w …`). Unknown ⇒ `{test:null, build:null}`.

- [ ] **Step 1: Write the failing tests**

```javascript
// payload/bin/lib/stack-commands.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { commandsForMarkers } from "./stack-commands.mjs";

test("plain node/next → pnpm test/build", () => {
  assert.deepEqual(commandsForMarkers(["node", "next"]), { test: "pnpm test", build: "pnpm build" });
});
test("pnpm workspace → workspace-root script form", () => {
  assert.deepEqual(commandsForMarkers(["node", "pnpm-ws"]), { test: "pnpm -w test", build: "pnpm -w build" });
});
test("django → uv run pytest, no build", () => {
  assert.deepEqual(commandsForMarkers(["python", "django"]), { test: "uv run pytest", build: null });
});
test("kotlin/android → gradlew", () => {
  assert.deepEqual(commandsForMarkers(["kotlin", "android"]), { test: "./gradlew test", build: "./gradlew build" });
});
test("dart → flutter", () => {
  assert.deepEqual(commandsForMarkers(["dart"]), { test: "flutter test", build: "flutter build" });
});
test("go → go test/build ./...", () => {
  assert.deepEqual(commandsForMarkers(["go"]), { test: "go test ./...", build: "go build ./..." });
});
test("native beats co-present JS (kotlin + node → gradlew)", () => {
  assert.deepEqual(commandsForMarkers(["node", "kotlin"]), { test: "./gradlew test", build: "./gradlew build" });
});
test("unknown stack → nulls", () => {
  assert.deepEqual(commandsForMarkers(["docker", "ci"]), { test: null, build: null });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test payload/bin/lib/stack-commands.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```javascript
// payload/bin/lib/stack-commands.mjs
// Pure stack-marker → {test,build} lookup. Markers come from stack-rules-check.mjs detectMarkers().
// Priority: native/mobile signals win over JS (JS is the fallback default). Deterministic.
export function commandsForMarkers(markers) {
  const m = new Set(markers || []);
  if (m.has("dart")) return { test: "flutter test", build: "flutter build" };
  if (m.has("kotlin") || m.has("android")) return { test: "./gradlew test", build: "./gradlew build" };
  if (m.has("swift")) return { test: "swift test", build: "swift build" };
  if (m.has("go")) return { test: "go test ./...", build: "go build ./..." };
  if (m.has("csharp")) return { test: "dotnet test", build: "dotnet build" };
  if (m.has("django") || m.has("python") || m.has("bot-python")) return { test: "uv run pytest", build: null };
  const js = ["next", "vite", "nest", "node", "turbo", "nx", "bot-node", "react-native"];
  if (js.some((t) => m.has(t))) {
    const p = m.has("pnpm-ws") ? "pnpm -w" : "pnpm";
    return { test: `${p} test`, build: `${p} build` };
  }
  return { test: null, build: null };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test payload/bin/lib/stack-commands.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add payload/bin/lib/stack-commands.mjs payload/bin/lib/stack-commands.test.mjs
git commit -m "feat(stack-commands): marker→test/build lookup"
```

---

### Task 4: `detect-stack-commands.mjs` — CLI emitting the section

**Files:**
- Create: `payload/bin/detect-stack-commands.mjs`
- Test: `payload/bin/detect-stack-commands.test.mjs`

**Interfaces:**
- Consumes: `detectMarkers` from `../hooks/lib/stack-rules-check.mjs`, `commandsForMarkers` from `./lib/stack-commands.mjs`
- Produces: `renderDetectedCommands(root) → string` (the markdown block); CLI `--root <path>` prints it.

**Note:** deployed layout is `~/.claude/bin/detect-stack-commands.mjs` and `~/.claude/hooks/lib/stack-rules-check.mjs`, so `../hooks/lib/…` resolves both in-repo (`payload/bin` → `payload/hooks/lib`) and when installed.

- [ ] **Step 1: Write the failing tests**

```javascript
// payload/bin/detect-stack-commands.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderDetectedCommands } from "./detect-stack-commands.mjs";

test("emits a well-formed section for a node project", () => {
  const d = mkdtempSync(join(tmpdir(), "detect-cmd-"));
  writeFileSync(join(d, "package.json"), "{}");
  const block = renderDetectedCommands(d);
  assert.match(block, /^## Detected commands/m);
  assert.match(block, /pnpm test/);
  assert.match(block, /pnpm build/);
  rmSync(d, { recursive: true, force: true });
});

test("unknown stack → explicit no-confident-default line", () => {
  const d = mkdtempSync(join(tmpdir(), "detect-cmd-"));
  const block = renderDetectedCommands(d);
  assert.match(block, /^## Detected commands/m);
  assert.match(block, /no confident default/i);
  rmSync(d, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test payload/bin/detect-stack-commands.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

```javascript
// payload/bin/detect-stack-commands.mjs
// Prints a rebuild-safe "## Detected commands" markdown block for the rules compiler to include
// in .claude/stack-rules.md. Pure derivation from detectMarkers() + commandsForMarkers().
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { detectMarkers } from "../hooks/lib/stack-rules-check.mjs";
import { commandsForMarkers } from "./lib/stack-commands.mjs";

export function renderDetectedCommands(root) {
  const markers = detectMarkers(root);
  const { test, build } = commandsForMarkers(markers);
  const lines = ["## Detected commands", ""];
  if (test || build) {
    lines.push(`Detected stack: ${markers.join(", ") || "—"}. Use these unless the project says otherwise.`, "");
    if (test) lines.push(`- **Test:** \`${test}\``);
    if (build) lines.push(`- **Build:** \`${build}\``);
  } else {
    lines.push(
      `Detected stack: ${markers.join(", ") || "—"}. No confident default test/build command —`,
      "set the exact commands for this project manually.",
    );
  }
  return lines.join("\n") + "\n";
}

function isMain() {
  const a = process.argv[1];
  if (!a) return false;
  const self = fileURLToPath(import.meta.url);
  if (resolve(a) === self) return true;
  try { return realpathSync(a) === self; } catch { return false; }
}

if (isMain()) {
  const i = process.argv.indexOf("--root");
  const root = resolve(i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : process.cwd());
  process.stdout.write(renderDetectedCommands(root));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test payload/bin/detect-stack-commands.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add payload/bin/detect-stack-commands.mjs payload/bin/detect-stack-commands.test.mjs
git commit -m "feat(stack-commands): detect-stack-commands CLI emits the section"
```

---

### Task 5: Rules-compiler directive in `rules-src/README.md`

**Files:**
- Modify: `payload/rules-src/README.md`

**Context:** The compiler subagent regenerates `.claude/stack-rules.md` from `rules-src/`. It must emit the detected-commands section so a rebuild reproduces (never wipes) it. This is prose guidance the compiler follows — no unit test (covered by the behavior of Task 4's CLI, which the directive invokes).

- [ ] **Step 1: Add the directive**

In the "Building stack-rules" section of `payload/rules-src/README.md`, add a step instructing the compiler to run the CLI and append its output verbatim as a top-level section of the snapshot:

```markdown
- **Detected commands (rebuild-safe):** run `node ~/.claude/bin/detect-stack-commands.mjs --root <projectRoot>`
  and include its `## Detected commands` block verbatim as a section of the snapshot. It derives
  exact test/build commands from the same stack markers this snapshot fingerprints, so every
  rebuild reproduces it. Do not hand-edit the block — change the stack or the lookup instead.
```

- [ ] **Step 2: Verify no code regressions**

Run (bash): `shopt -s globstar; node --test payload/**/*.test.mjs`
Expected: PASS (doc-only change; suite unaffected).

- [ ] **Step 3: Commit**

```bash
git add payload/rules-src/README.md
git commit -m "docs(rules): compiler emits detected test/build commands into stack-rules"
```

---

### Task 6: RISK_REGISTER updates + all-profiles regression test (+ #3 retire note)

**Files:**
- Modify: `RISK_REGISTER.md`
- Modify: the existing variants regression test (`setup-variants.e2e.test.mjs` — confirm exact filename before editing)

**Context:** `variants.json` needs **no** edit — the new non-test files ship to all profiles by default, and `**.test.mjs` is already globally excluded. Capability #3 (`claude_orchestration`) is retired: the reference doc `payload/references/gsd-claude-orchestration-pilot.md` stays as-is; the only action is recording the decision in the risk register. (Note: `references/**` is excluded in base/lite, which is correct — the pilot is GSD-only.)

- [ ] **Step 1: Write the failing regression test**

Add to the variants regression test (adapt the resolver call to the file's existing helper for resolving a profile's file list):

```javascript
test("Category-II files ship to all profiles; their tests do not", () => {
  for (const profile of ["full", "base", "lite"]) {
    const files = resolveProfileFiles(profile); // use the suite's existing resolver
    assert.ok(files.includes("hooks/lib/superpowers-fallow-graft.mjs"), `${profile}: fallow graft`);
    assert.ok(files.includes("bin/detect-stack-commands.mjs"), `${profile}: detect CLI`);
    assert.ok(files.includes("bin/lib/stack-commands.mjs"), `${profile}: stack-commands lib`);
    assert.ok(!files.some((f) => f.endsWith(".test.mjs")), `${profile}: no test files`);
  }
});
```

- [ ] **Step 2: Run to verify it passes as written** (these files exist after Tasks 1–4, and all-profiles is the default)

Run: `node --test <variants regression test file>`
Expected: PASS. If it FAILS because a file is missing from a profile, an unintended `exclude` is catching it — fix `variants.json`, do not weaken the test.

- [ ] **Step 3: Update RISK_REGISTER.md**

- RISK-INITSTACK-001: status → **Resolved**; note #1 (fallow via Superpowers graft) and #2 (test/build via rules compiler) reinstated the two genuinely-dropped capabilities; #3 (`claude_orchestration` pilot ask) **deliberately retired** — reference doc retained, no interactive restore (rationale: GSD-only, narrow value, fail-closed, gate usually closed).
- RISK-FALLOW-001: status → **Resolved** (base/lite now receive fallow via the guarded Superpowers-review graft).

- [ ] **Step 4: Commit**

```bash
git add RISK_REGISTER.md <variants regression test file>
git commit -m "test(variants): assert Category-II files are all-profiles; resolve INITSTACK/FALLOW risks"
```

---

## Self-Review

**Spec coverage:** #1 fallow → Tasks 1–2 (graft lib, resolver, re-apply, session-init wiring). #2 test/build → Tasks 3–5 (lookup, CLI, compiler directive). #3 retire → Task 6 (risk-register note; doc untouched). Cross-cutting risks → Task 6. Membership (all profiles) → Task 6 regression test. All spec sections mapped.

**Placeholder scan:** No TBD/TODO. Every code and test step carries real code. The one "confirm exact filename" (variants regression test) is an instruction to verify a path, not a code placeholder — the implementer greps for the existing all-profiles test.

**Type consistency:** `applyFallowGraft` returns the same `{applied,already,skippedNoAnchor}` shape everywhere; `regraftFallow` spreads it under `{ok}`. `commandsForMarkers` returns `{test,build}` (nullable) consumed identically by `renderDetectedCommands`. `resolveSuperpowersReviewerFile` returns `string|null`, handled by `regraftFallow`. Consistent.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-27-category2-gsd-reintegration.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, task review between tasks, broad final review.
2. **Inline Execution** — execute in this session with checkpoints.

Which approach?
