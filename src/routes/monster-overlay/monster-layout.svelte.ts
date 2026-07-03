import { SETTINGS, ensureTeammatePanelStyle } from "$lib/settings-store";
import {
  DEFAULT_MONSTER_OVERLAY_POSITIONS,
  DEFAULT_MONSTER_OVERLAY_SIZES,
  MAX_MONSTER_PANEL_SCALE,
  MIN_MONSTER_PANEL_SCALE,
} from "./monster-constants";
import { monsterRuntime } from "./monster-runtime.svelte.js";
import type {
  MonsterDragTarget,
  MonsterResizeTarget,
} from "./monster-types";

function patchMonsterMonitor(
  updater: (state: typeof SETTINGS.monsterMonitor.state) => Partial<typeof SETTINGS.monsterMonitor.state>,
) {
  Object.assign(SETTINGS.monsterMonitor.state, updater(SETTINGS.monsterMonitor.state));
}

function clampPanelScale(value: number) {
  return Math.max(MIN_MONSTER_PANEL_SCALE, Math.min(MAX_MONSTER_PANEL_SCALE, value));
}

function dragTargetsMatch(left: MonsterDragTarget, right: MonsterDragTarget) {
  return left.kind === right.kind;
}

function resizeTargetsMatch(left: MonsterResizeTarget, right: MonsterResizeTarget) {
  return left.kind === right.kind;
}

function getDragPreviewPosition(target: MonsterDragTarget) {
  const state = monsterRuntime.dragState;
  return state && dragTargetsMatch(state.target, target) ? state.currentPos : null;
}

function getResizePreviewScale(target: MonsterResizeTarget) {
  const state = monsterRuntime.resizeState;
  return state && resizeTargetsMatch(state.target, target) ? state.currentValue : null;
}

export function setMonsterOverlayWindow(
  currentWindow: typeof monsterRuntime.currentWindow,
) {
  monsterRuntime.currentWindow = currentWindow;
}

export function getMonsterOverlayPositions() {
  return {
    ...DEFAULT_MONSTER_OVERLAY_POSITIONS,
    ...(SETTINGS.monsterMonitor.state.overlayPositions ?? {}),
  };
}

export function getMonsterOverlaySizes() {
  return {
    ...DEFAULT_MONSTER_OVERLAY_SIZES,
    ...(SETTINGS.monsterMonitor.state.overlaySizes ?? {}),
  };
}

export function getMonsterPanelPosition() {
  return getDragPreviewPosition({ kind: "buffPanel" })
    ?? getMonsterOverlayPositions().monsterBuffPanel;
}

export function getMonsterPanelScale() {
  return getResizePreviewScale({ kind: "buffPanel" })
    ?? getMonsterOverlaySizes().monsterBuffPanelScale;
}

export function getTeammatePanelPosition() {
  return getDragPreviewPosition({ kind: "teammatePanel" })
    ?? getMonsterOverlayPositions().teammateBuffPanel;
}

export function getTeammatePanelScale() {
  return getResizePreviewScale({ kind: "teammatePanel" })
    ?? getMonsterOverlaySizes().teammateBuffPanelScale;
}

export function getHatePanelPosition() {
  return getDragPreviewPosition({ kind: "hatePanel" })
    ?? getMonsterOverlayPositions().hatePanel;
}

export function getHatePanelScale() {
  return getResizePreviewScale({ kind: "hatePanel" })
    ?? getMonsterOverlaySizes().hatePanelScale;
}

export function getFantasyPanelPosition() {
  return getDragPreviewPosition({ kind: "fantasyPanel" })
    ?? getMonsterOverlayPositions().fantasyPanel;
}

export function getFantasyPanelScale() {
  return getResizePreviewScale({ kind: "fantasyPanel" })
    ?? getMonsterOverlaySizes().fantasyPanelScale;
}

export function getDbmPanelPosition() {
  return getDragPreviewPosition({ kind: "dbmPanel" })
    ?? getMonsterOverlayPositions().bossDbmPanel;
}

export function getDbmPanelScale() {
  return getResizePreviewScale({ kind: "dbmPanel" })
    ?? getMonsterOverlaySizes().bossDbmPanelScale;
}

