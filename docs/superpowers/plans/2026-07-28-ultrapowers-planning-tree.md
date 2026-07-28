# `.ultrapowers/` Planning Tree, Agent-First Execution and the SDD Summary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use ultrapowers:subagent-driven-development (recommended) or ultrapowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give ultrapowers one versioned planning tree (`.ultrapowers/`) whose only git-ignored path is `sdd/`, make agent delegation the execution default, and replace "delete the workspace" with "write `NN-SUMMARY.md`".

**Architecture:** Three numbered deltas against the ultrapowers fork repoint every document path, invert the execution default, and rewrite the SDD `## Finish` section; two new fork-owned prompt files let subagents write the SUMMARY and VERIFICATION documents; one new fork-owned script allocates phase directories. In claude-config, the existing `.superpowers/sdd/` scratch is folded into SUMMARYs and the historic `docs/superpowers/{plans,specs}` trees move under `.ultrapowers/archive/`.

**Tech Stack:** Node 20+ ESM (`node --test`), bash scripts, the fork's own `transform/` build engine (`parsePatch`/`applyPatch`), git.

## Global Constraints

- Two repositories are in play. The fork is `D:\6__Work\AI_Projects\ultrapowers`, work happens on branch `patch`. The bundle is `D:\6__Work\AI_Projects\claude-config`, branch `master`.
- **The fork's `main` branch is generated.** Never hand-edit it. Rebuild with `node transform/build-cli.mjs commit`.
- **Deltas apply in filename sort order onto one shared tree.** A delta must therefore be authored against the tree that every lower-numbered delta has already produced. This plan renumbers the deltas the specs named `007`/`008`:

  | This plan | Spec name | Content |
  |---|---|---|
  | `007-planning-tree.patch` | — | document paths move into `.ultrapowers/` |
  | `008-sdd-summary.patch` | `008-sdd-summary.patch` | SDD writes a SUMMARY, keeps the workspace |
  | `009-agent-first.patch` | — | agent-first routing and who writes which document |
  | `010-design-records.patch` | `007-design-records.patch` | seams, Out of Scope, glossary, ADR — **plan #2, authored last** |

  The renumbering is forced, not cosmetic: `010` edits the same region of `brainstorming/SKILL.md` that `007` edits, and a lower number would have to match text that does not exist yet.
- **Validate every delta with the fork's own parser, never `git apply`.** `node transform/build-cli.mjs check` runs `parsePatch` + `applyPatch` and asserts hunk geometry exactly; `git apply --check` tolerates geometry the build rejects.
- **Blank context lines are forbidden inside a hunk.** A blank line stripped of its leading space fails with `header declares N/M, body has N-1/M-1`. Where the target line is surrounded by blank lines, use a **zero-context single-line hunk** (`@@ -N,1 +N,1 @@`); `findSequence` locates a unique line anywhere in the file.
- Paths written by skills: `.ultrapowers/phases/NN-slug/`, `.ultrapowers/tasks/NN-slug/`, `.ultrapowers/adhoc/NN-slug/`. Document names are `NN-SPEC.md`, `NN-PLAN.md`, `NN-SUMMARY.md`, `NN-VERIFICATION.md`, `NN-REVIEW.md`, `NN-DEBUG.md`, where `NN` is the directory's own numeric prefix.
- `sdd/` is the ONLY git-ignored path in the tree. It keeps its self-ignoring `.gitignore` containing `*`.
- No file is scaffolded empty. `PROJECT.md`, `ROADMAP.md`, `STATE.md`, `SUMMARY.md`, `GLOSSARY.md`, `RISK_REGISTER.md` appear when they have content.
- Terse-code mode: no comments except a genuine non-obvious *why*, no blank lines used only for visual grouping.

## Assumptions recorded at planning time

These close gaps the specs left open. They are decisions, not guesses — change them here if wrong, before Task 1.

1. **`.ultrapowers/docs/` is for artefacts and external sources only.** Process history never goes there (user ruling, 2026-07-28).
2. **Historic `docs/superpowers/{plans,specs}` (15 plans + 31 specs) move verbatim to `.ultrapowers/archive/{plans,specs}/`.** No retrofit into phase directories — retrofitting is out of scope in both source specs, and folding 46 documents into invented phase numbers would fabricate a history that never happened.
3. **`GLOSSARY.md` and `RISK_REGISTER.md` live inside `.ultrapowers/`**, per the layout spec. This contradicts the user-scope `~/.claude/CLAUDE.md`, which says the register goes to `.planning/` or the project root. That file is `CURATED:NOEDIT` and hook-blocked, so Task 12 asks the user to make the one-line edit; no task attempts it.
4. **ADRs live at `.ultrapowers/adr/NNNN-slug.md`** (user ruling, 2026-07-28), not the root `docs/adr/` the decision-records spec assumed. Consequence, accepted knowingly: `/gsd-ingest-docs` scans `docs/adr/`, so ADRs no longer migrate into a `.planning/` setup for free. Plan #3 owns whatever bridge that needs.
5. **`phases/` vs `tasks/` vs `adhoc/`**: `phases/` for work that gets a plan and more than one commit; `tasks/` for quick work with the same file set and shorter documents; `adhoc/` for unplanned, out-of-phase work. The allocator script takes the kind as its first argument, so the choice is explicit at the moment of creation.

## File Structure

**Fork (`D:\6__Work\AI_Projects\ultrapowers`, branch `patch`):**

| File | Responsibility |
|---|---|
| `transform/deltas/007-planning-tree.patch` | repoints six document-path references across four skills |
| `transform/deltas/008-sdd-summary.patch` | SDD process diagram, `## Finish`, ledger contract |
| `transform/deltas/009-agent-first.patch` | `## When to Use` routing, the delegation boundary table, who writes which document |
| `transform/fork-owned/phase-dir` | allocates/resolves `.ultrapowers/{phases,tasks,adhoc}/NN-slug/` |
| `transform/fork-owned/summary-writer-prompt.md` | subagent that folds the ledger + reports into `NN-SUMMARY.md` |
| `transform/fork-owned/verification-prompt.md` | subagent that writes `NN-VERIFICATION.md` from the plan and the branch diff |
| `transform/phase-dir.test.mjs` | tests the allocator (not shipped — lives outside `fork-owned/`) |
| `transform/inventory.json` | gains three `forkOwned` entries and an optional `mode` field |
| `transform/build.mjs` | honours `forkOwned[].mode`, defaulting to `100644` |
| `transform/build.test.mjs` | asserts the mode is honoured |

**Bundle (`D:\6__Work\AI_Projects\claude-config`, branch `master`):**

| File | Responsibility |
|---|---|
| `.gitignore` | drops `.superpowers/`; the new tree is tracked |
| `.ultrapowers/archive/{plans,specs}/` | frozen historic documents, moved with `git mv` |
| `.ultrapowers/phases/NN-slug/NN-SUMMARY.md` | three SUMMARYs folded from the `.superpowers/sdd/` strata |
| `RISK_REGISTER.md` → `.ultrapowers/RISK_REGISTER.md` | moved with `git mv`, references updated |

