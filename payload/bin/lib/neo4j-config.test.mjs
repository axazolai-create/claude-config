import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnvFile, loadNeo4jConfig, parseBoltHostPort, repoTagsFromGlobalGraph, probeReachable,
  parseReadResult, driverInstalled, testNeo4jConnection } from "./neo4j-config.mjs";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("parseEnvFile ignores comments/blanks and strips quotes", () => {
  const env = parseEnvFile('# c\n\nNEO4J_URI="bolt://nas:7687"\nNEO4J_USER=neo4j\nNEO4J_PASSWORD=\'p@ss\'\n');
  assert.deepEqual(env, { NEO4J_URI: "bolt://nas:7687", NEO4J_USER: "neo4j", NEO4J_PASSWORD: "p@ss" });
});

test("loadNeo4jConfig reports missing file / missing keys / ok", () => {
  assert.equal(loadNeo4jConfig(join(tmpdir(), "nope-xyz.env")).ok, false);
  const p = join(tmpdir(), `n4j-${process.pid}.env`);
  writeFileSync(p, "NEO4J_URI=bolt://h:7687\n");
  assert.match(loadNeo4jConfig(p).error, /NEO4J_PASSWORD/);
  writeFileSync(p, "NEO4J_URI=bolt://h:7687\nNEO4J_PASSWORD=x\n");
  const r = loadNeo4jConfig(p);
  assert.equal(r.ok, true);
  assert.equal(r.config.user, "neo4j"); // defaulted
  rmSync(p);
});

test("parseBoltHostPort defaults port 7687 and accepts +s", () => {
  assert.deepEqual(parseBoltHostPort("bolt://nas:7687"), { host: "nas", port: 7687 });
  assert.deepEqual(parseBoltHostPort("neo4j://host"), { host: "host", port: 7687 });
  assert.deepEqual(parseBoltHostPort("neo4j+s://a.io:7999"), { host: "a.io", port: 7999 });
  assert.equal(parseBoltHostPort("http://x"), null);
});

test("repoTagsFromGlobalGraph returns distinct repo tags", () => {
  const g = JSON.stringify({ nodes: [{ id: "a::x", repo: "a" }, { id: "a::y", repo: "a" }, { id: "b::z", repo: "b" }, { id: "n" }] });
  assert.deepEqual(repoTagsFromGlobalGraph(g).sort(), ["a", "b"]);
});

test("probeReachable resolves false for a closed port", async () => {
  assert.equal(await probeReachable("127.0.0.1", 1, 500), false);
});

test("parseReadResult extracts node count, rejects other output", () => {
  assert.deepEqual(parseReadResult("READ_OK nodes=269"), { ok: true, nodeCount: 269 });
  assert.deepEqual(parseReadResult("Neo.ClientError.Security.Unauthorized"), { ok: false });
  assert.deepEqual(parseReadResult(""), { ok: false });
});

test("driverInstalled reflects the import probe exit status", () => {
  assert.equal(driverInstalled("py", { run: () => ({ status: 0 }) }), true);
  assert.equal(driverInstalled("py", { run: () => ({ status: 1 }) }), false);
  assert.equal(driverInstalled(null, { run: () => ({ status: 0 }) }), false);
});

test("testNeo4jConnection: bad URI is rejected before any I/O", async () => {
  const r = await testNeo4jConnection({ uri: "http://x", user: "neo4j", password: "p", python: "py" });
  assert.equal(r.ok, false);
  assert.match(r.error, /cannot parse/i);
});

test("testNeo4jConnection: unreachable host short-circuits before the driver", async () => {
  let ran = false;
  const r = await testNeo4jConnection(
    { uri: "bolt://nas:7687", user: "neo4j", password: "p", python: "py" },
    { probe: async () => false, run: () => { ran = true; return { status: 0, stdout: "" }; } },
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /unreachable/);
  assert.equal(ran, false, "driver must not run when the port is unreachable");
});

test("testNeo4jConnection: reachable but no python reports driver unavailable", async () => {
  const r = await testNeo4jConnection(
    { uri: "bolt://nas:7687", user: "neo4j", password: "p", python: null },
    { probe: async () => true, run: () => ({ status: 0, stdout: "READ_OK nodes=1" }) },
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /no graphify python/i);
});

test("testNeo4jConnection: reachable + successful read returns node count", async () => {
  const r = await testNeo4jConnection(
    { uri: "bolt://nas:7687", user: "neo4j", password: "p", python: "py" },
    { probe: async () => true, run: () => ({ status: 0, stdout: "READ_OK nodes=269", stderr: "" }) },
  );
  assert.deepEqual(r, { ok: true, nodeCount: 269 });
});

test("testNeo4jConnection: auth failure surfaces the driver error, does not claim ok", async () => {
  const r = await testNeo4jConnection(
    { uri: "bolt://nas:7687", user: "neo4j", password: "wrong", python: "py" },
    { probe: async () => true,
      run: () => ({ status: 1, stdout: "", stderr: "neo4j.exceptions.AuthError: Unauthorized" }) },
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /Unauthorized/);
});
