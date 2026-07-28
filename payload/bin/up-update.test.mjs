import { test } from "node:test";
import assert from "node:assert/strict";
import { check, legalEntries } from "./up-update.mjs";

const CONFIG = {
  attribution: {
    require: [
      { path: "plugins/ultrapowers/README.md", contains: ["obra/superpowers"], reason: "MIT attribution: the fork must name upstream and state that it is a fork" },
    ],
  },
};
const INVENTORY = {
  rules: [
    { match: "skills/**", class: "tracked", reason: "the skills library" },
    { match: "LICENSE", class: "tracked", mode: "verbatim", reason: "MIT obligation: the copyright notice must survive redistribution" },
  ],
};

function fakes({ tags = ["upstream/6.2.0"], latest = "v6.2.0" } = {}) {
  const calls = [];
  return {
    calls,
    listRemoteTags(url) { calls.push(`ls-remote ${url}`); return tags; },
    async latestRelease(upstream) { calls.push(`release ${upstream}`); return latest; },
    async rawFile(owner, repo, branch, path) {
      calls.push(`raw ${owner}/${repo}@${branch}/${path}`);
      if (path.endsWith("config.json")) return JSON.stringify(CONFIG);
      if (path.endsWith("inventory.json")) return JSON.stringify(INVENTORY);
      throw new Error(`unexpected ${path}`);
    },
    async listDir() { calls.push("listDir"); return ["001-fallow-graft.patch", "readme.txt"]; },
  };
}

test("an unchanged upstream reads as up to date", async () => {
  const r = await check([], fakes());
  assert.equal(r.version.current, true);
  assert.equal(r.version.behind, false);
});

test("a newer upstream release reads as behind, naming both versions", async () => {
  const r = await check([], fakes({ latest: "v6.3.0" }));
  assert.equal(r.version.behind, true);
  assert.equal(r.version.have, "6.2.0");
  assert.equal(r.version.latest, "6.3.0");
});

test("the newest recorded base is used, not whichever tag came back first", async () => {
  const r = await check([], fakes({ tags: ["upstream/6.1.1", "upstream/6.2.0", "upstream/6.0.0"], latest: "v6.2.0" }));
  assert.equal(r.version.have, "6.2.0");
});

test("a fork with no recorded base is a problem, not a claim of being current", async () => {
  const r = await check([], fakes({ tags: [] }));
  assert.equal(r.version.current, false);
  assert.match(r.version.problem, /no upstream\/\* tag/);
});

test("--repo redirects every remote read for that run", async () => {
  const f = fakes();
  await check(["--repo", "someone/elses-fork"], f);
  assert.ok(f.calls.some((c) => c.includes("someone/elses-fork")));
  assert.ok(!f.calls.some((c) => c.includes("axazolai/ultrapowers")));
});

test("only real deltas are counted, not whatever else sits in the directory", async () => {
  const r = await check([], fakes());
  assert.deepEqual(r.deltas, ["001-fallow-graft.patch"]);
});

test("unreadable transform config degrades the report instead of failing the check", async () => {
  const f = fakes();
  f.rawFile = async () => { throw new Error("404"); };
  const r = await check([], f);
  assert.equal(r.version.current, true);
  assert.deepEqual(r.legal, []);
});

test("legal entries carry both the verbatim rules and the asserted attribution, with reasons", () => {
  const legal = legalEntries(CONFIG, INVENTORY);
  assert.deepEqual(legal.map((e) => e.path), ["LICENSE", "plugins/ultrapowers/README.md"]);
  for (const e of legal) assert.ok(e.reason && e.reason.length > 10);
});
