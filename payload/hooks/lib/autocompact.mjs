// Where automatic compaction fires, and how that gets learned. PreCompact carries no
// context_window, so the hook records an unkeyed observation in tokens and the statusline
// promotes it once it knows the model id and window. Keying on the transcript's own model
// id would collide: its 200K and 1M variants share it.
export function resolveAutocompact(arg) {
  const { windowSize, modelId, state, env = process.env, enabled = true } = arg || {};
  const w = Number(windowSize);
  if (!Number.isFinite(w) || w <= 0) return null;
  if (!enabled) return { tokens: w, source: "disabled" };
  // CLAUDE_CODE_AUTO_COMPACT_WINDOW sets the capacity compaction is reckoned against, capped at
  // the model's real window - it narrows the ladder's denominator, not the trigger percentage.
  const cw = Number(env && env.CLAUDE_CODE_AUTO_COMPACT_WINDOW);
  const capacity = Number.isFinite(cw) && cw > 0 ? Math.min(cw, w) : w;
  const pct = Number(env && env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE);
  if (Number.isFinite(pct) && pct > 0 && pct <= 100) return { tokens: (capacity * pct) / 100, source: "env" };
  const seen = state && state.models && state.models[modelId];
  const tokens = seen && Number(seen.tokens);
  if (Number.isFinite(tokens) && tokens > 0 && tokens <= capacity) return { tokens, source: "observed" };
  return { tokens: capacity, source: "assumed" };
}

export function observationFrom(records) {
  if (!Array.isArray(records)) return null;
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    const u = r && r.type === "assistant" && r.message && r.message.usage;
    if (!u) continue;
    const tokens = (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0) +
      (Number(u.cache_read_input_tokens) || 0) + (Number(u.output_tokens) || 0);
    if (tokens > 0) return { tokens, model: (r.message.model || "") };
  }
  return null;
}

// Long enough that a lunch-break or a meeting doesn't strand a legitimate claim; short enough
// that a record nobody claimed the same day doesn't outlive its session indefinitely.
const PENDING_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function baseModelId(id) {
  return String(id || "").replace(/-\d{8}$/, "").replace(/\[[^\]]*\]$/, "");
}

export function promotePending(state, arg) {
  const { modelId, windowSize, now = Date.now() } = arg || {};
  const p = state && state.pending;
  if (!p || !Number.isFinite(Number(p.tokens))) return { next: state || {}, changed: false };
  const at = Date.parse(p.at);
  const overAge = Number.isFinite(at) && now - at > PENDING_MAX_AGE_MS;
  // A stale record still gets purged even for the "wrong" model - it's orphaned either way.
  if (!overAge && baseModelId(p.model) !== baseModelId(modelId)) return { next: state, changed: false };
  const next = { ...state };
  delete next.pending;
  if (overAge) return { next, changed: true };
  const w = Number(windowSize);
  if (Number.isFinite(w) && w > 0 && Number(p.tokens) <= w) {
    next.models = { ...(next.models || {}),
      [modelId]: { tokens: Number(p.tokens), windowSize: w, observedAt: p.at } };
  }
  return { next, changed: true };
}

export function autoCompactEnabledFrom(settings) {
  return !(settings && settings.autoCompactEnabled === false);
}
