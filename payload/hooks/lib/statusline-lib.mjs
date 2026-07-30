// payload/hooks/lib/statusline-lib.mjs
// Profile-neutral statusline logic: token/window formatting and the context segment,
// shared by every profile's renderer (payload/hooks/statusline.mjs).

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
 * The whole context segment, e.g. "165.6K/1M 17%".
 *
 * The window size is `context_window_size`; `total_tokens` is a fallback only because this
 * bundle read that name for months and no captured payload existed to contradict it.
 *
 * The token figure is the plain sum of `current_usage`, and the percentage is the payload's
 * own `used_percentage` against the full window. Both are documented as null early in a
 * session and after /compact, so either half may be missing and the segment degrades to
 * whichever survives.
 */
export function computeContext(data) {
  const cw = data && data.context_window;
  if (!cw) return "";
  const total = cw.context_window_size ?? cw.total_tokens ?? 1_000_000;
  const u = cw.current_usage;
  let used = null;
  if (u && typeof u === "object") {
    const sum = (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0) +
      (Number(u.cache_read_input_tokens) || 0) + (Number(u.output_tokens) || 0);
    if (sum > 0) used = sum;
  }
  const pct = cw.used_percentage;
  if (used == null && pct == null) return "";
  const tokens = used != null ? used : (total * pct) / 100;
  return `${formatCurrentTokens(tokens)}/${formatContextWindow(total)}` +
    (pct == null ? "" : ` ${Math.round(pct)}%`);
}
