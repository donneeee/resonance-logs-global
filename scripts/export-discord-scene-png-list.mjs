import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const sceneNamesPath = path.join(rootDir, "parser-data/generated/scenenames.json");
const exportDir = path.join(rootDir, "DEV_exports");

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

const currentDiscordGroups = [
  {
    key: "scene_asterleeds",
    displayName: "Asterleeds",
    sceneIds: [8, 5206],
  },
  {
    key: "scene_starland",
    displayName: "Starland",
    sceneIds: [11],
  },
  {
    key: "scene_guild_center",
    displayName: "Guild Center",
    sceneIds: [12000],
  },
  {
    key: "scene_guild_hunt",
    displayName: "Guild Hunt",
    sceneIds: [12011, 12012, 12013, 12014, 12015, 12018, 12019, 12022, 12023],
    difficultyBySceneId: {
      12011: "Hard",
      12012: "Normal",
      12013: "Easy",
      12014: "Normal",
      12015: "Hard",
      12018: "Normal",
      12019: "Hard",
      12022: "Normal",
      12023: "Hard",
    },
  },
  {
    key: "scene_world_boss_crusade",
    displayName: "World Boss Crusade",
    sceneIds: [12050, 12051, 12052],
  },
  {
    key: "scene_city_rally",
    displayName: "City Rally",
    sceneIds: [7004],
  },
  {
    key: "scene_wondrous_tag",
    displayName: "Wondrous Tag",
    sceneIds: [11001],
  },
  {
    key: "scene_ee_chan_dont_stare_at_me",
    displayName: "Ee-chan, Don't Stare at Me!",
    sceneIds: [12030, 12040],
  },
  {
    key: "scene_homestead",
    displayName: "Homestead",
    sceneIds: [30001, 40001],
  },
  {
    key: "scene_asteria_plains",
    displayName: "Asteria Plains",
    sceneIds: [7],
  },
  {
    key: "scene_bahamar_highlands",
    displayName: "Bahamar Highlands",
    sceneIds: [9],
  },
  {
    key: "scene_underground_district",
    displayName: "Underground District",
    sceneIds: [74],
  },
  {
    key: "scene_windhowl_canyon",
    displayName: "Windhowl Canyon",
    sceneIds: [73],
  },
  {
    key: "scene_skimmers_lair",
    displayName: "Skimmer's Lair",
    sceneIds: [75],
  },
  {
    key: "scene_duskdye_woods",
    displayName: "Duskdye Woods",
    sceneIds: [71],
  },
  {
    key: "scene_everfall_forest",
    displayName: "Everfall Forest",
    sceneIds: [72],
  },
  {
    key: "scene_moonshadow_wilds",
    displayName: "Moonshadow Wilds",
    sceneIds: [93],
  },
  {
    key: "scene_stray_starway",
    displayName: "Stray Starway",
    sceneIds: [94],
  },
  {
    key: "scene_sunset_wilds",
    displayName: "Sunset Wilds",
    sceneIds: [95],
  },
  {
    key: "scene_sunken_corridor",
    displayName: "Sunken Corridor",
    sceneIds: [91],
  },
  {
    key: "scene_gloomy_depths",
    displayName: "Gloomy Depths",
    sceneIds: [92],
  },
  {
    key: "scene_stimen_vaults",
    displayName: "Stimen Vaults",
    sceneIds: [...range(30101, 30175), 30200, ...range(31101, 31175), ...range(32101, 32160)],
  },
  {
    key: "scene_void_tinas_mindrealm",
    displayName: "Tina's Mindrealm",
    sceneIds: [1001, 1002, 1011, 1021, 1031, 1032, 1033, 1611, 1621, 1631, 1632, 1633],
    difficultyBySceneId: {
      1011: "Unstable",
      1021: "Unstable",
      1031: "Normal",
      1032: "Hard",
      1033: "Master",
      1611: "Unstable",
      1621: "Unstable",
      1631: "Normal",
      1632: "Hard",
      1633: "Master",
    },
  },
  {
    key: "scene_void_towering_ruin",
    displayName: "Towering Ruin",
    sceneIds: [1101, 1102, 1111, 1112, 1121, 1122, 1123, 1150, 1151, 1152, 1153, 1154],
    difficultyBySceneId: {
      1111: "Unstable",
      1112: "Unstable",
      1121: "Normal",
      1122: "Hard",
      1123: "Master",
      1150: "Master",
      1151: "Hard",
      1152: "Normal",
      1153: "Unstable",
      1154: "Unstable",
    },
  },
  {
    key: "scene_mistveil_hunting_ground",
    displayName: "Mistveil Hunting Ground",
    sceneIds: [5901, 6541, 6542, 6543, 6544, 6545],
    difficultyBySceneId: {
      6541: "Unstable",
      6542: "Unstable",
      6543: "Normal",
      6544: "Hard",
      6545: "Master",
    },
  },
  {
    key: "scene_cursed_radiant_tomb",
    displayName: "Cursed Radiant Tomb",
    sceneIds: [5910, 6511, 6512, 6513, 6514, 6515],
    difficultyBySceneId: {
      6511: "Unstable",
      6512: "Unstable",
      6513: "Normal",
      6514: "Hard",
      6515: "Master",
    },
  },
  {
    key: "scene_mech_facility",
    displayName: "Mech Facility",
    sceneIds: [6521, 6522, 6523, 6524, 6525],
    difficultyBySceneId: {
      6521: "Unstable",
      6522: "Unstable",
      6523: "Normal",
      6524: "Hard",
      6525: "Master",
    },
  },
  {
    key: "scene_sea_ringed_reef",
    displayName: "Sea-Ringed Reef",
    sceneIds: [6563, 6564, 6565],
    difficultyBySceneId: {
      6563: "Normal",
      6564: "Hard",
      6565: "Master",
    },
  },
  {
    key: "scene_dragon_shackles",
    displayName: "Dragon Shackles",
    sceneIds: [9200, 13001, 13002, 13003],
    difficultyBySceneId: {
      9200: "Adept",
      13001: "Clash",
      13002: "Brutal",
      13003: "Purge",
    },
  },
  {
    key: "scene_illusion_shroud_woods",
    displayName: "Illusion-Shroud Woods",
    sceneIds: [9205, 9206, 9207],
    difficultyBySceneId: {
      9205: "Easy",
      9206: "Hard",
      9207: "Nightmare",
    },
  },
  {
    key: "scene_dreambloom_ruins",
    displayName: "Dreambloom Ruins",
    sceneIds: [13011, 13012, 13013],
    difficultyBySceneId: {
      13011: "Clash",
      13012: "Brutal",
      13013: "Purge",
    },
  },
  {
    key: "scene_field_of_forgotten_illusions",
    displayName: "Field of Forgotten Illusions",
    sceneIds: [13021, 13022, 13023],
    difficultyBySceneId: {
      13021: "Clash",
      13022: "Brutal",
      13023: "Purge",
    },
  },
];

