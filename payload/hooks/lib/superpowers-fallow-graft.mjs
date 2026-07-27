// Anchored, idempotent graft of a fallow structural pre-pass into Superpowers'
// requesting-code-review reviewer prompt. Survives Superpowers plugin updates (which land a
// fresh, unpatched code-reviewer.md at a new version dir) via idempotent re-apply from
// session-init. Same shape as impeccable-promax-graft.mjs / gsd-agent-patches.mjs: sentinel =
// already-applied guard, anchor = insert point, missing anchor/file = skip (never corrupt).
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const SENTINEL = "<!-- fallow-graft:v1 -->";

// The reviewer prompt's checklist heading. The graft is inserted immediately AFTER this heading
// line so the pre-pass reads before the first check. Verified 2026-07-27 against Superpowers
// 6.2.0 requesting-code-review/code-reviewer.md.
export const ANCHOR = "## What to Check";

export const GRAFT = `${SENTINEL}
**Structural pre-pass (fallow):** Before the checks below —
- If this repo is a GSD project (a \`.planning/\` directory exists), SKIP this pre-pass: GSD's own review owns the fallow pass there. Do not run fallow.
- Otherwise, if the \`fallow\` binary is resolvable (\`node_modules/.bin/fallow\`, or on PATH), run it over the changed files and fold any dead-code / duplication / circular-dependency findings into the Issues section, at the severity fallow reports.
- Otherwise (fallow not installed), add ONE Minor note: "Structural pre-pass skipped — install with \`pnpm add -D fallow\` (workspace root: \`pnpm add -D fallow -w\`)." Never fail the review over a missing fallow binary.
`;

export function applyFallowGraft({ skillFile }) {
  if (!existsSync(skillFile)) return { applied: false, already: false, skippedNoAnchor: true };
  const txt = readFileSync(skillFile, "utf8");
  if (txt.includes(SENTINEL)) return { applied: false, already: true, skippedNoAnchor: false };
  const at = txt.indexOf(ANCHOR);
  if (at < 0) return { applied: false, already: false, skippedNoAnchor: true };
  const eol = txt.indexOf("\n", at);
  const insertAt = eol < 0 ? txt.length : eol + 1;
  writeFileSync(skillFile, txt.slice(0, insertAt) + "\n" + GRAFT + "\n" + txt.slice(insertAt), "utf8");
  return { applied: true, already: false, skippedNoAnchor: false };
}

function cmpSemver(a, b) {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

// Authoritative: plugins/installed_plugins.json installPath. Fallback: highest semver cache dir.
export function resolveSuperpowersReviewerFile(
  claudeDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
) {
  const rel = join("skills", "requesting-code-review", "code-reviewer.md");
  try {
    const manifest = JSON.parse(readFileSync(join(claudeDir, "plugins", "installed_plugins.json"), "utf8"));
    const entries = manifest && manifest.plugins && manifest.plugins["superpowers@claude-plugins-official"];
    if (Array.isArray(entries) && entries.length) {
      const e = entries.find((x) => x && x.installPath) || entries[0];
      if (e && e.installPath) {
        const f = join(e.installPath, rel);
        if (existsSync(f)) return f;
      }
    }
  } catch { /* fall through to semver scan */ }
  try {
    const base = join(claudeDir, "plugins", "cache", "claude-plugins-official", "superpowers");
    const dirs = readdirSync(base).filter((d) => /^\d+\.\d+\.\d+/.test(d)).sort(cmpSemver).reverse();
    for (const d of dirs) {
      const f = join(base, d, rel);
      if (existsSync(f)) return f;
    }
  } catch { /* none */ }
  return null;
}

// Never-throw entry for session-init: resolve + graft, swallowing all errors.
export function regraftFallow({ claudeDir } = {}) {
  try {
    const f = resolveSuperpowersReviewerFile(claudeDir);
    if (!f) return { ok: false, reason: "no-skill-file" };
    return { ok: true, ...applyFallowGraft({ skillFile: f }) };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e) };
  }
}
