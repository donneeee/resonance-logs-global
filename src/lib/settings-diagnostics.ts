import {
  getStoreCollectionPath,
  getStoreIds,
  getStorePath,
  getStoreState,
  saveAllNow,
} from "@tauri-store/svelte";
import {
  historyDpsPlayerColumns,
  historyDpsSkillColumns,
  historyHealPlayerColumns,
  historyHealSkillColumns,
  historyTankedPlayerColumns,
  historyTankedSkillColumns,
  liveDpsPlayerColumns,
  liveDpsSkillColumns,
  liveHealPlayerColumns,
  liveHealSkillColumns,
  liveTankedPlayerColumns,
  liveTankedSkillColumns,
  orderColumnsByKey,
  type ColumnDefinition,
} from "$lib/column-data";
import {
  DEFAULT_DPS_PLAYER_COLUMN_ORDER,
  DEFAULT_DPS_SKILL_COLUMN_ORDER,
  DEFAULT_HEAL_PLAYER_COLUMN_ORDER,
  DEFAULT_HEAL_SKILL_COLUMN_ORDER,
  DEFAULT_HISTORY_DPS_PLAYER_COLUMN_ORDER,
  DEFAULT_HISTORY_DPS_SKILL_COLUMN_ORDER,
  DEFAULT_HISTORY_DPS_SKILL_STATS,
  DEFAULT_HISTORY_HEAL_PLAYER_COLUMN_ORDER,
  DEFAULT_HISTORY_HEAL_SKILL_COLUMN_ORDER,
  DEFAULT_HISTORY_HEAL_STATS,
  DEFAULT_HISTORY_STATS,
  DEFAULT_HISTORY_TANKED_PLAYER_COLUMN_ORDER,
  DEFAULT_HISTORY_TANKED_SKILL_COLUMN_ORDER,
  DEFAULT_HISTORY_TANKED_STATS,
  DEFAULT_STATS,
  DEFAULT_TANKED_PLAYER_COLUMN_ORDER,
  DEFAULT_TANKED_SKILL_COLUMN_ORDER,
  SETTINGS,
} from "$lib/settings-store";

type JsonRecord = Record<string, unknown>;

type DiagnosticStore = {
  id: string;
  state: JsonRecord;
};

type ColumnDiagnosticGroup = {
  name: string;
  visibilityStore: DiagnosticStore;
  orderStore?: DiagnosticStore;
  columns: readonly ColumnDefinition[];
  defaults: JsonRecord;
  defaultOrder?: readonly string[];
};

const SENSITIVE_KEY_RE = /(api.?key|token|secret|password|authorization|bearer)/i;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry));
  }
  if (!isRecord(value)) return value;

  const next: JsonRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] = SENSITIVE_KEY_RE.test(key) ? "[redacted]" : redact(entry);
  }
  return next;
}

function storeOf(store: { id: string; state: unknown }): DiagnosticStore {
  return {
    id: store.id,
    state: cloneJson(store.state) as JsonRecord,
  };
}

function valueTypesByKey(state: JsonRecord, keys: readonly string[]): JsonRecord {
  const result: JsonRecord = {};
  for (const key of keys) {
    const value = state[key];
    result[key] = Array.isArray(value) ? "array" : typeof value;
  }
  return result;
}

function detectObjectIssues(name: string, state: JsonRecord, defaults: JsonRecord): string[] {
  const issues: string[] = [];
  const defaultKeys = Object.keys(defaults);
  const stateKeys = Object.keys(state);

  for (const wrapperKey of ["state", "value", "settings"]) {
    if (isRecord(state[wrapperKey])) {
      issues.push(`${name}: contains nested ${wrapperKey} object`);
    }
  }

  for (const key of defaultKeys) {
    if (!Object.prototype.hasOwnProperty.call(state, key)) {
      issues.push(`${name}: missing key ${key}`);
    }
  }

  for (const key of stateKeys) {
    if (!Object.prototype.hasOwnProperty.call(defaults, key) && key !== "state") {
      issues.push(`${name}: extra key ${key}`);
    }
  }

  return issues;
}

