// Pure plugin reconciliation plan (spec § 4). No fs/process access here — setup.mjs executes.
export function buildPluginPlan({ required, managed, enabledPlugins, installedIds }) {
  const actions = [], notes = [];
  const enabled = enabledPlugins || {};
  const cli = Array.isArray(installedIds);
  for (const name of required) {
    const id = managed[name];
    if (!id) continue;
    if (cli && !installedIds.includes(id)) actions.push({ type: "install", name, id });
    else if (!cli && !(id in enabled)) notes.push(`if not installed yet, run: claude plugin install ${id}`);
    else if (!cli) notes.push(`cannot verify install of ${id} (claude CLI unavailable) - if missing, run: claude plugin install ${id}`);
    if (!(id in enabled)) actions.push({ type: "enable", name, id });
  }
  for (const name of Object.keys(managed)) {
    if (required.includes(name)) continue;
    const id = managed[name];
    if (cli && installedIds.includes(id)) actions.push({ type: "uninstall", name, id });
    else if (!cli && id in enabled) notes.push(`run manually: claude plugin uninstall ${id}`);
    if (id in enabled) actions.push({ type: "disable", name, id });
  }
  return { actions, notes };
}

export function formatPlan(actions, notes) {
  const lines = actions.map((a) => `  ${a.type.padEnd(9)} ${a.id}`);
  return [...lines, ...notes.map((n) => `  NOTE: ${n}`)].join("\n") || "  (plugins already match the variant)";
}
