#!/usr/bin/env node
// Append the "GSD CLAUDE.md clobber" risk to RISK_REGISTER.md file(s).
// Auto-detects the format per file: a markdown table with an ID column (e.g. R-001) gets a new ROW
// with the next free ID in the SAME scheme (prefix, separator, zero-pad width). If no table is
// found, falls back to a "### <ID> -" section. Idempotent per file. ASCII-only output.
//
// Discovery (when NO file/dir argument is given): looks for RISK_REGISTER.md in the project root,
// in .planning/, and in any .planning/ subfolder. If several are found, only the SHALLOWEST level
// is used; if multiple sit at that same shallowest level, EACH is updated independently (its own
// next free ID). Use --root <dir> to set the search base (default: cwd).
//
// Usage:
//   node add-risk.mjs                       # discover + update shallowest register(s)
//   node add-risk.mjs --no-create           # same, but do nothing if none exist (no file created)
//   node add-risk.mjs path/to/RISK_REGISTER.md   # update exactly this file (created if missing)
//   node add-risk.mjs path/to/dir           # update <dir>/RISK_REGISTER.md
//   node add-risk.mjs --root <dir>          # set discovery base
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const argv = process.argv.slice(2);
const NO_CREATE = argv.includes("--no-create");
let ROOT = process.cwd();
const ri = argv.indexOf("--root");
if (ri !== -1 && argv[ri + 1]) ROOT = argv[ri + 1];
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1] === "--root"));
const pathArg = positional[0];

const SIG = "deny-curated-claude-md.mjs";

function listRegisters(root) {
  const found = [];
  const rootFile = join(root, "RISK_REGISTER.md");
  if (existsSync(rootFile)) found.push(rootFile);
  const base = join(root, ".planning");
  if (existsSync(base)) {
    const stack = [base];
    while (stack.length) {
      const dir = stack.pop();
      let ents = [];
      try { ents = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of ents) {
        const ap = join(dir, e.name);
        if (e.isFile() && e.name === "RISK_REGISTER.md") found.push(ap);
        else if (e.isDirectory() && !e.name.startsWith(".")) stack.push(ap);
      }
    }
  }
  return found;
}
const depthOf = (f, root) => relative(root, f).split(/[\\/]+/).filter(Boolean).length - 1;
function shallowest(files, root) {
  if (!files.length) return [];
  const min = Math.min(...files.map((f) => depthOf(f, root)));
  return files.filter((f) => depthOf(f, root) === min);
}

function targets() {
  if (pathArg) {
    try { if (statSync(pathArg).isDirectory()) return [join(pathArg, "RISK_REGISTER.md")]; } catch { /* not a dir */ }
    return [pathArg];
  }
  const set = shallowest(listRegisters(ROOT), ROOT);
  if (set.length) return set;
  return NO_CREATE ? [] : [join(ROOT, "RISK_REGISTER.md")];
}

function applyTo(target) {
  const exists = existsSync(target);
  let body = exists ? readFileSync(target, "utf8") : "";
  if (body.includes(SIG) || /GSD-generated CLAUDE\.md/i.test(body)) {
    console.log(`risk already present in ${target}; nothing to do.`);
    return;
  }
  const lines = body.split(/\r?\n/);
  const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const idCell = (l) => {
    const m = l.match(/^\s*\|\s*([A-Za-z]+)(-?)(\d+)\s*\|/);
    return m ? { prefix: m[1], sep: m[2], num: +m[3], width: m[3].length } : null;
  };
  const ids = lines.map(idCell).filter(Boolean);
  const hasTable = ids.length > 0;

  let id;
  if (hasTable) {
    const maxNum = Math.max(...ids.map((i) => i.num));
    const width = Math.max(...ids.map((i) => i.width));
    const ref = ids[ids.length - 1];
    id = ref.prefix + ref.sep + String(maxNum + 1).padStart(width, "0");
  } else {
    const dn = [...body.matchAll(/\bD(\d+)\b/g)].map((m) => +m[1]);
    id = "D" + ((dn.length ? Math.max(...dn) : 0) + 1);
  }

  if (hasTable) {
    const row =
      `| ${id} | Mitigating | Medium | Tooling / GSD | ` +
      `GSD (\`open-gsd/gsd-core\`) generates a project \`CLAUDE.md\` (\`/gsd-new-project\`, plus a ` +
      `\`/gsd-profile-user\` section) in the project root or \`.planning/\`. Project memory outranks ` +
      `user memory and CLAUDE.md loads as context, not enforced config, so a generated file can ` +
      `silently override curated rules. | ` +
      `Cross-platform PreToolUse Node hook \`deny-curated-claude-md.mjs\` blocks Edit/Write to ` +
      `\`~/.claude/CLAUDE.md\` and any CLAUDE.md carrying the \`CURATED:NOEDIT\` marker (root or ` +
      `\`.planning/\`); unmarked generated files stay editable. Optional per-project ` +
      `\`claudeMdExcludes: ["**/.planning/CLAUDE.md"]\` when \`.planning/CLAUDE.md\` is GSD-owned; ` +
      `weighted \`@import\` for precedence. Hooks fire only inside Claude Code sessions (residual). |`;
    let lastIdx = -1;
    for (let i = 0; i < lines.length; i++) if (isTableRow(lines[i])) lastIdx = i;
    lines.splice(lastIdx + 1, 0, row);
    writeFileSync(target, lines.join("\n"));
    console.log(`appended table row ${id} to ${target}`);
  } else {
    if (!exists) body = "# Risk Register\n";
    const entry =
      `\n\n### ${id} - GSD-generated CLAUDE.md clobbering curated memory\n\n` +
      `- **Status:** Mitigating\n` +
      `- **Context:** GSD generates a project CLAUDE.md (root or .planning/) that can override ` +
      `curated memory; project memory outranks user memory and CLAUDE.md is context, not enforced config.\n` +
      `- **Mitigation:** marker-based PreToolUse Node hook deny-curated-claude-md.mjs blocks edits to ` +
      `any CURATED:NOEDIT file; optional per-project claudeMdExcludes; weighted @import for precedence.\n`;
    writeFileSync(target, body.replace(/\s*$/, "") + entry + "\n");
    console.log(`appended section ${id} to ${target}`);
  }
}

const list = targets();
if (!list.length) { console.log("no RISK_REGISTER.md found; nothing to do (--no-create)."); process.exit(0); }
for (const t of list) applyTo(t);
