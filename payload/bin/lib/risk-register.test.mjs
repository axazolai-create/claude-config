import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRegister, lintRegister, nextId } from "./risk-register.mjs";

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
