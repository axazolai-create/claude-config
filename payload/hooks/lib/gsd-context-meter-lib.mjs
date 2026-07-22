// payload/hooks/lib/gsd-context-meter-lib.mjs
// Pure logic for the statusline context-meter override (see payload/hooks/gsd-context-meter.mjs).
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

// Matches gsd-statusline.js's exact bar output: ` \x1b[<color>m` + optional `💀 ` +
// 10 block/shade chars + ` NN%` + an OPTIONAL native suffix (gsd-core 1.8.0's own
// opt-in `statusline.show_context_tokens`, e.g. " (156k)") + `\x1b[0m`. Color and
// skull-prefix are captured so the replacement keeps the same color/urgency signal;
// the bar chars are not captured - the bar itself is replaced by our own bracket
// segment. The native integer percent IS captured (group 3): it's what the native
// suffix (group 4) was computed from, and can legitimately differ from our own
// `used` (gsd-statusline.js rounds to an integer before we ever see it) - both are
// the original's own quantitative reading and ride along together, appended only
// when the native suffix is actually present (i.e. show_context_tokens is on).
const BAR_RE = /\x1b\[([\d;]+)m(💀 )?[█░]{10} (\d+)%( \([^)]*\))?\x1b\[0m/;

// The model segment is always `\x1b[2m<name>\x1b[0m` (dim) and is always the FIRST dim
// run gsd-statusline.js emits - composeStatusline() puts it right after the optional
// update banner (which uses yellow/red, never dim), in both `context_position: front`
// and `end`. Used as the splice point to relocate the bar segment (see below).
const MODEL_SEG_RE = /\x1b\[2m[\s\S]*?\x1b\[0m/;

/**
 * Replaces the context bar segment in `text` with a token-count segment, same color,
 * AND relocates it into its own ` │ `-delimited segment immediately after the model
 * segment - before GSD's own state/task ("middle") segment and before the directory
 * segment, regardless of where gsd-statusline.js originally placed it. This makes our
 * placement supersede the native `statusline.context_position` setting entirely (both
 * its `front` and `end` values converge on the same relocated output here).
 *
 * `usedTokens` (the real current_usage sum from computeUsedTokenMetrics) is preferred;
 * falls back to the old `totalCtx * used%` estimate only when it's unavailable
 * (e.g. hook input carries no `current_usage` block).
 *
 * Falls back to a plain in-place replace (no relocation) when the model segment can't
 * be located - defensive against unexpected input shapes, so the bar is never lost.
 */
export function rewriteContextBar(text, { totalCtx, used, usedTokens }) {
  if (typeof text !== "string" || totalCtx == null || used == null) return text;
  const tokens = usedTokens != null ? usedTokens : (totalCtx * used) / 100;

  const barMatch = BAR_RE.exec(text);
  if (!barMatch) return text;

  const [, color, skull, nativePercent, nativeSuffix] = barMatch;
  const nativeExtra = nativeSuffix ? `${nativeSuffix} ${nativePercent}%` : "";
  const newSegment = `\x1b[${color}m${skull || ""}[${formatCurrentTokens(tokens)}/${formatContextWindow(totalCtx)}] ${used.toFixed(1)}%${nativeExtra}\x1b[0m`;

  // Remove the original bar (and its one leading space - part of gsd-statusline.js's
  // own `ctx = ' \x1b[...'` construction, outside what BAR_RE matches) from wherever
  // it currently sits.
  let barStart = barMatch.index;
  const barEnd = barStart + barMatch[0].length;
  if (text[barStart - 1] === " ") barStart -= 1;
  const withoutBar = text.slice(0, barStart) + text.slice(barEnd);

  const modelMatch = MODEL_SEG_RE.exec(withoutBar);
  if (!modelMatch) {
    // No splice point - fall back to a plain in-place replace so the bar is never lost.
    return text.replace(BAR_RE, () => newSegment);
  }
  const afterModel = modelMatch.index + modelMatch[0].length;
  const pipeIdx = withoutBar.indexOf(" │ ", afterModel);
  if (pipeIdx === -1) {
    // Model segment is the only content after removing the bar - append our own pipe.
    return withoutBar.slice(0, afterModel) + " │ " + newSegment + withoutBar.slice(afterModel);
  }
  const insertAt = pipeIdx + " │ ".length;
  return withoutBar.slice(0, insertAt) + newSegment + " │ " + withoutBar.slice(insertAt);
}
