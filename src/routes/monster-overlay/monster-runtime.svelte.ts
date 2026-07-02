import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  BossDbmEvent,
  BuffUpdateState,
  HateEntry,
  StunEntry,
  TeammateFantasyState,
} from "$lib/api";
import type { TextBuffDisplay } from "../game-overlay/overlay-types";
import type {
  MonsterBossBuffSection,
  MonsterDragState,
  MonsterFantasyRow,
  MonsterHateSection,
  MonsterStunSection,
  MonsterTeammateBuffColumn,
  MonsterTeammateBuffRow,
  MonsterResizeState,
} from "./monster-types";

export const monsterRuntime = $state({
  currentWindow: null as ReturnType<typeof getCurrentWindow> | null,
  cleanup: null as (() => void) | null,
  isInitialized: false,
  isMounted: false,
  rafId: null as number | null,
  nameCache: new Map<number, string>(),
  playerNameCache: new Map<number, string>(),
  playerNameByEntityKey: new Map<string, string>(),
  monsterIdCache: new Map<number, number>(),
  monsterIdByEntityKey: new Map<string, number>(),
  bossBuffMap: new Map<string, Map<number, BuffUpdateState>>(),
  teammateBuffMap: new Map<string, Map<number, BuffUpdateState>>(),
  bossHateMap: new Map<string, HateEntry[]>(),
  bossStunMap: new Map<string, StunEntry>(),
  bossDbmMap: new Map<number, BossDbmEvent>(),
  fantasyEntries: [] as TeammateFantasyState[],
  bossSections: [] as MonsterBossBuffSection[],
  teammateColumns: [] as MonsterTeammateBuffColumn[],
  teammateRows: [] as MonsterTeammateBuffRow[],
  hateSections: [] as MonsterHateSection[],
  stunSections: [] as MonsterStunSection[],
  dbmRows: [] as TextBuffDisplay[],
  fantasyRows: [] as MonsterFantasyRow[],
  isEditing: false,
  dragState: null as MonsterDragState | null,
  resizeState: null as MonsterResizeState | null,
});

export function monsterBossSections() {
  return monsterRuntime.bossSections;
}

export function monsterHateSections() {
  return monsterRuntime.hateSections;
}

export function monsterTeammateColumns() {
  return monsterRuntime.teammateColumns;
}

export function monsterTeammateRows() {
  return monsterRuntime.teammateRows;
}

export function monsterFantasyRows() {
  return monsterRuntime.fantasyRows;
}

export function monsterDbmRows() {
  return monsterRuntime.dbmRows;
}

export function monsterStunSections() {
  return monsterRuntime.stunSections;
}

export function isMonsterEditing() {
  return monsterRuntime.isEditing;
}

export function isMonsterLayoutScaffold() {
  return monsterRuntime.isEditing;
}
