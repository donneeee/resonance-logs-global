import type { SkillCdState } from "$lib/api";
import type { PlayerImagineInfo } from "$lib/player-imagines";
import { findResonanceSkill } from "$lib/skill-mappings";

export type PlayerImagineCooldownState = {
  active: boolean;
  usable: boolean;
  solidFraction: number;
  remainingText: string;
  chargesText?: string;
  chargesAvailable?: number;
  maxCharges?: number;
};

function positiveId(value: number | null | undefined): number | null {
  const id = Number(value ?? 0);
  if (!Number.isFinite(id) || id <= 0) return null;
  return Math.trunc(id);
}

function skillLevelBaseId(skillLevelId: number | null | undefined): number | null {
  const id = positiveId(skillLevelId);
  if (id === null) return null;
  const baseId = Math.trunc(id / 100);
  return baseId > 0 ? baseId : null;
}

function pushId(ids: Set<number>, value: number | null | undefined): void {
  const id = positiveId(value);
  if (id !== null) ids.add(id);
}

function playerImagineLookupIds(imagine: PlayerImagineInfo): number[] {
  const ids = new Set<number>();
  pushId(ids, imagine.skillId);
  pushId(ids, imagine.baseSkillId);
  pushId(ids, imagine.skillLevelId);
  pushId(ids, skillLevelBaseId(imagine.skillLevelId));
  for (const replaceSkillId of imagine.replaceSkillIds ?? []) {
    pushId(ids, replaceSkillId);
  }
  return [...ids];
}

function latestCooldown(
  ids: number[],
  cooldownBySkillId: ReadonlyMap<number, SkillCdState>,
): SkillCdState | null {
  let latest: SkillCdState | null = null;
  for (const id of ids) {
    const cd = cooldownBySkillId.get(id);
    if (!cd) continue;
    if (!latest || (cd.receivedAt ?? 0) >= (latest.receivedAt ?? 0)) {
      latest = cd;
    }
  }
  return latest;
}

function formatTenthsDown(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const floored = Math.floor(value * 10) / 10;
  return floored.toFixed(floored >= 10 ? 0 : 1);
}

function cooldownText(remainingMs: number): string {
  if (remainingMs <= 0) return "";
  if (remainingMs < 60_000) return `${formatTenthsDown(remainingMs / 1000)}s`;
  return `${formatTenthsDown(remainingMs / 60_000)}m`;
}

function cooldownProgress(cd: SkillCdState, nowMs: number) {
  const packetDuration = cd.duration > 0 ? Math.max(1, cd.duration) : 0;
  const calculatedDuration =
    cd.calculatedDuration > 0 ? Math.max(1, cd.calculatedDuration) : 0;
  const effectiveDuration = packetDuration || calculatedDuration;
  const progressRate = Math.max(1, 1 + Math.max(0, cd.cdAccelerateRate ?? 0));
  const elapsed = Math.max(0, nowMs - cd.receivedAt);
  const serverProgress = Math.max(0, cd.validCdTime ?? 0);
  const progressed = serverProgress + elapsed * progressRate;
  return { effectiveDuration, progressed };
}

export function computePlayerImagineCooldown(
  imagine: PlayerImagineInfo,
  cooldownBySkillId: ReadonlyMap<number, SkillCdState> | null | undefined,
  nowMs: number,
): PlayerImagineCooldownState | null {
  if (!cooldownBySkillId || cooldownBySkillId.size === 0) return null;

  const cd = latestCooldown(playerImagineLookupIds(imagine), cooldownBySkillId);
  if (!cd) return null;

  const skill = findResonanceSkill(imagine.skillId);
  const { effectiveDuration, progressed } = cooldownProgress(cd, nowMs);

  if (cd.duration === -1 && cd.skillCdType === 1) {
    const maxValidCdTime = skill?.maxValidCdTime;
    if (!maxValidCdTime) return null;
    const chargeFraction = Math.max(
      0,
      Math.min(1, Math.max(0, cd.validCdTime ?? 0) / maxValidCdTime),
    );
    return {
      active: chargeFraction < 1,
      usable: chargeFraction >= 1,
      solidFraction: chargeFraction,
      remainingText: `${Math.round(chargeFraction * 100)}%`,
    };
  }

  if (cd.skillCdType === 1 && cd.duration > 0 && effectiveDuration > 0) {
    const maxCharges = Math.max(1, skill?.maxCharges ?? 1);
    if (maxCharges > 1) {
      const maxValidCdTime = maxCharges * effectiveDuration;
      const currentValidCdTime = Math.min(maxValidCdTime, Math.max(0, progressed));
      const chargesAvailable = Math.min(
        maxCharges,
        Math.floor(currentValidCdTime / effectiveDuration),
      );
      const chargesOnCooldown = Math.max(0, maxCharges - chargesAvailable);
      if (chargesOnCooldown <= 0) {
        return {
          active: false,
          usable: true,
          solidFraction: 1,
          remainingText: "",
          chargesText: `${maxCharges}/${maxCharges}`,
          chargesAvailable: maxCharges,
          maxCharges,
        };
      }
      const timeToNextCharge = Math.max(
        0,
        effectiveDuration - (currentValidCdTime % effectiveDuration),
      );
      return {
        active: true,
        usable: chargesAvailable >= 1,
        solidFraction: Math.max(0, Math.min(1, chargesAvailable / maxCharges)),
        remainingText: cooldownText(timeToNextCharge),
        chargesText: `${chargesAvailable}/${maxCharges}`,
        chargesAvailable,
        maxCharges,
      };
    }
  }

  const remainingMs =
    effectiveDuration > 0 ? Math.max(0, effectiveDuration - progressed) : 0;
  return {
    active: remainingMs > 0,
    usable: remainingMs <= 0,
    solidFraction: remainingMs > 0 ? 0 : 1,
    remainingText: cooldownText(remainingMs),
  };
}
