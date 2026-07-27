import { test } from "node:test";
import assert from "node:assert/strict";
import { commandsForMarkers } from "./stack-commands.mjs";

test("plain node/next → pnpm test/build", () => {
  assert.deepEqual(commandsForMarkers(["node", "next"]), { test: "pnpm test", build: "pnpm build" });
});
test("pnpm workspace → workspace-root script form", () => {
  assert.deepEqual(commandsForMarkers(["node", "pnpm-ws"]), { test: "pnpm -w test", build: "pnpm -w build" });
});
test("django → uv run pytest, no build", () => {
  assert.deepEqual(commandsForMarkers(["python", "django"]), { test: "uv run pytest", build: null });
});
test("kotlin/android → gradlew", () => {
  assert.deepEqual(commandsForMarkers(["kotlin", "android"]), { test: "./gradlew test", build: "./gradlew build" });
});
test("dart → flutter", () => {
  assert.deepEqual(commandsForMarkers(["dart"]), { test: "flutter test", build: "flutter build" });
});
test("go → go test/build ./...", () => {
  assert.deepEqual(commandsForMarkers(["go"]), { test: "go test ./...", build: "go build ./..." });
});
test("native beats co-present JS (kotlin + node → gradlew)", () => {
  assert.deepEqual(commandsForMarkers(["node", "kotlin"]), { test: "./gradlew test", build: "./gradlew build" });
});
test("unknown stack → nulls", () => {
  assert.deepEqual(commandsForMarkers(["docker", "ci"]), { test: null, build: null });
});
