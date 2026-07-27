// Pure classification + rewrite for the Ultrapowers rebrand. No I/O, no paths, no plugin on disk.
// Every occurrence of the upstream name lands in exactly one bucket. Protective buckets are
// applied FIRST and consume their spans, so `brand` can never eat the prefix of an invocation
// like `superpowers:writing-plans` - that failure is delayed (the file still reads correctly)
// and therefore the most expensive one available. See RISK-ULTRAPOWERS-003.
//
// Fix round 1 findings (see RISK-ULTRAPOWERS-003 ledger): rule ORDER alone is not enough to
// guarantee a narrow rule can't fragment a broader protective match (Critical 1) - classify()
// now collects every rule's candidate spans up front and resolves overlaps by preferring the
// LONGEST span, falling back to rule order only as a tie-break. The `brand` rules also refuse
// to match a `superpowers` occurrence adjacent to a path separator (Important 5): if no rule
// recognizes the surrounding path shape, the occurrence must surface as `unclassified` rather
// than have `brand` guess a target path that may not exist.
export const BUCKET_ORDER = ["invocation", "plugin-path", "artifact-path", "brand"];

export const RULES = [
  { bucket: "invocation", re: /superpowers:[a-z0-9-]+/gi, replace: null,
    why: "skill namespace derives from the plugin directory name; rewriting breaks resolution" },
  { bucket: "plugin-path", re: /\$\{CLAUDE_PLUGIN_ROOT\}[^\s)"']*superpowers[^\s)"']*/gi, replace: null,
    why: "resolved by the host against the real plugin root" },
  { bucket: "plugin-path", re: /(?:\.claude\/)?plugins\/superpowers(?:\/[\w.-]+)*/gi, replace: null,
    why: "plugin install directory; the segment must match the installed path on disk" },
  { bucket: "plugin-path", re: /skills\/using-superpowers(?:\/[\w.-]+)*/gi, replace: null,
    why: "path inside the upstream package; the directory is deliberately not renamed" },
  { bucket: "plugin-path", re: /(?:github\.com\/[\w-]+\/superpowers\b|obra\/superpowers\b|superpowers-marketplace\b)/gi, replace: null,
    why: "upstream repo/marketplace identifier; rewriting breaks the install instruction" },
  { bucket: "artifact-path", re: /docs\/superpowers\/(?:plans|specs)/gi, replace: ".ultrapowers/phases",
    why: "artifact home moves to .ultrapowers (layer 1)" },
  { bucket: "artifact-path", re: /\.superpowers\/sdd/gi, replace: ".ultrapowers/sdd",
    why: "scratch home moves with it" },
  { bucket: "brand", re: /(?<!\/)\bSuperpowers\b(?!\/)/g, replace: "Ultrapowers",
    why: "brand prose (never adjacent to a path separator, to avoid inventing an unmapped path)" },
  { bucket: "brand", re: /(?<!\/)\bsuperpowers\b(?!\/)/g, replace: "ultrapowers",
    why: "brand prose, lowercase (same path guard)" },
];

const ANY = /superpowers/gi;
const overlaps = (spans, s, e) => spans.some((x) => s < x.end && e > x.start);

export function classify(text) {
  // Collect every rule's candidate spans first, rather than committing spans rule-by-rule.
  // Committing incrementally makes correctness depend on RULES order alone: a narrower rule
  // listed earlier can claim a fragment of text that a broader, more protective rule listed
  // later would otherwise have matched in full, leaving the broader match's remainder to fall
  // through to `brand` (Critical 1). Resolving overlaps by longest-span-wins afterward means a
  // future rule 7 inserted in the "wrong" place still can't fragment a bigger protective match.
  const candidates = [];
  RULES.forEach((rule, ruleIndex) => {
    const re = new RegExp(rule.re.source, rule.re.flags.includes("g") ? rule.re.flags : rule.re.flags + "g");
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      candidates.push({ start: m.index, end: m.index + m[0].length, bucket: rule.bucket, match: m[0], rule, ruleIndex });
    }
  });

  // Longest span wins; ties break by RULES order (earlier/more-protective rule wins), then by
  // start position for determinism.
  candidates.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.ruleIndex - b.ruleIndex || a.start - b.start);

  const spans = [];
  for (const c of candidates) {
    if (overlaps(spans, c.start, c.end)) continue;
    spans.push(c);
  }
  spans.sort((a, b) => a.start - b.start);

  const unclassified = [];
  let m;
  ANY.lastIndex = 0;
  while ((m = ANY.exec(text)) !== null) {
    if (overlaps(spans, m.index, m.index + m[0].length)) continue;
    unclassified.push({
      index: m.index,
      match: m[0],
      line: text.slice(0, m.index).split("\n").length,
    });
  }
  return { spans, unclassified };
}

export function rewrite(text) {
  const { spans, unclassified } = classify(text);
  const histogram = Object.fromEntries(BUCKET_ORDER.map((b) => [b, 0]));
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    // Count raw occurrences of the name inside the span, not spans themselves: a single
    // protective span (e.g. a CLAUDE_PLUGIN_ROOT path) can embed the word more than once.
    histogram[span.bucket] += (span.match.match(/superpowers/gi) || []).length;
    out += text.slice(cursor, span.start);
    out += span.rule.replace === null
      ? span.match
      : span.match.replace(new RegExp(span.rule.re.source, span.rule.re.flags.replace("g", "")), span.rule.replace);
    cursor = span.end;
  }
  out += text.slice(cursor);
  return { text: out, histogram, unclassified };
}