function analyzeColumnGroup(group: ColumnDiagnosticGroup): JsonRecord {
  const columnKeys = group.columns.map((column) => column.key);
  const defaultKeys = Object.keys(group.defaults);
  const visibilityState = group.visibilityStore.state;
  const orderState = group.orderStore?.state;
  const orderValue = orderState?.["order"];
  const order = Array.isArray(orderValue)
    ? orderValue.filter((key): key is string => typeof key === "string")
    : [...(group.defaultOrder ?? columnKeys)];
  const orderedColumns = orderColumnsByKey(group.columns, order);
  const visibleStrict = orderedColumns
    .filter((column) => visibilityState[column.key] === true)
    .map((column) => column.key);
  const visibleTruthy = orderedColumns
    .filter((column) => Boolean(visibilityState[column.key]))
    .map((column) => column.key);
  const nonBooleanKeys = defaultKeys.filter(
    (key) => typeof group.defaults[key] === "boolean" && typeof visibilityState[key] !== "boolean",
  );
  const unknownOrderKeys = order.filter((key) => !columnKeys.includes(key));
  const missingOrderKeys = columnKeys.filter((key) => !order.includes(key));
  const issues = [
    ...detectObjectIssues(group.name, visibilityState, group.defaults),
    ...nonBooleanKeys.map((key) => `${group.name}: ${key} is ${typeof visibilityState[key]}`),
    ...unknownOrderKeys.map((key) => `${group.name}: unknown order key ${key}`),
    ...missingOrderKeys.map((key) => `${group.name}: missing order key ${key}`),
  ];

  return {
    visibilityStoreId: group.visibilityStore.id,
    orderStoreId: group.orderStore?.id ?? null,
    columnKeys,
    defaultKeys,
    order,
    visibleStrict,
    visibleTruthy,
    stateTypes: valueTypesByKey(visibilityState, defaultKeys),
    stateValues: redact(visibilityState),
    issues,
  };
}

