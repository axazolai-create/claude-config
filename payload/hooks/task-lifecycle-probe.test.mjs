// payload/hooks/task-lifecycle-probe.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { probeRecord } from "./task-lifecycle-probe.mjs";

test("probeRecord captures event name and sorted payload keys", () => {
  const r = probeRecord({ hook_event_name: "TaskCreated", task_id: "x", command: "pnpm build" }, "2026-01-01T00:00:00Z");
  assert.equal(r.event, "TaskCreated");
  assert.deepEqual(r.keys, ["command", "hook_event_name", "task_id"]);
  assert.equal(r.ts, "2026-01-01T00:00:00Z");
});

test("probeRecord tolerates junk input", () => {
  assert.equal(probeRecord(null, "t").event, "unknown");
  assert.deepEqual(probeRecord(null, "t").keys, []);
});
