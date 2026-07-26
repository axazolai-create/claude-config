## SUDO ELEVATION (default; Windows)
- Windows 11's inline `sudo` is OFF by default — verify with `sudo config` first; on
  "Sudo is disabled on this computer", tell the user and do NOT fall back to another
  elevation method.
- Ask permission first, in-session (AskUserQuestion or a direct question), naming the exact
  command and why elevation is needed; run `sudo <command>` only after explicit consent —
  never silently/preemptively (no answer, no call), and never treat a UAC dialog
  (mode-dependent, may not appear at all) as a substitute for asking.
- Appropriate only when the operation genuinely needs admin rights (SYSTEM/Administrators
  ACL, Scheduled Task registration, protected directories) under a UAC-filtered token.
- Example: `sudo powershell -ExecutionPolicy Bypass -File 'C:\path\to\Script.ps1'`
