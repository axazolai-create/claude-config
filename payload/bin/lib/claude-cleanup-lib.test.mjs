import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, mkdirSync as mkd, writeFileSync, writeFileSync as wf, utimesSync, rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, sep } from "node:path";
import { KEEP_DAYS, AUTO_DAYS, DAY_MS, newestMtime, dirSize, ageBucket, activeInstallPaths, pluginPruneCandidates, buildPlan, applyPlan, restoreBatch, purgeRetention, trashRoot, listTrashBatches } from "./claude-cleanup-lib.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "cc-"));
const setMtime = (p, ms) => utimesSync(p, new Date(ms), new Date(ms));
const UUID = "05b6d095-deef-4e70-875e-8fcff99484fe";
const UUID2 = "11111111-2222-3333-4444-555555555555";

test("constants", () => {
  assert.equal(KEEP_DAYS, 7); assert.equal(AUTO_DAYS, 14); assert.equal(DAY_MS, 86_400_000);
});

test("ageBucket edges (now-relative)", () => {
  const now = 1_000 * DAY_MS;
  assert.equal(ageBucket(now - 6 * DAY_MS, now), "keep");   // < 7d
  assert.equal(ageBucket(now - 8 * DAY_MS, now), "list");   // 7–14d
  assert.equal(ageBucket(now - 15 * DAY_MS, now), "auto");  // > 14d
  assert.equal(ageBucket(now - 7 * DAY_MS, now), "list");   // exactly 7d → not keep
  assert.equal(ageBucket(now - 14 * DAY_MS, now), "list");  // exactly 14d → not yet auto
});

test("newestMtime returns the newest file mtime, recursively (not the dir's own)", () => {
  const d = tmp();
  const sub = join(d, "a"); mkdirSync(sub);
  const old = join(sub, "old.txt"); writeFileSync(old, "x"); setMtime(old, 1000 * DAY_MS);
  const neu = join(sub, "new.txt"); writeFileSync(neu, "y"); setMtime(neu, 2000 * DAY_MS);
  assert.equal(newestMtime(d), 2000 * DAY_MS);
  rmSync(d, { recursive: true, force: true });
});

test("dirSize sums file bytes recursively", () => {
  const d = tmp();
  writeFileSync(join(d, "a"), "12345");           // 5
  mkdirSync(join(d, "s")); writeFileSync(join(d, "s", "b"), "678"); // 3
  assert.equal(dirSize(d), 8);
  rmSync(d, { recursive: true, force: true });
});

test("pluginPruneCandidates keeps active installPaths, trashes the rest, keeps project-scope", () => {
  const d = tmp();
  const cache = join(d, "plugins", "cache", "mkt", "sp");
  for (const v of ["6.1.1", "6.2.0"]) mkd(join(cache, v), { recursive: true });
  const projCache = join(d, "plugins", "cache", "mkt", "kotlin-lsp", "1.0.0");
  mkd(projCache, { recursive: true });
  mkd(join(d, "plugins"), { recursive: true });
  wf(join(d, "plugins", "installed_plugins.json"), JSON.stringify({ plugins: {
    "sp@mkt": [{ scope: "user", installPath: join(cache, "6.2.0") }],
    "kotlin-lsp@mkt": [{ scope: "project", installPath: projCache }],
  }}));
  const cand = pluginPruneCandidates(d);
  assert.deepEqual(cand, [join(cache, "6.1.1")]);          // only the stale version
  rmSync(d, { recursive: true, force: true });
});

test("pluginPruneCandidates fail-safe: missing manifest → [] (never guess)", () => {
  const d = tmp(); mkd(join(d, "plugins", "cache", "mkt", "sp", "6.2.0"), { recursive: true });
  assert.deepEqual(pluginPruneCandidates(d), []);
  assert.equal(activeInstallPaths(d), null);
  rmSync(d, { recursive: true, force: true });
});

test("activeInstallPaths fail-safe: manifest missing `plugins` key → null (not empty Set), pluginPruneCandidates → []", () => {
  const d = tmp();
  const cache = join(d, "plugins", "cache", "mkt", "sp", "6.2.0");
  mkd(cache, { recursive: true });
  mkd(join(d, "plugins"), { recursive: true });
  wf(join(d, "plugins", "installed_plugins.json"), JSON.stringify({})); // no `plugins` key
  assert.equal(activeInstallPaths(d), null);
  assert.deepEqual(pluginPruneCandidates(d), []);
  rmSync(d, { recursive: true, force: true });
});