---

### Task 1: `forkOwned[].mode` — ship an executable fork-owned file

The allocator script added in Task 2 must be executable. Today `build.mjs` hardcodes `mode: "100644"` for every fork-owned file, so a script shipped that way cannot be run the way `scripts/sdd-workspace` is.

**Files:**
- Modify: `transform/build.mjs` (the `inventory.forkOwned` loop)
- Test: `transform/build.test.mjs` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `inventory.forkOwned[].mode` — an optional string, defaulting to `"100644"`, written straight into the built tree entry's `mode`.

- [ ] **Step 1: Write the failing test**

Append to `transform/build.test.mjs`:

```js
test("fork-owned files carry their declared mode, defaulting to 100644", () => {
  const inventory = {
    pluginRoot: "plugins/ultrapowers",
    rules: [],
    manifest: [],
    forkOwned: [
      { src: "fork-owned/runme", dest: "plugins/ultrapowers/skills/x/scripts/runme", mode: "100755" },
      { src: "fork-owned/plain.md", dest: "plugins/ultrapowers/skills/x/plain.md" },
    ],
  };
  const forkOwned = new Map([
    ["fork-owned/runme", "#!/usr/bin/env bash\nexit 0\n"],
    ["fork-owned/plain.md", "text\n"],
  ]);
  const result = build({ tree: new Map(), cfg: { substitutions: [], protect: [] }, inventory, forkOwned });
  assert.equal(result.files.get("plugins/ultrapowers/skills/x/scripts/runme").mode, "100755");
  assert.equal(result.files.get("plugins/ultrapowers/skills/x/plain.md").mode, "100644");
});
```

If the existing file does not already import them, add at the top: `import { test } from "node:test";`, `import assert from "node:assert/strict";`, `import { build } from "./build.mjs";`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test transform/build.test.mjs`
Expected: FAIL — `Expected values to be strictly equal: '100644' !== '100755'`

- [ ] **Step 3: Honour the declared mode**

In `transform/build.mjs`, inside the `for (const f of inventory.forkOwned ?? [])` loop, replace:

```js
    files.set(f.dest, { mode: "100644", text });
```

with:

```js
    files.set(f.dest, { mode: f.mode ?? "100644", text });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test transform/build.test.mjs && node transform/build-cli.mjs check`
Expected: tests PASS; the build reports `files 56 | deltas applied 6 obsolete 0 failed 0` with no `REFUSE` lines.

- [ ] **Step 5: Commit**

```bash
git add transform/build.mjs transform/build.test.mjs
git commit -m "transform: let a fork-owned file declare its file mode"
```

---

### Task 2: `phase-dir` — the planning-directory allocator

Every skill that writes a phase document needs the same directory, and needs to agree on its number. One script owns that, exactly as `sdd-workspace` owns the scratch path — two implementations of "which directory is this" is the drift that plan-scoped workspaces were introduced to remove.

**Files:**
- Create: `transform/fork-owned/phase-dir`
- Create: `transform/phase-dir.test.mjs`
- Modify: `transform/inventory.json` (`forkOwned` array)

**Interfaces:**
- Consumes: `forkOwned[].mode` from Task 1.
- Produces: `bash scripts/phase-dir KIND SLUG` → prints one absolute directory path, e.g. `/repo/.ultrapowers/phases/03-planning-tree`. `KIND` is `phase`, `task` or `adhoc`. Re-running with the same kind and slug prints the existing directory instead of allocating a second one. The directory's `NN-` prefix is the document prefix: `03-planning-tree/03-SPEC.md`. Shipped at `plugins/ultrapowers/skills/brainstorming/scripts/phase-dir`.

- [ ] **Step 1: Write the failing test**

Create `transform/phase-dir.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "fork-owned", "phase-dir");

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "phase-dir-"));
  execFileSync("git", ["-C", dir, "init", "-q"]);
  return dir;
}
const run = (dir, ...args) =>
  execFileSync("bash", [SCRIPT, ...args], { cwd: dir, encoding: "utf8" }).trim();

test("allocates 01 for the first phase", () => {
  const dir = repo();
  assert.equal(basename(run(dir, "phase", "planning-tree")), "01-planning-tree");
});

test("allocates the next free number per kind", () => {
  const dir = repo();
  run(dir, "phase", "first");
  assert.equal(basename(run(dir, "phase", "second")), "02-second");
  assert.equal(basename(run(dir, "task", "quick")), "01-quick");
});

test("re-resolves an existing slug instead of allocating again", () => {
  const dir = repo();
  const first = run(dir, "phase", "planning-tree");
  run(dir, "phase", "other");
  assert.equal(run(dir, "phase", "planning-tree"), first);
});

test("counts gaps from the highest number, never reusing a deleted one", () => {
  const dir = repo();
  mkdirSync(join(dir, ".ultrapowers", "phases", "07-old"), { recursive: true });
  assert.equal(basename(run(dir, "phase", "new")), "08-new");
});

test("rejects an unknown kind and a slug containing a separator", () => {
  const dir = repo();
  assert.throws(() => run(dir, "milestone", "x"));
  assert.throws(() => run(dir, "phase", "a/b"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test transform/phase-dir.test.mjs`
Expected: FAIL — every case errors, the script does not exist.

- [ ] **Step 3: Write the script**

Create `transform/fork-owned/phase-dir`:

```bash
#!/usr/bin/env bash
# Resolve and ensure one planning directory under .ultrapowers/, and print its absolute path.
#
# Single source of truth for where a phase's documents live, so brainstorming, writing-plans
# and subagent-driven-development cannot drift to different directories for the same work.
# The directory's NN- prefix is also the document prefix: 03-planning-tree/03-SPEC.md.
#
# Re-running with the same kind and slug re-resolves the existing directory: a later skill
# in the same phase asks for the same thing and must get the same answer, never a second
# directory. Numbers are allocated above the highest existing one and never reused, so a
# deleted phase cannot have its number silently taken over by unrelated work.
#
# Usage: phase-dir phase|task|adhoc SLUG
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "usage: phase-dir phase|task|adhoc SLUG" >&2
  exit 2
fi

kind=$1
slug=$2

case "$kind" in
  phase) sub=phases ;;
  task) sub=tasks ;;
  adhoc) sub=adhoc ;;
  *) echo "unknown kind: $kind (expected phase, task or adhoc)" >&2; exit 2 ;;
esac