function getColumnGroups(): ColumnDiagnosticGroup[] {
  return [
    {
      name: "live.dps.players",
      visibilityStore: storeOf(SETTINGS.live.dps.players),
      orderStore: storeOf(SETTINGS.live.columnOrder.dpsPlayers),
      columns: liveDpsPlayerColumns,
      defaults: DEFAULT_STATS,
      defaultOrder: DEFAULT_DPS_PLAYER_COLUMN_ORDER,
    },
    {
      name: "live.dps.skillBreakdown",
      visibilityStore: storeOf(SETTINGS.live.dps.skillBreakdown),
      orderStore: storeOf(SETTINGS.live.columnOrder.dpsSkills),
      columns: liveDpsSkillColumns,
      defaults: DEFAULT_STATS,
      defaultOrder: DEFAULT_DPS_SKILL_COLUMN_ORDER,
    },
    {
      name: "live.heal.players",
      visibilityStore: storeOf(SETTINGS.live.heal.players),
      orderStore: storeOf(SETTINGS.live.columnOrder.healPlayers),
      columns: liveHealPlayerColumns,
      defaults: DEFAULT_STATS,
      defaultOrder: DEFAULT_HEAL_PLAYER_COLUMN_ORDER,
    },
    {
      name: "live.heal.skillBreakdown",
      visibilityStore: storeOf(SETTINGS.live.heal.skillBreakdown),
      orderStore: storeOf(SETTINGS.live.columnOrder.healSkills),
      columns: liveHealSkillColumns,
      defaults: DEFAULT_STATS,
      defaultOrder: DEFAULT_HEAL_SKILL_COLUMN_ORDER,
    },
    {
      name: "live.tanked.players",
      visibilityStore: storeOf(SETTINGS.live.tanked.players),
      orderStore: storeOf(SETTINGS.live.columnOrder.tankedPlayers),
      columns: liveTankedPlayerColumns,
      defaults: DEFAULT_STATS,
      defaultOrder: DEFAULT_TANKED_PLAYER_COLUMN_ORDER,
    },
    {
      name: "live.tanked.skills",
      visibilityStore: storeOf(SETTINGS.live.tanked.skills),
      orderStore: storeOf(SETTINGS.live.columnOrder.tankedSkills),
      columns: liveTankedSkillColumns,
      defaults: DEFAULT_STATS,
      defaultOrder: DEFAULT_TANKED_SKILL_COLUMN_ORDER,
    },
    {
      name: "history.dps.players",
      visibilityStore: storeOf(SETTINGS.history.dps.players),
      orderStore: storeOf(SETTINGS.history.columnOrder.dpsPlayers),
      columns: historyDpsPlayerColumns,
      defaults: DEFAULT_HISTORY_STATS,
      defaultOrder: DEFAULT_HISTORY_DPS_PLAYER_COLUMN_ORDER,
    },
    {
      name: "history.dps.skillBreakdown",
      visibilityStore: storeOf(SETTINGS.history.dps.skillBreakdown),
      orderStore: storeOf(SETTINGS.history.columnOrder.dpsSkills),
      columns: historyDpsSkillColumns,
      defaults: DEFAULT_HISTORY_DPS_SKILL_STATS,
      defaultOrder: DEFAULT_HISTORY_DPS_SKILL_COLUMN_ORDER,
    },
    {
      name: "history.heal.players",
      visibilityStore: storeOf(SETTINGS.history.heal.players),
      orderStore: storeOf(SETTINGS.history.columnOrder.healPlayers),
      columns: historyHealPlayerColumns,
      defaults: DEFAULT_HISTORY_HEAL_STATS,
      defaultOrder: DEFAULT_HISTORY_HEAL_PLAYER_COLUMN_ORDER,
    },
    {
      name: "history.heal.skillBreakdown",
      visibilityStore: storeOf(SETTINGS.history.heal.skillBreakdown),
      orderStore: storeOf(SETTINGS.history.columnOrder.healSkills),
      columns: historyHealSkillColumns,
      defaults: DEFAULT_HISTORY_STATS,
      defaultOrder: DEFAULT_HISTORY_HEAL_SKILL_COLUMN_ORDER,
    },
    {
      name: "history.tanked.players",
      visibilityStore: storeOf(SETTINGS.history.tanked.players),
      orderStore: storeOf(SETTINGS.history.columnOrder.tankedPlayers),
      columns: historyTankedPlayerColumns,
      defaults: DEFAULT_HISTORY_TANKED_STATS,
      defaultOrder: DEFAULT_HISTORY_TANKED_PLAYER_COLUMN_ORDER,
    },
    {
      name: "history.tanked.skillBreakdown",
      visibilityStore: storeOf(SETTINGS.history.tanked.skillBreakdown),
      orderStore: storeOf(SETTINGS.history.columnOrder.tankedSkills),
      columns: historyTankedSkillColumns,
      defaults: DEFAULT_HISTORY_STATS,
      defaultOrder: DEFAULT_HISTORY_TANKED_SKILL_COLUMN_ORDER,
    },
  ];
}

