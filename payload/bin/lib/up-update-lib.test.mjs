import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { compareVersions, resolveRepo, latestUpstreamTag, formatReport, assess, DEFAULTS } from "./up-update-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("behind when upstream has published a newer release", () => {
  const r = compareVersions("v6.3.0", "upstream/6.2.0");
  assert.equal(r.behind, true);
  assert.equal(r.current, false);
  assert.equal(r.have, "6.2.0");
  assert.equal(r.latest, "6.3.0");
});

test("current when the recorded base is the latest release", () => {
  const r = compareVersions("v6.2.0", "upstream/6.2.0");
  assert.equal(r.current, true);
  assert.equal(r.behind, false);
});

test("a v prefix on either side is noise, not a difference", () => {
  assert.equal(compareVersions("6.2.0", "upstream/v6.2.0").current, true);
});

test("an upstream pre-release does not count as being behind", () => {
  const r = compareVersions("v6.3.0-rc.1", "upstream/6.2.0");
  assert.equal(r.behind, false);
  assert.equal(r.prerelease, true);
});

test("a newer patch counts, not just a newer minor", () => {
  assert.equal(compareVersions("v6.2.1", "upstream/6.2.0").behind, true);
  assert.equal(compareVersions("v7.0.0", "upstream/6.99.99").behind, true);
});

test("an unparseable version is reported, never silently treated as up to date", () => {
  const r = compareVersions("not-a-version", "upstream/6.2.0");
  assert.equal(r.current, false);
  assert.equal(r.behind, false);
  assert.match(r.problem, /parse/i);
});

test("the newest upstream/* tag wins, and non-version tags are ignored", () => {
  assert.equal(latestUpstreamTag(["upstream/6.2.0", "upstream/6.10.0", "upstream/6.9.0", "some-other-tag"]), "upstream/6.10.0");
});

test("no upstream tag at all is a problem, not an empty string", () => {
  assert.equal(latestUpstreamTag(["v1"]), null);
});

test("repository identity comes from constants in this source, not from any file", () => {
  const r = resolveRepo([]);
  assert.equal(r.owner, DEFAULTS.owner);
  assert.equal(r.repo, DEFAULTS.repo);
  assert.equal(r.upstream, DEFAULTS.upstream);
});

test("--repo overrides identity for one run", () => {
  const r = resolveRepo(["--repo", "someone/elses-fork"]);
  assert.equal(r.owner, "someone");
  assert.equal(r.repo, "elses-fork");
});

test("a malformed --repo throws rather than half-applying an identity", () => {
  assert.throws(() => resolveRepo(["--repo", "nonsense"]), /owner\/name/);
  assert.throws(() => resolveRepo(["--repo"]), /owner\/name/);
});

// A2: /up-update works through GitHub and never through a local checkout, and this plan creates no
// state under ~/.claude. Both are trivially easy to violate later by adding one convenience path,
// so the guard is structural rather than a comment nobody reads.
test("the library touches no filesystem and no home directory, so it cannot grow a cache", () => {
  const src = readFileSync(join(HERE, "up-update-lib.mjs"), "utf8");
  for (const forbidden of ["node:fs", "node:os", "homedir", "CLAUDE_CONFIG_DIR", "process.cwd"]) {
    assert.ok(!src.includes(forbidden), `up-update-lib.mjs must not reference ${forbidden}`);
  }
});

const REPORT_INPUT = {
  repo: { owner: "axazolai", repo: "ultrapowers", upstream: "obra/superpowers" },
  version: { current: true, behind: false, have: "6.2.0", latest: "6.2.0" },
  legal: [
    { path: "LICENSE", reason: "MIT obligation: the upstream copyright notice must survive redistribution" },
    { path: "plugins/ultrapowers/README.md", reason: "MIT attribution: the fork must name upstream and state that it is a fork" },
  ],
  deltas: ["001-fallow-graft.patch", "002-drop-platform-adaptation.patch"],
};

test("the report says up to date when it is", () => {
  assert.match(formatReport(REPORT_INPUT), /up to date/i);
});

test("the report prints every legal entry WITH its reason, not just the paths", () => {
  const out = formatReport(REPORT_INPUT);
  for (const e of REPORT_INPUT.legal) {
    assert.ok(out.includes(e.path), `${e.path} missing from the report`);
    assert.ok(out.includes(e.reason), `${e.path} printed without its reason - an unreasoned entry is the drift this guards against`);
  }
});

test("the report names the versions when behind, so the human knows the gap", () => {
  const out = formatReport({ ...REPORT_INPUT, version: { current: false, behind: true, have: "6.2.0", latest: "6.3.0" } });
  assert.match(out, /6\.2\.0/);
  assert.match(out, /6\.3\.0/);
  assert.match(out, /behind/i);
});

test("a version problem is surfaced in the report rather than reading as up to date", () => {
  const out = formatReport({ ...REPORT_INPUT, version: { current: false, behind: false, problem: "cannot parse upstream release tag \"weird\"" } });
  assert.doesNotMatch(out, /up to date/i);
  assert.match(out, /cannot parse/);
});

