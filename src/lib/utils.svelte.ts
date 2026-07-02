/**
 * @file This file contains utility functions and constants for the application.
 */
import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css'; // optional for styling
import type { Attachment } from 'svelte/attachments';
// import html2canvas from "html2canvas-pro";
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
// import { writeImage } from '@tauri-apps/plugin-clipboard-manager';
// import { image } from '@tauri-apps/api';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { emit } from '@tauri-apps/api/event';

import classSpecIconsData from '$parserData/generated/class-spec-icons.json';
import { resolveStaticIconUrl } from '$lib/config/static-icon-resolver';
import { SETTINGS, DEFAULT_CLASS_COLORS, DEFAULT_CLASS_SPEC_COLORS, CLASS_SPEC_MAP } from '$lib/settings-store';

let pendingDetachedTooltip: {
  destroy: () => void;
  hide: () => void;
  state?: { isDestroyed?: boolean };
} | null = null;

export const CLASS_MAP: Record<number, string> = {
  1: 'Stormblade',
  2: 'Frost Mage',
  3: 'Flame Berserker',
  4: 'Wind Knight',
  5: 'Verdant Oracle',
  9: 'Heavy Guardian',
  11: 'Marksman',
  12: 'Shield Knight',
  13: 'Beat Performer'
};

export const CLASS_NAMES = Object.values(CLASS_MAP);

export function getClassColorRaw(className: string, classSpecName?: string): string {
  const useSpec = SETTINGS.accessibility.state.useClassSpecColors;
  if (useSpec && classSpecName && classSpecName in CLASS_SPEC_MAP) {
    const specColors = SETTINGS.accessibility.state.classSpecColors ?? DEFAULT_CLASS_SPEC_COLORS;
    return specColors[classSpecName] ?? DEFAULT_CLASS_SPEC_COLORS[classSpecName] ?? "#ffc9ed";
  }
  const classColors = SETTINGS.accessibility.state.classColors ?? DEFAULT_CLASS_COLORS;
  return classColors[className] ?? DEFAULT_CLASS_COLORS[className] ?? "#ffc9ed";
}

export function getClassColor(className: string, classSpecName?: string): string {
  return `rgb(from ${getClassColorRaw(className, classSpecName)} r g b / 0.6)`;
}

export function getClassIcon(class_name: string, class_spec_name = ""): string {
  return getClassOrSpecIcon(class_name, class_spec_name);
}

const SPEC_ICON_ROLE_COLORS = {
  dps: "#d99a97",
  support: "#9bc9a8",
  tank: "#7ea6c6",
} as const;

const SUPPORT_SPEC_ICONS = new Set(["Smite", "Lifebind", "Dissonance", "Concerto"]);
const TANK_SPEC_ICONS = new Set(["Earthfort", "Block", "Recovery", "Shield"]);
const DPS_HEALER_SPEC_ICONS = new Set(["Smite", "Dissonance"]);

export const DPS_HEALER_SPEC_GLOW = "#ff4d5f";

export function isDpsHealerSpec(class_spec_name = ""): boolean {
  return DPS_HEALER_SPEC_ICONS.has(class_spec_name);
}

export function getClassSpecRoleTintColor(class_spec_name = ""): string {
  if (!class_spec_name) return "";
  if (SUPPORT_SPEC_ICONS.has(class_spec_name)) return SPEC_ICON_ROLE_COLORS.support;
  if (TANK_SPEC_ICONS.has(class_spec_name)) return SPEC_ICON_ROLE_COLORS.tank;
  return "";
}

export function getClassIconTintColor(class_name: string, class_spec_name = ""): string {
  if (!class_spec_name) return "";
  const roleTint = getClassSpecRoleTintColor(class_spec_name);
  if (roleTint) return roleTint;
  if (CLASS_SPEC_MAP[class_spec_name] || class_name) return SPEC_ICON_ROLE_COLORS.dps;
  return "";
}

export function getClassRowGlowColor(
  class_name: string,
  class_spec_name = "",
  options: { highlightDpsHealerSpecIcons?: boolean } = {},
): string {
  if (options.highlightDpsHealerSpecIcons === true && isDpsHealerSpec(class_spec_name)) {
    return DPS_HEALER_SPEC_GLOW;
  }

  return getClassSpecRoleTintColor(class_spec_name) || getClassColor(class_name, class_spec_name);
}

type ClassIconEntry = {
  staticIconPath?: string;
  professionIconPath?: string;
};

type SpecIconEntry = {
  iconPath?: string;
  weaponStyleIconPath?: string;
};

type ClassSpecIconTable = {
  classes?: Record<string, ClassIconEntry>;
  specs?: Record<string, SpecIconEntry>;
};

const CLASS_SPEC_ICONS = classSpecIconsData as ClassSpecIconTable;

const CLASS_ICON_ALIASES: Record<string, string[]> = {
  "Twin Striker": ["Flame Berserker", "Flame Vanguard"],
  "Flame Vanguard": ["Flame Berserker", "Twin Striker"],
  "Flame Berserker": ["Twin Striker", "Flame Vanguard"],
};

