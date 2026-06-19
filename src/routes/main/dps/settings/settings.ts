import type { ShortcutCommandSettingId } from "$lib/settings-store";

export type BaseInputs = BaseInput[];

/** Common base for all settings */
export interface BaseInput {
  id: ShortcutCommandSettingId;
  label: string;
  description?: string;
}
