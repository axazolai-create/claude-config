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

export function resolveVariant({ repoRoot, variant }) {
  const cfg = loadVariants(repoRoot);
  const def = cfg.variants[variant];
  if (!def) throw new Error(`unknown variant "${variant}" (known: ${Object.keys(cfg.variants).join(", ")})`);
  const payloadDir = join(repoRoot, "payload");
  const payloadRels = walkRels(payloadDir);

  if (!def.include) { // full: identity
    return { name: variant, rels: payloadRels, srcFor: (rel) => join(payloadDir, ...rel.split("/")),
             excludedSet: new Set(), uncovered: [], orphanOverlay: [], plugins: def.plugins };
  }
  const incRes = def.include.map(globToRe);
  const excRes = def.exclude.map(globToRe);
  const rels = [], excluded = [], uncovered = [];
  for (const rel of payloadRels) {
    if (matchAny(rel, excRes)) excluded.push(rel);       // exclude wins over include
    else if (matchAny(rel, incRes)) rels.push(rel);
    else uncovered.push(rel);
  }
  const overlayDir = def.overlay ? join(repoRoot, def.overlay) : null;
  const overlayRels = overlayDir ? walkRels(overlayDir) : [];
  const relSet = new Set(rels);
  const orphanOverlay = overlayRels.filter((r) => !relSet.has(r));
  const overlaySet = new Set(overlayRels);
  const srcFor = (rel) => overlaySet.has(rel)
    ? join(overlayDir, ...rel.split("/"))
    : join(payloadDir, ...rel.split("/"));
  return { name: variant, rels, srcFor, excludedSet: new Set(excluded), uncovered, orphanOverlay, plugins: def.plugins };
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
