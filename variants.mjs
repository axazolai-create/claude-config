// Variant resolver for setup.mjs and the test suite. Pure logic + fs reads; no side effects.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export function loadVariants(repoRoot) {
  return JSON.parse(readFileSync(join(repoRoot, "variants.json"), "utf8"));
}

// Glob → anchored RegExp. Supports ** (any chars incl. /), * (any chars except /), literal rest.
export function globToRe(glob) {
  const esc = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\x00")   // placeholder so single-* rule doesn't eat it
    .replace(/\*/g, "[^/]*")
    .replace(/\x00/g, ".*");
  return new RegExp(`^${esc}$`);
}

const matchAny = (rel, res) => res.some((re) => re.test(rel));

function walkRels(dir, rel = "") {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    if (e.name === "__pycache__" || e.name.endsWith(".pyc")) continue; // mirror walkBundle()
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walkRels(join(dir, e.name), childRel));
    else out.push(childRel);
  }
  return out;
}

export function profilesOf(cfg) { return cfg.profiles || cfg.variants || {}; }

export function resolvedExclude(cfg, name) {
  const def = profilesOf(cfg)[name] || {};
  const parent = def.extends ? resolvedExclude(cfg, def.extends) : [];
  return [...parent, ...(def.exclude || [])];
}

export function resolveVariant({ repoRoot, variant, activeOptional = [], cfg = null }) {
  cfg = cfg || loadVariants(repoRoot);
  const profiles = profilesOf(cfg);
  const def = profiles[variant];
  if (!def) throw new Error(`unknown profile "${variant}" (known: ${Object.keys(profiles).join(", ")})`);
  const payloadDir = join(repoRoot, "payload");
  const payloadRels = walkRels(payloadDir);
  const alwaysRes = (cfg.alwaysExclude || []).map(globToRe);
  const isAlways = (rel) => matchAny(rel, alwaysRes);
  const srcForPayload = (rel) => join(payloadDir, ...rel.split("/"));

  // identity (full): ship everything except alwaysExclude
  if (!def.include && !def.exclude && !def.extends) {
    const rels = payloadRels.filter((r) => !isAlways(r));
    return { name: variant, rels, srcFor: srcForPayload,
      excludedSet: new Set(payloadRels.filter(isAlways)), uncovered: [], orphanOverlay: [], plugins: def.plugins };
  }

  // Active optional groups are promoted OVER exclude: their globs are installed this run and,
  // being in the manifest, get pruned again automatically on a later opt-out. Unknown group
  // names contribute nothing (no throw) so a stale flag can never break resolution.
  const optGlobs = (activeOptional || []).flatMap((g) => (def.optional && def.optional[g]) || []);
  const optRes = optGlobs.map(globToRe);

  // denylist (base/lite via extends): everything not excluded; optional-active wins over exclude
  if (!def.include) {
    const excRes = resolvedExclude(cfg, variant).map(globToRe);
    const rels = [], excluded = [];
    for (const rel of payloadRels) {
      if (isAlways(rel)) { excluded.push(rel); continue; }
      if (matchAny(rel, optRes)) { rels.push(rel); continue; }   // optional promoted over exclude
      if (matchAny(rel, excRes)) { excluded.push(rel); continue; }
      rels.push(rel);
    }
    return finalizeResolved({ variant, def, repoRoot, payloadDir, rels, excluded, plugins: def.plugins });
  }

  // legacy allowlist (kept one release for back-compat) — existing include/exclude/optional body,
  // wrapped to also drop alwaysExclude and route through finalizeResolved().
  const incRes = def.include.map(globToRe);
  const excRes = def.exclude.map(globToRe);
  const rels = [], excluded = [], uncovered = [];
  for (const rel of payloadRels) {
    if (isAlways(rel)) { excluded.push(rel); continue; }
    if (matchAny(rel, optRes)) rels.push(rel);           // active optional wins over exclude
    else if (matchAny(rel, excRes)) excluded.push(rel);  // exclude wins over include
    else if (matchAny(rel, incRes)) rels.push(rel);
    else uncovered.push(rel);
  }
  return finalizeResolved({ variant, def, repoRoot, payloadDir, rels, excluded, uncovered, plugins: def.plugins });
}

// shared overlay/srcFor/orphan handling (was inline in the old allowlist path)
function finalizeResolved({ variant, def, repoRoot, payloadDir, rels, excluded, uncovered = [], plugins }) {
  const overlayDir = def.overlay ? join(repoRoot, def.overlay) : null;
  const overlayRels = overlayDir ? walkRels(overlayDir) : [];
  const relSet = new Set(rels);
  const orphanOverlay = overlayRels.filter((r) => !relSet.has(r));
  const overlaySet = new Set(overlayRels);
  const srcFor = (rel) => overlaySet.has(rel)
    ? join(overlayDir, ...rel.split("/"))
    : join(payloadDir, ...rel.split("/"));
  return { name: variant, rels, srcFor, excludedSet: new Set(excluded), uncovered, orphanOverlay, plugins };
}

// Drop hook entries whose script basenames are not all inside the variant set; drop empty events.
export function filterPartialHooks(partialHooks, variantBasenames) {
  const out = {};
  for (const [ev, entries] of Object.entries(partialHooks || {})) {
    const kept = entries.filter((e) => (e.hooks || []).every((h) =>
      (h.args || []).every((a) => variantBasenames.has(String(a).split(/[\\/]/).pop()))));
    if (kept.length) out[ev] = kept;
  }
  return out;
}
