// payload/hooks/lib/gsd-context-meter-lib.mjs
// Pure logic for the statusline context-meter override (see payload/hooks/gsd-context-meter.mjs).
// computeUsedTokenMetrics deliberately duplicates ~/.claude/hooks/gsd-statusline.js's own
// buffer-normalization math rather than importing gsd-core internals - that file is
// gsd-core-managed and versioned, its internals aren't a stable import surface.

/** e.g. 250000 -> "250k" */
export function formatTokenCount(n) {
  return `${Math.round(n / 1000)}k`;
}

/**
 * Mirrors gsd-statusline.js's context-window bar math: normalizes `remaining_percentage`
 * against Claude Code's autocompact buffer (16.5% default, or derived from
 * CLAUDE_CODE_AUTO_COMPACT_WINDOW when set) to get the same `used` percentage the
 * original bar displays.
 */
export function computeUsedTokenMetrics(data) {
  const remaining = data && data.context_window && data.context_window.remaining_percentage;
  if (remaining == null) return null;
  const totalCtx = (data.context_window && data.context_window.total_tokens) || 1_000_000;
  const acw = parseInt(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW || "0", 10);
  const AUTO_COMPACT_BUFFER_PCT = acw > 0
    ? Math.min(100, Math.max(0, (1 - acw / totalCtx) * 100))
    : 16.5;
  const usableRemaining = Math.max(0, ((remaining - AUTO_COMPACT_BUFFER_PCT) / (100 - AUTO_COMPACT_BUFFER_PCT)) * 100);
  const used = Math.max(0, Math.min(100, Math.round(100 - usableRemaining)));
  return { totalCtx, used };
}

// Matches gsd-statusline.js's exact bar output: ` \x1b[<color>m` + optional `💀 ` +
// 10 block/shade chars + ` NN%` + `\x1b[0m`. Color and skull-prefix are captured so the
// replacement keeps the same color/urgency signal; the bar chars and percent number are
// not captured - percent comes from the caller's own `used` (same value already printed),
// guaranteeing the displayed % and the token ratio never disagree.
const BAR_RE = /\x1b\[([\d;]+)m(💀 )?[█░]{10} \d+%\x1b\[0m/;

/** Replaces the context bar segment in `text` with a token-count segment, same color. */
export function rewriteContextBar(text, { totalCtx, used }) {
  if (typeof text !== "string" || totalCtx == null || used == null) return text;
  const usedTokens = Math.round((totalCtx * used) / 100);
  return text.replace(
    BAR_RE,
    (_match, color, skull) =>
      `\x1b[${color}m${skull || ""}[${formatTokenCount(usedTokens)}/${formatTokenCount(totalCtx)}] ${used}%\x1b[0m`
  );
}
