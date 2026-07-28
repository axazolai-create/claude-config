// Pure plugin reconciliation plan (spec § 4). No fs/process access here — setup.mjs executes.
export function buildPluginPlan({ required, managed, enabledPlugins, installedIds, keepInstalled = [], marketplaces, knownMarketplaces }) {
  const actions = [], notes = [];
  const enabled = enabledPlugins || {};
  const cli = Array.isArray(installedIds);
  const kept = new Set(keepInstalled);
  const known = knownMarketplaces && new Set(knownMarketplaces);
  const registered = new Set();
  for (const name of required) {
    const id = managed[name];
    if (!id) continue;
    // `claude plugin install` fails outright when the marketplace is unknown, so it goes first.
    const marketplace = id.split("@")[1];
    if (known && marketplace && !known.has(marketplace) && !registered.has(marketplace)) {
      registered.add(marketplace);
      const source = (marketplaces || {})[marketplace];
      if (source) actions.push({ type: "marketplace_add", name, id, marketplace, source });
      else notes.push(`marketplace "${marketplace}" is required by ${id} but is not registered and has no recorded source - add it to variants.json marketplaces, then re-run`);
    }
    if (cli && !installedIds.includes(id)) actions.push({ type: "install", name, id });
    else if (!cli && !(id in enabled)) notes.push(`if not installed yet, run: claude plugin install ${id}`);
    else if (!cli) notes.push(`cannot verify install of ${id} (claude CLI unavailable) - if missing, run: claude plugin install ${id}`);
    if (!(id in enabled)) actions.push({ type: "enable", name, id });
  }
  for (const name of Object.keys(managed)) {
    if (required.includes(name)) continue;
    const id = managed[name];
    // keepInstalled: disabled, but left on disk so rollback stays one command.
    if (kept.has(name)) notes.push(`${id} stays installed on purpose (kept for rollback); it is only disabled`);
    else if (cli && installedIds.includes(id)) actions.push({ type: "uninstall", name, id });
    else if (!cli && id in enabled) notes.push(`run manually: claude plugin uninstall ${id}`);
    if (id in enabled) actions.push({ type: "disable", name, id });
  }
  return { actions, notes };
}

export function formatPlan(actions, notes) {
  const lines = actions.map((a) => `  ${a.type.padEnd(9)} ${a.type === "marketplace_add" ? `${a.source} (marketplace "${a.marketplace}", needed by ${a.id})` : a.id}`);
  return [...lines, ...notes.map((n) => `  NOTE: ${n}`)].join("\n") || "  (plugins already match the variant)";
}
