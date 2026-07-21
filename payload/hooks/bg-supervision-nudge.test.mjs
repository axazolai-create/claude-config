// payload/hooks/bg-supervision-nudge.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldSuperviseBg } from "./bg-supervision-nudge.mjs";

test("nudges an unsupervised bounded background job", () => {
  assert.equal(shouldSuperviseBg({ run_in_background: true, command: "pnpm build" }).nudge, true);
  assert.equal(shouldSuperviseBg({ run_in_background: true, command: "vitest run" }).nudge, true);
});

test("does not nudge a foreground command", () => {
  assert.equal(shouldSuperviseBg({ run_in_background: false, command: "pnpm build" }).nudge, false);
  assert.equal(shouldSuperviseBg({ command: "ls" }).nudge, false);
});

test("does not nudge an already-supervised or self-bounded job", () => {
  assert.equal(shouldSuperviseBg({ run_in_background: true, command: "node ~/.claude/bin/supervise-bg.mjs -- 'pnpm build'" }).nudge, false);
  assert.equal(shouldSuperviseBg({ run_in_background: true, command: "gh run watch 123 --exit-status" }).nudge, false);
});

test("does not nudge a long-lived server (supervision would kill it)", () => {
  assert.equal(shouldSuperviseBg({ run_in_background: true, command: "pnpm dev" }).nudge, false);
  assert.equal(shouldSuperviseBg({ run_in_background: true, command: "next dev" }).nudge, false);
  assert.equal(shouldSuperviseBg({ run_in_background: true, command: "nodemon server.js" }).nudge, false);
});