case "$slug" in
  "" | . | .. | */* | *\\*) echo "bad slug: $slug" >&2; exit 2 ;;
esac

root=$(git rev-parse --show-toplevel)
base="$root/.ultrapowers/$sub"
mkdir -p "$base"

for d in "$base"/[0-9][0-9]-"$slug"; do
  if [ -d "$d" ]; then
    printf '%s\n' "$d"
    exit 0
  fi
done

next=1
for d in "$base"/[0-9][0-9]-*; do
  [ -d "$d" ] || continue
  n=$(basename "$d")
  n=${n%%-*}
  n=$((10#$n))
  [ "$n" -ge "$next" ] && next=$((n + 1))
done

dir=$(printf '%s/%02d-%s' "$base" "$next" "$slug")
mkdir -p "$dir"
printf '%s\n' "$dir"
```

- [ ] **Step 4: Register it as fork-owned and executable**

In `transform/inventory.json`, append to the `forkOwned` array:

```json
{
  "src": "fork-owned/phase-dir",
  "dest": "plugins/ultrapowers/skills/brainstorming/scripts/phase-dir",
  "mode": "100755",
  "reason": "one allocator for .ultrapowers/{phases,tasks,adhoc}/NN-slug/, so brainstorming, writing-plans and subagent-driven-development cannot disagree about which directory a phase's documents belong to"
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test transform/phase-dir.test.mjs && node transform/build-cli.mjs check`
Expected: 5/5 PASS; the build reports `files 57` and no `REFUSE` lines.

- [ ] **Step 6: Commit**

```bash
git add transform/fork-owned/phase-dir transform/phase-dir.test.mjs transform/inventory.json
git commit -m "fork-owned: phase-dir, the planning-directory allocator"
```

---

### Task 3: Delta `007-planning-tree` — every document path moves into `.ultrapowers/`

Six references across four skills still name `docs/ultrapowers/{plans,specs}`. They move to the phase directory in one delta, so a later re-authoring against a new upstream release is one file to fix, not six.

**Files:**
- Create: `transform/deltas/007-planning-tree.patch`

**Interfaces:**
- Consumes: `scripts/phase-dir` from Task 2 — the delta's text tells skills to call it.
- Produces: the paths `NN-SPEC.md` and `NN-PLAN.md` inside `.ultrapowers/phases/NN-slug/`, which deltas 008 and 009 and plan #2's delta 010 all assume.

- [ ] **Step 1: Write the delta**

Create `transform/deltas/007-planning-tree.patch` with exactly this content:

```diff
--- a/plugins/ultrapowers/skills/brainstorming/SKILL.md
+++ b/plugins/ultrapowers/skills/brainstorming/SKILL.md
@@ -28,3 +28,3 @@
 5. **Present design** — in sections scaled to their complexity, get user approval after each section
-6. **Write design doc** — save to `docs/ultrapowers/specs/YYYY-MM-DD-<topic>-design.md` and commit
+6. **Write design doc** — resolve the phase directory with `bash scripts/phase-dir phase <topic-slug>`, save the design there as `NN-SPEC.md`, and commit
 7. **Spec self-review** — quick inline check for placeholders, contradictions, ambiguity, scope (see below)
@@ -111,3 +111,3 @@
-- Write the validated design (spec) to `docs/ultrapowers/specs/YYYY-MM-DD-<topic>-design.md`
+- Write the validated design (spec) to the phase directory: `bash scripts/phase-dir phase <topic-slug>` prints `.ultrapowers/phases/NN-<topic-slug>/`, and the document is `NN-SPEC.md` inside it, where `NN` is that directory's own prefix. Use `task` instead of `phase` for quick work, `adhoc` for unplanned out-of-phase work.
   - (User preferences for spec location override this default)
 - Use elements-of-style:writing-clearly-and-concisely skill if available
--- a/plugins/ultrapowers/skills/brainstorming/spec-document-reviewer-prompt.md
+++ b/plugins/ultrapowers/skills/brainstorming/spec-document-reviewer-prompt.md
@@ -7,1 +7,1 @@
-**Dispatch after:** Spec document is written to docs/ultrapowers/specs/
+**Dispatch after:** Spec document is written to `.ultrapowers/phases/NN-slug/NN-SPEC.md`
--- a/plugins/ultrapowers/skills/writing-plans/SKILL.md
+++ b/plugins/ultrapowers/skills/writing-plans/SKILL.md
@@ -18,2 +18,2 @@
-**Save plans to:** `docs/ultrapowers/plans/YYYY-MM-DD-<feature-name>.md`
+**Save plans to:** the phase directory the spec already owns, as `NN-PLAN.md` — `bash ../brainstorming/scripts/phase-dir phase <feature-slug>` prints `.ultrapowers/phases/NN-<feature-slug>/`, re-resolving the existing directory rather than allocating a second one
 - (User preferences for plan location override this default)
@@ -154,1 +154,1 @@
-**"Plan complete and saved to `docs/ultrapowers/plans/<filename>.md`. Two execution options:**
+**"Plan complete and saved to `.ultrapowers/phases/NN-<feature-slug>/NN-PLAN.md`. Two execution options:**
--- a/plugins/ultrapowers/skills/requesting-code-review/SKILL.md
+++ b/plugins/ultrapowers/skills/requesting-code-review/SKILL.md
@@ -59,3 +59,3 @@
   DESCRIPTION: Added verifyIndex() and repairIndex() with 4 issue types
-  PLAN_OR_REQUIREMENTS: Task 2 from docs/ultrapowers/plans/deployment-plan.md
+  PLAN_OR_REQUIREMENTS: Task 2 from .ultrapowers/phases/04-deployment/04-PLAN.md
   BASE_SHA: a7981ec
--- a/plugins/ultrapowers/skills/subagent-driven-development/SKILL.md
+++ b/plugins/ultrapowers/skills/subagent-driven-development/SKILL.md
@@ -443,4 +443,4 @@
 [Setup: worktree verified]
-[Read plan file once: docs/ultrapowers/plans/feature-plan.md]
-[Resolve workspace: scripts/sdd-workspace docs/ultrapowers/plans/feature-plan.md — no ledger inside, fresh start]
+[Read plan file once: .ultrapowers/phases/04-hooks/04-PLAN.md]
+[Resolve workspace: scripts/sdd-workspace .ultrapowers/phases/04-hooks/04-PLAN.md — no ledger inside, fresh start]
 [Create todos for all tasks]
```

Two hunks carry no context at all (`@@ -7,1 +7,1 @@` and `@@ -154,1 +154,1 @@`). That is deliberate: both target lines sit between blank lines, and a blank context line stripped of its leading space is the exact failure `parsePatch` refuses. `findSequence` locates a unique single line anywhere in the file, so the position hint is enough.

- [ ] **Step 2: Verify the delta applies through the fork's own parser**

Run: `node transform/build-cli.mjs check`
Expected: `files 57 | deltas applied 7 obsolete 0 failed 0`, no `REFUSE` lines. A geometry error prints `malformed hunk at <path>:<line>`; a context miss prints `context not found at ~line N`.

- [ ] **Step 3: Verify the built text actually changed**

```bash
node transform/build-cli.mjs emit .build
grep -rn "docs/ultrapowers/\(plans\|specs\)" .build/ || echo "no stale paths remain"
grep -rn "phase-dir" .build/plugins/ultrapowers/skills/ | wc -l
```

Expected: `no stale paths remain`, and at least 3 lines mentioning `phase-dir`.

- [ ] **Step 4: Commit**

```bash
git add transform/deltas/007-planning-tree.patch
git commit -m "delta: move plan and spec documents into the .ultrapowers tree"
```

---

### Task 4: `summary-writer-prompt.md` — the agent that folds the ledger into a SUMMARY

`NN-SUMMARY.md` is a fold of the whole ledger plus every implementer report — measured at 159 KB, ~41k tokens, on this repository. The controller reaching the end of a phase already carries the plan and all coordination; reading that fold itself is out of budget. So a subagent reads it, writes the file, and returns one line.

**Files:**
- Create: `transform/fork-owned/summary-writer-prompt.md`
- Modify: `transform/inventory.json` (`forkOwned` array)

**Interfaces:**
- Consumes: `scripts/phase-dir` (Task 2) for the destination directory; the ledger contract that delta 008 hunk C states (Task 6).
- Produces: `plugins/ultrapowers/skills/subagent-driven-development/summary-writer-prompt.md`, referenced by name from delta 008's `## Finish` section and delta 009's document table.

- [ ] **Step 1: Write the prompt**

Create `transform/fork-owned/summary-writer-prompt.md`:

```markdown
# Summary Writer Prompt

**Dispatch when:** the final whole-branch review is clean and its fixes are merged.

**Model:** a mid-tier model. This is a fold of existing text, not a judgement about the code.

**Why a subagent:** the ledger and the implementer reports run to tens of thousands of tokens.
The controller that reaches this point is already carrying the plan and every coordination
decision; reading the drafts itself is what this dispatch exists to avoid.

```
Subagent (general-purpose):

Write the phase summary for a completed plan.

INPUTS
- Ledger: <workspace>/progress.md
- Implementer reports: <workspace>/task-*-report.md
- Plan: <plan file path>
- Destination: <phase dir>/<NN>-SUMMARY.md

Read the ledger first, then every report. Do not read the diffs or the task briefs — they are
regenerable and they are not what this document is for.

WRITE the destination file with these sections, in this order:

## Tasks
One line per task: the task number, its one-line deliverable, and its commit range as
`<base7>..<head7>`. Take the range from the ledger's completion line, never from your own
reading of git log.

## Rulings
Every finding the ledger records as parked, with its ruling. **Copy each ruling verbatim.**
Do not summarise, soften, merge or re-word them. These are the least flattering and most
valuable content in the whole record, and they are the first thing a fold smooths away. If a
ruling is three sentences of hedging, three sentences of hedging is what the file gets.
Include deferred minors the same way. If the ledger records none, write `None.` — not an
omitted section.

## Deviations and decisions
From the implementer reports: where the plan turned out to be wrong, what was tried and
abandoned, and what was decided on the spot. Extract these; do not copy the reports wholesale.
An implementer's report is mostly narration of work that git already records — what belongs
here is only what the code cannot show.

## Reviews
For each review, BOTH references on one line:
`<workspace-relative path>.diff` — `git diff <base7>..<head7>`
Two references because they fail at different times: while the workspace is on disk the file
is right there and opening it beats regenerating it; once the scratch is cleared the path goes
stale and the hash range still reconstructs the same diff exactly.

CONSTRAINTS
- Never paste diff content into the summary. It is byte-identical to what git already stores.
- Expect 15–30 KB for a large plan. If you are far above that, you are copying rather than
  folding.
- If the ledger and a report disagree about what happened, say so in `## Deviations and
  decisions` and name both. Do not pick a winner.

RETURN
One line only: the absolute path of the file you wrote, and the number of tasks, rulings and
reviews it covers. Returning the document's text spends on the way back exactly what this
dispatch saved.
```
```

- [ ] **Step 2: Register it as fork-owned**

Append to `forkOwned` in `transform/inventory.json`:

```json
{
  "src": "fork-owned/summary-writer-prompt.md",
  "dest": "plugins/ultrapowers/skills/subagent-driven-development/summary-writer-prompt.md",
  "reason": "the SUMMARY is a fold of the ledger plus every implementer report - tens of thousands of tokens the controller must not read itself, so the fold is delegated and only a path comes back"
}
```

- [ ] **Step 3: Verify it lands in the built tree**

Run: `node transform/build-cli.mjs check && node transform/build-cli.mjs emit .build && test -f .build/plugins/ultrapowers/skills/subagent-driven-development/summary-writer-prompt.md && echo present`
Expected: `files 58 …`, no `REFUSE` lines, then `present`.

- [ ] **Step 4: Commit**

```bash
git add transform/fork-owned/summary-writer-prompt.md transform/inventory.json
git commit -m "fork-owned: summary-writer-prompt, the ledger-to-SUMMARY fold"
```

---

### Task 5: `verification-prompt.md` — the agent that writes VERIFICATION

`NN-VERIFICATION.md` reads a lot of code and decides little. That is the shape that belongs in a subagent.

**Files:**
- Create: `transform/fork-owned/verification-prompt.md`
- Modify: `transform/inventory.json` (`forkOwned` array)

**Interfaces:**
- Consumes: nothing from Tasks 1–4 beyond the destination convention.
- Produces: `plugins/ultrapowers/skills/subagent-driven-development/verification-prompt.md`, referenced from delta 009's document table.

- [ ] **Step 1: Write the prompt**

Create `transform/fork-owned/verification-prompt.md`:

```markdown
# Verification Prompt

**Dispatch when:** the plan's tasks are complete and you need the phase's goal checked against
what the branch actually contains — before finishing the branch, not after.

**Model:** a capable model. Deciding whether a goal was met is judgement, even though the
inputs are bulk.

```
Subagent (general-purpose):

Verify that a completed phase achieved its goal, and write the verification document.

INPUTS
- Plan: <plan file path>
- Branch diff: <review package path>
- Destination: <phase dir>/<NN>-VERIFICATION.md

Work goal-backward. Start from the plan's **Goal** and **Global Constraints**, not from its
task list: a plan whose every task is ticked can still miss what it was for.

WRITE the destination file with these sections:

## Goal
The plan's goal, quoted, and a one-line verdict: ACHIEVED, PARTIAL or NOT ACHIEVED.

## Evidence
For each claim in the goal, the concrete thing in the branch that delivers it — file and
symbol, or the test that covers it. A claim with no evidence is not achieved, however
plausible the code looks.

## Global constraints
One line per constraint from the plan's Global Constraints section: HELD or VIOLATED, with the
file and line where you checked. Every constraint gets a line, including the ones that are
obviously fine.

## Gaps
What the plan promised and the branch does not contain. Empty is a valid answer; an invented
gap to look thorough is worse than none.

CONSTRAINTS
- Verify against the diff and the code, never against the implementer reports. Reports say
  what was intended; you are checking what landed.
- Do not fix anything. You are not an implementer, and a fix you make is a fix nobody reviews.
- Where you cannot verify a claim from the material given, say so explicitly under `## Gaps`
  as `unverifiable: <claim> — <what would settle it>`. Silence reads as verified.

RETURN
One line only: the absolute path of the file you wrote and the verdict.
```
```

- [ ] **Step 2: Register it as fork-owned**

Append to `forkOwned` in `transform/inventory.json`:

```json
{
  "src": "fork-owned/verification-prompt.md",
  "dest": "plugins/ultrapowers/skills/subagent-driven-development/verification-prompt.md",
  "reason": "goal-backward verification reads the whole branch diff and decides little - bulk reading that belongs in a subagent, returning a verdict and a path"
}
```

- [ ] **Step 3: Verify it lands in the built tree**

Run: `node transform/build-cli.mjs check && node transform/build-cli.mjs emit .build && test -f .build/plugins/ultrapowers/skills/subagent-driven-development/verification-prompt.md && echo present`
Expected: `files 59 …`, no `REFUSE` lines, then `present`.

- [ ] **Step 4: Commit**

```bash
git add transform/fork-owned/verification-prompt.md transform/inventory.json
git commit -m "fork-owned: verification-prompt, goal-backward checking in a subagent"
```

---

### Task 6: Delta `008-sdd-summary` — write the SUMMARY, keep the workspace

`## Finish` today says the git history is the record. It is not: git holds commits and diffs, and holds neither the rulings on parked findings nor why an approach was abandoned.

**Files:**
- Create: `transform/deltas/008-sdd-summary.patch`

**Interfaces:**
- Consumes: `summary-writer-prompt.md` (Task 4) and the `.ultrapowers/phases/NN-slug/` destination (Task 3).
- Produces: the ledger's cold-read contract, which `summary-writer-prompt.md` relies on and delta 009 assumes.

- [ ] **Step 1: Write the delta**

Create `transform/deltas/008-sdd-summary.patch`:

```diff
--- a/plugins/ultrapowers/skills/subagent-driven-development/SKILL.md
+++ b/plugins/ultrapowers/skills/subagent-driven-development/SKILL.md
@@ -75,3 +75,3 @@
     "Final findings? ONE fix dispatch, one scoped re-review, adjudicate residuals" [shape=box];
-    "Final review clean: delete this plan's workspace" [shape=box];
+    "Final review clean: write NN-SUMMARY, keep the workspace" [shape=box];
     "Use ultrapowers:finishing-a-development-branch" [shape=box style=filled fillcolor=lightgreen];
@@ -104,4 +104,4 @@
     "Dispatch final code reviewer (../requesting-code-review/code-reviewer.md)" -> "Final findings? ONE fix dispatch, one scoped re-review, adjudicate residuals";
-    "Final findings? ONE fix dispatch, one scoped re-review, adjudicate residuals" -> "Final review clean: delete this plan's workspace";
-    "Final review clean: delete this plan's workspace" -> "Use ultrapowers:finishing-a-development-branch";
+    "Final findings? ONE fix dispatch, one scoped re-review, adjudicate residuals" -> "Final review clean: write NN-SUMMARY, keep the workspace";
+    "Final review clean: write NN-SUMMARY, keep the workspace" -> "Use ultrapowers:finishing-a-development-branch";
 }
@@ -134,3 +134,7 @@
 - Create the ledger with its identity as the first line:
   `# SDD ledger — plan: <plan file path>`.
+- The ledger is read cold, by someone else. At the end of the plan a summary
+  writer subagent folds it into `NN-SUMMARY.md`, so every entry must stand on
+  its own: task number, commit range, ruling, deviation. An entry that only
+  makes sense to its own author has not been written yet.
 - The ledger is your recovery map: the commits it names exist in git even
@@ -418,4 +418,19 @@
-When the final whole-branch review is clean and its fixes are merged,
-delete this plan's workspace (`rm -rf <workspace>`) — the git history is
-the record now. Sibling directories belong to other plans; leave them
-alone.
+When the final whole-branch review is clean and its fixes are merged, write
+the phase summary — do not delete anything.
+
+Dispatch the summary writer ([summary-writer-prompt.md](summary-writer-prompt.md))
+with the ledger, the implementer reports, the plan file, and the destination
+`<phase dir>/<NN>-SUMMARY.md`. It returns a path; it never returns the
+document's text.
+
+The workspace stays. Diffs and briefs remain on disk, at hand, for as long as
+they are useful. Clearing `.ultrapowers/sdd/` is a separate, deliberate,
+janitorial act — nothing in it is lost, which is exactly why it need not
+happen on a schedule. Sibling directories belong to other plans; leave them
+alone.
+
+The premise the old instruction rested on was false. Git history holds commits
+and diffs; it does not hold the rulings on parked findings, and it does not
+hold why an approach was abandoned. Measured on one repository: 159 KB of
+irreplaceable content against 725 KB of diffs already in git. Deleting the
+workspace destroyed the first to be rid of the second.
@@ -500,1 +500,1 @@
-[Delete this plan's workspace — the record now lives in git]
+[Dispatch the summary writer: it writes 04-SUMMARY.md and returns the path. Workspace kept.]
```

The `@@ -418,4 @@` hunk carries no context because `## Finish`'s heading and its closing line are both separated from the body by blank lines. Its four removed lines are a unique sequence, which is what `findSequence` matches on.

- [ ] **Step 2: Verify the delta applies**

Run: `node transform/build-cli.mjs check`
Expected: `files 59 | deltas applied 8 obsolete 0 failed 0`, no `REFUSE` lines.

- [ ] **Step 3: Verify the deletion instruction is gone**

```bash
node transform/build-cli.mjs emit .build
grep -rn "delete this plan's workspace\|rm -rf <workspace>" .build/ || echo "deletion instruction removed"
grep -c "NN-SUMMARY" .build/plugins/ultrapowers/skills/subagent-driven-development/SKILL.md
```

Expected: `deletion instruction removed`, then a count of at least 4.

- [ ] **Step 4: Commit**

```bash
git add transform/deltas/008-sdd-summary.patch
git commit -m "delta: SDD writes a SUMMARY instead of deleting the workspace"
```

---

### Task 7: Delta `009-agent-first` — delegation becomes the default

The skill already states the principle and then applies it only to code. Two entry conditions currently route to manual execution — no plan, and tightly-coupled tasks — and both are wrong under an agent-first default: coupling is a reason to give **one** agent a chain, and absence of a plan is a reason to write one.

**Files:**
- Create: `transform/deltas/009-agent-first.patch`

**Interfaces:**
- Consumes: both prompt files (Tasks 4 and 5), and delta 008's rewritten `## Finish` — hunk C's context is 008's text, not upstream's.
- Produces: nothing later in this plan depends on it; plan #2's delta 010 touches a different file.

- [ ] **Step 1: Write the delta**

Create `transform/deltas/009-agent-first.patch`:

```diff
--- a/plugins/ultrapowers/skills/subagent-driven-development/SKILL.md
+++ b/plugins/ultrapowers/skills/subagent-driven-development/SKILL.md
@@ -22,15 +22,16 @@
-digraph when_to_use {
-    "Have implementation plan?" [shape=diamond];
-    "Tasks mostly independent?" [shape=diamond];
-    "Stay in this session?" [shape=diamond];
-    "subagent-driven-development" [shape=box];
-    "executing-plans" [shape=box];
-    "Manual execution or brainstorm first" [shape=box];
-
-    "Have implementation plan?" -> "Tasks mostly independent?" [label="yes"];
-    "Have implementation plan?" -> "Manual execution or brainstorm first" [label="no"];
-    "Tasks mostly independent?" -> "Stay in this session?" [label="yes"];
-    "Tasks mostly independent?" -> "Manual execution or brainstorm first" [label="no - tightly coupled"];
-    "Stay in this session?" -> "subagent-driven-development" [label="yes"];
-    "Stay in this session?" -> "executing-plans" [label="no - parallel session"];
-}
+digraph when_to_use {
+    "Phase artefact, or >1 commit?" [shape=diamond];
+    "Tasks mostly independent?" [shape=diamond];
+    "Stay in this session?" [shape=diamond];
+    "one agent, whole chain" [shape=box];
+    "subagent-driven-development" [shape=box];
+    "executing-plans" [shape=box];
+    "Offer: direct, or an agent" [shape=box];
+
+    "Phase artefact, or >1 commit?" -> "Tasks mostly independent?" [label="yes"];
+    "Phase artefact, or >1 commit?" -> "Offer: direct, or an agent" [label="no"];
+    "Tasks mostly independent?" -> "Stay in this session?" [label="yes"];
+    "Tasks mostly independent?" -> "one agent, whole chain" [label="no - coupled"];
+    "Stay in this session?" -> "subagent-driven-development" [label="yes"];
+    "Stay in this session?" -> "executing-plans" [label="no - parallel session"];
+}
@@ -39,1 +39,32 @@
+**Agent-driven execution is the norm.** The exception is a one-off isolated
+task, and there the correct move is to offer the choice, not to decide
+silently.
+
+| Situation | Execution |
+|---|---|
+| Work produces a phase artefact (SPEC/PLAN/SUMMARY/VERIFICATION/REVIEW) | Agent |
+| Work spans more than one commit | Agent |
+| Tasks are tightly coupled | Agent — **one** agent, given the chain, not one per task |
+| Single edit in a known location, no plan needed | Offer: directly, or via an agent |
+
+"Offer" means ask. It does not mean proceed and mention it afterwards.
+
+Absence of a plan is not an execution route. It is a reason to write a plan.
+
+**Who writes which document:**
+
+| Artefact | Written by | Why |
+|---|---|---|
+| `NN-SPEC.md` | main session | brainstorming is a dialogue with the human, one question at a time — not delegable |
+| `NN-PLAN.md` | main session | writing-plans negotiates as it goes |
+| `NN-SUMMARY.md` | **subagent** | mechanical fold of ~40k tokens of drafts ([summary-writer-prompt.md](summary-writer-prompt.md)) |
+| `NN-VERIFICATION.md` | **subagent** | reads a lot of code, decides little ([verification-prompt.md](verification-prompt.md)) |
+| `NN-REVIEW.md` | **subagent** | already the case — [code-reviewer.md](../requesting-code-review/code-reviewer.md) |
+| `ROADMAP.md`, `STATE.md` | main session | short edits; "where we are" lives in the coordinator |
+
+Anything requiring the human's answers stays in the main session. Anything
+requiring bulk reading goes to an agent. A document writer returns a path and
+a confirmation — never the document's text, which would spend on the way back
+exactly what the delegation saved.
+
 **vs. Executing Plans (parallel session):**
@@ -422,2 +422,6 @@
-When the final whole-branch review is clean and its fixes are merged, write
-the phase summary — do not delete anything.
+When the final whole-branch review is clean and its fixes are merged, write the
+phase documents — do not delete anything.
+
+Dispatch the verification writer ([verification-prompt.md](verification-prompt.md))
+with the plan file, the whole-branch review package, and the destination
+`<phase dir>/<NN>-VERIFICATION.md`. It returns a path and a verdict.
```

Three things about this delta's geometry, each of which will bite if ignored:

- The first hunk removes a blank line (line 29 of the original) and adds one. That is safe — the hazard is a blank **context** line, which loses its leading space; a `-` or `+` line is unambiguous.
- The third hunk's removed text is **delta 008's** output, not upstream's. Author it after 008 exists and verify with a full build, never against `--base`.
- `@@ -422,2 @@` is a position hint, not an assertion. Delta 008 inserts four lines earlier in the file, so the real line number shifts; `findSequence` matches the text and takes the occurrence nearest the hint.

- [ ] **Step 2: Verify the delta applies**

Run: `node transform/build-cli.mjs check`
Expected: `files 59 | deltas applied 9 obsolete 0 failed 0`, no `REFUSE` lines.

- [ ] **Step 3: Verify the routing actually inverted**

```bash
node transform/build-cli.mjs emit .build
SDD=.build/plugins/ultrapowers/skills/subagent-driven-development/SKILL.md
grep -c "Manual execution or brainstorm first" "$SDD" || echo "manual route gone"
grep -c "Offer: direct, or an agent" "$SDD"
grep -c "verification-prompt.md" "$SDD"
```

Expected: `manual route gone`, then `3`, then `2`.

- [ ] **Step 4: Commit**

```bash
git add transform/deltas/009-agent-first.patch
git commit -m "delta: agent-first execution, and who writes the phase documents"
```

---

### Task 8: Rebuild and publish the fork

`main` is generated. Three deltas, three fork-owned files and one engine change have landed on `patch`; `main` must be rebuilt from them, and the shipped version must move so an installed copy can tell it changed.

**Files:**
- Modify: `transform/config.json` (`version.revision`)

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces: a `main` tree carrying the new skills, and the version string `6.2.0-up.2`.

- [ ] **Step 1: Bump the fork revision**

In `transform/config.json`, change `"revision": 1` to `"revision": 2`. Upstream has not moved, so only the fork's own revision advances; the shipped version becomes `6.2.0-up.2`.

- [ ] **Step 2: Verify the build refuses nothing**

Run: `node transform/build-cli.mjs check`
Expected: `files 59 | deltas applied 9 obsolete 0 failed 0` and no `REFUSE` lines. Any `OBSOLETE` line means upstream has since made the same change — decide per delta, do not drop it automatically.

- [ ] **Step 3: Commit the patch branch, then rebuild `main`**

```bash
git add transform/config.json
git commit -m "transform: revision 2 - the planning tree, agent-first execution, the SDD summary"
node transform/build-cli.mjs commit
```

Expected: `main -> <sha> (tree <sha>)`.

- [ ] **Step 4: Verify `main` is exactly what a fresh build produces**

Run: `node transform/build-cli.mjs drift`
Expected: `main is exactly what original + patch produce (tree <sha>)`.

- [ ] **Step 5: Push both branches**

```bash
git push origin patch main
```

---

### Task 9: Un-ignore the planning tree in claude-config

The bundle's `.gitignore` still hides `.superpowers/`, the pre-rebrand scratch. The new tree is versioned; only `sdd/` inside it is not, and it ignores itself.

**Files:**
- Modify: `D:\6__Work\AI_Projects\claude-config\.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: a working tree in which `.ultrapowers/` is trackable — every later task in this plan depends on that.

- [ ] **Step 1: Remove the stale ignore**

In `.gitignore`, delete the line:

```
.superpowers/
```

Add nothing in its place. `scripts/sdd-workspace` writes `.ultrapowers/sdd/.gitignore` containing `*`, so the scratch ignores itself the moment it exists; a second rule in the root `.gitignore` would be a duplicate that can drift.

- [ ] **Step 2: Verify the tree is now visible and the scratch is not**

```bash
mkdir -p .ultrapowers/sdd && printf '*\n' > .ultrapowers/sdd/.gitignore
printf 'probe\n' > .ultrapowers/sdd/probe.txt
git status --short .ultrapowers
```

Expected: `.ultrapowers/sdd/` does not appear in the output. Then remove the probe: `rm .ultrapowers/sdd/probe.txt`.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: track the .ultrapowers planning tree, ignore only its sdd scratch"
```

---

### Task 10: Fold the three `.superpowers/sdd/` strata into SUMMARYs

`.superpowers/` holds 106 files and 952 KB, of which 83% duplicates git. Three distinct strata exist and each is folded the same way: keep the reasoning and the rulings, drop the diffs and the briefs.

| Stratum | Ledger | Reports | What it is |
|---|---|---|---|
| `archive-graphify-neo4j/` | `sdd/progress-graphify-neo4j.archive.md` | 10 | finished work, manually set aside |
| the flat `sdd/` root | `sdd/progress.md` — `# Progress: AI Development Mode (feat/ai-dev-mode-spec)` | 8 (`task-1..8-report.md`) plus 4 fix-wave reports | the pre-plan-scoped format |
| `2026-07-27-ultrapowers-layer0-patcher/` | that directory's `progress.md` | 1 (`task-2-report.md`) | **abandoned mid-flight** — its ledger ends `Awaiting: verified facts … before the new spec is written`, and the fork design superseded it |

**Files:**
- Create: `.ultrapowers/phases/01-graphify-neo4j/01-SUMMARY.md`
- Create: `.ultrapowers/phases/02-ai-development-mode/02-SUMMARY.md`
- Create: `.ultrapowers/phases/03-ultrapowers-layer0-patcher/03-SUMMARY.md`
- Delete: `.superpowers/` (whole tree, after the three SUMMARYs are committed)

**Interfaces:**
- Consumes: `scripts/phase-dir` (Task 2) and `summary-writer-prompt.md` (Task 4) — this task is the first real use of both.
- Produces: three phase directories, which Task 12 verifies.

- [ ] **Step 1: Allocate the three phase directories**

From the claude-config repository root, run the allocator out of the fork's emitted build (the installed plugin copy does not update until the marketplace is refreshed):

```bash
PD=/d/6__Work/AI_Projects/ultrapowers/.build/plugins/ultrapowers/skills/brainstorming/scripts/phase-dir
bash "$PD" phase graphify-neo4j
bash "$PD" phase ai-development-mode
bash "$PD" phase ultrapowers-layer0-patcher
```

Expected: three paths ending `01-graphify-neo4j`, `02-ai-development-mode`, `03-ultrapowers-layer0-patcher`. The order matters — it is chronological, and the allocator never reuses a number.

- [ ] **Step 2: Dispatch one summary writer per stratum**

Three dispatches, using `summary-writer-prompt.md` verbatim with these inputs. Do not read the drafts yourself: the three ledgers plus 19 reports are exactly the bulk this prompt exists to keep out of the controller's context.

| Dispatch | Ledger | Reports | Destination |
|---|---|---|---|
| 1 | `.superpowers/sdd/progress-graphify-neo4j.archive.md` | `.superpowers/sdd/archive-graphify-neo4j/*report*.md` | `.ultrapowers/phases/01-graphify-neo4j/01-SUMMARY.md` |
| 2 | `.superpowers/sdd/progress.md` | `.superpowers/sdd/task-*-report.md` and `.superpowers/sdd/*-report.md` | `.ultrapowers/phases/02-ai-development-mode/02-SUMMARY.md` |
| 3 | `.superpowers/sdd/2026-07-27-ultrapowers-layer0-patcher/progress.md` | that directory's `task-2-report.md` | `.ultrapowers/phases/03-ultrapowers-layer0-patcher/03-SUMMARY.md` |

Two additions to the prompt's standard inputs, specific to this backfill:

- The review references cannot use a live workspace path, because the workspace is about to be deleted. For each `review-A..B.diff` filename, record **only** the hash range: `git diff A..B`. State that in the dispatch — the prompt asks for both references and one of them is knowingly unavailable here.
- Dispatch 3 covers abandoned work. Its summary must say so in the first line of `## Tasks` and carry the ledger's `Awaiting:` block verbatim under `## Rulings`. A summary that reads as if the work completed is worse than no summary.

- [ ] **Step 3: Verify each summary before deleting anything**

```bash
wc -c .ultrapowers/phases/*/*-SUMMARY.md
grep -L "## Rulings" .ultrapowers/phases/*/*-SUMMARY.md || echo "all three carry rulings"
grep -c "diff --git\|^+++ \|^--- " .ultrapowers/phases/*/*-SUMMARY.md
```

Expected: each file between roughly 5 KB and 30 KB; `all three carry rulings`; and zero diff content in every file. A summary carrying diff hunks has copied rather than folded — send it back rather than editing it yourself.

Read the three files yourself at this point. This is the one place where the controller must read the output: everything else can be regenerated from git, and this cannot.

- [ ] **Step 4: Commit the summaries, then delete the scratch**

```bash
git add .ultrapowers/phases
git commit -m "docs: fold the three sdd strata into phase summaries"
rm -rf .superpowers
git status --short
```

Expected: `git status --short` shows nothing — `.superpowers/` was never tracked, so its removal is not a commit.

`rm -rf` is correct here and only here: every remaining byte is either a diff that `git diff` reproduces exactly, or a brief that `scripts/task-brief` regenerates from a plan file that is still in the repository.

---

### Task 11: Move the historic documents and the risk register into the tree

`docs/superpowers/` holds 15 plans, 31 specs and a `rework/` folder — process records, which by the layout's own rule do not belong in `.ultrapowers/docs/` (artefacts and external sources only). They move to `.ultrapowers/archive/` verbatim. No retrofit into phase directories: retrofitting is out of scope in both source specs, and inventing phase numbers for 46 documents would fabricate a history that never happened.

**This task moves the file it is being executed from.** After the move this plan lives at `.ultrapowers/archive/plans/2026-07-28-ultrapowers-planning-tree.md`. The SDD workspace is keyed on the plan's basename, so it is unaffected; but extract Task 12's brief **before** running Step 1, or `scripts/task-brief` will be pointed at a path that no longer exists.

**Files:**
- Move: `docs/superpowers/` → `.ultrapowers/archive/`
- Move: `RISK_REGISTER.md` → `.ultrapowers/RISK_REGISTER.md`
- Modify: every file referencing the old paths (30 references outside `docs/`, more inside it)

**Interfaces:**
- Consumes: Task 9's `.gitignore` change.
- Produces: the final tree layout Task 12 verifies.

- [ ] **Step 1: Move both trees with git, preserving history**

```bash
node -e "require('fs').mkdirSync('.ultrapowers/archive',{recursive:true})"
git mv docs/superpowers .ultrapowers/archive
git mv RISK_REGISTER.md .ultrapowers/RISK_REGISTER.md
git status --short | head -20
```

Expected: renames only, no additions or deletions. `docs/` keeps its reference material (`gsd-config-defaults.md`, `review.md`, `opus5/`) — only the process records move.

`RISK_REGISTER.snippet.md` stays at the repository root: it is a template fragment for other projects, not this repository's register. Open it and, if it states a path for the register, update that string to `.ultrapowers/RISK_REGISTER.md`.

- [ ] **Step 2: Repoint every reference**

```bash
git grep -l "docs/superpowers/" | while read -r f; do
  node -e "
    const fs = require('fs'); const p = process.argv[1];
    const before = fs.readFileSync(p, 'utf8');
    const after = before.split('docs/superpowers/').join('.ultrapowers/archive/');
    if (after !== before) fs.writeFileSync(p, after);
  " "$f"
