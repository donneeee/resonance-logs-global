import type { MessageKey } from "$lib/i18n/index.svelte";

export type ChallengePreset = {
  id: string;
  labelKey: MessageKey;
  damageIds: number[];
};

export const CHALLENGE_PRESETS: ChallengePreset[] = [
  {
    id: "n17-fuyoupao",
    labelKey: "challengeWatch.preset.n17Fuyoupao",
    damageIds: [
      110098100102,
      110098110103,
      110098130103,
      110098140102,
      110098140104,
      110098140107,
      120016180102,
    ],
  },
];

const DAMAGE_ID_TO_PRESET = new Map<number, ChallengePreset>();

for (const preset of CHALLENGE_PRESETS) {
  for (const id of preset.damageIds) {
    if (!DAMAGE_ID_TO_PRESET.has(id)) {
      DAMAGE_ID_TO_PRESET.set(id, preset);
    }
  }
}

export function getPresetForDamageId(id: number): ChallengePreset | undefined {
  return DAMAGE_ID_TO_PRESET.get(id);
}
