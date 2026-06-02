import { getCurrentWindow } from "@tauri-apps/api/window";
import type { BuffUpdateState, HateEntry } from "$lib/api";
import type {
  MonsterBossBuffSection,
  MonsterDragState,
  MonsterHateSection,
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
  bossBuffMap: new Map<number, Map<number, BuffUpdateState>>(),
  teammateBuffMap: new Map<string, Map<number, BuffUpdateState>>(),
  bossHateMap: new Map<number, HateEntry[]>(),
  bossSections: [] as MonsterBossBuffSection[],
  teammateColumns: [] as MonsterTeammateBuffColumn[],
  teammateRows: [] as MonsterTeammateBuffRow[],
  hateSections: [] as MonsterHateSection[],
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

export function isMonsterEditing() {
  return monsterRuntime.isEditing;
}