export function getStunPanelPosition() {
  return getDragPreviewPosition({ kind: "stunPanel" })
    ?? getMonsterOverlayPositions().stunPanel;
}

export function getStunPanelScale() {
  return getResizePreviewScale({ kind: "stunPanel" })
    ?? getMonsterOverlaySizes().stunPanelScale;
}

export function monsterPanelStyle() {
  return SETTINGS.monsterMonitor.state.panelStyle;
}

export function teammatePanelStyle() {
  return ensureTeammatePanelStyle(
    SETTINGS.monsterMonitor.state.teammatePanelStyle
      ?? SETTINGS.monsterMonitor.state.panelStyle,
  );
}

export function hatePanelStyle() {
  return SETTINGS.monsterMonitor.state.hatePanelStyle
    ?? SETTINGS.monsterMonitor.state.panelStyle;
}

export function fantasyPanelStyle() {
  return SETTINGS.monsterMonitor.state.fantasyPanelStyle
    ?? SETTINGS.monsterMonitor.state.panelStyle;
}

export function dbmPanelStyle() {
  return SETTINGS.monsterMonitor.state.bossDbmPanelStyle
    ?? SETTINGS.monsterMonitor.state.panelStyle;
}

export function stunPanelStyle() {
  return SETTINGS.monsterMonitor.state.stunPanelStyle
    ?? SETTINGS.monsterMonitor.state.panelStyle;
}

export function setMonsterPanelPosition(nextPos: { x: number; y: number }) {
  patchMonsterMonitor(() => ({
    overlayPositions: {
      ...getMonsterOverlayPositions(),
      monsterBuffPanel: nextPos,
    },
  }));
}

export function setMonsterPanelScale(value: number) {
  patchMonsterMonitor(() => ({
    overlaySizes: {
      ...getMonsterOverlaySizes(),
      monsterBuffPanelScale: clampPanelScale(value),
    },
  }));
}

export function setTeammatePanelPosition(nextPos: { x: number; y: number }) {
  patchMonsterMonitor(() => ({
    overlayPositions: {
      ...getMonsterOverlayPositions(),
      teammateBuffPanel: nextPos,
    },
  }));
}

export function setTeammatePanelScale(value: number) {
  patchMonsterMonitor(() => ({
    overlaySizes: {
      ...getMonsterOverlaySizes(),
      teammateBuffPanelScale: clampPanelScale(value),
    },
  }));
}

export function setHatePanelPosition(nextPos: { x: number; y: number }) {
  patchMonsterMonitor(() => ({
    overlayPositions: {
      ...getMonsterOverlayPositions(),
      hatePanel: nextPos,
    },
  }));
}

export function setHatePanelScale(value: number) {
  patchMonsterMonitor(() => ({
    overlaySizes: {
      ...getMonsterOverlaySizes(),
      hatePanelScale: clampPanelScale(value),
    },
  }));
}

export function setFantasyPanelPosition(nextPos: { x: number; y: number }) {
  patchMonsterMonitor(() => ({
    overlayPositions: {
      ...getMonsterOverlayPositions(),
      fantasyPanel: nextPos,
    },
  }));
}

export function setFantasyPanelScale(value: number) {
  patchMonsterMonitor(() => ({
    overlaySizes: {
      ...getMonsterOverlaySizes(),
      fantasyPanelScale: clampPanelScale(value),
    },
  }));
}

export function setDbmPanelPosition(nextPos: { x: number; y: number }) {
  patchMonsterMonitor(() => ({
    overlayPositions: {
      ...getMonsterOverlayPositions(),
      bossDbmPanel: nextPos,
    },
  }));
}

export function setDbmPanelScale(value: number) {
  patchMonsterMonitor(() => ({
    overlaySizes: {
      ...getMonsterOverlaySizes(),
      bossDbmPanelScale: clampPanelScale(value),
    },
  }));
}

export function setStunPanelPosition(nextPos: { x: number; y: number }) {
  patchMonsterMonitor(() => ({
    overlayPositions: {
      ...getMonsterOverlayPositions(),
      stunPanel: nextPos,
    },
  }));
}

export function setStunPanelScale(value: number) {
  patchMonsterMonitor(() => ({
    overlaySizes: {
      ...getMonsterOverlaySizes(),
      stunPanelScale: clampPanelScale(value),
    },
  }));
}

