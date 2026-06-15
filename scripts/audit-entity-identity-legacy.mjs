import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const scanRoots = ["src", "src-tauri/src"];
const allowedExtensions = new Set([".rs", ".svelte", ".ts", ".js", ".mjs"]);
const ignoredDirectories = new Set([
  "node_modules",
  "target",
  ".svelte-kit",
  "dist",
  "build",
  "gen",
  "generated",
]);

const patterns = [
  {
    id: "backend-uid-entity-lookup",
    re: /\bentity_(?:mut_)?by_uid(?:_or_insert_with)?\s*\(/g,
    note: "backend entity lookup by display UID",
  },
  {
    id: "backend-uid-entity-map",
    re: /\bentity_uid_to_entity\b/g,
    note: "backend entity storage keyed by display UID",
  },
  {
    id: "backend-uid-entry-iteration",
    re: /\bentity_uid_entries\s*\(/g,
    note: "backend entity iteration exposes display UID keys",
  },
  {
    id: "route-player-uid",
    re: /\bplayerUid\b/g,
    note: "live route or payload still carries playerUid",
  },
  {
    id: "history-char-id",
    re: /\b(charId|targetUid|targetUuid|charUuid)\b/g,
    note: "saved-history route identity compatibility",
  },
  {
    id: "victim-uid",
    re: /\bvictimUid\b/g,
    note: "death replay compatibility field",
  },
  {
    id: "source-target-uid",
    re: /\b(sourceUid|targetUid|ownerUid|attackerUid|topSummonerUid)\b/g,
    note: "combat source or target display UID compatibility",
  },
];

function normalize(filePath) {
  return filePath.split(path.sep).join("/");
}

function classify(file, lineNumber, lineText, patternId) {
  const normalized = normalize(path.relative(repoRoot, file));

  if (normalized === "src-tauri/src/live/entity_id.rs") return "identity-core";
  if (normalized === "src-tauri/src/live/opcodes_models.rs") return "identity-core";
  if (normalized === "src-tauri/src/live/event_manager.rs" && lineNumber >= 845) return "test-fixture";
  if (normalized === "src-tauri/src/live/event_manager.rs") return "live-payload-compat";
  if (normalized === "src-tauri/src/live/live_main.rs" && lineNumber >= 6350 && lineNumber <= 6900) return "debug-display";
  if (normalized === "src/lib/live-entity-route.ts") return "route-compat-helper";
  if (normalized === "src/lib/death-record-identity.ts") return "route-compat-helper";
  if (normalized === "src/lib/bindings.ts") return "generated-binding";
  if (normalized === "src/lib/api.ts") return "public-compat-type";
  if (normalized.startsWith("src/lib/history-modifier-report")) return "saved-history-compat";
  if (normalized.startsWith("src/lib/components/death-replay/")) return "death-replay-display";
  if (normalized.startsWith("src/lib/custom-trigger-")) return "custom-trigger-compat";
  if (normalized.startsWith("src/routes/game-overlay/")) return "overlay-source-compat";
  if (normalized.startsWith("src/routes/monster-overlay/")) return "monster-overlay-compat";
  if (normalized.includes("/history/")) return "saved-history-compat";
  if (normalized.includes("event-logger")) return "debug-display";
  if (normalized.includes("custom-definitions")) return "custom-uid-definition";
  if (normalized.includes("monster-display.svelte.ts") && lineText.includes("UID ")) return "display-label";

  if (
    patternId === "route-player-uid" &&
    (normalized.startsWith("src/routes/live/death/") ||
      normalized === "src/routes/live/tanked/+page.svelte")
  ) {
    return "route-compat-helper";
  }

  if (
    normalized === "src-tauri/src/live/live_main.rs" &&
    ((lineNumber >= 2360 && lineNumber <= 2760) ||
      (lineNumber >= 3990 && lineNumber <= 4095) ||
      (lineNumber >= 5710 && lineNumber <= 5750) ||
      (lineNumber >= 6110 && lineNumber <= 6135))
  ) {
    return "debug-display";
  }

  if (
    patternId === "route-player-uid" &&
    normalized.startsWith("src/routes/live/") &&
    (lineText.includes("routeIdentity") || lineText.includes("livePlayerRoute"))
  ) {
    return "route-compat-helper";
  }

  if (
    patternId === "source-target-uid" &&
    normalized.startsWith("src-tauri/src/live/") &&
    lineText.includes("_uid:")
  ) {
    return "payload-compat-field";
  }

  return "needs-review";
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      const nestedFiles = await walk(path.join(directory, entry.name));
      files.push(...nestedFiles);
      continue;
    }
    if (!entry.isFile()) continue;
    const fullPath = path.join(directory, entry.name);
    if (allowedExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

async function existingScanRoots() {
  const roots = [];
  for (const root of scanRoots) {
    const fullPath = path.join(repoRoot, root);
    try {
      const info = await stat(fullPath);
      if (info.isDirectory()) roots.push(fullPath);
    } catch {
      // Ignore missing roots so the script can run in partial checkouts.
    }
  }
  return roots;
}

const roots = await existingScanRoots();
const files = (await Promise.all(roots.map(walk))).flat();
const findings = [];

for (const file of files) {
  const text = await readFile(file, "utf8");
  const lines = text.split(/\r?\n/);
  for (const [lineIndex, line] of lines.entries()) {
    for (const pattern of patterns) {
      pattern.re.lastIndex = 0;
      if (!pattern.re.test(line)) continue;
      findings.push({
        file: normalize(path.relative(repoRoot, file)),
        line: lineIndex + 1,
        id: pattern.id,
        note: pattern.note,
        classification: classify(file, lineIndex + 1, line, pattern.id),
        text: line.trim(),
      });
    }
  }
}

const groups = new Map();
for (const finding of findings) {
  const group = groups.get(finding.classification) ?? [];
  group.push(finding);
  groups.set(finding.classification, group);
}

console.log("Entity identity legacy audit");
console.log("============================");
console.log(`Scanned files: ${files.length}`);
console.log(`Matched UID/compat surfaces: ${findings.length}`);
console.log("");

for (const [classification, entries] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`${classification}: ${entries.length}`);
}

const needsReview = groups.get("needs-review") ?? [];
if (needsReview.length > 0) {
  console.log("");
  console.log("Needs review");
  console.log("------------");
  for (const finding of needsReview.slice(0, 200)) {
    console.log(
      `${finding.file}:${finding.line} [${finding.id}] ${finding.note}: ${finding.text}`,
    );
  }
  if (needsReview.length > 200) {
    console.log(`... ${needsReview.length - 200} more`);
  }
}

if (process.argv.includes("--fail-on-review") && needsReview.length > 0) {
  process.exitCode = 2;
}