const SPEC_ICON_ALIASES: Record<string, string[]> = {
  Formless: ["Voidflame"],
  Crimson: ["Blazecrimson"],
  Voidflame: ["Formless"],
  Blazecrimson: ["Crimson"],
};

const SPEC_CLASS_ALIASES: Record<string, string> = {
  Formless: "Flame Berserker",
  Crimson: "Flame Berserker",
  Voidflame: "Flame Berserker",
  Blazecrimson: "Flame Berserker",
};

function lookupWithAliases<T>(
  table: Record<string, T> | undefined,
  key: string,
  aliases: Record<string, string[]>,
): T | undefined {
  if (!table || !key) return undefined;
  const direct = table[key];
  if (direct) return direct;

  for (const alias of aliases[key] ?? []) {
    const match = table[alias];
    if (match) return match;
  }

  return undefined;
}

export function getClassOrSpecIcon(class_name: string, class_spec_name = ""): string {
  const className = class_name.trim();
  const classSpecName = class_spec_name.trim();

  if ((className === "" || className === "blank") && classSpecName === "") {
    return "/images/classes/blank.png";
  }

  const specIcon = classSpecName
    ? lookupWithAliases(CLASS_SPEC_ICONS.specs, classSpecName, SPEC_ICON_ALIASES)
    : undefined;
  const classIcon =
    lookupWithAliases(CLASS_SPEC_ICONS.classes, className, CLASS_ICON_ALIASES)
    ?? lookupWithAliases(
      CLASS_SPEC_ICONS.classes,
      CLASS_SPEC_MAP[classSpecName] ?? SPEC_CLASS_ALIASES[classSpecName] ?? "",
      CLASS_ICON_ALIASES,
    );

  return (
    resolveStaticIconUrl(specIcon?.iconPath, specIcon?.weaponStyleIconPath)
    ?? resolveStaticIconUrl(classIcon?.professionIconPath, classIcon?.staticIconPath)
    ?? (className ? `/images/classes/${className}.png` : "/images/classes/blank.png")
  );
}

// https://svelte.dev/docs/svelte/@attach#Attachment-factories
export function tooltip(getContent: () => string): Attachment {
  return (element: Element) => {
    const instance = tippy(element, {
      content: getContent(),
      theme: 'resonance',
      arrow: true,
      interactive: true,
      appendTo: () => document.body,
      delay: [200, 240],
      duration: [120, 120],
      animation: 'fade',
      hideOnClick: false,
      moveTransition: 'transform 120ms ease-out',
      placement: 'top',
      maxWidth: 'min(420px, calc(100vw - 16px))',
      zIndex: 1000,
      onShow() {
        if (pendingDetachedTooltip && !pendingDetachedTooltip.state?.isDestroyed) {
          pendingDetachedTooltip.destroy();
        }
        pendingDetachedTooltip = null;
      },
      popperOptions: {
        modifiers: [
          {
            name: 'offset',
            options: {
              offset: [0, 6],
            },
          },
          {
            name: 'flip',
            options: {
              padding: 8,
              fallbackPlacements: ['bottom', 'right', 'left'],
            },
          },
          {
            name: 'preventOverflow',
            options: {
              boundary: document.body,
              rootBoundary: 'viewport',
              padding: 8,
            },
          },
        ],
      },
    });

    // Keep content in sync with reactive source
    $effect(() => {
      instance.setContent(getContent());
    });

    return () => {
      const shouldKeepReadable =
        instance.state.isVisible ||
        element.matches(":hover") ||
        document.activeElement === element;

      if (!shouldKeepReadable) {
        instance.destroy();
        return;
      }

      if (pendingDetachedTooltip && !pendingDetachedTooltip.state?.isDestroyed) {
        pendingDetachedTooltip.destroy();
      }

      pendingDetachedTooltip = instance;
      instance.disable();
      window.setTimeout(() => {
        if (pendingDetachedTooltip === instance) {
          pendingDetachedTooltip = null;
        }
        if (!instance.state.isDestroyed) {
          instance.hide();
          window.setTimeout(() => {
            if (!instance.state.isDestroyed) {
              instance.destroy();
            }
          }, 160);
        }
      }, 2200);
    };
  };
}

export async function copyToClipboard(error: MouseEvent & { currentTarget: EventTarget & HTMLElement }, content: string) {
  // TODO: add a way to simulate a "click" animation
  error.stopPropagation();
  await writeText(content);
}

// export async function takeScreenshot(target?: HTMLElement): Promise<void> {
//   if (!target) return;
//   // Give the browser a paint frame (helps if caller just changed DOM)
//   await new Promise(requestAnimationFrame);

//   const canvas = await html2canvas(target, { backgroundColor: "#27272A" });

//   const blob: Blob | null = await new Promise((resolve) =>
//     canvas.toBlob(resolve)
//   );
//   if (!blob) return;

//   try {
//     await writeImage(await image.Image.fromBytes(await blob.arrayBuffer()));
//   } catch (error) {
//     console.error("Failed to take a screenshot", error);
//   }
// }