export async function setMonsterEditMode(editing: boolean) {
  monsterRuntime.isEditing = editing;
  if (monsterRuntime.currentWindow) {
    await monsterRuntime.currentWindow.setIgnoreCursorEvents(!editing);
  }
}

export function startMonsterDrag(
  event: PointerEvent,
  target: MonsterDragTarget,
  startPos: { x: number; y: number },
) {
  if (!monsterRuntime.isEditing) return;
  event.preventDefault();
  event.stopPropagation();
  monsterRuntime.dragState = {
    target,
    startX: event.clientX,
    startY: event.clientY,
    startPos,
    currentPos: { ...startPos },
  };
}

export function startMonsterResize(
  event: PointerEvent,
  target: MonsterResizeTarget,
  startValue: number,
) {
  if (!monsterRuntime.isEditing) return;
  event.preventDefault();
  event.stopPropagation();
  monsterRuntime.resizeState = {
    target,
    startX: event.clientX,
    startY: event.clientY,
    startValue,
    currentValue: startValue,
  };
}

export function onGlobalPointerMove(event: PointerEvent) {
  if (monsterRuntime.dragState) {
    const state = monsterRuntime.dragState;
    const deltaX = event.clientX - state.startX;
    const deltaY = event.clientY - state.startY;
    const nextPos = {
      x: Math.max(0, Math.round(state.startPos.x + deltaX)),
      y: Math.max(0, Math.round(state.startPos.y + deltaY)),
    };
    monsterRuntime.dragState = { ...state, currentPos: nextPos };
  }

  if (monsterRuntime.resizeState) {
    const state = monsterRuntime.resizeState;
    const deltaX = event.clientX - state.startX;
    const deltaY = event.clientY - state.startY;
    const delta = (deltaX + deltaY) / 300;
    monsterRuntime.resizeState = {
      ...state,
      currentValue: clampPanelScale(state.startValue + delta),
    };
  }
}

export function onGlobalPointerUp() {
  const dragState = monsterRuntime.dragState;
  if (dragState) {
    if (dragState.target.kind === "buffPanel") {
      setMonsterPanelPosition(dragState.currentPos);
    } else if (dragState.target.kind === "teammatePanel") {
      setTeammatePanelPosition(dragState.currentPos);
    } else if (dragState.target.kind === "hatePanel") {
      setHatePanelPosition(dragState.currentPos);
    } else if (dragState.target.kind === "fantasyPanel") {
      setFantasyPanelPosition(dragState.currentPos);
    } else if (dragState.target.kind === "stunPanel") {
      setStunPanelPosition(dragState.currentPos);
    } else {
      setDbmPanelPosition(dragState.currentPos);
    }
    monsterRuntime.dragState = null;
  }

  const resizeState = monsterRuntime.resizeState;
  if (resizeState) {
    if (resizeState.target.kind === "buffPanel") {
      setMonsterPanelScale(resizeState.currentValue);
    } else if (resizeState.target.kind === "teammatePanel") {
      setTeammatePanelScale(resizeState.currentValue);
    } else if (resizeState.target.kind === "hatePanel") {
      setHatePanelScale(resizeState.currentValue);
    } else if (resizeState.target.kind === "fantasyPanel") {
      setFantasyPanelScale(resizeState.currentValue);
    } else if (resizeState.target.kind === "stunPanel") {
      setStunPanelScale(resizeState.currentValue);
    } else {
      setDbmPanelScale(resizeState.currentValue);
    }
    monsterRuntime.resizeState = null;
  }
}

export function onWindowDragPointerDown(event: PointerEvent) {
  if (!monsterRuntime.currentWindow) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("button,a,input,textarea,select")) return;
  event.preventDefault();
  void monsterRuntime.currentWindow.startDragging();
}

export function resetMonsterOverlayPositions() {
  patchMonsterMonitor(() => ({
    overlayPositions: { ...DEFAULT_MONSTER_OVERLAY_POSITIONS },
  }));
}

export function resetMonsterOverlaySizes() {
  patchMonsterMonitor(() => ({
    overlaySizes: { ...DEFAULT_MONSTER_OVERLAY_SIZES },
  }));
}
