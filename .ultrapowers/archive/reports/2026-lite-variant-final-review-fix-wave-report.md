## Final-review fix wave

Branch: `feat/lite-variant`. All five fixes from the final-review wave applied and verified.

### Fix 1 — setup.mjs closing summary: hoist automark bullet out of the full-only gate

**Where:** `setup.mjs`, `main()`, the "Step 2" block of the closing "Project setup" summary (~line 1021-1030).

**What:** The two `log()` lines for "marks an unmarked root CLAUDE.md as curated (skipped if it
looks GSD-generated)" were inside `if (VARIANT === "full")`, even though `session-init.mjs`'s
automark step (line ~221-229) runs unconditionally in both variants. Moved just that log pair
above the `if (VARIANT === "full")` block; the `.planning/CLAUDE.md` exclude, the GSD-clobber
RISK_REGISTER append, and the `/init-mcp` suggestion bullets stayed inside the gate (correct —
they really are full-only). Text left unchanged, including the "(skipped if it looks
GSD-generated)" parenthetical — verified true in both variants (the `looksGsd()` check in
session-init.mjs isn't variant-gated).

### Fix 2 — setup.mjs bulk consent for plugin actions: install/uninstall never auto-execute under BULK

**Where:** `setup.mjs`, the "plugin reconciliation" block (~line 833-865).

**What:** Previously `else if (BULK) go = true;` caused install/uninstall to execute
unconditionally under `--replace-all`/`--merge-all` — the documented non-interactive bootstrap
path — with no way to preview before it ran. Split `go` (apply the `enabledPlugins` JSON side)
from a new `execInstall` flag (actually run `claude plugin install/uninstall`):
- **BULK:** `go = true`, `execInstall` stays `false` — enable/disable land in `settings.json`;
  install/uninstall are printed (`  run manually: claude plugin <type> <id>`) and recorded in the
  summary as `plugin-<type>-manual <id>`, never executed.
- **Interactive:** unchanged behavior, now expressed as `go = execInstall = (answer === "y")` —
  a "yes" still executes everything.
- **DRY / `CLAUDE_SETUP_SKIP_PLUGINS=1` / `--skip-all`:** unchanged, nothing executes.

`plugin-reconcile.mjs` (pure plan builder) and its 6 existing unit tests are untouched — the
split lives entirely in `setup.mjs`'s execution loop, as expected.

**Test evidence (targeted e2e smoke, real store never touched):** Built a stub `claude.cmd` on
`PATH` (in `CLAUDE_CONFIG_DIR`-isolated scratch space) that intercepts `plugin list/install/
uninstall` and logs any install/uninstall invocation to `calls.log`. Ran
`node setup.mjs --variant=lite --replace-all` (real `CLAUDE_SETUP_SKIP_PLUGINS` **unset**, so the
CLI probe actually runs) against that scratch config dir:
- Output showed `plugin reconciliation` with all pending install actions printed as
  `run manually: claude plugin install <id>` and `plugin-<type>-manual <id>` in the summary.
- `calls.log` was **never created** — proves `claude plugin install/uninstall` was never invoked.
- `enabledPlugins` in the scratch `settings.json` was correctly updated (enable actions applied).
- Real plugin store verified via `claude plugin list --json` before and after: **8 entries, same
  id set, byte-identical** — untouched.

Existing `variants.test.mjs` / `plugin-reconcile.test.mjs` / `setup-variants.e2e.test.mjs` all use
`CLAUDE_SETUP_SKIP_PLUGINS=1` (hermetic) so they don't exercise this branch; no automated unit
test was added inside `setup.mjs` itself for the branch split (it's inline main()-scope logic, not
an exported pure function — extracting one for testability alone was judged out of scope for a
review-fix pass). Manual verification above is the record of correctness; documenting here per the
task's "otherwise document manual verification" allowance.

### Fix 3 — RISK_REGISTER.md: RISK-VARIANT-002 mitigation corrected

