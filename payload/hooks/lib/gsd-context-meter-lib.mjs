// payload/hooks/lib/gsd-context-meter-lib.mjs
// Pure logic for the statusline context-meter override (see payload/hooks/gsd-context-meter.mjs).
// Only rewriteContextBar lives here - it exists solely to parse gsd-statusline.js's own
// output, so it's gsd-core-specific. The profile-neutral formatting/metrics functions
// live in statusline-lib.mjs; re-exported here so no existing importer breaks.
export { formatCurrentTokens, formatContextWindow, computeUsedTokenMetrics, appendUpdatesSegment, usedTokensOf } from "./statusline-lib.mjs";
import { formatCurrentTokens, formatContextWindow, usedTokensOf } from "./statusline-lib.mjs";

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
  const tokens = usedTokensOf({ totalCtx, used, usedTokens });

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
