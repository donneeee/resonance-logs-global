# Changelog

## v1.1.3 - Global

- Updated package, Tauri, Rust crate, lockfile, and window-title metadata for the `v1.1.3` release build.
- Fixed Season Cultivate SkillCast factor counters so Blast Shot and other cast-based factors can count deduped local cooldown-start packets when the client cast packet is missed, while preserving duplicate-count protection.
- Fixed saved-history scene labels so dungeon and raid difficulty display follows the Rich Presence scene mapping, including Master dungeon labels such as `M1`.
- Tightened Twin Striker spec detection so the common `1605` skill can no longer classify Crimson players as Formless without stronger Formless-only evidence.
- Added a Network settings restart notice across supported locales for settings that only take effect after restarting the app.
- Added an Overlay tool notice with a direct link to Overlay settings so users know Skill Monitor and Monster Monitor must be enabled before overlay panels publish data.

## v1.1.2 - Global

- Updated package, Tauri, Rust crate, lockfile, and window-title metadata for the `v1.1.2` test build.
- Added Discord Rich Presence support with configurable presence text for idle, mobbing, boss combat, and floor-tanking states, plus Discord asset key support for scene/spec artwork.
- Expanded Discord Rich Presence scene handling so the main card image/title now follows the detected scene, difficulty, Stimen Vault floor, floor-tanking timer, compact DPS/death totals, and retained encounter state until a scene change.
- Reworked Discord Rich Presence updates to keep running from the main window even when the live meter is hidden, pace combat/death updates around Discord's rate limits, skip duplicate states, and explain that throttling in the settings hover text.
- Added a Discord Rich Presence DPS metric setting so users can choose DPS or true DPS, while keeping the separate encounter timer and wipe-persistent total death counter behavior.
- Added scene-change driven live/parser updates so towns, overworld areas, dungeons, raids, and line/instance transitions can update immediately without waiting for combat damage.
- Added Discord scene mappings for current overworld areas, Stimen Vaults, Guild Center/Hunt, World Boss Crusade, Illusion-Shroud Woods, seasonal raid difficulties, Wondrous Tag, City Rally, and Ee-chan, Don't Stare at Me!.
- Added generated Discord-ready scene and spec assets, including corrected DPS/healer/tank spec coloring and dedicated Twin Striker Crimson/Formless icons.
- Fixed live/main/overlay window placement persistence so saved window positions load correctly on app start again.
- Fixed Twin Striker spec icon routing in the parser so Crimson/Formless and their legacy aliases use distinct class-spec artwork instead of the old Vanguard fallback.
- Hardened Module Calculator parsing and native scoring against malformed module attribute values so unusual synced module rows cannot crash the app during optimization.
- Reduced frontend bundle pressure by moving bulky generated lookup data to compact runtime JSON tables and restoring production minification for the app build.
- Continued CN 0.1.8 DBM parity work by wiring richer boss/mechanic snapshots through Global's shared overlay placement while keeping monster monitor output scoped to the current target.
- Refined overlay/window responsiveness and event pressure handling around DBM, monster monitor, background images, and live/main window dragging without reintroducing the WebView message flood path.

## v1.1.1 - Global

- Updated package, Tauri, Rust crate, lockfile, and window-title metadata for the `v1.1.1` release build.
- Condensed the full beta and release-candidate changelog line into this mainline release entry, covering the Global work since the previous main release.
- Merged and adapted the CN 0.1.7 / 0.1.8 dungeon/minimap/DBM work into Global while keeping Global's Npcap-only capture path, shared overlay placement, and existing overlay toggle/edit behavior.
- Moved Dungeon Boss Mechanics into the Overlay tool as the `DBM` tab, routed it through the shared overlay window, and expanded the minimap/mechanic pipeline with boss buff, teammate, mechanic, fantasy, stun/toughness, and minimap snapshots.
- Narrowed Monster Monitor boss-buff snapshots back to the current attack target to match CN's target-scoped behavior and prevent repeated debuffs from every visible monster from flooding the Monster Buff Area.
- Expanded saved-history views with redesigned summary panels, solid sticky table headers, scene details in Skill Details, graph timelines with horizontal guide lines, interactive legends, guide-line style controls, and better small-window scrolling behavior.
- Added live-window behavior and display controls including header/column aliases, summary-field aliases, suffix sizing, decimal/format controls, no-boss color controls, dynamic row behavior, always-show-self DPS row placement, and single-key hotkey opt-in warnings.
- Improved live and history player identity visuals with configurable imagine/ocean badge sizing, missing-imagine placeholders, ocean weapon Lv.200+ glow/tooltip behavior, local/remote equipment evidence, and restored Lucy/Natsu/Season 3 imagine skill labels.
- Reworked Phantom Factor tracking with generated factor data, grade-aware descriptions, community validation workbooks, equipped-factor gating, stale-source pruning, Reality lockout/duration separation, local active-effect buff candidates, and corrected Inspiration/Reality source behavior.
- Replaced grouped Food/Alchemy UUID clutter with category quick-listen controls and expanded localization coverage for overlay, DBM/minimap, buff monitoring, module calculator, settings, shell strings, and generated parser data across supported languages.
- Hardened packet capture and first-run reliability with Npcap DLL diagnostics/loading fixes, capture-settings repair, VPN/ExitLag diagnostic bundle data, scene-frame dedupe telemetry, capped retries, and cleaner release warnings.
- Reduced WebView2 `PostMessage` pressure and combat-time UI/FPS lag by coalescing noisy live/overlay emits, limiting packet backlog catch-up, deduping unchanged snapshots, reducing background/GIF repaint churn, and preserving high-priority lifecycle/reset updates.
- Added and refined overlay tools for Skill CD acceleration diagnostics, duration/resource/custom panels, HP/shield area settings, monster monitor teammate buffs/fantasy/stun/DBM panels, runtime debug capture, and shared overlay layout editing.
- Hardened settings/profile/local-file storage with corrupt-store preservation, selected save-location support for profiles/debug bundles/Event Logger files, settings repair/migration fixes, and installer AppData cleanup behavior that honors the uninstall checkbox directly.
- Fixed training-dummy mode, scene-change hold/clear behavior, live reset/timer stability, graph guide-line styling, custom GIF/image background persistence, and assorted parser/history/localization regressions found during the beta and RC test builds.

