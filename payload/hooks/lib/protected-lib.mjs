// Protected-path rules: a .gitignore-format subset, matched with last-rule-wins semantics.
// Every decision the .protected mechanism makes lives here as a pure function; the hook that
// calls it only reads stdin and sets an exit code. No subprocess is ever spawned - the suite
// asserts that of every hook, which is also why `git check-ignore` is not an option.
import { readFileSync } from "node:fs";
import { join, relative, resolve, basename } from "node:path";

const ESC = (s) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&");

export function ruleToRegExp(pattern) {
  let p = pattern;
  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.slice(0, -1);
  // A slash anywhere but the last position anchors the rule, exactly as .gitignore does.
  const anchored = p.startsWith("/") || p.slice(0, -1).includes("/");
  if (p.startsWith("/")) p = p.slice(1);
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        const before = i === 0 || p[i - 1] === "/";
        const after = p[i + 2] === "/" || i + 2 >= p.length;
        if (before && after) { re += "(?:.*)"; i += p[i + 2] === "/" ? 2 : 1; continue; }
        re += "[^/]*"; i += 1; continue;
      }
      re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "[") {
      const end = p.indexOf("]", i + 1);
      if (end === -1) { re += "\\["; continue; }
      let cls = p.slice(i + 1, end);
      if (cls.startsWith("!")) cls = "^" + cls.slice(1);
      re += `[${cls}]`;
      i = end;
    } else re += ESC(c);
  }
  return { re: new RegExp(`${anchored ? "^" : "^(?:.*/)?"}${re}(?:/.*)?$`), dirOnly, anchored };
}

export function parseRules(text, base = "") {
  const out = [];
  String(text ?? "").split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const negated = line.startsWith("!");
    const pattern = negated ? line.slice(1) : line;
    if (!pattern) return;
    out.push({ pattern, negated, base, line: i + 1, ...ruleToRegExp(pattern) });
  });
  return out;
}

// Last match wins, so a nested file's `!` beats an ancestor's rule - that single property is
// what delivers the "extend or override" the user chose, with no second mechanism.
export function matchRules(rules, relPath) {
  let hit = null;
  for (const r of rules) {
    const scoped = r.base ? (relPath === r.base || relPath.startsWith(r.base + "/")) : true;
    if (!scoped) continue;
    if (r.re.test(r.base ? relPath.slice(r.base.length + 1) : relPath)) hit = r;
  }
  return hit && !hit.negated ? hit : null;
}

const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

const chainDirs = (relPath) => {
  const segs = relPath.split("/").filter(Boolean);
  const dirs = [""];
  for (let i = 0; i < segs.length - 1; i++) dirs.push(segs.slice(0, i + 1).join("/"));
  return dirs;
};

// A protection git would not carry to another machine is not a project rule, so a hidden list
// is treated as a broken mechanism rather than a weaker one.
function isHidden(root, rel) {
  for (const dir of chainDirs(rel)) {
    const text = read(join(root, dir ? `${dir}/.gitignore` : ".gitignore"));
    if (text == null) continue;
    if (matchRules(parseRules(text, dir), rel)) return true;
  }
  return false;
}

export function collectRules(root, relPath) {
  const rules = [];
  let hidden = null;
  for (const dir of chainDirs(relPath)) {
    const rel = dir ? `${dir}/.protected` : ".protected";
    const text = read(join(root, rel));
    if (text == null) continue;
    rules.push(...parseRules(text, dir));
    if (!hidden && isHidden(root, rel)) hidden = rel;
  }
  return { rules, hidden };
}

