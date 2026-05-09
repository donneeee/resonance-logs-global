# Changelog

## v1.0.6_beta4 - Global Beta

- Disabled WIP modifier analysis by default to reduce live/history CPU cost while modifier attribution work continues.
- Kept the Modifiers history tab visibly marked as WIP.
- Improved installed-build parser-data lookup for generated names and monitor support files.
- Added monitor/runtime visibility fixes and history loading optimizations.
- Fixed history boss/elite aggregate display so Total boss columns use Boss:/Elite: targets while per-target views stay per-target.

## v1.0.6_beta3 - Global Beta

- Renamed the local app identity to Resonance Logs - Global.
- Changed package, Tauri, Rust crate, window title, log, and database naming to the global line.
- Redirected update checks and release links to `donneeee/resonance-logs-global`.
- Added first-launch migration from the legacy CN AppData/database paths into the new global paths without overwriting existing global files.
- Marked the Modifiers history tab as WIP while modifier attribution accuracy work continues.