## v1.1.0_RC2 - Global Release Candidate

- Updated package, Tauri, Rust crate, lockfile, and window-title metadata for the `v1.1.0_RC2` release-candidate build.
- Added a generated Phantom Factor community validation workbook with separate tabs for all combat classes plus Polarity and Stasis, grade-driven descriptions, source offsets, trigger/counter evidence, and validation note/status columns.
- Normalized public factor/class naming from Twin Axe / Flame Vanguard to Twin Striker, and simplified Twin Striker spec labels to Formless and Crimson across generated data and supported UI locale surfaces.
- Expanded Phantom Factor extraction so Polarity and Stasis rows can use season effect descriptions when item-package factor rows are not enough.
- Refined factor counter behavior for duration-linked sources, including reset-buff proc counting, threshold proc suppression where needed, and a BuffUpserted source path for factors whose active buff refreshes instead of cleanly re-adding.
- Corrected the Marksman X10 factor text/trigger override so Blast Shot, not the mistranslated Explosive Arrow text, is treated as the energy source.
- Made Event Logger packet/session capture opt-in on every app start so diagnostic logging cannot remain enabled after a restart unless the user turns it back on.
- Reduced WebView2 `PostMessage failed` pressure by flushing only immediate lifecycle events between normal live snapshot ticks while preserving coalesced monitor, buff, and overlay updates.
- Fixed the final live DPS/timer snapshot after changing scenes with Clear Meter on Scene Change disabled, so the held parse no longer gets overwritten or delayed by the optimized snapshot cadence.
- Changed the uninstaller AppData cleanup to honor the Delete application data checkbox directly and removed the second confirmation pop-up, with the destructive warning shown in the checkbox text instead.
- Added a dirty-container precheck for Season Cultivate / Phantom Factor data so factor rules are refreshed only when the dirty packet can actually touch the season-cultivate tree, reducing unnecessary rule rebuilds during normal packet flow.
- Reworked selected Phantom Factor tracking around the equipped factor snapshot, selector dirty packets, removed item IDs, and cleared selector slots so stale factors are pruned from the backend counter rules instead of only being hidden in the overlay.
- Kept the explicit refresh behavior when the Season Cultivate tree itself changes, so factor rules still rebuild when the underlying Deep-Slumber / psychoscope state changes rather than relying on manual overlay refreshes.
- Gated Phantom Factor Inspiration energy sources to visible/selected factor rows so unequipped or stale source-side factor IDs can no longer keep feeding Reality factor energy after their row disappears from the overlay.
- Avoided recomputing the visible-factor source gate during every factor counter emit, preserving the stale-source fix without reintroducing combat-time CPU spikes.
- Reduced live runtime lag during packet bursts by ticking counter timers and actor-state lifecycle sampling once per packet batch instead of repeating that periodic work for every packet, while still processing each packet's damage/buff/factor changes individually.
- Reduced combat-time FPS and UI hitching by shrinking packet backlog catch-up slices, letting pending control commands interrupt packet drains, and allowing reset/pause/scene/training lifecycle events to bypass the normal noisy WebView snapshot budget.
- Reduced packet-capture CPU pressure outside active game traffic by caching game-process TCP classifications, throttling TCP table refreshes, skipping empty unknown payloads, and limiting non-game scene discovery to known login/address-change signatures.
- Kept the auto-hide live window WebView mounted while visually hidden, so incoming damage can restore the window without losing live runtime state or depending on a fully hidden native window to wake back up.
- Reduced live-window drag/repaint lag, especially with GIF backgrounds, by removing a duplicate always-running header animation-frame timer and isolating the custom background layer's paint/compositing work.
- Added focused backend tests for the stale-factor gate: hidden source rows are ignored, visible matching rows still feed energy, cleared selector slots suppress active-source fallback, and selected-factor mode does not borrow unrelated active-source IDs.
- Promoted local active effect/factor buff rows into buff-monitor display candidates when explicitly selected, restoring Photon Energy Enhancement and similar threshold/effect buffs without exposing those internal aliases in generic monitor-all views.

