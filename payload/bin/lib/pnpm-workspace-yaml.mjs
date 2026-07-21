// payload/bin/lib/pnpm-workspace-yaml.mjs
// Minimal, additive-only handler for the packageExtensions subtree of pnpm-workspace.yaml.
// Node has no stdlib YAML parser and npm deps are forbidden, so this handles ONLY the
// canonical block-style shape pnpm writes. Anything it can't safely edit => safe:false, no write.
const q = (name) => (/^[A-Za-z0-9_.-]+$/.test(name) ? name : `"${name}"`); // quote scoped/special keys
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // escape for RegExp source

function findBlock(lines, key) {
  // returns {flow, start, end} for a top-level `key:` block (its indented children), or null
  const i = lines.findIndex((l) => l === `${key}:` || l.startsWith(`${key}:`));
  if (i < 0) return null;
  if (lines[i].trim() !== `${key}:`) return { flow: true, start: i, end: i }; // inline/flow value
  let end = i + 1;
  while (end < lines.length && (lines[end].trim() === "" || /^\s+/.test(lines[end]))) end++;
  return { flow: false, start: i, end };
}

export function addOptionalPeers(yamlText, additions) {
  if (/\t/.test(yamlText)) return { text: yamlText, added: [], skipped: [], safe: false };
  const nl = yamlText.includes("\r\n") ? "\r\n" : "\n";
  const lines = yamlText.split(/\r?\n/);
  const blk = findBlock(lines, "packageExtensions");
  if (blk && blk.flow) return { text: yamlText, added: [], skipped: [], safe: false };

  // Snapshot of the existing block text, to detect what is already present.
  const blockText = blk ? lines.slice(blk.start, blk.end).join("\n") : "";

  // Is P already a mapping key (2-space indent) inside the block?
  const pExists = (P) => new RegExp(`^\\s{2}(?:"${esc(P)}"|${esc(P)}):`, "m").test(blockText);

  // Is P->Q already declared as an optional peer within the block?
  const has = (P, Q) => {
    const pIdx = blockText.search(new RegExp(`^\\s{2}(?:"${esc(P)}"|${esc(P)}):`, "m"));
    if (pIdx < 0) return false;
    const after = blockText.slice(pIdx);
    const nextP = after.slice(1).search(/^\s{2}\S/m); // start of the next P-key, if any
    const pBody = nextP < 0 ? after : after.slice(0, nextP + 1);
    return new RegExp(`peerDependenciesMeta:[\\s\\S]*?\\b${esc(Q)}:\\s*$`, "m").test(pBody)
        || new RegExp(`\\b${esc(Q)}:\\s*['"]?\\*`, "m").test(pBody);
  };

  const added = [], skipped = [];
  // If P already exists but Q is missing, appending a fresh P-block would create a duplicate
  // mapping key. That is unsafe, so we FAIL SAFE for that pair (report as skipped/manual)
  // rather than risk corrupting the file. Fresh full P-blocks are the common path.
  for (const [P, qs] of additions) {
    for (const Q of qs) {
      if (has(P, Q)) { skipped.push([P, Q]); continue; }
      if (pExists(P)) { skipped.push([P, Q]); continue; } // manual: P present, avoid dup-key
      added.push([P, Q]);
    }
  }

  // Group added pairs by P into fresh, self-contained blocks.
  const byP = new Map();
  for (const [P, Q] of added) { if (!byP.has(P)) byP.set(P, []); byP.get(P).push(Q); }
  const newEntries = [];
  for (const [P, qs] of byP) {
    const b = [`  ${q(P)}:`, `    peerDependencies:`];
    for (const Q of qs) b.push(`      ${q(Q)}: "*"`);
    b.push(`    peerDependenciesMeta:`);
    for (const Q of qs) b.push(`      ${q(Q)}:`, `        optional: true`);
    newEntries.push(...b);
  }

  if (!newEntries.length) return { text: yamlText, added: [], skipped, safe: true };

  if (!blk) {
    // Append a new top-level packageExtensions block at EOF.
    const pad = yamlText.endsWith("\n") || yamlText === "" ? "" : nl;
    const text = yamlText + pad + `packageExtensions:` + nl + newEntries.join(nl) + nl;
    return { text, added, skipped, safe: true };
  }
  // Insert new entries at the end of the existing block.
  const before = lines.slice(0, blk.end);
  const after = lines.slice(blk.end);
  const text = [...before, ...newEntries, ...after].join(nl);
  return { text, added, skipped, safe: true };
}
