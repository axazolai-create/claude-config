// Pure registry + decision logic for the centralized component-update checker.
// No I/O: the worker (component-update-check-run.mjs) and session-init.mjs supply state
// and env; this module only classifies and formats. See
// docs/superpowers/specs/2026-07-26-component-update-checker-design.md.

// kind: "version"     -> has a check() that yields installed/latest/updateAvailable
//       "upgrade-only" -> no version signal; just runs its self-upgrade on the throttle
// scope: "global"     -> machine-wide CLI/tool
//        "project"     -> per-project skill (probe arrives in Phase 3: impeccable, ui-ux-pro-max)
export const COMPONENTS = [
  { name: "context-mode",  scope: "global",  kind: "upgrade-only", updateClass: "safe",   legacyEnv: "CONTEXT_MODE" },
  { name: "graphify",      scope: "global",  kind: "upgrade-only", updateClass: "safe",   legacyEnv: "GRAPHIFY" },
  { name: "claude-config", scope: "global",  kind: "version",      updateClass: "reinit", legacyEnv: null },
  { name: "impeccable",    scope: "project", kind: "version",      updateClass: "safe",   legacyEnv: null },
  { name: "ui-ux-pro-max", scope: "project", kind: "version",      updateClass: "safe",   legacyEnv: null },
];

const envKey = (name) => name.toUpperCase().replace(/-/g, "_");

export function autoUpdateEnabled(name, env = process.env) {
  if (env.CLAUDE_COMPONENT_AUTOUPDATE === "0") return false;
  if (env[`CLAUDE_COMPONENT_AUTOUPDATE_${envKey(name)}`] === "0") return false;
  const legacy = (COMPONENTS.find((c) => c.name === name) || {}).legacyEnv;
  if (legacy) {
    if (env.CLAUDE_TOOL_AUTOUPGRADE === "0") return false;
    if (env[`CLAUDE_TOOL_AUTOUPGRADE_${legacy}`] === "0") return false;
  }
  return true;
}

export function decide({ updateClass, updateAvailable, autoUpdateEnabled }) {
  if (!updateAvailable) return "skip";
  if (updateClass === "safe" && autoUpdateEnabled) return "auto";
  return "notify";
}
