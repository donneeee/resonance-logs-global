import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  loadGeneratorConfig,
  loadMetaEntries,
  readPkgEntry,
  resolveM0Package,
} from "../../BPSR-UID-Extractors/generator-common.mjs";

const ADDRESS_PREFIX = Buffer.from("address:");
const MAX_LINE_BYTES = 4096;

const repoRoot = process.cwd();
const betaRoot = path.resolve(repoRoot, "..");
const extractorRoot = path.join(betaRoot, "BPSR-UID-Extractors");

const MINI_GAME_GROUPS = [
  {
    assetKey: "scene_wondrous_tag",
    displayName: "Wondrous Tag",
    keywords: ["hideseek", "hide_seek", "hideandseek", "activity_carnival", "carnival_act"],
  },
  {
    assetKey: "scene_wondrous_mahjong",
    displayName: "Wondrous Mahjong",
    keywords: ["mahjong", "activity_carnival", "carnival_act"],
  },
  {
    assetKey: "scene_city_rally",
    displayName: "City Rally",
    keywords: ["parkour", "rally", "dancestage", "activity_carnival", "carnival_act"],
  },
  {
    assetKey: "scene_ee_chan_dont_stare_at_me",
    displayName: "Ee-chan, Don't Stare at Me!",
    keywords: ["stare", "activity_carnival", "carnival_act"],
  },
  {
    assetKey: "scene_wondrous_carnival_misc",
    displayName: "Wondrous Carnival Misc",
    keywords: ["activity_carnival", "carnival_act"],
  },
];

const PREFERRED_UI_PREFIXES = [
  "ui/textures/activity_carnival/",
  "ui/textures/recommendedplay/recommendedplay_tab/recommendedplay_tab_three/",
  "ui/textures/hideseek/",
  "ui/textures/large_ui/activity_carnival/",
  "ui/textures/large_ui/mahjong/",
  "ui/atlas/activity_carnival",
  "ui/atlas/hideseek",
  "ui/atlas/mahjong",
  "ui/atlas/mahjong_scene",
];

const SKIP_HINTS = [
  "localizetextures/",
  "hudnumber/",
  "prefabs/",
  "uieffect/",
  "helpsys/",
  "skill_hideseek/",
  "skill_vehicle/",
  "mahjong_settlement_text",
  "mahjong_settlement_num",
  "mahjong_main_btn",
  "mahjong_main_bureau",
];

const args = parseArgs(process.argv.slice(2));
const config = loadGeneratorConfig();
const gameRoot = args.game || config.gamePath;
const m0Path = resolveM0Package(gameRoot);
const containerDir = path.dirname(m0Path);
const metaEntries = loadMetaEntries(containerDir);
const outRoot = path.resolve(args.outDir || path.join(repoRoot, "DEV_exports/discord-minigame-asset-candidates"));
const limitPerScene = Math.max(1, Number(args.limitPerScene || 80));
const decode = args.decode !== "false";

fs.mkdirSync(outRoot, { recursive: true });
for (const group of MINI_GAME_GROUPS) {
  fs.mkdirSync(path.join(outRoot, "scenes", group.assetKey), { recursive: true });
}

const matchedByScene = new Map(MINI_GAME_GROUPS.map((group) => [group.assetKey, []]));
let scannedAddressCount = 0;
scanAddressCatalog(m0Path, (record) => {
  scannedAddressCount += 1;
  if (!isUsefulMiniGameAddress(record.address)) return;

  for (const match of matchMiniGameGroups(record.address)) {
    matchedByScene.get(match.group.assetKey)?.push({
      ...record,
      displayName: match.group.displayName,
      assetKey: match.group.assetKey,
      matchedKeyword: match.keyword,
      score: scoreAddress(record.address, match.keyword),
    });
  }
});

const bundleByHash = new Map();
const items = [];
const manifestRows = [];
const failures = [];