const currentDiscordById = new Map(
  currentDiscordGroups.flatMap((group) =>
    group.sceneIds.map((sceneId) => [
      sceneId,
      {
        key: group.key,
        displayName: group.displayName,
        difficulty: group.difficultyBySceneId?.[sceneId] ?? "",
      },
    ]),
  ),
);

const prioritySceneGroups = [
  {
    requestedName: "Asterleed",
    displayName: "Asterleeds",
    suggestedAssetKey: "scene_asterleeds",
    sceneIds: [8, 5206],
    note: "Parser spelling is Asterleeds.",
  },
  {
    requestedName: "Starland",
    displayName: "Starland",
    suggestedAssetKey: "scene_starland",
    sceneIds: [11],
    note: "",
  },
  {
    requestedName: "Guild Hall",
    displayName: "Guild Center",
    suggestedAssetKey: "scene_guild_center",
    sceneIds: [12000],
    note: "Closest parser match for Guild Hall.",
  },
  {
    requestedName: "Guild Hunt",
    displayName: "Guild Hunt",
    suggestedAssetKey: "scene_guild_hunt",
    sceneIds: [12011, 12012, 12013, 12014, 12015, 12018, 12019, 12022, 12023],
    note: "Separate Guild Hunt scene IDs found in parser data.",
  },
  {
    requestedName: "World Boss Crusade",
    displayName: "Giant Golem Crusade",
    suggestedAssetKey: "scene_world_boss_crusade",
    sceneIds: [12050, 12051, 12052],
    note: "Parser currently lists three Giant Golem Crusade scene IDs.",
  },
  {
    requestedName: "Homestead",
    displayName: "Homestead",
    suggestedAssetKey: "scene_homestead",
    sceneIds: [30001, 40001],
    note: "Covers Homestead Courtyard and Homestead House.",
  },
  {
    requestedName: "Asteria Plains",
    displayName: "Asteria Plains",
    suggestedAssetKey: "scene_asteria_plains",
    sceneIds: [7],
    note: "",
  },
  {
    requestedName: "Bahamar Highlands",
    displayName: "Bahamar Highlands",
    suggestedAssetKey: "scene_bahamar_highlands",
    sceneIds: [9],
    note: "",
  },
  {
    requestedName: "Underground District",
    displayName: "Underground District",
    suggestedAssetKey: "scene_underground_district",
    sceneIds: [74],
    note: "",
  },
  {
    requestedName: "Windhowl Canyon",
    displayName: "Windhowl Canyon",
    suggestedAssetKey: "scene_windhowl_canyon",
    sceneIds: [73],
    note: "",
  },
  {
    requestedName: "Skimmer's Lair",
    displayName: "Skimmer's Lair",
    suggestedAssetKey: "scene_skimmers_lair",
    sceneIds: [75],
    note: "",
  },
  {
    requestedName: "Duskdye Woods",
    displayName: "Duskdye Woods",
    suggestedAssetKey: "scene_duskdye_woods",
    sceneIds: [71],
    note: "",
  },
  {
    requestedName: "Everfall Forest",
    displayName: "Everfall Forest",
    suggestedAssetKey: "scene_everfall_forest",
    sceneIds: [72],
    note: "",
  },
  {
    requestedName: "Moonshadow Wilds",
    displayName: "Moonshadow Wilds",
    suggestedAssetKey: "scene_moonshadow_wilds",
    sceneIds: [93],
    note: "",
  },
  {
    requestedName: "Stray Starway",
    displayName: "Stray Starway",
    suggestedAssetKey: "scene_stray_starway",
    sceneIds: [94],
    note: "",
  },
  {
    requestedName: "Sunset Wilds",
    displayName: "Sunset Wilds",
    suggestedAssetKey: "scene_sunset_wilds",
    sceneIds: [95],
    note: "",
  },
  {
    requestedName: "Sunken Corridor",
    displayName: "Sunken Corridor",
    suggestedAssetKey: "scene_sunken_corridor",
    sceneIds: [91],
    note: "",
  },
  {
    requestedName: "Gloomy Depths",
    displayName: "Gloomy Depths",
    suggestedAssetKey: "scene_gloomy_depths",
    sceneIds: [92],
    note: "",
  },
  {
    requestedName: "Stimen Vaults",
    displayName: "Stimen Vaults",
    suggestedAssetKey: "scene_stimen_vaults",
    sceneIds: [...range(30101, 30175), 30200, ...range(31101, 31175), ...range(32101, 32160)],
    note: "One PNG for all Stimen Vault floor IDs found; floors 1-60 are included.",
  },
  {
    requestedName: "Illusion-Shroud Woods",
    displayName: "Illusion-Shroud Woods",
    suggestedAssetKey: "scene_illusion_shroud_woods",
    sceneIds: [9205, 9206, 9207],
    note: "Covers Easy, Hard, and Nightmare difficulty scene IDs.",
  },
  {
    requestedName: "Wondrous Tag",
    displayName: "Wondrous Tag",
    suggestedAssetKey: "scene_wondrous_tag",
    sceneIds: [11001],
    note: "Carnival hide-and-seek mini-game scene.",
  },
  {
    requestedName: "City Rally",
    displayName: "City Rally",
    suggestedAssetKey: "scene_city_rally",
    sceneIds: [7004],
    note: "Carnival rally mini-game scene.",
  },
  {
    requestedName: "Ee-chan, Don't Stare at Me!",
    displayName: "Ee-chan, Don't Stare at Me!",
    suggestedAssetKey: "scene_ee_chan_dont_stare_at_me",
    sceneIds: [12030, 12040],
    note: "Overrides the raw parser Guild Party/Ee-chan story labels for the carnival mini-game.",
  },
];