## v1.1.0_RC1 - Global Release Candidate

- Updated package, Tauri, Rust crate, lockfile, sidebar display, and window-title metadata for the `v1.1.0_RC1` release-candidate build.
- Added an advanced hotkey option to allow single-key global shortcuts, with an in-app warning that single-key hotkeys can override Windows or other application shortcuts.
- Routed live-window show/hide hotkey actions through native Rust commands for faster response and less frontend WebView message traffic.
- Reduced `PostMessage failed` / WebView2 queue pressure by coalescing pending live snapshot events, skipping hidden-window emits, clearing stale queued snapshots on reset, and deduping unchanged overlay/resource snapshots before they are emitted.
- Corrected Stasis X5 Phantom Factor proc/lockout matching to use the generated observed factor buff `3059050` instead of the unproven `3059051` mapping, so its proc timer can appear from live effect evidence.
- Made the live Training Dummy countdown tick from a local timer anchored to the latest backend state, so the visible header timer keeps counting down between combat packets while the backend still owns segment completion.
- Reduced live-window header/table flicker by limiting Training Dummy header countdown repaint churn and adding hysteresis to dynamic live-window height resizing.
- Resolved Lucy and Natsu Imagine short runtime damage IDs to their generated full damage IDs, restoring saved-history Skill Details names/icons/grouping for those transformation rows without a game-file rescan.
- Coalesced dynamic live-window resize calls so content-height jitter cannot flood WebView2/Tauri with `setSize` / constraint messages and trigger `PostMessage failed` quota errors.
- Hardened corrupt settings-store handling so unreadable or binary critical stores are detected, preserved instead of overwritten with defaults, and skipped by runtime monitor snapshot sync until they can be repaired.
- Fixed custom save-location handling for diagnostics bundles, profile-library files, and Event Logger session files by routing those operations through generated Tauri command bindings with the selected paths.
- Registered and persisted the Event Logger Events/Snapshots capture toggles in Rust, preventing the profile settings page from calling a missing command and allowing snapshot rows to be filtered separately from event rows.
- Fixed Npcap startup on systems with mismatched or stale `wpcap.dll` companion DLLs by loading the standard Npcap install path with DLL-load-dir search flags and removing the unqualified `wpcap.dll` fallback that could trigger a Windows entry-point dialog.
- Added a read-only Npcap diagnostic to Network settings showing the `wpcap.dll` path used for packet capture, plus the loader error when Npcap cannot be opened.
- Made custom background images more repair/update tolerant by remembering the originally selected file path as a fallback while still preferring the imported Local AppData copy for normal rendering.
- Fixed inflated Reality factor overlay proc counts, including Marksman Reality X4, by using the backend factor counter for thresholded Reality rows instead of noisy buff-layer fallback totals.
- Fixed Reality factor counters so thresholded Reality slots always consume the shared Inspiration energy pool, restoring Marksman Reality X6 proc counting from other active Inspiration sources.
- Separated Reality factor lockouts from linked effect-duration timers, so only descriptions with "Can trigger at most once within ..." freeze energy gain while no-lockout Reality effects can keep counting procs during their active duration.

## v1.1.0_beta5 - Global Beta

