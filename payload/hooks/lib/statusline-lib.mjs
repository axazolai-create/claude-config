// payload/hooks/lib/statusline-lib.mjs
// Profile-neutral statusline logic: token/window formatting and the updates-pending
// segment, used by both gsd-context-meter.mjs (full) and the base/lite renderer.
// computeUsedTokenMetrics deliberately duplicates ~/.claude/hooks/gsd-statusline.js's own
// buffer-normalization math rather than importing gsd-core internals - that file is
// gsd-core-managed and versioned, its internals aren't a stable import surface.

/** e.g. 123400 -> "123.4K" (thousands, always one decimal digit) */
export function formatCurrentTokens(n) {
  return `${(n / 1000).toFixed(1)}K`;
}

/** e.g. 1000000 -> "1M", 200000 -> "200K", 1500000 -> "1.5M" (compact label; trailing ".0" stripped) */
export function formatContextWindow(n) {
  const [divisor, unit] = n >= 1_000_000 ? [1_000_000, "M"] : [1_000, "K"];
  const value = (n / divisor).toFixed(1).replace(/\.0$/, "");
  return `${value}${unit}`;
}

/**
 * Mirrors gsd-statusline.js's context-window bar math: normalizes `remaining_percentage`
 * against Claude Code's autocompact buffer (16.5% default, or derived from
 * CLAUDE_CODE_AUTO_COMPACT_WINDOW when set) to get the same `used` percentage the
 * original bar displays. `used` is returned unrounded so the caller can render
 * one-decimal precision.
 *
 * `usedTokens` is a SEPARATE figure, deliberately not derived from `used` * `totalCtx`:
 * `used` is scaled against the buffer-reduced *usable* window, so multiplying it back
 * against the full `totalCtx` inflates the count (confirmed live: 227.5K/22.8% shown
 * vs the real 190K for the same render). The actual used-token count is the plain sum
 * of `context_window.current_usage` fields - identical to what gsd-statusline.js's own
 * `contextTokenSuffix()` reports - so ours matches the native suffix instead of
 * disagreeing with it. `null` when `current_usage` is absent/empty; the caller
 * (`rewriteContextBar`) falls back to the old percentage-derived estimate in that case.
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
  const used = Math.max(0, Math.min(100, 100 - usableRemaining));

  const currentUsage = data.context_window && data.context_window.current_usage;
  let usedTokens = null;
  if (currentUsage && typeof currentUsage === "object") {
    const sum = (Number(currentUsage.input_tokens) || 0) +
      (Number(currentUsage.cache_creation_input_tokens) || 0) +
      (Number(currentUsage.cache_read_input_tokens) || 0) +
      (Number(currentUsage.output_tokens) || 0);
    if (sum > 0) usedTokens = sum;
  }

  return { totalCtx, used, usedTokens };
}

/**
 * The token figure to display for a computeUsedTokenMetrics() result: the real `current_usage`
 * sum when the hook input carried one, else the `totalCtx * used%` estimate. Shared so the full
 * and base/lite statuslines cannot drift on which of the two they show.
 */
export function usedTokensOf({ totalCtx, used, usedTokens }) {
  return usedTokens != null ? usedTokens : (totalCtx * used) / 100;
}

/** Append a compact ` │ ⬆<count>` segment (yellow) before any trailing newline. */
export function appendUpdatesSegment(text, count) {
  if (typeof text !== "string" || !Number.isFinite(count) || count < 1) return text;
  const seg = ` │ \x1b[33m⬆${count}\x1b[0m`;
  return text.replace(/(\r?\n)?$/, (nl) => seg + (nl || ""));
}