for (const group of MINI_GAME_GROUPS) {
  const sceneMatches = dedupe(
    matchedByScene.get(group.assetKey) ?? [],
    (item) => `${item.bundleHash}:${item.addressHash}:${item.address}`,
  )
    .sort((a, b) => b.score - a.score || a.address.localeCompare(b.address))
    .slice(0, limitPerScene);

  for (const [index, candidate] of sceneMatches.entries()) {
    const entry = metaEntries.get(candidate.bundleHash);
    if (!entry) {
      failures.push({
        assetKey: group.assetKey,
        displayName: group.displayName,
        address: candidate.address,
        error: `Missing meta entry for bundle ${candidate.bundleHash}`,
      });
      continue;
    }

    const bundleFile = path.join(outRoot, "bundles", `${candidate.bundleHash}.bundle`);
    if (!bundleByHash.has(candidate.bundleHash)) {
      fs.mkdirSync(path.dirname(bundleFile), { recursive: true });
      fs.writeFileSync(bundleFile, readPkgEntry(containerDir, entry));
      bundleByHash.set(candidate.bundleHash, bundleFile);
    }

    const basename = path.posix.basename(candidate.address);
    const pngFile = path.join(
      outRoot,
      "scenes",
      group.assetKey,
      `${String(index + 1).padStart(3, "0")}_${slugify(basename)}.png`,
    );
    items.push({
      AssetId: `${group.assetKey}:${candidate.address}`,
      ResourceType: "Texture2D",
      TextureName: basename,
      BundleFile: bundleFile,
      PngFile: pngFile,
      Address: candidate.address,
      BundleHash: candidate.bundleHash,
      SceneAssetKey: group.assetKey,
      SceneName: group.displayName,
      MatchedKeyword: candidate.matchedKeyword,
      Score: candidate.score,
    });
    manifestRows.push({
      assetKey: group.assetKey,
      displayName: group.displayName,
      candidateRank: index + 1,
      score: candidate.score,
      matchedKeyword: candidate.matchedKeyword,
      address: candidate.address,
      bundleHash: candidate.bundleHash,
      textureName: basename,
      pngFile,
    });
  }
}

const planPath = path.join(outRoot, "minigame-candidate-export-plan.json");
const resultPath = path.join(outRoot, "minigame-candidate-export-result.json");
const manifestPath = path.join(outRoot, "minigame-candidate-manifest.csv");
const summaryPath = path.join(outRoot, "minigame-candidate-summary.md");

fs.writeFileSync(
  planPath,
  `${JSON.stringify({ Items: items, Missing: failures, SourcePackage: m0Path }, null, 2)}\n`,
  "utf8",
);
writeCsv(manifestPath, [
  "assetKey",
  "displayName",
  "candidateRank",
  "score",
  "matchedKeyword",
  "address",
  "bundleHash",
  "textureName",
  "pngFile",
], manifestRows);

let decodeResult = null;
if (decode && items.length > 0) {
  const decoder = path.join(extractorRoot, "export_icon_pngs.py");
  decodeResult = spawnSync("python", [decoder, "--plan", planPath, "--result", resultPath], {
    cwd: extractorRoot,
    stdio: "inherit",
  });
  if (decodeResult.status !== 0) {
    console.warn(`Decoder exited with status ${decodeResult.status}`);
  }
}

const sceneCounts = MINI_GAME_GROUPS.map((group) => ({
  assetKey: group.assetKey,
  displayName: group.displayName,
  count: manifestRows.filter((row) => row.assetKey === group.assetKey).length,
  folder: path.join(outRoot, "scenes", group.assetKey),
}));

fs.writeFileSync(
  summaryPath,
  [
    "# Discord Mini-Game Candidate Extraction",
    "",
    `Source package: ${m0Path}`,
    `Output root: ${outRoot}`,
    `Scanned address records: ${scannedAddressCount}`,
    `Export plan items: ${items.length}`,
    `Unique bundles: ${bundleByHash.size}`,
    `Limit per scene: ${limitPerScene}`,
    "",
    "| mini-game | asset key | candidates | folder |",
    "| --- | --- | --- | --- |",
    ...sceneCounts.map((row) => `| ${row.displayName} | ${row.assetKey} | ${row.count} | ${row.folder} |`),
    "",
  ].join("\r\n"),
  "utf8",
);

console.log(`Scanned address records: ${scannedAddressCount}`);
console.log(`Export plan items: ${items.length}`);
console.log(`Unique bundles: ${bundleByHash.size}`);
console.log(summaryPath);
console.log(manifestPath);
console.log(planPath);
if (decode) console.log(resultPath);

