// The one shell string the autosync worker spawns, as data rather than inline concatenation:
// the worker's own effects are untestable, this is not.
const quote = (s) => `"${String(s).replace(/"/g, '\\"')}"`;

export function buildSyncCommand({ root, name, lock, isWin }) {
  const steps = [`graphify ${["extract", root, "--code-only", "--global", "--as", name].map(quote).join(" ")}`];
  steps.push(isWin ? `del /f /q ${quote(lock)}` : `rm -f ${quote(lock)}`);
  return {
    shell: isWin ? "cmd" : "sh",
    flag: isWin ? "/c" : "-c",
    inner: steps.join(isWin ? " & " : "; "),
  };
}