- Made Skill CD overlay timers prefer packet-reported active cooldown duration/progress over static cooldown calculations, using calculated cooldowns only when packet duration is missing.
- Fixed accelerated Skill CD timer display so packet cooldown duration remains the visible starting value while CD Boost / acceleration speeds local countdown progress, preventing Focus from starting too low or jumping when the next packet arrives.
- Kept packet-observed cooldown progress rate as Skill CD diagnostics while display progress uses packet progress checkpoints plus calculated cooldown acceleration.
- Fixed Skill CD timer drift caused by duplicate or stale cooldown packets refreshing the local receive anchor without advancing server progress, which could make Focus count down too slowly during continuous combat until a later packet snapped it closer to the in-game timer.
- Tightened monitored Skill CD interpolation by normalizing base/level cooldown IDs, preventing observed packet speed from leaking into a fresh cooldown cast, blending same-cooldown packet progress corrections from the calculated baseline, and adding compact runtime trace logging for monitored cooldown packets.
- Fixed selected talent matching for Skill CD acceleration sources that arrive as full node IDs, so Celestial Eagle-style nodes match their talent family and can apply haste-scaled Focus CD Boost.
- Applied the corrected Skill CD acceleration path through the shared Skill CD monitor so selected class skills and selected battle-imagine cooldown rows use the same packet checkpoint plus calculated acceleration display behavior.
- Hid the verbose Skill CD diagnostic hover text during normal overlay use; it remains available behind the existing Show Skill CD acceleration diagnostic toggle.
- Exposed raw packet cooldown ratio placeholders in Skill CD diagnostics and confirmed the current live cooldown sync path does not carry `subCdRatio`, `subCdFixed`, or `accelerateCdRatio`; those richer fields exist on a separate generated `SkillCdInfo` message and still need a packet bridge before they can drive timers.
- Fixed saved-history graph mode for new encounters by persisting a lightweight combat timeline at save time instead of relying on modifier replay rows, so Damage/Healing/Tanked graphs work without enabling the WIP modifier ledger.
- Clarified the saved-history graph empty state so older encounters without timeline samples explain that they cannot be backfilled and require a newly saved encounter.
- Expanded saved-history graph mode into a two-panel timeline with cumulative overall rate, moving-average rate, per-player lines, death markers, and total/average/peak legend values.
- Restyled saved-history graph mode with per-series high-contrast colors, transparent plot panels, lighter area fills, stronger dashed guide lines, and player-colored death markers so overlapping player lines and deaths are easier to distinguish.
- Rounded saved-history graph axis scales to clean tick values and trimmed `.0` suffixes from compact axis labels.
- Made saved-history graph legend entries interactive so individual player lines can be toggled on/off without changing the saved encounter.
- Preserved local equipped-item and profession-skill metadata across partial character syncs, encounter resets, and modifier-state cleanup so local imagine badges do not intermittently disappear from newly saved history rows.
- Added an opt-in Skill CD acceleration diagnostic overlay badge and tooltip so cooldown reduction/acceleration sources can be checked against the live cooldown timer.
- Expanded Skill CD cooldown diagnostics to include the matched cooldown attr/temp-attr source rows, scope, raw skill tag IDs, and calculated cooldown source mode, and to apply parsed acceleration while cooldown timers advance between packets.
- Added generated localized skill tag labels to Skill CD diagnostics so tag-scoped cooldown sources show names such as Expertise Skill and Haste instead of raw IDs only.
- Kept selected profession talent-node snapshots available outside the WIP modifier ledger and included active talent IDs in Skill CD diagnostics, so cooldown-reduction tests can compare timers against the player's actual selected talents before talent math is applied.
- Kept selected psychoscope/Season Medal nodes available outside the WIP modifier ledger and applied Swiftflow's Endless Mind CD Boost as cooldown acceleration for Expertise-tagged skills.
- Added a dev raid/class gear set effect audit that gathers localized 2401xxx-2409xxx set descriptions, class/spec grouping, 2-piece/4-piece thresholds, cooldown/duration/speed/trigger categories, and the requirement to prove each player's active suit counts up to 6 equipped pieces before applying set-effect math.
- Added a runtime gear-set evidence bridge for local character syncs, exposing `SuitInfoDict` / `SuitAttr` suit-family data through live/history/debug entity payloads so cooldown and factor rules can be wired from proven equipped-set state instead of static assumptions.
- Added gear-set evidence rows to Skill CD diagnostics so cooldown tests can show the observed suit family and raw suit attrs in the hover tooltip before any gear-set cooldown math is enabled.
- Hardened first-launch settings repair after upgrades from older `1.0.x` installs by saving the final normalized store state, restarting repaired frontend stores, and broadcasting a settings refresh so users do not need a second install or AppData reset for new UI settings to apply.
- Hardened native packet-capture startup after skipped/restored upgrades by validating saved Npcap adapters, repairing missing/stale/empty `packetCapture` stores before capture starts, and syncing packet-capture settings to both Roaming and Local AppData stores.
- Made Season Cultivate / Phantom Factor counters grade-aware by deriving per-item grade metadata, resolved descriptions, factor IDs, thresholds, and energy grants from generated factor data, so Reality factors use the selected `G#` threshold instead of a shared fallback.
- Enlarged live/history battle-imagine and ocean-weapon badges, strengthened T1-T4 imagine glows, restored live-window imagine badge hover hit-testing, corrected the Lv.200 ocean weapon ID family mapping, and made ocean weapon hover text use a single localized tooltip.
- Derived local-player ocean weapon badge levels from equipped item breakthrough data while keeping remote-player ocean badges on the safest config-family fallback when only slot/config ID is available.
- Expanded the dev-only remote equipment probe to decode raw team/social equipment item rows directly, so future Event Logger exports can show whether remote ocean weapons carry hidden level or breakthrough fields beyond slot/config ID.
- Prevented saved-history player UID hover text from stacking on top of battle-imagine and ocean-weapon badge tooltips.
- Changed custom background image handling to copy selected files into Local AppData and store only the imported file path/display name in settings, while keeping legacy data-URL backgrounds readable.
- Fixed path-based custom background images, including GIF backgrounds, not rendering after selection by loading imported AppData images through a runtime-only image URL while keeping settings JSON path-only.
- Added supported-locale strings for ocean weapon levels, saved-history graph mode buttons, graph death markers, and graph bucket/window settings.
- Added supported-locale strings for the Target Dummy timer toggle, duration slider, and countdown tooltip.
- Removed the hardcoded CN live-reset toast fallback so missing locale data falls back to English instead of untranslated CN text.
- Added a timer column to the Season Cultivate / Phantom Factor custom monitor rows, showing active cooldown/tick/freeze timers beside proc and Illusion Energy values, with localized Timer headers across supported UI locales.
- Smoothed Season Cultivate / Phantom Factor overlay countdown updates and guarded the shared overlay clock against tight reschedule loops when timers land exactly on an interval boundary.
- Replaced grouped buff Food/Alchemy UUID clutter with category quick-listen controls so grouped monitor setup matches the cleaner individual-mode category flow.
- Added user-editable label aliases for live/history meter columns and live header Total Damage / Total DPS labels.
- Added live header suffix-size and "No Boss" text color controls, and made history summary field visibility, aliases, and font-size settings target the summary renderer fields that actually display.
- Added an optional "Always show your DPS row" live behavior setting that shows a copied local DPS row only when the normal row is not fully visible, supports bottom-of-list (default), top-of-list, and above-header placement modes, shows a localized rank badge in place of battle-imagine badges, keeps the ocean weapon badge visible, and renders the bottom-pinned row as a solid footer layer for readability.
- Added a red missing battle-imagine slot marker for players with exactly one battle imagine equipped, using the same badge size/scale settings as equipped imagine badges.
- Redesigned saved-history summary panels for team and individual breakdowns with compact grouped sections, tab-aware Damage/Healing/Tanked fields, and colored metric labels.
- Added saved-history Skill Details scene metadata under the selected player header, with wrapping long text and a responsive layout fix for narrowed windows.
- Added horizontal graph guide lines aligned to generated left-axis values so saved-history graph totals are easier to read.
- Reinforced saved-history sticky table headers with opaque layered backgrounds so player, skill, and modifier rows no longer bleed over column headers while scrolling.
- Improved small-window saved-history scrolling so the final rows can scroll fully into view after the summary/header wraps.
- Filled missing supported-locale coverage for beta6 UI additions, including saved-history graph/modifier strings, skill-monitor countdown alerts, custom panel controls, HP/shield area controls, and shell labels, and expanded the locale integrity audit to catch mojibake.
- Added HP/shield area settings for the shared overlay, including toggles for HP, total shield, and shield-detail rows plus bar sizing, spacing, and color controls.
- Added optional zero-counter hiding for custom panel factor/counter rows so inactive factor counters can stay out of the overlay until they have visible state.
- Fixed packet capture scene-server detection so multi-stream traffic no longer repeatedly emits synthetic server-change resets that could clear the meter, flood logs, or trigger WebView message quota pressure.
- Adapted CN 0.1.6 packet-capture optimizations for Global's Npcap path, including immediate-mode/BPF capture setup, batched packet dispatch, bounded capture-event delivery, idle stream cleanup, and game-process flow filtering while preserving Global's scene-proven parser guards.
- Fixed installed beta6 packet capture startup on systems whose Npcap/Wpcap DLL does not expose newer optional capture symbols, falling back to the older compatible startup path instead of restarting capture every second with `GetProcAddress` failures.
- Restored self-only monster/on-hit monitoring for local-owned or unknown-source buff rows while still filtering known other-player sources, fixing Steel Beak and similar non-boss monster monitor rows.
- Made the Clear Meter on Scene Change setting protect monster, teammate, modifier, and training-dummy runtime monitor state before any scene-change cleanup runs, so disabling it also prevents monitor overlays from being wiped.