const DESTRUCTIVE = /\b(rm|mv|truncate|dd|shred)\b|\bgit\s+(rm|mv)\b|\bsed\b[^|;]*\s-i\b|\bfind\b[^|;]*(-delete|-exec\s+rm)|\b(tar|unzip)\b/;
const UNPARSEABLE = /[$`]|\*|\?|\[|\bxargs\b/;
const REMOVES = /\b(rm|mv|shred)\b|\bgit\s+(rm|mv)\b/;
const ALWAYS_WRITABLE = new Set([".gitignore", ".protected"]);

// Command words and shell noise, so that `rm -rf docs` yields `docs` and not `rm`. A bare
// directory name carries no slash or dot, so "looks like a path" cannot be the test.
const NOT_A_PATH = new Set(["rm", "mv", "cp", "git", "sed", "find", "tar", "unzip", "echo",
  "dd", "truncate", "shred", "xargs", "cat", "sudo", "env", "then", "do", "done", "&&", "||", ";", "|"]);

export function bashTargets(command) {
  const cmd = String(command ?? "");
  const v = { destructive: false, parseable: true, paths: [], dests: [] };
  if (!DESTRUCTIVE.test(cmd) && !/>>?\s*\S/.test(cmd) && !/\bcp\b/.test(cmd)) return v;
  v.destructive = true;
  if (UNPARSEABLE.test(cmd)) v.parseable = false;
  const toks = cmd.split(/\s+/).filter(Boolean);
  const unquote = (t) => t.replace(/^["']|["']$/g, "");
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === ">" || t === ">>") { if (toks[i + 1]) v.dests.push(unquote(toks[i + 1])); continue; }
    const rd = /^>>?(\S+)$/.exec(t);
    if (rd) { v.dests.push(unquote(rd[1])); continue; }
    if (!t.startsWith("-") && !NOT_A_PATH.has(t)) v.paths.push(unquote(t));
  }
  // Direction is the whole point for cp: copying FROM a protected path is allowed.
  if (/\bcp\b/.test(cmd)) {
    const ti = toks.findIndex((t) => t === "-t" || t === "--target-directory");
    if (ti !== -1 && toks[ti + 1]) v.dests.push(unquote(toks[ti + 1]));
    else if (v.paths.length) v.dests.push(v.paths[v.paths.length - 1]);
  }
  return v;
}

const UNPARSED = "This command could not be parsed. Rephrase it with literal paths and it will be judged exactly.";
const INTRINSIC = "`.protected` may be edited but never deleted or moved. That rule is intrinsic to the mechanism, not an entry in any list.";

const MSG = (p, rule, extra) =>
  [`Denied: ${p} is protected.`,
   `Rule: ${rule.base ? rule.base + "/" : ""}.protected:${rule.line}  \`${rule.pattern}\``,
   "Protected paths may be read and copied FROM, never edited, deleted or moved.",
   ...extra].join("\n");

const hiddenMsg = (rel) => [
  `Denied: \`${rel}\` is hidden by \`.gitignore\`, so this protection would not exist on another machine.`,
  "Every write in its scope is denied until that is fixed.",
  "Remove the entry from .gitignore — that file and .protected stay writable for exactly this repair.",
].join("\n");

// A path lifted out of an unparseable command may carry junk ahead of the real one
// ($TARGET/docs/spec.md). Trying each suffix is what makes "deny anything suspicious" bite.
const suffixes = (p) => { const s = p.split("/").filter(Boolean); return s.map((_, i) => s.slice(i).join("/")); };

export function decide({ root, tool, path, command }) {
  const rel = (abs) => relative(root, resolve(root, abs)).split("\\").join("/");
  const isRepairFile = (p) => ALWAYS_WRITABLE.has(basename(p));

  if (tool !== "Bash") {
    if (!path) return null;
    const r = rel(path);
    if (isRepairFile(r)) return null;
    const { rules, hidden } = collectRules(root, r);
    if (hidden) return { message: hiddenMsg(hidden) };
    const rule = matchRules(rules, r);
    return rule ? { message: MSG(r, rule, []) } : null;
  }

  const t = bashTargets(command);
  if (!t.destructive) return null;
  const cmd = String(command);
  const removing = REMOVES.test(cmd);
  const cpOnly = /\bcp\b/.test(cmd) && !DESTRUCTIVE.test(cmd);
  const considered = cpOnly && t.parseable
    ? [...new Set(t.dests)].map(rel)
    : [...new Set([...t.paths, ...t.dests])].map(rel);

  for (const c of considered) {
    for (const cand of t.parseable ? [c] : suffixes(c)) {
      if (isRepairFile(cand)) {
        if (removing) return { message: `Denied: ${cand} may not be deleted or moved.\n${INTRINSIC}` };
        continue;
      }
      const { rules, hidden } = collectRules(root, cand);
      if (hidden) return { message: hiddenMsg(hidden) };
      const rule = matchRules(rules, cand);
      if (rule) return { message: MSG(cand, rule, t.parseable ? [] : [UNPARSED]) };
    }
  }
  return null;
}
