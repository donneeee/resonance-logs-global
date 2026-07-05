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

const SCENE_GROUPS = [
  {
    assetKey: "scene_asterleeds",
    displayName: "Asterleeds",
    keywords: ["asterleed", "asterleeds", "asteris"],
    pathPrefixes: [
      "ui/textures/scenemaps/cty001/",
      "ui/textures/scenemaps/cty001new/",
    ],
  },
  {
    assetKey: "scene_starland",
    displayName: "Starland",
    keywords: ["starland", "star_land", "starwander", "blueland"],
    pathPrefixes: [
      "ui/textures/scenemaps/blueland001/",
      "ui/textures/scenemaps/arn001/",
    ],
  },
  {
    assetKey: "scene_guild_center",
    displayName: "Guild Center",
    keywords: ["guild_center", "guildhall", "guild_hall", "guild center", "guild hall", "union"],
    pathPrefixes: [
      "ui/textures/scenemaps/union_001/",
      "ui/textures/scenemaps/union_activity_001/",
    ],
  },
  {
    assetKey: "scene_guild_hunt",
    displayName: "Guild Hunt",
    keywords: ["guild_hunt", "guild hunt", "unionhunt", "union_hunt", "weekly_hunt"],
  },
  {
    assetKey: "scene_world_boss_crusade",
    displayName: "World Boss Crusade",
    keywords: ["worldboss", "world_boss", "world boss", "crusade", "golem"],
    pathPrefixes: [
      "ui/textures/scenemaps/dng_worldboss_001/",
      "ui/textures/scenemaps/dng_worldboss_002/",
      "ui/textures/scenemaps/dng_worldboss_003/",
    ],
  },
  {
    assetKey: "scene_homestead",
    displayName: "Homestead",
    keywords: ["homestead", "home_stead", "house", "housing"],
    pathPrefixes: ["ui/textures/scenemaps/home_system_outdoor_001/"],
  },
  {
    assetKey: "scene_asteria_plains",
    displayName: "Asteria Plains",
    keywords: ["asteria", "asteria_plains", "asteria plain"],
    pathPrefixes: [
      "ui/textures/scenemaps/fld001/",
      "ui/textures/scenemaps/fld001_east/",
      "ui/textures/scenemaps/fld001_north/",
    ],
  },
  {
    assetKey: "scene_bahamar_highlands",
    displayName: "Bahamar Highlands",
    keywords: ["bahamar", "bahamar_highlands", "bahamar highland"],
    pathPrefixes: ["ui/textures/scenemaps/fld002/"],
  },
  {
    assetKey: "scene_underground_district",
    displayName: "Underground District",
    keywords: ["underground_district", "underground district", "underground"],
    pathPrefixes: ["ui/textures/scenemaps/fld001_04_underground/"],
  },
  {
    assetKey: "scene_windhowl_canyon",
    displayName: "Windhowl Canyon",
    keywords: ["windhowl", "wind_howl", "windhowl_canyon", "wind canyon", "windfield"],
    pathPrefixes: ["ui/textures/scenemaps/fld003/"],
  },
  {
    assetKey: "scene_skimmers_lair",
    displayName: "Skimmer's Lair",
    keywords: ["skimmer", "skimmer_lair", "skimmers_lair", "skimmer's lair", "darkblue", "underwater"],
    pathPrefixes: ["ui/textures/scenemaps/fld001_05_underwater/"],
  },
  {
    assetKey: "scene_duskdye_woods",
    displayName: "Duskdye Woods",
    keywords: ["duskdye", "dusk_dye", "duskdye_woods", "bloomlight", "colorfulforest"],
    pathPrefixes: ["ui/textures/scenemaps/fld002_00_colorfulforest/"],
  },
  {
    assetKey: "scene_everfall_forest",
    displayName: "Everfall Forest",
    keywords: ["everfall", "ever_fall", "everfall_forest", "gleamfall", "imaginedforest", "mistyforest"],
    pathPrefixes: [
      "ui/textures/scenemaps/fld002_03_imaginedforest/",
      "ui/textures/scenemaps/fld001_06_mistyforest/",
    ],
  },
  {
    assetKey: "scene_moonshadow_wilds",
    displayName: "Moonshadow Wilds",
    keywords: ["moonshadow", "moon_shadow", "moonshadow_wilds", "moonshade"],
    pathPrefixes: ["ui/textures/scenemaps/dng_dmj_003/"],
  },
  {
    assetKey: "scene_stray_starway",
    displayName: "Stray Starway",
    keywords: ["stray_starway", "stray starway", "straystarway"],
    pathPrefixes: ["ui/textures/scenemaps/dng_dmj_004/"],
  },
  {
    assetKey: "scene_sunset_wilds",
    displayName: "Sunset Wilds",
    keywords: ["sunset_wilds", "sunset wilds", "sunset"],
    pathPrefixes: ["ui/textures/scenemaps/dng_dmj_005/"],
  },
  {
    assetKey: "scene_sunken_corridor",
    displayName: "Sunken Corridor",
    keywords: ["sunken_corridor", "sunken corridor", "sunken"],
    pathPrefixes: ["ui/textures/scenemaps/dng_dmj_001/"],
  },
  {
    assetKey: "scene_gloomy_depths",
    displayName: "Gloomy Depths",
    keywords: ["gloomy_depths", "gloomy depths", "gloomy"],
    pathPrefixes: ["ui/textures/scenemaps/dng_dmj_002/"],
  },
  {
    assetKey: "scene_stimen_vaults",
    displayName: "Stimen Vaults",
    keywords: ["stimen", "stimen_vault", "stimen vault", "stimen_ruin", "stimen ruin", "dng_twr"],
    pathPrefixes: [
      "ui/textures/scenemaps/dng_twr_001/",
      "ui/textures/scenemaps/dng_twr_002/",
    ],
  },
  {
    assetKey: "scene_illusion_shroud_woods",
    displayName: "Illusion-Shroud Woods",
    keywords: [
      "illusion_shroud",
      "illusion shroud",
      "illusion-shroud",
      "delirium",
      "psychoscope",
      "phantom",
    ],
  },
];