## v1.1.0_beta4 - Global Beta

- Updated package, Tauri, Rust crate, lockfile, and window-title metadata for the `1.1.0_beta4` beta release.
- Corrected Earthfort spec styling to use the tank/blue accent instead of DPS/gold coloring.
- Excluded Dark Mist Fortress Divine Defense Tower objective entities from boss HP/boss metric display, including localized saved-history boss-name filtering.
- Shared Rage Cleave stage labeling between history/detail rows and the Twin Axe Skill CD monitor so the 1608-1611 variants display localized stage suffixes.
- Corrected Twin Axe factor/class presentation labels and marked expired Rhapsody factor rows for Season 3 in Season Cultivate factor audit exports.
- Reinstated live-only True Boss DPS as a toggleable/reorderable DPS player column, using boss-only damage over the same active combat timer as True DPS while keeping saved history unchanged.
- Moved Module Calculator filter/profile selections into the active profile while migrating the older per-index Module Calculator memory bucket when present.
- Improved live DPS timing so rows visually age between backend packets, large sessions throttle visual refresh, and idle/no-change or dungeon-objective boundary pauses stop DPS decay when encounter activity ends.
- Widened the live Boss header row so long boss/objective names and HP summaries use the full header width before truncating.
- Added/expanded auto-hide controls: visible overlays can follow live-window auto-hide, manual live-window minimization stays respected, and profile game-inactive auto-hide hides live/overlays only while neither Blue Protocol: Star Resonance nor Resonance Logs - Global is the foreground window.
- Stabilized live/history sticky table headers and column rendering across normal live view, dynamic live view, live skill breakdowns, tanked drilldowns, and history detail tables so headers stay pinned/opaque and settings changes apply while the live window is open.
- Normalized older/restored/skipped-update settings stores at startup, including malformed live DPS column visibility/order/sorting JSON, so users do not need to delete AppData to recover column toggles.
- Centralized startup settings-store repair so new additive setting keys are written into existing AppData JSON automatically, and normalized single-profile library JSON files on load/save for safer upgrades from older versions.
- Expanded the Settings > Debug diagnostics bundle with redacted frontend/backend settings-store snapshots, store paths, AppData/config file summaries, and column-visibility issue detection so restored-settings bugs can be diagnosed from user-submitted debug ZIPs.
- Added live-style column reordering to DPS Meter > Meter Settings > History, including persisted per-profile history column-order stores, startup normalization for older profiles, diagnostics coverage, and ordered rendering in saved-history player and skill detail tables.
- Made Skill CD overlay timers prefer packet-reported cooldown duration/progress over static calculated cooldowns, improving accuracy when psychoscopes or talents modify cooldowns.