done
git grep -n "docs/superpowers/" || echo "no stale references remain"
```

Expected: `no stale references remain`. The substitution is safe because `docs/superpowers/` is a full path prefix that appears nowhere as a substring of something else.

Then repoint the register's own references:

```bash
git grep -n "\`RISK_REGISTER.md\`\|(RISK_REGISTER.md)\|\./RISK_REGISTER.md" -- ':!.ultrapowers/archive' | head -20
```

Fix each hit by hand — there are few, and they sit in prose where a blind substitution would read badly.

- [ ] **Step 3: Verify nothing was lost**

```bash
ls .ultrapowers/archive/plans | wc -l
ls .ultrapowers/archive/specs | wc -l
test -f .ultrapowers/RISK_REGISTER.md && echo "register moved"
git status --short | grep -c "^D " || echo "no deletions"
```

Expected: at least 15, at least 31, `register moved`, `no deletions`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: move planning history and the risk register into .ultrapowers"
```

---

### Task 12: Verify the tree, and hand the one blocked edit to the user

**Files:**
- Create: `.ultrapowers/STATE.md` (only if there is something to put in it)

**Interfaces:**
- Consumes: everything above.
- Produces: the plan's completion evidence.

- [ ] **Step 1: Verify the layout invariants**

```bash
git check-ignore -v .ultrapowers/sdd/probe 2>/dev/null || echo "WARNING: sdd is not ignored"
git ls-files .ultrapowers | grep "^\.ultrapowers/sdd/" && echo "WARNING: scratch is tracked" || echo "scratch untracked"
test -d .superpowers && echo "WARNING: old scratch survives" || echo "old scratch gone"
ls .ultrapowers
```

