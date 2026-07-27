// Pure stack-marker → {test,build} lookup. Markers come from stack-rules-check.mjs detectMarkers().
// Priority: native/mobile signals win over JS (JS is the fallback default). Deterministic.
export function commandsForMarkers(markers) {
  const m = new Set(markers || []);
  if (m.has("dart")) return { test: "flutter test", build: "flutter build" };
  if (m.has("kotlin") || m.has("android")) return { test: "./gradlew test", build: "./gradlew build" };
  if (m.has("swift")) return { test: "swift test", build: "swift build" };
  if (m.has("go")) return { test: "go test ./...", build: "go build ./..." };
  if (m.has("csharp")) return { test: "dotnet test", build: "dotnet build" };
  if (m.has("django") || m.has("python") || m.has("bot-python")) return { test: "uv run pytest", build: null };
  const js = ["next", "vite", "nest", "node", "turbo", "nx", "bot-node", "react-native"];
  if (js.some((t) => m.has(t))) {
    const p = m.has("pnpm-ws") ? "pnpm -w" : "pnpm";
    return { test: `${p} test`, build: `${p} build` };
  }
  return { test: null, build: null };
}