const ART_HINTS = [
  "bg",
  "background",
  "banner",
  "picture",
  "photo",
  "pic",
  "scene",
  "scenic",
  "map",
  "world",
  "loading",
  "login",
  "title",
  "main",
  "cover",
  "panel",
  "texture",
];

const LOW_VALUE_IMAGE_HINTS = [
  "_gray_mask",
  "_region_data",
  "/regions/",
  "map_attr",
  "chunk_info",
  "icon",
  "item",
];

const args = parseArgs(process.argv.slice(2));
const config = loadGeneratorConfig();
const gameRoot = args.game || config.gamePath;
const m0Path = resolveM0Package(gameRoot);
const containerDir = path.dirname(m0Path);
const metaEntries = loadMetaEntries(containerDir);
const outRoot = path.resolve(args.outDir || path.join(repoRoot, "DEV_exports/discord-scene-asset-candidates"));
const limitPerScene = Math.max(1, Number(args.limitPerScene || 80));
const decode = args.decode !== "false";
const includeNonUi = args.includeNonUi === "true";

fs.mkdirSync(outRoot, { recursive: true });
for (const group of SCENE_GROUPS) {
  fs.mkdirSync(path.join(outRoot, "scenes", group.assetKey), { recursive: true });
}

const matchedByScene = new Map(SCENE_GROUPS.map((group) => [group.assetKey, []]));
let scannedAddressCount = 0;
scanAddressCatalog(m0Path, (record) => {
  scannedAddressCount += 1;
  if (!includeNonUi && !isExportableTextureAddress(record.address)) {
    return;
  }
  const matched = matchScenes(record.address);
  for (const match of matched) {
    matchedByScene.get(match.group.assetKey)?.push({
      ...record,
      displayName: match.group.displayName,
      assetKey: match.group.assetKey,
      matchedKeyword: match.keyword,
      score: scoreAddress(record.address, match.keyword, match.kind),
    });
  }
});

const bundleByHash = new Map();
const items = [];
const manifestRows = [];
const failures = [];

for (const group of SCENE_GROUPS) {
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

const planPath = path.join(outRoot, "scene-candidate-export-plan.json");
const resultPath = path.join(outRoot, "scene-candidate-export-result.json");
const manifestPath = path.join(outRoot, "scene-candidate-manifest.csv");
const summaryPath = path.join(outRoot, "scene-candidate-summary.md");

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

const sceneCounts = SCENE_GROUPS.map((group) => ({
  assetKey: group.assetKey,
  displayName: group.displayName,
  count: manifestRows.filter((row) => row.assetKey === group.assetKey).length,
  folder: path.join(outRoot, "scenes", group.assetKey),
}));

fs.writeFileSync(
  summaryPath,
  [
    "# Discord Scene Candidate Extraction",
    "",
    `Source package: ${m0Path}`,
    `Output root: ${outRoot}`,
    `Scanned address records: ${scannedAddressCount}`,
    `Export plan items: ${items.length}`,
    `Unique bundles: ${bundleByHash.size}`,
    `Limit per scene: ${limitPerScene}`,
    `Include non-UI assets: ${includeNonUi}`,
    "",
    "| scene | asset key | candidates | folder |",
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

function matchScenes(address) {
  const lower = String(address || "").toLowerCase();
  const matches = [];
  for (const group of SCENE_GROUPS) {
    const pathPrefix = (group.pathPrefixes ?? []).find((item) => lower.startsWith(item.toLowerCase()));
    if (pathPrefix) {
      matches.push({ group, keyword: pathPrefix, kind: "pathPrefix" });
      continue;
    }
    const keyword = group.keywords.find((item) => lower.includes(item.toLowerCase()));
    if (keyword) matches.push({ group, keyword, kind: "keyword" });
  }
  return matches;
}

function scoreAddress(address, keyword, kind) {
  const lower = String(address || "").toLowerCase();
  let score = 0;
  if (kind === "pathPrefix") score += 140;
  if (lower.includes(keyword.toLowerCase())) score += 100;
  for (const hint of ART_HINTS) {
    if (lower.includes(hint)) score += 8;
  }
  if (lower.startsWith("ui/textures/scenemaps/")) score += 36;
  if (lower.startsWith("ui/textures/")) score += 12;
  if (lower.startsWith("ui/background/")) score += 16;
  if (lower.startsWith("ui/atlas/")) score += 4;
  for (const hint of LOW_VALUE_IMAGE_HINTS) {
    if (lower.includes(hint)) score -= 45;
  }
  return score;
}

function isExportableTextureAddress(address) {
  const lower = String(address || "").toLowerCase();
  if (!lower.startsWith("ui/")) return false;
  if (lower.startsWith("ui/textures/scenemaps/")) {
    return !LOW_VALUE_IMAGE_HINTS.some((hint) => lower.includes(hint));
  }
  return true;
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
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    parsed[key] = value;
  }
  return parsed;
}