## v1.1.0_beta3 - Global Beta

- Updated package, Tauri, Rust crate, lockfile, and window-title metadata for the `1.1.0_beta3` beta release.
- Guarded Season Cultivate factor counters against dungeon-start/bootstrap cooldown snapshots so Illusion Energy no longer jumps from stale skill cooldowns when a run or floor starts.
- Fixed Season Cultivate SkillCast factor overcounting by counting local cooldown-start edges instead of repeated `attr_skill_id` echoes, so Blast Shot and similar cast-based factors no longer double count.
- Reduced live-runtime memory and CPU churn by keeping Event Logger/probe rows fully off unless enabled, avoiding full `live-data` payload clones on every tick, adding WebView emit backoff for invalid window states, and gating persisted modifier timing ledgers behind the WIP modifier opt-in.
- Preserved known player identity/name maps across resets; a tested reset-prune optimization was reverted because it caused known players to fall back to UID labels and did not release the reported RAM growth.
- Kept live and history table headers pinned while scrolling so column labels stay visible and only the data rows move underneath them.
- Removed the WinDivert capture path, bundled WinDivert binaries, service cleanup hooks, and capture-method selector; packet capture now uses Npcap only, matching the CN 0.1.5 capture model.

## v1.1.0_beta2 - Global Beta

