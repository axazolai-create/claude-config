// Pure classification + rewrite for the Ultrapowers rebrand. No I/O, no paths, no plugin on disk.
// Every occurrence of the upstream name lands in exactly one bucket. Protective buckets are
// applied FIRST and consume their spans, so `brand` can never eat the prefix of an invocation
// like `superpowers:writing-plans` - that failure is delayed (the file still reads correctly)
// and therefore the most expensive one available. See RISK-ULTRAPOWERS-003.
export const BUCKET_ORDER = ["invocation", "plugin-path", "artifact-path", "brand"];

export const RULES = [
  { bucket: "invocation", re: /superpowers:[a-z0-9-]+/gi, replace: null,
    why: "skill namespace derives from the plugin directory name; rewriting breaks resolution" },
  { bucket: "plugin-path", re: /skills\/using-superpowers(?:\/[\w.-]+)*/gi, replace: null,
    why: "path inside the upstream package; the directory is deliberately not renamed" },
  { bucket: "plugin-path", re: /\$\{CLAUDE_PLUGIN_ROOT\}[^\s)"']*superpowers[^\s)"']*/gi, replace: null,
    why: "resolved by the host against the real plugin root" },
  { bucket: "artifact-path", re: /docs\/superpowers\/(?:plans|specs)/gi, replace: ".ultrapowers/phases",
    why: "artifact home moves to .ultrapowers (layer 1)" },
  { bucket: "artifact-path", re: /\.superpowers\/sdd/gi, replace: ".ultrapowers/sdd",
    why: "scratch home moves with it" },
  { bucket: "brand", re: /\bSuperpowers\b/g, replace: "Ultrapowers", why: "brand prose" },
  { bucket: "brand", re: /\bsuperpowers\b/g, replace: "ultrapowers", why: "brand prose, lowercase" },
];

const ANY = /superpowers/gi;
const overlaps = (spans, s, e) => spans.some((x) => s < x.end && e > x.start);

export function classify(text) {
  const spans = [];
  for (const rule of RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags.includes("g") ? rule.re.flags : rule.re.flags + "g");
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      if (overlaps(spans, m.index, m.index + m[0].length)) continue;
      spans.push({ start: m.index, end: m.index + m[0].length, bucket: rule.bucket, match: m[0], rule });
    }
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
    histogram[span.bucket] += 1;
    out += text.slice(cursor, span.start);
    out += span.rule.replace === null
      ? span.match
      : span.match.replace(new RegExp(span.rule.re.source, span.rule.re.flags.replace("g", "")), span.rule.replace);
    cursor = span.end;
  }
  out += text.slice(cursor);
  return { text: out, histogram, unclassified };
}