function getFrontendStoreSnapshots(): JsonRecord {
  return {
    accessibility: redact(SETTINGS.accessibility.state),
    appBehavior: redact(SETTINGS.appBehavior.state),
    appVersion: redact(SETTINGS.appVersion.state),
    customTriggers: redact(SETTINGS.customTriggers.state),
    live: {
      general: redact(SETTINGS.live.general.state),
      tableCustomization: redact(SETTINGS.live.tableCustomization.state),
      dynamicWindow: redact(SETTINGS.live.dynamicWindow.state),
      headerCustomization: redact(SETTINGS.live.headerCustomization.state),
      dps: {
        players: redact(SETTINGS.live.dps.players.state),
        skillBreakdown: redact(SETTINGS.live.dps.skillBreakdown.state),
      },
      heal: {
        players: redact(SETTINGS.live.heal.players.state),
        skillBreakdown: redact(SETTINGS.live.heal.skillBreakdown.state),
      },
      tanked: {
        players: redact(SETTINGS.live.tanked.players.state),
        skills: redact(SETTINGS.live.tanked.skills.state),
      },
      columnOrder: {
        dpsPlayers: redact(SETTINGS.live.columnOrder.dpsPlayers.state),
        dpsSkills: redact(SETTINGS.live.columnOrder.dpsSkills.state),
        healPlayers: redact(SETTINGS.live.columnOrder.healPlayers.state),
        healSkills: redact(SETTINGS.live.columnOrder.healSkills.state),
        tankedPlayers: redact(SETTINGS.live.columnOrder.tankedPlayers.state),
        tankedSkills: redact(SETTINGS.live.columnOrder.tankedSkills.state),
      },
      sorting: {
        dpsPlayers: redact(SETTINGS.live.sorting.dpsPlayers.state),
        dpsSkills: redact(SETTINGS.live.sorting.dpsSkills.state),
        healPlayers: redact(SETTINGS.live.sorting.healPlayers.state),
        healSkills: redact(SETTINGS.live.sorting.healSkills.state),
        tankedPlayers: redact(SETTINGS.live.sorting.tankedPlayers.state),
        tankedSkills: redact(SETTINGS.live.sorting.tankedSkills.state),
      },
    },
    history: {
      general: redact(SETTINGS.history.general.state),
      summary: redact(SETTINGS.history.summary.state),
      tableCustomization: redact(SETTINGS.history.tableCustomization.state),
      dps: {
        players: redact(SETTINGS.history.dps.players.state),
        skillBreakdown: redact(SETTINGS.history.dps.skillBreakdown.state),
      },
      heal: {
        players: redact(SETTINGS.history.heal.players.state),
        skillBreakdown: redact(SETTINGS.history.heal.skillBreakdown.state),
      },
      tanked: {
        players: redact(SETTINGS.history.tanked.players.state),
        skillBreakdown: redact(SETTINGS.history.tanked.skillBreakdown.state),
      },
      columnOrder: {
        dpsPlayers: redact(SETTINGS.history.columnOrder.dpsPlayers.state),
        dpsSkills: redact(SETTINGS.history.columnOrder.dpsSkills.state),
        healPlayers: redact(SETTINGS.history.columnOrder.healPlayers.state),
        healSkills: redact(SETTINGS.history.columnOrder.healSkills.state),
        tankedPlayers: redact(SETTINGS.history.columnOrder.tankedPlayers.state),
        tankedSkills: redact(SETTINGS.history.columnOrder.tankedSkills.state),
      },
    },
    moduleCalc: redact(SETTINGS.moduleCalc.state),
    moduleSync: redact(SETTINGS.moduleSync.state),
    monsterMonitor: redact(SETTINGS.monsterMonitor.state),
    packetCapture: redact(SETTINGS.packetCapture.state),
    profileLibrary: redact(SETTINGS.profileLibrary.state),
    skillMonitor: redact(SETTINGS.skillMonitor.state),
    trainingDummy: redact(SETTINGS.trainingDummy.state),
  };
}

async function getBackendStoreSnapshots(): Promise<JsonRecord> {
  const collectionPath = await getStoreCollectionPath().catch((error) => `error: ${String(error)}`);
  const storeIds = await getStoreIds().catch(() => []);
  const stores: JsonRecord = {};

  for (const id of [...storeIds].sort()) {
    const path = await getStorePath(id).catch((error) => `error: ${String(error)}`);
    const state = await getStoreState<JsonRecord>(id)
      .then((value) => redact(value))
      .catch((error) => ({ error: String(error) }));
    stores[id] = { path, state };
  }

  return {
    collectionPath,
    storeIds: [...storeIds].sort(),
    stores,
  };
}

function getLocalStorageSnapshot(): JsonRecord {
  if (typeof window === "undefined") return {};

  const entries: JsonRecord = {};
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key) continue;
    if (!/(resonance|tauri|settings|profile|dps|live|history|overlay)/i.test(key)) continue;
    entries[key] = SENSITIVE_KEY_RE.test(key) ? "[redacted]" : window.localStorage.getItem(key);
  }
  return entries;
}

export async function collectSettingsDiagnosticsSnapshot(): Promise<string> {
  await saveAllNow().catch(() => undefined);

  const columnGroups = Object.fromEntries(
    getColumnGroups().map((group) => [group.name, analyzeColumnGroup(group)]),
  );
  const detectedIssues = Object.values(columnGroups)
    .flatMap((entry) => {
      const issues = (entry as JsonRecord)["issues"];
      return Array.isArray(issues) ? issues : [];
    });

  const snapshot = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    location: typeof window === "undefined" ? null : window.location.href,
    userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
    appVersion: SETTINGS.appVersion.state.value ?? null,
    detectedIssues,
    columnGroups,
    frontendStores: getFrontendStoreSnapshots(),
    backendStores: await getBackendStoreSnapshots(),
    localStorage: getLocalStorageSnapshot(),
  };

  return JSON.stringify(snapshot, null, 2);
}
