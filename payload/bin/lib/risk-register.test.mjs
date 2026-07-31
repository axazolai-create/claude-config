import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRegister, lintRegister, nextId, migrateStatus, normalizeRegister } from "./risk-register.mjs";

const SECTIONED = `# Risk Register

## Active
### RISK-VARIANT-003 — trash retention
- **Status:** Active
- **Context:** something

## Closed
### RISK-NEO4J-004 — stale reference
- **Status:** Closed (2026-07-17) — the check-and-retry landed
- **Context:** other
`;

test("parses id, prefix, number, title and status", () => {
  const { entries } = parseRegister(SECTIONED);
  assert.equal(entries.length, 2);
  assert.deepEqual(
    { ...entries[0], lines: undefined },
    { id: "RISK-VARIANT-003", prefix: "VARIANT", num: 3, title: "trash retention", status: "Active", section: "Active", lines: undefined },
  );
});

test("parses the legacy flat format, with no sections", () => {
  const { entries } = parseRegister("# Risk Register\n\n## RISK-SUP-002 — x\n- **Status:** Open (accepted)\n");
  assert.equal(entries[0].section, null);
  assert.equal(entries[0].status, "Open (accepted)");
});

// An entry's status is its FIRST occurrence: prose that quotes the field - migration notes do
// exactly this - must not overwrite it. The live register has no such case today; this pins the
// behaviour before one appears.
test("only the first Status line in an entry counts", () => {
  const { entries } = parseRegister(
    "## RISK-A-001 — x\n- **Status:** Active\n- **Context:** we used to write `- **Status:** Open (accepted)` here\n",
  );
  assert.equal(entries[0].status, "Active");
});

test("clean input lints clean", () => {
  assert.deepEqual(lintRegister(parseRegister(SECTIONED), { knownAdrIds: [] }), []);
});

test("an unknown status value is reported", () => {
  const bad = SECTIONED.replace("- **Status:** Active", "- **Status:** Open (accepted)");
  const found = lintRegister(parseRegister(bad), { knownAdrIds: [] });
  assert.equal(found.length, 1);
  assert.match(found[0].problem, /status/i);
  assert.equal(found[0].id, "RISK-VARIANT-003");
});

test("an entry in the wrong section is reported", () => {
  const bad = SECTIONED.replace("## Closed\n### RISK-NEO4J-004", "## Active\n### RISK-NEO4J-004");
  const found = lintRegister(parseRegister(bad), { knownAdrIds: [] });
  assert.equal(found.length, 1);
  assert.match(found[0].problem, /section/i);
});

test("a duplicate id is reported once", () => {
  const bad = SECTIONED + "\n### RISK-VARIANT-003 — again\n- **Status:** Active\n";
  const found = lintRegister(parseRegister(bad), { knownAdrIds: [] });
  assert.equal(found.filter((f) => /duplicate/i.test(f.problem)).length, 1);
});

test("a dangling ADR reference is reported", () => {
  const bad = SECTIONED.replace("- **Context:** something", "- **Context:** see ADR-0007");
  const found = lintRegister(parseRegister(bad), { knownAdrIds: ["ADR-0001"] });
  assert.match(found[0].problem, /ADR-0007/);
});

test("nextId never reuses a number, including a closed one", () => {
  const parsed = parseRegister(SECTIONED);
  assert.equal(nextId(parsed, "VARIANT"), "RISK-VARIANT-004");
  assert.equal(nextId(parsed, "NEO4J"), "RISK-NEO4J-005");
  assert.equal(nextId(parsed, "BRANDNEW"), "RISK-BRANDNEW-001");
});