- Updated package, Tauri, Rust crate, lockfile, and window-title metadata for the `1.1.0_beta2` beta release.
- Fixed live meter hotkey/sidebar/tray show behavior so the live window can appear without stealing game focus, while still becoming clickable afterward.
- Restored overlay edit-mode exit behavior so the overlay returns to its previous visible/hidden state instead of staying on after editing.
- Fixed Dynamic Live Window row capping by measuring actual rendered live-table rows, preventing the player list from clipping before the configured visible-player count.
- Kept live table column headers pinned at the top while scrolling beyond the Dynamic Live Window row cap.
- Made the live refresh-rate setting affect the backend idle update loop as well as active packet updates, reducing cases where live stats felt stuck on a coarse delay.
- Reconciled Auto-hide Live Window with manual show/toggle actions so auto-hidden windows no longer require a double toggle to reappear.
- Forced auto-hidden live windows into cursor-ignore mode before hiding so an invisible live meter cannot block game clicks.
- Added a UUID compatibility boundary for saved history: new entity blobs prefer UUID keys, older UID-keyed history still loads, and history detail URLs now preserve UUID sidecars alongside existing UID params.
- Ported the safe CN 0.1.5 beta data and live-parser updates into Global while keeping the Global app identity and existing Global localization flow.
- Expanded official data coverage with new counter source/slot templates, class skill configs, buff names, scene names, damage attribute names, aoyi icons, and CN-only logic table additions.
- Added New Factor/Season Cultivate monitor support with automatic active-factor rows, compact Reality/Inspiration/Stasis sorting, skill-aware labels, proc counts, timer bars, and localized factor display names across supported UI locales.
- Fixed factor energy/proc inference so skill-cast factor sources count from local cooldown-start packets, source rows do not cross-count unrelated factor energy, thresholdless timer/effect rows no longer reset source buckets, and durationless Stasis signals do not inflate proc totals.
- Improved Tanked reports with source/monster aggregation, monster drilldown into damage-taken skills, lucky/block/lucky-block style rate fields, and localized history/live detail columns and values.
- Added ally buff/monster monitor support from the CN merge, including teammate buff display plumbing and refreshed monster overlay localization strings.
- Added event logger and probe tooling for factor-energy packet investigations, plus a reusable Tauri static dev server path so stale dev servers no longer block beta testing.

## v1.0.9 - Global

- Kept Skill CD hover cards inside the app window and widened them so longer descriptions are readable without clipping offscreen.
- Replaced native `title` hover text with persistent app-rendered tooltips globally, so pressing keys such as Ctrl no longer dismisses hover text during screenshots.
- Added fallback descriptions for Rage Cleave variant IDs and a no-source notice for Lethal Shot when the game data exposes the skill name but no standalone tooltip text.
- Localized the Shield Knight Shattered Illusion child buff damage row so user parses no longer show the raw `虚妄裁定-子BUFF技能` label in skill details.
- Added an optional Dynamic Live Window setting under Settings > Themes > Live with enable/disable and a 5-20 visible-player cap; live tables grow to the cap and the player table becomes scrollable beyond it.
- Added Live-only General settings to auto-hide the live window until damage is detected, show it when live damage appears, and hide it again after a configurable no-new-damage delay.
- Localized the new live parser UI settings for Dynamic Live Window, Clear Meter on Scene Change, Auto-hide Live Window, and Auto-hide Delay across supported UI locales.
- Moved the live Boss section onto its own header row in both classic and custom header layouts, widened the spacing between T.DMG and T.DPS, and filtered boss HP display to the active/top-HP boss tier so low-HP mechanics no longer crowd out the real encounter boss.
- Localized design-only shield buff names used by the health/shield overlay, including Life Barrier Shield, so the live overlay follows the selected locale instead of showing raw Chinese design labels.
- Hardened Module Calculator startup when the game/module data is unavailable, with separate refresh/calculation/GPU loading states, timeouts, and friendlier no-data errors.
- Hardened Module Calculator against GPU driver probe hangs, falling back to CPU mode when GPU availability cannot be confirmed, and reduced generated-data build chunks by loading bundled skill names as a static JSON asset.
- Deferred automatic Module Calculator GPU checks until module data is synced, added a manual GPU recheck for driver updates, and removed the native one-shot GPU probe cache so a stale or stuck first probe cannot poison later checks.
- Stopped Module Calculator from auto-starting a module-data refresh on page open, kept remembered profile filters from touching transient refresh state, and added a refresh watchdog so a hung module-data read cannot leave the page stuck on "Checking module data...".
- Changed Module Calculator Refresh Data to return a lightweight module status/count response instead of the full module list, so successful backend parses can update the UI without getting stuck after module deserialization.
- Made Module Calculator Refresh Data recover from stale calculation state and show its current refresh phase in the Data Status card, with backend breadcrumbs for status request start, worker start, parse completion, and count readiness.
- Hardened the Module Calculator status response parser so Refresh Data accepts camelCase, snake_case, or generated-result payloads and reports unexpected payloads visibly instead of silently leaving the UI at Not Synced.
- Deduped Module Calculator profile persistence so synced module counts cannot trigger repeated settings writes, and decoupled Refresh Data from GPU probing so the refresh button only refreshes module status; GPU checks now run from the manual Check GPU action.
- Reworked Module Calculator filter/profile memory to save from explicit control-change callbacks instead of a broad page-level reactive effect, keeping remembered filters out of the Refresh Data response path.
- Temporarily disabled Module Calculator profile-backed filter memory while investigating the page-entry lock, so entering the tool and refreshing data no longer reads or writes the shared skill-monitor profile store.
- Restored Module Calculator filter memory through a separate lightweight per-profile Module Calculator settings store, avoiding shared skill-monitor profile writes that could kick live runtime sync while the calculator page is open.
- Reduced noisy live Skill CD dev logging so large cooldown packets no longer dump hundreds of IDs/payload rows into normal app logs while the parser is active.
- Fixed Windows CUDA native builds by moving the CMake CUDA scratch/build directory out of Cargo's long build-script hash path, preventing MSBuild FileTracker path failures and restoring the `module_optimizer_cuda` static library link.
- Fixed Unbound Meteor recount icons so live/history skill rows use the actual Flame Berserker skill icon instead of the basic attack icon.
- Corrected Twin Axe Skill CD selection icons for Axe Wind, Wildfire Dance, and Unbound Meteor to match their in-game skill icons.
- Fixed Formless Flame Slash and Great Crimson Lotus proc icons so their recount and detail rows use the talent icons that enable them.
- Corrected Formless Flame Slash proc icons to use the Wildfire Dance trigger talent icon.
- Added a Skill CD overlay display option to hide tracked skill slot outlines and active-skill glow while keeping the current look enabled by default.
- Hardened update handling so Global ignores stale CN release payloads and only shows update prompts from `donneeee/resonance-logs-global`.
- Prevented vertical resizing while Dynamic Live Window is enabled, so player-table overflow no longer leaves transparent dead click space below the meter.
- Added a Fit Width background image mode that scales the image to meter width and reveals more of it as the live window grows downward.
- Split Skill CD slot outlines from enhanced-skill glow, keeping the gold enhanced glow visible for skills such as Unbound Meteor even when static slot outlines are hidden.
- Fixed Phantom Falcon AoE skill breakdown rows so they use the Phantom Falcon talent name/icon instead of a raw design label.
- Localized additional Death Replay monster and mechanic damage rows found in saved encounter history, with audit tooling to scan current history chunks for visible localization gaps.
- Kept passive live meter and overlay windows from stealing focus when shown through hotkeys, tray actions, or sidebar toggles, so controller input stays registered by the game.