let isClickthrough = false;
const LIVE_WINDOW_FOCUS_RESTORE_DELAY_MS = 80;
export const LIVE_WINDOW_MANUAL_SHOW_EVENT = "live-window-manual-show";
export const LIVE_WINDOW_INTERACTION_RESTORE_REQUEST_EVENT =
  "live-window-interaction-restore-request";
const PASSIVE_OVERLAY_WINDOW_LABELS = [
  "game-overlay",
  "monster-overlay",
] as const;

type LiveWindowHandle = {
  setFocusable(focusable: boolean): Promise<void>;
  setIgnoreCursorEvents(ignore: boolean): Promise<void>;
  show(): Promise<void>;
  unminimize(): Promise<void>;
};

function shouldIgnoreLiveWindowCursorEvents(): boolean {
  return SETTINGS.accessibility.state.clickthrough === true;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getClickthroughState(): boolean {
  return isClickthrough;
}

export async function restoreLiveWindowInteractivity(liveWindow?: LiveWindowHandle | null): Promise<void> {
  const windowHandle = liveWindow ?? await WebviewWindow.getByLabel("live");
  if (!windowHandle) return;

  await windowHandle.setFocusable(true);
  await windowHandle.setIgnoreCursorEvents(shouldIgnoreLiveWindowCursorEvents());
}

export async function forceLiveWindowCursorPassthrough(liveWindow?: LiveWindowHandle | null): Promise<void> {
  const windowHandle = liveWindow ?? await WebviewWindow.getByLabel("live");
  if (!windowHandle) return;

  await windowHandle.setFocusable(false);
  await windowHandle.setIgnoreCursorEvents(true);
}

export async function requestLiveWindowInteractionRestore(): Promise<void> {
  await emit(LIVE_WINDOW_INTERACTION_RESTORE_REQUEST_EVENT).catch((error) => {
    console.warn("Failed to request live window interaction restore:", error);
  });
}

export async function showLiveWindowWithoutFocus(
  liveWindow?: LiveWindowHandle | null,
  options: { emitManualShow?: boolean } = {},
): Promise<void> {
  const windowHandle = liveWindow ?? await WebviewWindow.getByLabel("live");
  if (!windowHandle) return;

  const emitManualShow = options.emitManualShow ?? true;
  const ignoreCursorEvents = shouldIgnoreLiveWindowCursorEvents();
  await windowHandle.setFocusable(false);
  await windowHandle.setIgnoreCursorEvents(ignoreCursorEvents);
  await windowHandle.show();
  await windowHandle.unminimize();
  await wait(LIVE_WINDOW_FOCUS_RESTORE_DELAY_MS);
  await windowHandle.setFocusable(true);
  await windowHandle.setIgnoreCursorEvents(ignoreCursorEvents);
  if (emitManualShow) {
    await emit(LIVE_WINDOW_MANUAL_SHOW_EVENT).catch((error) => {
      console.warn("Failed to notify live window manual show:", error);
    });
  }
}

export async function hideVisiblePassiveOverlayWindows(): Promise<Set<string>> {
  const hiddenLabels = new Set<string>();
  for (const label of PASSIVE_OVERLAY_WINDOW_LABELS) {
    const overlayWindow = await WebviewWindow.getByLabel(label);
    if (!overlayWindow) continue;
    const visible = await overlayWindow.isVisible().catch(() => false);
    if (!visible) continue;
    await overlayWindow.hide().catch((error) => {
      console.warn(`Failed to auto-hide overlay window '${label}':`, error);
    });
    hiddenLabels.add(label);
  }
  return hiddenLabels;
}

export async function restorePassiveOverlayWindows(labels: Iterable<string>): Promise<void> {
  for (const label of labels) {
    if (!PASSIVE_OVERLAY_WINDOW_LABELS.includes(label as typeof PASSIVE_OVERLAY_WINDOW_LABELS[number])) {
      continue;
    }
    const overlayWindow = await WebviewWindow.getByLabel(label);
    if (!overlayWindow) continue;
    await overlayWindow.setFocusable(false).catch(() => undefined);
    await overlayWindow.setIgnoreCursorEvents(true).catch(() => undefined);
    await overlayWindow.show().catch((error) => {
      console.warn(`Failed to restore auto-hidden overlay window '${label}':`, error);
    });
    await overlayWindow.unminimize().catch(() => undefined);
  }
}

export async function setClickthrough(bool: boolean) {
  const liveWindow = await WebviewWindow.getByLabel("live");
  await liveWindow?.setIgnoreCursorEvents(bool);
  if (!bool) {
    await liveWindow?.setFocusable(true);
  }
  isClickthrough = bool;
}

export async function toggleClickthrough() {
  await setClickthrough(!shouldIgnoreLiveWindowCursorEvents());
}

export async function setClickthroughPreference(enabled: boolean) {
  SETTINGS.accessibility.state.clickthrough = enabled;
  await setClickthrough(enabled);
}

export async function toggleClickthroughPreference() {
  await setClickthroughPreference(!shouldIgnoreLiveWindowCursorEvents());
}
