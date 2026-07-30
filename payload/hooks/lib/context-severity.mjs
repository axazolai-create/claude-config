const COLOURS = [[95, "91"], [85, "31"], [70, "38;5;208"], [45, "33"], [15, "32"]];
const ICONS = [[95, "💀"], [85, "🔥"], [70, "⚠️"], [45, "💡"]];

const pick = (table, value, fallback) => {
  if (!Number.isFinite(value)) return fallback;
  for (const [floor, out] of table) if (value >= floor) return out;
  return fallback;
};

export function severityOf(input) {
  const { windowPct, acProgress } = input ?? {};
  return {
    colour: pick(COLOURS, Number(windowPct), "2"),
    icon: pick(ICONS, Number(acProgress), ""),
  };
}