function scanAddressCatalog(filePath, onRecord) {
  const stat = fs.statSync(filePath);
  const fd = fs.openSync(filePath, "r");
  const chunkSize = 8 * 1024 * 1024;
  const buffer = Buffer.allocUnsafe(chunkSize);
  let carry = Buffer.alloc(0);
  let position = 0;
  let lastPercent = -1;
  try {
    while (position < stat.size) {
      const bytesRead = fs.readSync(fd, buffer, 0, chunkSize, position);
      if (bytesRead <= 0) break;
      position += bytesRead;
      const data = carry.length
        ? Buffer.concat([carry, buffer.subarray(0, bytesRead)])
        : buffer.subarray(0, bytesRead);
      carry = processChunk(data, onRecord, false);
      const percent = Math.floor((position / stat.size) * 100);
      if (percent >= lastPercent + 20) {
        lastPercent = percent;
        console.log(`m0 scan ${percent}%`);
      }
    }
    processChunk(carry, onRecord, true);
  } finally {
    fs.closeSync(fd);
  }
}

function processChunk(data, onRecord, flush) {
  let offset = 0;
  while (offset < data.length) {
    const found = data.indexOf(ADDRESS_PREFIX, offset);
    if (found < 0) break;

    const end = findLineEnd(data, found);
    if (end >= data.length && !flush) {
      return data.subarray(found);
    }
    const lineBytes = data.subarray(found, end);
    if (lineBytes.length <= MAX_LINE_BYTES && looksAscii(lineBytes)) {
      const line = lineBytes.toString("utf8");
      const match = /^address:(.*?) ->>>> hash:(\d+) ->>>> bundleHash:(\d+)$/.exec(line);
      if (match) {
        onRecord({
          address: normalize(match[1]),
          addressHash: Number(match[2]) >>> 0,
          bundleHash: Number(match[3]) >>> 0,
        });
      }
    }
    offset = Math.max(found + 1, end + 1);
  }
  return !flush && data.length
    ? data.subarray(Math.max(0, data.length - ADDRESS_PREFIX.length + 1))
    : Buffer.alloc(0);
}

function isUsefulMiniGameAddress(address) {
  const lower = String(address || "").toLowerCase();
  if (!lower.startsWith("ui/")) return false;
  if (SKIP_HINTS.some((hint) => lower.includes(hint))) return false;
  return PREFERRED_UI_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function matchMiniGameGroups(address) {
  const lower = String(address || "").toLowerCase();
  const matches = [];
  for (const group of MINI_GAME_GROUPS) {
    const keyword = group.keywords.find((item) => lower.includes(item.toLowerCase()));
    if (keyword) matches.push({ group, keyword });
  }
  return matches;
}

function scoreAddress(address, keyword) {
  const lower = String(address || "").toLowerCase();
  let score = 0;
  if (lower.startsWith("ui/textures/activity_carnival/activity_carnival_tab/")) score += 160;
  if (lower.startsWith("ui/textures/hideseek/")) score += 150;
  if (lower.startsWith("ui/textures/large_ui/")) score += 145;
  if (lower.startsWith("ui/textures/recommendedplay/")) score += 120;
  if (lower.startsWith("ui/atlas/")) score += 70;
  if (lower.includes(keyword.toLowerCase())) score += 80;
  if (lower.includes("bg")) score += 15;
  if (lower.includes("main")) score += 12;
  if (lower.includes("picture") || lower.includes("pic")) score += 10;
  if (lower.includes("tab")) score += 8;
  return score;
}

function findLineEnd(buffer, start) {
  const max = Math.min(buffer.length, start + MAX_LINE_BYTES + 1);
  for (let index = start; index < max; index += 1) {
    const byte = buffer[index];
    if (byte === 0 || byte === 10 || byte === 13) return index;
  }
  return max;
}

function looksAscii(buffer) {
  for (const byte of buffer) {
    if (byte === 9) continue;
    if (byte < 32 || byte > 126) return false;
  }
  return true;
}

function normalize(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\0/g, "").trim();
}

function slugify(value) {
  const slug = String(value || "")
    .replace(/'/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .split("_")
    .filter(Boolean)
    .join("_");
  return slug || "candidate";
}

function dedupe(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function writeCsv(filePath, headers, rows) {
  const lines = [
    headers.map(quoteCsv).join(","),
    ...rows.map((row) => headers.map((header) => quoteCsv(row[header])).join(",")),
  ];
  fs.writeFileSync(filePath, `${lines.join("\r\n")}\r\n`, "utf8");
}

function quoteCsv(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      out._.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    const key = token.slice(2, eq === -1 ? undefined : eq).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    const value = eq === -1 ? argv[++index] : token.slice(eq + 1);
    out[key] = value ?? "true";
  }
  return out;
}