## v1.0.7 - Global

- Updated package, Tauri, Rust crate, lockfile, and window-title metadata for the `1.0.7` release.
- Refreshed generated parser data and icon coverage from the latest game files, including skill, buff, item, monster, scene, modifier, resonance/imagine, class/spec, talent, and Phantom Factor assets.
- Added generated spec icon output and wired Name-Spec display modes to show spec icons in live, history, shared player info, and death replay views.
- Tinted spec icons with the same role palette as class icons: DPS red, support/healer green, and tank blue.
- Expanded skill monitor class/spec coverage and localization support so more skills, talents, and icons resolve through generated data instead of hardcoded/manual rows.
- Cleaned up skill monitor hover descriptions with readable generated tooltip sections, removed trailing tips text, fixed missing descriptions on first app start, and replaced native browser titles with stable app-owned tooltips.
- Fixed an overlay startup edge case where monitor settings could show the overlay window after a later settings write even when `Start with App` was off.
- Improved resonance skill search by matching description text too, making imagine/resonance entries easier to find when the visible skill name is not the searched name.
- Fixed several localization and naming fallbacks, including Twin Axe no longer displaying as Flame Berserker when only the class fallback is known.
- Improved Name-Spec recovery for nearby players by inferring specs from selector/passive evidence even when WIP modifier parsing is disabled.
- Fixed live ability-score/season-strength spacing so abbreviated `k` values no longer clip in player rows.
- Fixed Buff Uptime tracking so it works independently from Buff Monitor selections and refreshes immediately when monitor settings change or clear.
- Fixed missing season strength in live/player parse rows by retaining positive identity attrs on encounter entities and ignoring zero/default attr-cache values when a known value already exists.
- Kept WIP modifier parsing behind the explicit opt-in switch and tightened the disabled path so live parsing skips factor/effect source derivation, selected-factor cache sync, and modifier temp-attr source lookups when modifier reports are off.
- Improved modifier source/reportability handling for factor, talent, and spec-owned rows while keeping unresolved modifier work marked as WIP.
- Restored scrollability for Module Calculator filter settings.
- Built the `Resonance Logs - Global_1.0.7_x64-setup.exe` NSIS installer; updater artifacts still require `TAURI_SIGNING_PRIVATE_KEY` when publishing.

## v1.0.6_beta5 - Global Beta

- Stabilized monitor runtime startup so saved monitor settings apply even when the backend snapshot is corrupt or stale.
- Hardened live reset behavior so parsing resumes cleanly and stale meter totals clear immediately.
- Improved history responsiveness with compact persisted entity summaries and lighter default history loads.
- Fixed boss/elite aggregate display and filtered Rock Serpent crystal mechanics out of boss metrics.
- Restored monster-monitor event routing in the embedded game overlay.
- Fixed the health and shield overlay area localization and HP refresh behavior.
- Kept WIP modifier analysis behind the explicit opt-in switch.

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
