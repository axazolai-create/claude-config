#!/usr/bin/env node
// Standalone, self-contained (no sibling imports) - spawned detached via `node <path>`, same
// pattern as hooks/lib/graphify-global-sync-run.mjs. Fetches Anthropic's public pricing docs
// page, parses the "Model pricing" HTML table, and writes ~/.claude/state/model-pricing.json.
//
// Best-effort scraping: there is NO official pricing API, so this depends on the docs page's
// current HTML structure (a plain <table> with <thead>/<tbody>/<tr>/<td>, verified 2026-07-08).
// If Anthropic changes that structure, parsing can silently return fewer rows - the
// MIN_EXPECTED_MODELS guard below turns that into a loud skip (existing file untouched) instead
// of writing a corrupt/partial price table. See RISK-TOKENLOG-001 in RISK_REGISTER.md.
//
// Model name -> price-table key: the page lists human names ("Claude Sonnet 5", "Claude Opus
// 4.8"); slugify() turns those into the SAME "claude-<family>-<version>" prefix convention as
// real API model ids (e.g. "claude-sonnet-4-5", "claude-haiku-4-5-20251001"). token-usage-log.mjs
// looks up cost by PREFIX match (longest prefix wins), not exact id match, so a dated suffix on
// the real resolved model id still matches without this file needing to know the exact date.
//
// The Sonnet 5 row currently appears twice on the page (introductory pricing "through August 31,
// 2026" vs. the price starting after that date) - both slugify to the same prefix, and the FIRST
// occurrence in table order wins (see `seen` below), which is always today's active price. This
// is self-updating: whenever Anthropic reorders/removes the introductory row after the cutover,
// a re-scrape just picks up whatever row is first at that time.
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const PRICING_URL = "https://docs.claude.com/en/docs/about-claude/pricing";
const OUT_FILE = join(homedir(), ".claude", "state", "model-pricing.json");
const MIN_EXPECTED_MODELS = 8; // page currently lists 14+; a big drop signals a parse break, not a real catalog shrink

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
const writeFile = (p, c) => { try { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); return true; } catch { return false; } };

function stripTags(s) {
  return s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}
function priceOf(cell) {
  const m = cell.match(/\$([\d.]+)\s*\/\s*MTok/);
  return m ? parseFloat(m[1]) : null;
}
function slugify(name) {
  return "claude-" + name
    .toLowerCase()
    .replace(/^claude\s+/, "")
    .replace(/\./g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parsePricingTable(html) {
  const headingIdx = html.indexOf("Model pricing");
  if (headingIdx === -1) return null;
  const tableStart = html.indexOf("<table", headingIdx);
  if (tableStart === -1) return null;
  const tableEnd = html.indexOf("</table>", tableStart);
  if (tableEnd === -1) return null;
  const table = html.slice(tableStart, tableEnd + "</table>".length);

  const rowRe = /<tr[^>]*>(.*?)<\/tr>/gs;
  const cellRe = /<td[^>]*>(.*?)<\/td>/gs;
  const rows = [...table.matchAll(rowRe)].map((m) => m[1]);

  const seen = new Set();
  const prices = [];
  for (const row of rows) {
    const cells = [...row.matchAll(cellRe)].map((m) => stripTags(m[1]));
    if (cells.length < 6) continue; // header row (th, not td) or malformed
    const name = cells[0]
      .replace(/\(.*?\)/g, "")
      .replace(/\s+(through|starting)\s+.*/i, "")
      .trim();
    if (!name) continue;
    const prefix = slugify(name);
    if (seen.has(prefix)) continue; // first occurrence wins (current/introductory pricing row)
    seen.add(prefix);
    const inputPerMTok = priceOf(cells[1]);
    const outputPerMTok = priceOf(cells[5]);
    if (inputPerMTok === null || outputPerMTok === null) continue; // malformed row, skip
    prices.push({
      prefix,
      name,
      inputPerMTok,
      cacheWritePerMTok: priceOf(cells[2]),
      cacheReadPerMTok: priceOf(cells[4]),
      outputPerMTok,
    });
  }
  return prices;
}

async function main() {
  let html;
  try {
    const res = await fetch(PRICING_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) { console.error("token-usage-pricing-refresh: HTTP " + res.status); return; }
    html = await res.text();
  } catch (err) {
    console.error("token-usage-pricing-refresh: fetch failed - " + (err && err.message));
    return;
  }

  const prices = safe(() => parsePricingTable(html));
  if (!prices || prices.length < MIN_EXPECTED_MODELS) {
    console.error(
      "token-usage-pricing-refresh: parsed " + (prices ? prices.length : 0) +
      " model(s), expected >= " + MIN_EXPECTED_MODELS + " - leaving existing pricing file untouched " +
      "(page structure may have changed; see RISK-TOKENLOG-001)."
    );
    return;
  }

  const out = { fetchedAt: new Date().toISOString(), source: PRICING_URL, prices };
  if (!writeFile(OUT_FILE, JSON.stringify(out, null, 2) + "\n"))
    console.error("token-usage-pricing-refresh: failed to write " + OUT_FILE);
}

main();
