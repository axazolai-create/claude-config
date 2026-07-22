// payload/bin/lib/config-dir-validate.mjs
// Validate/normalize a candidate config directory WITHOUT creating it. Returns { ok:true, norm }
// (slashes normalized to the platform form) or { ok:false, error }. Rejects: relative paths,
// invalid syntax, Windows-illegal chars, UNC/network/removable/CD drives, a non-existent
// drive/root (so it could never be mkdir-p'd), and any symlink/junction along the existing path.
import { existsSync, statSync, realpathSync } from "node:fs";
import { platform } from "node:os";
import { resolve, isAbsolute, dirname } from "node:path";
import { spawnSync } from "node:child_process";

// Windows drive-type via .NET DriveInfo: Fixed | Network | Removable | CDRom | Ram |
// NoRootDirectory | Unknown. Best-effort ("" when it can't be determined).
export function winDriveType(driveColon) {
  try {
    const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
      `([System.IO.DriveInfo]::new('${driveColon}\\')).DriveType`], { encoding: "utf8", timeout: 6000 });
    if (r.status === 0) return (r.stdout || "").trim();
  } catch { /* ignore */ }
  return "";
}

// driveTypeFn is injectable so the drive-type branch is testable without a real drive.
export function validateConfigDir(input, driveTypeFn = winDriveType) {
  if (typeof input !== "string" || !input.trim()) return { ok: false, error: "empty path" };
  // Reject UNC on the RAW input (resolve() can fold "\\\\host\\share" into a drive path).
  if (input.startsWith("\\\\") || (platform() === "win32" && input.startsWith("//")))
    return { ok: false, error: "UNC / network paths are not allowed" };
  if (!isAbsolute(input)) return { ok: false, error: "enter an ABSOLUTE path (e.g. D:\\claude-home)" };
  let norm;
  try { norm = resolve(input); } catch { return { ok: false, error: "invalid path syntax" }; }

  if (platform() === "win32") {
    const afterDrive = norm.replace(/^[A-Za-z]:/, "");
    if (/[<>:"|?*\x00-\x1f]/.test(afterDrive)) return { ok: false, error: 'invalid characters for Windows (< > : " | ? *)' };
    const m = norm.match(/^([A-Za-z]:)/);
    if (!m) return { ok: false, error: "expected a drive-letter path" };
    const dt = driveTypeFn(m[1]);
    if (dt === "NoRootDirectory") return { ok: false, error: `drive ${m[1]} does not exist` };
    if (dt === "Network" || dt === "Removable" || dt === "CDRom")
      return { ok: false, error: `${dt} drives are not allowed - use a local fixed disk` };
  }

  // The deepest existing ancestor must be a real directory (so mkdir -p can create the rest).
  let p = norm;
  while (!existsSync(p)) {
    const parent = dirname(p);
    if (parent === p) return { ok: false, error: "no existing root - path cannot be created" };
    p = parent;
  }
  try { if (!statSync(p).isDirectory()) return { ok: false, error: `${p} exists but is a file` }; }
  catch { return { ok: false, error: "cannot access the path" }; }

  // Reject any symlink/junction in the existing chain (case-insensitive on Windows so a mere
  // casing difference from the on-disk name is not mistaken for a reparse point).
  try {
    const rp = realpathSync(p);
    const differ = platform() === "win32" ? rp.toLowerCase() !== p.toLowerCase() : rp !== p;
    if (differ) return { ok: false, error: "path goes through a symlink/junction" };
  } catch { /* ignore */ }

  return { ok: true, norm };
}