Expected: `sdd` reported as ignored, `scratch untracked`, `old scratch gone`, and `.ultrapowers` listing exactly `archive`, `phases`, `RISK_REGISTER.md`, `sdd`. Nothing else — no empty `PROJECT.md`, `ROADMAP.md`, `SUMMARY.md`, `GLOSSARY.md`, `docs/`, `tasks/` or `adhoc/`. Lazy creation means a file appears when it has content, and none of them do yet.

- [ ] **Step 2: Verify the fork ships what the tree expects**

```bash
cd /d/6__Work/AI_Projects/ultrapowers
node transform/build-cli.mjs drift
node --test transform/
```

Expected: `main is exactly what original + patch produce`, and every test passing.

- [ ] **Step 3: Write `STATE.md`**

Now there is something to say. Create `.ultrapowers/STATE.md`:

```markdown
# State

**Now:** the planning tree exists and the fork ships it (`6.2.0-up.2`). Four of the seven
designs approved on 2026-07-28 remain unplanned.

**Next:** plan #2 — delta `010-design-records` and stack rules resolved at design time.

**Resume from:** `.ultrapowers/archive/specs/2026-07-28-*.md` for the four remaining designs;
`.ultrapowers/phases/` for what has already landed.
```

- [ ] **Step 4: The one edit no task may make**

