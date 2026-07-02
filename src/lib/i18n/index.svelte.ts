import { SETTINGS } from "$lib/settings-store";
import { uiT } from "$lib/i18n";

export type MessageKey = string;

const translateMinimap = uiT(
  "minimap",
  () => SETTINGS.live.general.state.language,
);

export function t(
  key: string,
  params?: Record<string, string | number | boolean | null | undefined>,
): string {
  let text = translateMinimap(key, key);

  if (params) {
    for (const [paramKey, value] of Object.entries(params)) {
      text = text.replaceAll(`{${paramKey}}`, String(value ?? ""));
    }
  }

  return text;
}
