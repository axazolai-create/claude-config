// Frontmatter scalar setter — the value-compare primitive behind the effort re-tune patches
// (Phase 5 §6.1). The block-insertion machinery in gsd-agent-patches.mjs cannot express an
// effort re-tune: it inserts marker-wrapped prose blocks, whereas an effort change is a mutation
// of ONE existing YAML scalar (`effort: low` -> `effort: medium`). HTML-comment version markers
// can't wrap a frontmatter value without corrupting the YAML, and `effort: low` is not a unique
// anchor. So idempotency and safety here come from comparing the VALUE, not from a marker.
//
// setFrontmatterField(content, { key, from, to }) -> { content, kind }
//   kind:
//     "applied"        current value was in `from` -> rewritten to `to`
//     null             current value already equals `to` -> nothing written
//     "skippedForeign" current value is neither in `from` nor `to` (a deliberate user edit) ->
//                      left exactly as-is; never clobbered
//     "noKey"          no frontmatter block, or the key is absent from it
//
// Scope guarantees: only the first `---`...`---` frontmatter block is searched, so a stray
// `key:` line in the document BODY is never touched. Quoted (`"max"`/`'max'`) and unquoted
// scalars are both matched; the rewrite is always unquoted. CRLF and LF are both preserved.
// Pure string transform — no fs, no curated check (the caller handles CURATED:NOEDIT and I/O,
// mirroring how insertAfter/replaceOnce stay pure in gsd-agent-patches.mjs).

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function unquote(s) {
  const t = s.trim();
  const m = t.match(/^(['"])([\s\S]*)\1$/);
  return m ? m[2] : t;
}

export function setFrontmatterField(content, { key, from, to }) {
  const lines = content.split("\n");
  const bare = (l) => l.replace(/\r$/, "");
  // Frontmatter must open with `---` on the very first line.
  if (!lines.length || bare(lines[0]).trim() !== "---") return { content, kind: "noKey" };
  // Find the closing `---`.
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (bare(lines[i]).trim() === "---") { close = i; break; }
  }
  if (close === -1) return { content, kind: "noKey" };

  const keyRe = new RegExp(`^(\\s*${escapeRegExp(key)}\\s*:\\s*)(.*?)\\s*$`);
  for (let i = 1; i < close; i++) {
    const cr = lines[i].endsWith("\r") ? "\r" : "";
    const m = bare(lines[i]).match(keyRe);
    if (!m) continue;
    const cur = unquote(m[2]);
    if (cur === to) return { content, kind: null };
    if (from.includes(cur)) {
      lines[i] = `${m[1]}${to}${cr}`;
      return { content: lines.join("\n"), kind: "applied" };
    }
    return { content, kind: "skippedForeign" };
  }
  return { content, kind: "noKey" };
}
