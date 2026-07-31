import { test } from "node:test";
import assert from "node:assert/strict";
import { nextAdrNumber, adrTemplate, lintAdr, lintCrossRefs } from "./adr-lib.mjs";

test("allocates above the highest existing number, never filling a gap", () => {
  assert.equal(nextAdrNumber([]), "0001");
  assert.equal(nextAdrNumber(["0001-a.md", "0003-c.md"]), "0004");
  assert.equal(nextAdrNumber(["0001-a.md", "README.md", "notes.txt"]), "0002");
});

test("the template carries every section the classifier expects", () => {
  const t = adrTemplate({ number: "0007", title: "Fork instead of consume", date: "2026-07-28" });
  assert.match(t, /^---\nstatus: proposed\ndate: 2026-07-28\n---\n/);
  assert.match(t, /^# ADR-0007 Fork instead of consume$/m);
  for (const s of ["## Context", "## Decision", "## Consequences"]) assert.match(t, new RegExp(`^${s}$`, "m"));
});

test("a well-formed ADR lints clean", () => {
  const t = adrTemplate({ number: "0007", title: "x", date: "2026-07-28" });
  assert.deepEqual(lintAdr(t, "0007-x.md"), []);
});

test("a heading whose number disagrees with the filename is reported", () => {
  const t = adrTemplate({ number: "0007", title: "x", date: "2026-07-28" });
  const found = lintAdr(t, "0008-x.md");
  assert.equal(found.length, 1);
  assert.match(found[0].problem, /0008/);
});

test("a missing section is reported by name", () => {
  const t = adrTemplate({ number: "0007", title: "x", date: "2026-07-28" }).replace("## Consequences\n", "");
  assert.match(lintAdr(t, "0007-x.md")[0].problem, /Consequences/);
});

test("a missing status field is reported", () => {
  const t = adrTemplate({ number: "0007", title: "x", date: "2026-07-28" }).replace("status: proposed\n", "");
  assert.match(lintAdr(t, "0007-x.md")[0].problem, /status/);
});

test("cross-references are checked in both directions", () => {
  const adrs = [{ file: "0001-a.md", id: "ADR-0001", text: "see RISK-SUP-009 and ADR-0002" }];
  const found = lintCrossRefs({ adrs, riskIds: ["RISK-SUP-001"] });
  assert.equal(found.length, 2);
  assert.ok(found.some((f) => /RISK-SUP-009/.test(f.problem)));
  assert.ok(found.some((f) => /ADR-0002/.test(f.problem)));
});

// NEO4J is a live prefix and carries a digit; [A-Z]+ would silently skip those references.
test("a prefix containing a digit is still recognised", () => {
  const adrs = [{ file: "0001-a.md", id: "ADR-0001", text: "see RISK-NEO4J-004" }];
  assert.deepEqual(lintCrossRefs({ adrs, riskIds: ["RISK-NEO4J-004"] }), []);
  assert.equal(lintCrossRefs({ adrs, riskIds: [] }).length, 1);
});
