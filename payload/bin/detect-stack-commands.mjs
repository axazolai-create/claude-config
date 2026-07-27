// Prints a rebuild-safe "## Detected commands" markdown block for the rules compiler to include
// in .claude/stack-rules.md. Pure derivation from detectMarkers() + commandsForMarkers().
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { detectMarkers } from "../hooks/lib/stack-rules-check.mjs";
import { commandsForMarkers } from "./lib/stack-commands.mjs";

export function renderDetectedCommands(root) {
  const markers = detectMarkers(root);
  const { test, build } = commandsForMarkers(markers);
  const lines = ["## Detected commands", ""];
  if (test || build) {
    lines.push(`Detected stack: ${markers.join(", ") || "—"}. Use these unless the project says otherwise.`, "");
    if (test) lines.push(`- **Test:** \`${test}\``);
    if (build) lines.push(`- **Build:** \`${build}\``);
  } else {
    lines.push(
      `Detected stack: ${markers.join(", ") || "—"}. No confident default test/build command —`,
      "set the exact commands for this project manually.",
    );
  }
  return lines.join("\n") + "\n";
}

function isMain() {
  const a = process.argv[1];
  if (!a) return false;
  const self = fileURLToPath(import.meta.url);
  if (resolve(a) === self) return true;
  try { return realpathSync(a) === self; } catch { return false; }
}

if (isMain()) {
  const i = process.argv.indexOf("--root");
  const root = resolve(i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : process.cwd());
  process.stdout.write(renderDetectedCommands(root));
}