function slugify(value) {
  const slug = String(value || "")
    .normalize("NFKD")
    .replace(/'/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .split("_")
    .filter(Boolean)
    .join("_");
  return slug || "unknown_scene";
}

function inferDifficulty(sceneId, rawName) {
  const current = currentDiscordById.get(sceneId);
  if (current?.difficulty) return current.difficulty;

  const name = String(rawName || "").trim();
  if (/^clash!/i.test(name)) return "Clash";
  if (/^brutal!/i.test(name)) return "Brutal";
  if (/^purge!/i.test(name)) return "Purge";
  if (/unstable/i.test(name)) return "Unstable";
  if (/easy/i.test(name)) return "Easy";
  if (/normal/i.test(name)) return "Normal";
  if (/hard/i.test(name)) return "Hard";
  if (/master/i.test(name)) return "Master";
  if (/nightmare/i.test(name)) return "Nightmare";
  if (/adept/i.test(name)) return "Adept";
  if (/chaotic/i.test(name)) return "Chaotic";
  return "";
}

function canonicalName(sceneId, rawName) {
  const current = currentDiscordById.get(sceneId);
  if (current?.displayName) return current.displayName;

  let name = String(rawName || "").trim();
  name = name.replace(/^Clash!\s*/i, "");
  name = name.replace(/^Brutal!\s*/i, "");
  name = name.replace(/^Purge!\s*/i, "");
  name = name.replace(/^Normal\s*[-:]\s*/i, "");
  name = name.replace(/^Hard\s*[-:]\s*/i, "");
  name = name.replace(/^Master\s*[-:]\s*/i, "");
  name = name.replace(/^Nightmare\s*[-:]\s*/i, "");
  name = name.replace(/^Chaotic\s*[-:]\s*/i, "");
  name = name.replace(/^Unstable Space\s*[-:]\s*/i, "");
  name = name.replace(/^Unstable\s*[-:]\s*/i, "");
  name = name.replace(/\s*[-:]\s*Adept'?s Trial/gi, "");
  name = name.replace(/\s*[-:]\s*Normal/gi, "");
  name = name.replace(/\s*[-:]\s*Hard/gi, "");
  name = name.replace(/\s*[-:]\s*Master/gi, "");
  name = name.replace(/\s*[-:]\s*Nightmare/gi, "");
  name = name.replace(/\s+/g, " ").trim();
  return name || String(rawName || "Unknown Scene").trim() || "Unknown Scene";
}

function quoteCsv(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function writeCsv(fileName, headers, rows) {
  const lines = [
    headers.map(quoteCsv).join(","),
    ...rows.map((row) => headers.map((header) => quoteCsv(row[header])).join(",")),
  ];
  fs.writeFileSync(path.join(exportDir, fileName), `${lines.join("\r\n")}\r\n`);
}

function compactIdRanges(ids) {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  const chunks = [];
  for (const id of sorted) {
    const last = chunks[chunks.length - 1];
    if (last && last.end + 1 === id) {
      last.end = id;
    } else {
      chunks.push({ start: id, end: id });
    }
  }
  return chunks.map((chunk) => (chunk.start === chunk.end ? `${chunk.start}` : `${chunk.start}-${chunk.end}`)).join(" ");
}

const sceneData = JSON.parse(fs.readFileSync(sceneNamesPath, "utf8"));
const allRows = Object.values(sceneData)
  .map((entry) => {
    const sceneId = Number(entry.Id);
    const rawName = String(entry.Name || entry.Names?.en || `Unknown Scene ${sceneId}`).trim();
    const current = currentDiscordById.get(sceneId);
    const baseName = canonicalName(sceneId, rawName);
    const suggestedAssetKey = current?.key ?? `scene_${slugify(baseName)}`;
    return {
      sceneId,
      rawName,
      canonicalName: baseName,
      difficultyHint: inferDifficulty(sceneId, rawName),
      suggestedAssetKey,
      currentDiscordAssetKey: current?.key ?? "",
      currentDiscordDisplayName: current?.displayName ?? "",
      source: entry.Source ?? "",
    };
  })
  .sort((a, b) => a.sceneId - b.sceneId);

const grouped = new Map();
for (const row of allRows) {
  const key = row.suggestedAssetKey;
  const existing =
    grouped.get(key) ??
    {
      suggestedAssetKey: key,
      canonicalName: row.canonicalName,
      sceneIds: [],
      difficultyHints: new Set(),
      rawNames: new Set(),
      currentDiscordAssetKey: row.currentDiscordAssetKey,
      currentDiscordDisplayName: row.currentDiscordDisplayName,
      sceneCount: 0,
    };
  existing.sceneIds.push(row.sceneId);
  if (row.difficultyHint) existing.difficultyHints.add(row.difficultyHint);
  existing.rawNames.add(row.rawName);
  if (row.currentDiscordAssetKey) existing.currentDiscordAssetKey = row.currentDiscordAssetKey;
  if (row.currentDiscordDisplayName) existing.currentDiscordDisplayName = row.currentDiscordDisplayName;
  existing.sceneCount += 1;
  grouped.set(key, existing);
}

const groupedRows = [...grouped.values()]
  .map((row) => ({
    suggestedAssetKey: row.suggestedAssetKey,
    canonicalName: row.canonicalName,
    sceneIds: row.sceneIds.join(" "),
    difficultyHints: [...row.difficultyHints].join(" "),
    rawNames: [...row.rawNames].join(" | "),
    sceneCount: row.sceneCount,
    currentDiscordAssetKey: row.currentDiscordAssetKey,
    currentDiscordDisplayName: row.currentDiscordDisplayName,
  }))
  .sort((a, b) => a.suggestedAssetKey.localeCompare(b.suggestedAssetKey));

fs.mkdirSync(exportDir, { recursive: true });

writeCsv("discord-scene-png-list-all-ids.csv", [
  "sceneId",
  "rawName",
  "canonicalName",
  "difficultyHint",
  "suggestedAssetKey",
  "currentDiscordAssetKey",
  "currentDiscordDisplayName",
  "source",
], allRows);

writeCsv("discord-scene-png-list-grouped.csv", [
  "suggestedAssetKey",
  "canonicalName",
  "sceneIds",
  "difficultyHints",
  "rawNames",
  "sceneCount",
  "currentDiscordAssetKey",
  "currentDiscordDisplayName",
], groupedRows);

const mappedRows = groupedRows.filter((row) => row.currentDiscordAssetKey);
const priorityRows = prioritySceneGroups.map((group, index) => {
  const uniqueSceneIds = [...new Set(group.sceneIds)];
  const sceneIds = uniqueSceneIds.filter((sceneId) => sceneData[String(sceneId)]);
  const missingSceneIds = uniqueSceneIds.filter((sceneId) => !sceneData[String(sceneId)]);
  const rawNames = [
    ...new Set(
      sceneIds.map((sceneId) => {
        const entry = sceneData[String(sceneId)];
        return String(entry.Name || entry.Names?.en || `Unknown Scene ${sceneId}`).trim();
      }),
    ),
  ];
  const difficultyHints = [
    ...new Set(
      sceneIds
        .map((sceneId) => inferDifficulty(sceneId, sceneData[String(sceneId)]?.Name ?? ""))
        .filter(Boolean),
    ),
  ];
  const missingNote = missingSceneIds.length > 0 ? `Missing scene IDs: ${missingSceneIds.join(" ")}` : "";
  return {
    priority: index + 1,
    requestedName: group.requestedName,
    displayName: group.displayName,
    suggestedAssetKey: group.suggestedAssetKey,
    sceneIds: sceneIds.join(" "),
    sceneIdRanges: compactIdRanges(sceneIds),
    sceneCount: sceneIds.length,
    difficultyHints: difficultyHints.join(" "),
    rawNames: rawNames.join(" | "),
    note: [group.note, missingNote].filter(Boolean).join(" "),
  };
});

writeCsv("discord-scene-png-priority.csv", [
  "priority",
  "requestedName",
  "displayName",
  "suggestedAssetKey",
  "sceneIds",
  "sceneIdRanges",
  "sceneCount",
  "difficultyHints",
  "rawNames",
  "note",
], priorityRows);

const summary = [
  "# Discord Scene PNG List",
  "",
  `Source: parser-data/generated/scenenames.json`,
  `Scene ID rows: ${allRows.length}`,
  `Grouped PNG rows: ${groupedRows.length}`,
  `Already mapped Discord asset rows: ${mappedRows.length}`,
  `Priority PNG rows: ${priorityRows.length}`,
  "",
  "Use `discord-scene-png-list-grouped.csv` when one image can cover several difficulty IDs.",
  "Use `discord-scene-png-list-all-ids.csv` when you need to audit every parser scene ID.",
  "Use `discord-scene-png-priority.csv` for the first batch.",
  "",
  "## Already Mapped",
  "",
  "| asset key | scene | scene ids | difficulty hints |",
  "| --- | --- | --- | --- |",
  ...mappedRows.map(
    (row) =>
      `| ${row.suggestedAssetKey} | ${row.canonicalName} | ${row.sceneIds} | ${row.difficultyHints} |`,
  ),
  "",
  "## Priority Batch",
  "",
  "| priority | asset key | scene | scene id ranges | count | notes |",
  "| --- | --- | --- | --- | --- | --- |",
  ...priorityRows.map(
    (row) =>
      `| ${row.priority} | ${row.suggestedAssetKey} | ${row.displayName} | ${row.sceneIdRanges} | ${row.sceneCount} | ${row.note} |`,
  ),
  "",
];

fs.writeFileSync(path.join(exportDir, "discord-scene-png-list.md"), `${summary.join("\r\n")}\r\n`);

console.log(`Wrote ${allRows.length} scene ID rows.`);
console.log(`Wrote ${groupedRows.length} grouped PNG rows.`);
console.log(`Wrote ${priorityRows.length} priority PNG rows.`);
console.log(path.join(exportDir, "discord-scene-png-list-all-ids.csv"));
console.log(path.join(exportDir, "discord-scene-png-list-grouped.csv"));
console.log(path.join(exportDir, "discord-scene-png-priority.csv"));
console.log(path.join(exportDir, "discord-scene-png-list.md"));