**Where:** `RISK_REGISTER.md`, `RISK-VARIANT-002` § Mitigation/Residual.

**What:** Old text claimed "every run (interactive or bulk-flag) requires confirmation
(`apply N plugin action(s)? (y/N)`) before executing" — false post-Fix-2. Rewrote to describe the
three real execution paths: interactive = one aggregate y/N that executes everything; bulk =
only `enabledPlugins` JSON edits auto-apply, install/uninstall printed as manual commands;
dry-run/hermetic = nothing executes. Residual updated to note a wrong `gsd` id would surface as a
`claude plugin install` failure on the interactive path, or as a printed (never-executed) manual
command on the bulk path — a strictly safer failure mode than before. Entry schema (Status/
Context/Mitigation/Residual) preserved.

### Fix 4 — payload-lite/skills/model-selection-policy/SKILL.md: lite adaptation

**Where:** new file `payload-lite/skills/model-selection-policy/SKILL.md` (overlay); test change
in `variants.test.mjs`.

**What:** Lite was shipping `payload/skills/model-selection-policy/SKILL.md` verbatim (matched by
`variants.json`'s include glob, no overlay existed), which cited `/gsd-execute-phase` and
`/gsd-debug` in its "Worth enabling" bullet — GSD-only commands lite doesn't ship. Created the
overlay copy (same rel path `skills/model-selection-policy/SKILL.md`, so `resolveVariant()`'s
existing overlay-precedence logic in `variants.mjs` picks it up automatically, no code change
needed there) with those two examples replaced by variant-neutral superpowers equivalents: "a
superpowers subagent-driven-development implementer/reviewer dispatch loop, or a
systematic-debugging investigation." Frontmatter `name`/`description` are byte-identical to
payload's version (description never mentioned `gsd`, so no change needed there); the rest of the
body (executor defaults, effort rule, advisor-tool section) is unchanged verbatim.

**Test extension:** checked the other two lite skills for the `FORBIDDEN` list's `"gsd"` substring
first, per the task's instruction:
- `skills/token-usage/**` — zero occurrences of "gsd" (grepped, confirmed clean).
- `skills/update-changelog/**` — **legitimately contains "GSD"** multiple times (its whole job is
  stripping "every trace of AI tooling, GSD, and internal implementation detail" from user-facing
  changelog entries, plus a rule to skip "GSD scope/decision identifiers"). A blanket
  `skills/` scan would false-positive on it forever.

  So, per the task's guidance, scoped the purity-guard test extension to
  `skills/model-selection-policy/**` only (not all of `skills/`), with a comment in the test
  explaining exactly why. The overlay's new content contains no forbidden token, so the test
  passes.

### Fix 5 — two one-liners

**5a (`setup.mjs`, settings-merge second strip loop, ~line 743-747):** after filtering
`merged.hooks[ev]` to drop entries mentioning our hook files, added
`if (!merged.hooks[ev].length) delete merged.hooks[ev];` — kills the leftover `TaskCreated: []`/
`TaskCompleted: []` (or any other now-empty event array) left over on a full→lite switch. Verified
by the existing `setup-variants.e2e.test.mjs` "switch full->lite prunes surplus..." test, which
re-runs setup.mjs end to end after this change and still passes.

### Fix 5a revert — preserve byte-identical variant round-trip

**Where:** `setup.mjs`, settings-merge second strip loop, line 746.

**What:** The empty-hook-event cleanup (`if (!merged.hooks[ev].length) delete merged.hooks[ev];`)
breaks the byte-identical full→lite→full settings.json round trip: deleting then later re-adding
an event key re-inserts it at the END of the hooks object (TaskCreated/TaskCompleted migrate to
the tail). Reverted the delete statement and replaced with an explanatory comment:

```js
    // NOTE: deliberately NOT deleting now-empty event arrays here - delete+later-readd
    // moves the key to the object tail and breaks the byte-identical full->lite->full
    // settings.json round trip. An empty `TaskCreated: []` on lite is harmless residue.
```

Empty arrays (`TaskCreated: []` left on lite) are the lesser cosmetic evil — harmless and
self-healing on switch back.

**Empirical verification (round-trip test):**
- Run 1 (full variant): `settings.json` 4585 bytes
- Run 2 (lite variant): `settings.json` 4585 bytes
- Run 3 (full again): `settings.json` 4585 bytes
- `diff run1 vs run3`: **byte-identical PASS**

Command: `CLAUDE_SETUP_SKIP_PLUGINS=1 CLAUDE_CONFIG_DIR=<mktemp> node setup.mjs --replace-all` →
`--variant lite --replace-all` → `--replace-all` (back to full).

**5b (`payload/hooks/session-init.mjs`, fallow-gap note, ~line 442-446):** the note "...or run
/init-stack (step 8) to do it interactively..." assumed full's step numbering. Checked
`payload-lite/commands/init-stack.md` — lite's `/init-stack` has no numbered steps at all (just
"1. Detect the stack / 2. Assemble / 3. Wire"), so "(step 8)" is meaningless there. Made the
clause conditional on `FULL`: full keeps "...or run /init-stack (step 8) to do it interactively,
or explicitly set..."; lite reads "...or explicitly set code_quality.fallow.enabled: false for
this project." (clause dropped entirely, not just the "(step 8)" fragment, since lite has nothing
resembling "do it interactively" to point at).

