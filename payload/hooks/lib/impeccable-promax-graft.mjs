// Anchored, idempotent graft of "query Pro Max first" guidance into Impeccable's reference
// docs. Survives `npx impeccable update` (which clobbers reference/*.md) by re-apply from the
// updater's afterUpdate. Same shape as gsd-agent-patches.mjs: sentinel = already-applied guard,
// anchor = where to insert, missing anchor = skip (never corrupt).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SENTINEL = "<!-- promax-graft:v1 -->";

// anchor text must be a stable prose fragment present in each shipped Impeccable reference file.
// Verify against the installed skill during Task 5 integration; update here if upstream changes.
export const ANCHORS = {
  "new-work.md": "## ",
  "shape.md": "## ",
  "colorize.md": "## ",
  "typeset.md": "## ",
};

const GRAFT = `${SENTINEL}
**Query the Pro Max style DB first.** Before proposing visuals, run
\`python .claude/skills/ui-ux-pro-max/scripts/search.py "<design intent>"\` and prefer its
candidate styles / palettes / font-pairings. If python3 or the skill is absent, fall back to the
reference tables below.
`;

export function applyPromaxGraft({ skillsDir }) {
  const refDir = join(skillsDir, "impeccable", "reference");
  const applied = [], already = [], skippedNoAnchor = [];
  for (const [file, anchor] of Object.entries(ANCHORS)) {
    const p = join(refDir, file);
    if (!existsSync(p)) { skippedNoAnchor.push(file); continue; }
    const txt = readFileSync(p, "utf8");
    if (txt.includes(SENTINEL)) { already.push(file); continue; }
    const at = txt.indexOf(anchor);
    if (at < 0) { skippedNoAnchor.push(file); continue; }
    writeFileSync(p, txt.slice(0, at) + GRAFT + "\n" + txt.slice(at), "utf8");
    applied.push(file);
  }
  return { applied, already, skippedNoAnchor };
}