`~/.claude/CLAUDE.md` says the risk register goes to `.planning/` or the project root. This repository's register now lives at `.ultrapowers/RISK_REGISTER.md`. That file is `CURATED:NOEDIT` and the `deny-curated-claude-md.mjs` hook blocks writes to it, correctly.

Tell the user, verbatim:

> `~/.claude/CLAUDE.md` — COLLABORATION CONTRACT — currently says the risk register goes to
> `.planning/` if a GSD project exists, otherwise the project root. This repository now keeps it
> at `.ultrapowers/RISK_REGISTER.md`. The line needs a third case: *"otherwise `.ultrapowers/`
> if that tree exists, otherwise the project root."* The file is hook-protected, so this edit is
> yours to make.

Do not attempt the edit. Do not work around the hook.

- [ ] **Step 5: Commit**

```bash
git add .ultrapowers/STATE.md
git commit -m "docs: STATE - the planning tree is live, four designs remain"
```

---

## Self-Review

**Spec coverage.** Layout spec: target tree (Tasks 9, 11, 12), `sdd/` the only ignored path (Task 9), five documents per phase (Task 3 naming, Tasks 4–5 prompts), what a SUMMARY contains (Task 4), lazy creation (Task 12 Step 1), migration of all three strata (Task 10). Agent-first spec: inverted default and routing (Task 7), who writes which document (Task 7), both new prompts (Tasks 4–5), the return-a-path constraint (Tasks 4, 5, 7). Delta 008 spec: hunks A, B and C (Task 6), the ledger's cold-read contract (Task 6).

**Deliberately not covered here.** Phase numbering semantics borrowed from GSD, automatic conversion into `.planning/`, and any retention policy for diffs or briefs — all three are Out of Scope in the source specs. `NN-DEBUG.md` gets no writer: `systematic-debugging` is untouched by this plan, and the layout reserves the name without requiring it yet.

**Type consistency.** `phase-dir KIND SLUG` prints a directory; every consumer composes `<dir>/<NN>-<DOC>.md` from that directory's own prefix. `forkOwned[].mode` is the only new field, used once. The three delta numbers 007/008/009 are referenced consistently, and plan #2's 010 is named but not created here.

**Known ordering hazard.** Delta 009's third hunk matches delta 008's output. If 008 is ever re-authored against a new upstream release, 009's hunk must be re-checked in the same pass — `build-cli.mjs check` catches it, but only after the fact.
