// payload/bin/install-design-stack.mjs
// Idempotent, fail-soft, project-scope design-stack installer. Invoked by /init-stack on frontend
// detect: node install-design-stack.mjs --root <path>. See
// docs/superpowers/specs/2026-07-26-phase3-design-skills-integration-design.md.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInstaller, pruneProMaxSkills, pythonAvailable, registerDesignHook,
         readDesignStackConfig, recordBaselineVersions } from "./lib/design-stack.mjs";
import { applyPromaxGraft } from "../hooks/lib/impeccable-promax-graft.mjs";

const DEFAULT = {
  impeccable: { install: "npx impeccable install --providers=claude --scope=project --no-hooks" },
  proMax: { install: "uipro init --ai claude --offline", keepSkills: ["ui-ux-pro-max", "ui-styling", "design-system"] },
};
const safe = (fn, fallback) => { try { return fn(); } catch (e) { console.error(`  ! ${e.message}`); return fallback; } };
const parts = (s) => s.trim().split(/\s+/);

export function runDesignStack({ root, config, skip = false } = {}) {
  const cfg = config || DEFAULT;
  const skillsDir = join(root, ".claude", "skills");
  const preExisting = existsSync(skillsDir) ? readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];

  // (a) Impeccable — install only if absent.
  const impPresent = existsSync(join(skillsDir, "impeccable"));
  const [ic, ...ia] = parts(cfg.impeccable.install);
  const impeccable = impPresent ? { ok: true, skipped: true } : safe(() => runInstaller(ic, ia, { root, skip }), { ok: false });

  // (b) Pro Max — install if the core skill is absent, then prune to the subset.
  const pmPresent = existsSync(join(skillsDir, "ui-ux-pro-max"));
  const [pc, ...pa] = parts(cfg.proMax.install);
  const proMax = pmPresent ? { ok: true, skipped: true } : safe(() => runInstaller(pc, pa, { root, skip }), { ok: false });
  const protect = preExisting.filter((n) => n !== "impeccable" && !cfg.proMax.keepSkills.includes(n)
    && !["design", "brand", "banner-design", "banner", "slides"].includes(n)); // don't protect known uipro extras
  const pruned = safe(() => pruneProMaxSkills(skillsDir, cfg.proMax.keepSkills, { protect }), []);

  // (c) design hook — project-scoped registration via our writer.
  const hook = safe(() => registerDesignHook(join(root, ".claude", "settings.json"),
    { scriptPath: ".claude/skills/impeccable/scripts/hook.mjs" }), { added: false });

  // (d) Pro Max graft into Impeccable reference docs.
  const graft = safe(() => applyPromaxGraft({ skillsDir }), { applied: [], already: [], skippedNoAnchor: [] });

  // (e) baseline versions for the updater (best-effort; real versions filled by the probe later).
  safe(() => recordBaselineVersions(root, { impeccable: "installed", "ui-ux-pro-max": "installed" }));

  // (f) python soft-check.
  const python = safe(() => pythonAvailable(), false);
  if (!python) console.error("  ! python3 not found — Pro Max search.py disabled; graft falls back to reference tables.");

  return { impeccable, proMax, pruned, hook, graft, python };
}

function main() {
  const argv = process.argv.slice(2);
  const ri = argv.indexOf("--root");
  const root = ri >= 0 ? argv[ri + 1] : process.cwd();
  const config = readDesignStackConfig(root) || DEFAULT;
  const r = runDesignStack({ root, config });
  console.log(`design-stack: pruned=${r.pruned.length} hook=${r.hook.added ? "added" : "present"} graft=${r.graft.applied.length}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
