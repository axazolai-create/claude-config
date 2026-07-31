export function parseGlossary(text) {
  const entries = [];
  let current = null;
  for (const line of String(text ?? "").split("\n")) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) { current = { term: m[1], definition: "" }; entries.push(current); continue; }
    if (current) current.definition += `${line}\n`;
  }
  return entries.map((e) => ({ ...e, definition: e.definition.trim() }));
}

export function lintGlossary(text) {
  const entries = parseGlossary(text);
  const problems = [];
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.term)) problems.push({ term: e.term, problem: `duplicate term — ${e.term} is defined more than once` });
    seen.add(e.term);
    if (!e.definition) problems.push({ term: e.term, problem: `${e.term} has no definition` });
  }
  const terms = entries.map((e) => e.term);
  const sorted = [...terms].sort((a, b) => a.localeCompare(b));
  if (terms.join(" ") !== sorted.join(" "))
    problems.push({ term: null, problem: "terms are out of alphabetical order" });
  return problems;
}

// Backticked identifiers only. A frequency pass over free prose surfaces "the", "should" and
// every project noun, which is noise dressed as a report; a term someone bothered to mark as
// code is a term someone already treated as jargon.
export function suggestTerms({ documents, defined = [], minCount = 5, minFiles = 2 }) {
  const known = new Set(defined);
  const counts = new Map();
  for (const doc of documents) {
    for (const m of String(doc.text ?? "").matchAll(/`([a-z][a-z0-9 -]{2,30})`/gi)) {
      const term = m[1].toLowerCase();
      if (known.has(term)) continue;
      const rec = counts.get(term) ?? { term, count: 0, files: new Set() };
      rec.count += 1;
      rec.files.add(doc.path);
      counts.set(term, rec);
    }
  }
  return [...counts.values()]
    .filter((r) => r.count >= minCount && r.files.size >= minFiles)
    .map((r) => ({ term: r.term, count: r.count, files: [...r.files].sort() }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
}
