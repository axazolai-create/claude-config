// Deploy-time old-model migrator (Phase 5 Part B). Two pure, value-compare functions — same
// non-clobber ethos as the §6.1 frontmatter setter: only a KNOWN-old value ever moves; anything
// the user chose deliberately is reported/returned unchanged. No I/O here; callers (setup.mjs and
// bin/init-stack.mjs) own reads/writes/prompts. Not gsd-prefixed, so it ships in every profile;
// the project-config function's GSD role names are inert data in base/lite (never invoked there —
// bin/init-stack.mjs only calls it behind a `.planning/config.json` runtime guard).

// ---- session model (settings.json "model") ----
// Tier-preserving: an old opus id -> opus[1m], an old sonnet id -> claude-sonnet-5, an old haiku
// id -> claude-haiku-4-5. Explicit per-family prefixes (not a "not in current allowlist"
// heuristic) so a future claude-opus-6 is never mis-flagged and no migration crosses tiers.
const SUPERSEDED_MODEL_FAMILIES = [
  { target: "opus[1m]", prefixes: ["claude-opus-4", "claude-3-opus"] },
  { target: "claude-sonnet-5", prefixes: ["claude-sonnet-4", "claude-3-5-sonnet", "claude-3-7-sonnet"] },
  { target: "claude-haiku-4-5", prefixes: ["claude-3-5-haiku", "claude-3-haiku"] },
];

export function migrateSettingsModel(model) {
  if (typeof model !== "string" || !model) return { value: model, changed: false };
  for (const fam of SUPERSEDED_MODEL_FAMILIES) {
    if (fam.prefixes.some((p) => model.startsWith(p))) {
      return { value: fam.target, changed: true, from: model };
    }
  }
  return { value: model, changed: false };
}

// ---- project .planning/config.json model_overrides (§6.3 re-migration) ----
// Per-role old -> new; a role only moves when it currently holds the known-old value.
const PROJECT_OVERRIDE_MIGRATIONS = {
  "gsd-pattern-mapper": { from: "haiku", to: "sonnet" },
  "gsd-integration-checker": { from: "haiku", to: "sonnet" },
  "gsd-nyquist-auditor": { from: "haiku", to: "sonnet" },
  "gsd-ui-checker": { from: "haiku", to: "sonnet" },
  "gsd-ui-auditor": { from: "haiku", to: "sonnet" },
  "gsd-verifier": { from: "sonnet", to: "opus" },
};

export function migrateProjectModelConfig(config) {
  const changes = [];
  const overrides = config && config.model_overrides;
  if (!overrides || typeof overrides !== "object") return { config, changes };

  // Shallow-clone so the input object is never mutated.
  const nextOverrides = { ...overrides };
  for (const [role, { from, to }] of Object.entries(PROJECT_OVERRIDE_MIGRATIONS)) {
    if (nextOverrides[role] === from) {
      nextOverrides[role] = to;
      changes.push({ role, from, to });
    }
  }
  if (!changes.length) return { config, changes };
  return { config: { ...config, model_overrides: nextOverrides }, changes };
}