// ---------------------------------------------------------------------------------------------
// assess: the refusal conditions. The command's value is not that it updates - it is that it can
// say "I did not manage this" instead of producing a plausible-looking broken build. So every
// condition asserts the verdict AND the reason: a refusal that does not say which condition fired
// is not actionable.
const CFG = { thresholds: { changedFilesPct: 25, unclassifiedRefuses: true, attributionMissingRefuses: true } };
const CLEAN = {
  buildResult: { failed: [], failures: [], obsolete: [], residual: [], attributionMissing: [], mapDrift: { unclassified: [], added: [], removed: [], reclassified: [] } },
  upstreamDiff: { changedPct: 2, trackedChanged: [] },
  mainDrift: [],
  cfg: CFG,
};

test("a clean rebuild is ok", () => {
  const a = assess(CLEAN);
  assert.equal(a.verdict, "ok");
  assert.deepEqual(a.reasons, []);
});

test("a delta that fails to apply refuses, and names the delta", () => {
  const a = assess({ ...CLEAN, buildResult: { ...CLEAN.buildResult, failed: ["003-plugin-version-source.patch"],
    failures: [{ name: "003-plugin-version-source.patch", detail: "context not found at ~line 208" }] } });
  assert.equal(a.verdict, "needs-work");
  assert.match(a.reasons.join(" "), /003-plugin-version-source\.patch/);
});

test("upstream name surviving outside the protected slug refuses", () => {
  const a = assess({ ...CLEAN, buildResult: { ...CLEAN.buildResult,
    residual: [{ path: "plugins/ultrapowers/skills/x/SKILL.md", text: "SuperPowers" }] } });
  assert.equal(a.verdict, "needs-work");
  assert.match(a.reasons.join(" "), /SKILL\.md/);
});

test("a large upstream diff refuses even when everything applied", () => {
  const a = assess({ ...CLEAN, upstreamDiff: { changedPct: 40, trackedChanged: [] } });
  assert.equal(a.verdict, "needs-work");
  assert.match(a.reasons.join(" "), /40%.*25%|25%.*40%/);
});

test("a diff exactly at the threshold does not refuse - the threshold is a ceiling, not a trap", () => {
  assert.equal(assess({ ...CLEAN, upstreamDiff: { changedPct: 25, trackedChanged: [] } }).verdict, "ok");
});

test("a hand-edited main refuses, and names what was edited", () => {
  const a = assess({ ...CLEAN, mainDrift: ["plugins/ultrapowers/skills/brainstorming/SKILL.md"] });
  assert.equal(a.verdict, "needs-work");
  assert.match(a.reasons.join(" "), /brainstorming/);
});

test("an upstream file the map does not classify refuses - this is what the manifest is for", () => {
  const a = assess({ ...CLEAN, buildResult: { ...CLEAN.buildResult,
    mapDrift: { unclassified: ["commands/new-thing.md"], added: [], removed: [], reclassified: [] } } });
  assert.equal(a.verdict, "needs-work");
  assert.match(a.reasons.join(" "), /commands\/new-thing\.md/);
});

test("a new upstream file the manifest has not recorded refuses, quoting the proposed class", () => {
  const a = assess({ ...CLEAN, buildResult: { ...CLEAN.buildResult,
    mapDrift: { unclassified: [], added: [{ path: "skills/new-skill/SKILL.md", proposed: "tracked" }], removed: [], reclassified: [] } } });
  assert.equal(a.verdict, "needs-work");
  assert.match(a.reasons.join(" "), /skills\/new-skill\/SKILL\.md/);
});

test("missing attribution refuses - the licence obligation is not negotiable", () => {
  const a = assess({ ...CLEAN, buildResult: { ...CLEAN.buildResult,
    attributionMissing: [{ path: "plugins/ultrapowers/README.md", detail: "missing required attribution: obra/superpowers", reason: "MIT attribution" }] } });
  assert.equal(a.verdict, "needs-work");
  assert.match(a.reasons.join(" "), /obra\/superpowers/);
});

test("an obsolete delta reports but does not refuse", () => {
  const a = assess({ ...CLEAN, buildResult: { ...CLEAN.buildResult, obsolete: ["002-drop-platform-adaptation.patch"] } });
  assert.equal(a.verdict, "ok");
  assert.deepEqual(a.obsolete, ["002-drop-platform-adaptation.patch"]);
});

test("every failing condition is reported, not just the first one found", () => {
  const a = assess({ ...CLEAN,
    buildResult: { ...CLEAN.buildResult, failed: ["001-x.patch"], failures: [{ name: "001-x.patch", detail: "gone" }],
      residual: [{ path: "p", text: "Superpowers" }] },
    mainDrift: ["q"] });
  assert.equal(a.verdict, "needs-work");
  assert.ok(a.reasons.length >= 3, `expected every condition, got ${a.reasons.length}: ${a.reasons.join(" | ")}`);
});