function fakeTree() {
  const d = tmp(); const now = 1000 * DAY_MS;
  const mk = (p) => (mkdirSync(dirname(p), { recursive: true }), writeFileSync(p, "x"), p);
  const age = (p, days) => setMtime(p, now - days * DAY_MS);
  // ephemeral
  age(mk(join(d, "paste-cache", "p1")), 1);
  // memory MUST be preserved
  mk(join(d, "projects", "slug", "memory", "MEMORY.md"));
  // sessions: one old (auto), one mid (list), one fresh (keep)
  age(mk(join(d, "projects", "slug", `${UUID}.jsonl`)), 30);       // auto
  age(mk(join(d, "projects", "slug", UUID, "data")), 30);          // its dir
  age(mk(join(d, "projects", "slug", `${UUID2}.jsonl`)), 10);      // list
  age(mk(join(d, "projects", "slug", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl")), 2); // keep
  return { d, now };
}

test("buildPlan: auto sessions trashed, mid listed, fresh kept, memory never touched, ephemeral trashed", () => {
  const { d, now } = fakeTree();
  const plan = buildPlan({ dir: d, tempRoot: join(d, "__notemp"), nowMs: now, excludeUuids: [] });
  const paths = plan.items.map((i) => i.absPath);
  assert.ok(paths.some((p) => p.endsWith(join("paste-cache", "p1"))), "ephemeral trashed");
  assert.ok(paths.some((p) => p.endsWith(`${UUID}.jsonl`)), "auto session .jsonl trashed");
  assert.ok(paths.some((p) => p.endsWith(join("slug", UUID))), "auto session dir trashed");
  assert.ok(!paths.some((p) => p.includes(`${sep}memory${sep}`) || p.endsWith("memory")), "memory NEVER in plan");
  assert.ok(!plan.items.concat(plan.listCheck).some((i) => i.absPath.includes("aaaaaaaa-bbbb")), "fresh session kept");
  assert.ok(plan.listCheck.some((i) => i.absPath.includes(UUID2)), "mid session in listCheck");
  rmSync(d, { recursive: true, force: true });
});

test("buildPlan: excludeUuids keeps a matching session even if old", () => {
  const { d, now } = fakeTree();
  const plan = buildPlan({ dir: d, tempRoot: join(d, "__notemp"), nowMs: now, excludeUuids: [UUID] });
  assert.ok(!plan.items.some((i) => i.absPath.includes(UUID) && !i.absPath.includes("memory")), "excluded uuid not trashed");
  rmSync(d, { recursive: true, force: true });
});

test("applyPlan moves items to a batch + manifest; restore puts them back", () => {
  const d = tmp(); const now = 1000 * DAY_MS;
  const victim = join(d, "logs", "old.log"); mkdirSync(dirname(victim), { recursive: true }); writeFileSync(victim, "data");
  const items = [{ absPath: victim, size: 4, category: "ephemeral", reason: "ephemeral:logs", mtimeMs: statSync(victim).mtimeMs, bucket: "auto" }];
  const res = applyPlan({ dir: d, items, nowMs: now, ts: "20260727T000000Z" });
  assert.equal(res.moved, 1); assert.ok(!existsSync(victim), "moved out of place");
  assert.ok(existsSync(join(res.batchDir, "manifest.json")));
  const rr = restoreBatch({ dir: d, ts: "20260727T000000Z" });
  assert.equal(rr.restored, 1); assert.ok(existsSync(victim), "restored to original path");
  rmSync(d, { recursive: true, force: true });
});

test("applyPlan TOCTOU: item whose mtime changed since scan is skipped", () => {
  const d = tmp(); const now = 1000 * DAY_MS;
  const v = join(d, "logs", "x"); mkdirSync(dirname(v), { recursive: true }); writeFileSync(v, "d");
  const items = [{ absPath: v, size: 1, category: "ephemeral", reason: "r", mtimeMs: statSync(v).mtimeMs - 999, bucket: "auto" }]; // stale recorded mtime
  const res = applyPlan({ dir: d, items, nowMs: now, ts: "T1" });
  assert.equal(res.skipped, 1); assert.equal(res.moved, 0); assert.ok(existsSync(v), "left in place");
  rmSync(d, { recursive: true, force: true });
});

test("purgeRetention removes only batches older than retentionDays", () => {
  const d = tmp(); const now = 1000 * DAY_MS;
  const root = trashRoot(d); mkdirSync(join(root, "old"), { recursive: true }); mkdirSync(join(root, "new"), { recursive: true });
  writeFileSync(join(root, "old", "manifest.json"), JSON.stringify({ ts: "old", entries: [] }));
  writeFileSync(join(root, "new", "manifest.json"), JSON.stringify({ ts: "new", entries: [] }));
  setMtime(join(root, "old"), now - 10 * DAY_MS); setMtime(join(root, "old", "manifest.json"), now - 10 * DAY_MS);
  setMtime(join(root, "new"), now - 1 * DAY_MS); setMtime(join(root, "new", "manifest.json"), now - 1 * DAY_MS);
  const removed = purgeRetention({ dir: d, nowMs: now, retentionDays: 7 });
  assert.deepEqual(removed, ["old"]); assert.ok(!existsSync(join(root, "old")) && existsSync(join(root, "new")));
  rmSync(d, { recursive: true, force: true });
});