test("maps every observed Open spelling onto the vocabulary", () => {
  const cases = [
    ["Open (accepted)", "Active", "accepted"],
    ["Open (accepted / low)", "Active", "accepted / low"],
    ["Open (accepted; not fixable from this repository)", "Active", "accepted; not fixable from this repository"],
    ["Open (mitigated by design)", "Mitigated", "mitigated by design"],
    ["Open (mitigated by design, 2026-07-27)", "Mitigated", "mitigated by design, 2026-07-27"],
    ["Open (until tests green)", "Deferred (until tests green)", null],
    ["Open (until Stage 2)", "Deferred (until Stage 2)", null],
    ["Open (verification pending)", "Deferred (verification pending)", null],
    ["Mitigated (detector built; auto-apply in Stage 2)", "Mitigated", "detector built; auto-apply in Stage 2"],
  ];
  for (const [raw, status, nuance] of cases) {
    const got = migrateStatus(raw, "2026-07-28");
    assert.equal(got.status, status, raw);
    assert.equal(got.nuance, nuance, raw);
  }
});

test("Resolved becomes Closed, keeping its date and reason", () => {
  assert.deepEqual(migrateStatus("Resolved (2026-07-17) — the check-and-retry landed", "2026-07-28"), {
    status: "Closed (2026-07-17) — the check-and-retry landed",
    nuance: null,
  });
});

test("Resolved without a date takes the fallback and keeps the reason", () => {
  assert.deepEqual(migrateStatus("Resolved (subset choice + provenance-based pruning)", "2026-07-28"), {
    status: "Closed (2026-07-28) — subset choice + provenance-based pruning",
    nuance: null,
  });
});

test("an already-valid status passes through untouched", () => {
  assert.deepEqual(migrateStatus("Active", "2026-07-28"), { status: "Active", nuance: null });
});

// Two live entries already speak the target vocabulary but with a parenthetical, e.g.
// "Closed (observed, 2026-07-30)". They must land in Closed, not be read as Active.
test("a Closed spelling that is not yet canonical still lands in Closed", () => {
  const got = migrateStatus("Closed (observed, 2026-07-30)", "2026-07-31");
  assert.match(got.status, /^Closed \(2026-07-31\) — observed, 2026-07-30$/);
});

test("normalize groups into sections and is idempotent", () => {
  const flat = `# Risk Register

## RISK-B-002 — later
- **Status:** Open (accepted)
- **Mitigation:** none

## RISK-A-001 — earlier
- **Status:** Resolved (2026-07-17) — done
`;
  const once = normalizeRegister(parseRegister(flat), { fallbackDate: "2026-07-28" });
  assert.match(once, /## Active\n### RISK-B-002/);
  assert.match(once, /## Closed\n### RISK-A-001/);
  assert.match(once, /Status nuance \(migrated 2026-07-28\): accepted/);
  assert.equal(normalizeRegister(parseRegister(once), { fallbackDate: "2026-07-28" }), once);
});

// A field is a bullet plus its wrapped continuation lines. Appending to the first line splices
// the sentence into the middle of what the field was saying - it did exactly that to 45 of the
// 57 live entries before this was fixed.
test("the nuance lands after the whole Mitigation field, not inside its first line", () => {
  const flat = [
    "# Risk Register",
    "",
    "## RISK-A-001 — x",
    "- **Status:** Open (accepted)",
    "- **Mitigation:** the first line of a sentence that",
    "  continues onto a second line and ends here.",
    "- **Residual:** none",
    "",
  ].join("\n");
  const out = normalizeRegister(parseRegister(flat), { fallbackDate: "2026-07-31" });
  assert.match(out, /continues onto a second line and ends here\. Status nuance \(migrated 2026-07-31\): accepted/);
  assert.doesNotMatch(out, /sentence that Status nuance/);
});

test("an entry with no Mitigation field gains one to hold the nuance", () => {
  const flat = "# Risk Register\n\n## RISK-A-001 — x\n- **Status:** Open (accepted / low)\n";
  const out = normalizeRegister(parseRegister(flat), { fallbackDate: "2026-07-28" });
  assert.match(out, /- \*\*Mitigation:\*\* Status nuance \(migrated 2026-07-28\): accepted \/ low/);
});

test("every section heading is present even when empty", () => {
  const out = normalizeRegister(parseRegister("# Risk Register\n"), { fallbackDate: "2026-07-28" });
  for (const s of ["Active", "Deferred", "Mitigated", "Closed"]) assert.match(out, new RegExp(`^## ${s}$`, "m"));
});