## Verify — commands run + results

| Command | Result |
|---|---|
| `node --check setup.mjs payload/hooks/session-init.mjs` | OK, no syntax errors |
| `node --test variants.test.mjs plugin-reconcile.test.mjs setup-variants.e2e.test.mjs` | **18/18 pass** |
| `node --test payload/**/*.test.mjs` (globstar enabled) | **67/67 pass** |
| Bulk-path smoke (`--variant=lite --replace-all`, stubbed `claude` CLI, `CLAUDE_SETUP_SKIP_PLUGINS` unset) | install actions printed as `run manually:`/`plugin-*-manual`; stub's install/uninstall handler never invoked (no `calls.log`); `enabledPlugins` correctly written to scratch `settings.json` |
| `claude plugin list --json` before vs. after the smoke run | **8 entries, identical id set — real plugin store untouched** |

Both post-fix full re-runs of the whole suite (before and after committing) came back green:
18/18 + 67/67 = 85/85.

## Commits

1. `04009b1` `fix(setup): hoist root-CLAUDE.md automark bullet out of full-only gate` —
   **note:** this commit's diff also contains Fix 2 (bulk plugin-consent split) and Fix 5a
   (empty-hook-array cleanup), since all three touch `setup.mjs` and were staged together as one
   file-group commit (a deliberate "one combined commit per file-group" call per the task's
   instructions) before the message was written — the subject undersells the diff's actual scope.
   See the diff itself (`git show 04009b1`) for the full picture; the per-fix breakdown above is
   the authoritative description of what changed and why.
2. `be12714` `docs(risk-register): correct RISK-VARIANT-002 mitigation to match bulk-vs-interactive split`
3. `b02a4d2` `fix(hooks): make session-init fallow-gap note's /init-stack step reference variant-safe`
4. `60b9e6d` `fix(skills): lite-adapt model-selection-policy overlay, per spec 2.2`
5. `4498a78` `fix(setup): revert empty-event cleanup - preserves byte-identical variant round-trip` — Fix 5a revert

## Files touched

- `D:\6__Work\claude-config\setup.mjs`
- `D:\6__Work\claude-config\RISK_REGISTER.md`
- `D:\6__Work\claude-config\payload\hooks\session-init.mjs`
- `D:\6__Work\claude-config\payload-lite\skills\model-selection-policy\SKILL.md` (new)
- `D:\6__Work\claude-config\variants.test.mjs`
