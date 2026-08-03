const COLOURS = [[81, "31"], [56, "38;5;208"], [31, "33"], [16, "32"]];
// Every icon must have Emoji_Presentation=Yes. U+26A0 does not: xterm.js drops the U+FE0F
// selector and renders a monochrome glyph that inherits the surrounding foreground colour.
const ICONS = [[90, "💀"], [75, "🔥"], [60, "❗"], [40, "💡"]];

const pick = (table, value, fallback) => {
  if (!Number.isFinite(value)) return fallback;
  for (const [floor, out] of table) if (value >= floor) return out;
  return fallback;
};

export function severityOf(input) {
  const { windowPct, acProgress } = input ?? {};
  return {
    // Both ladders are whole-percent bands and the segment prints a rounded percent, so the
    // comparison rounds too - otherwise 80.6% would print "81%" and still render orange.
    colour: pick(COLOURS, Math.round(Number(windowPct)), "2"),
    icon: pick(ICONS, Math.round(Number(acProgress)), ""),
  };
}
