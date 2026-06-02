export const NO_DAMAGE_INFO = "-" as const;

export const DAMAGE_PROPERTY_LABELS: Readonly<Record<number, string>> = {
  0: "Generic",
  1: "Fire",
  2: "Water",
  3: "Lightning",
  4: "Wood",
  5: "Wind",
  6: "Earth",
  7: "Light",
  8: "Dark",
};

export const DAMAGE_MODE_LABELS: Readonly<Record<number, string>> = {
  1: "Physical",
  2: "Magical",
};

export const DAMAGE_PROPERTY_LABEL_KEYS: Readonly<Record<number, string>> = {
  0: "damage.property.generic",
  1: "damage.property.fire",
  2: "damage.property.water",
  3: "damage.property.lightning",
  4: "damage.property.wood",
  5: "damage.property.wind",
  6: "damage.property.earth",
  7: "damage.property.light",
  8: "damage.property.dark",
};

export const DAMAGE_MODE_LABEL_KEYS: Readonly<Record<number, string>> = {
  1: "damage.mode.physical",
  2: "damage.mode.magical",
};

export function propertyLabel(value: number | null | undefined): string {
  if (value == null) return NO_DAMAGE_INFO;
  return DAMAGE_PROPERTY_LABELS[value] ?? NO_DAMAGE_INFO;
}

export function damageModeLabel(value: number | null | undefined): string {
  if (value == null) return NO_DAMAGE_INFO;
  return DAMAGE_MODE_LABELS[value] ?? NO_DAMAGE_INFO;
}

export function propertyLabelKey(value: number | null | undefined): string | undefined {
  if (value == null) return undefined;
  return DAMAGE_PROPERTY_LABEL_KEYS[value];
}

export function damageModeLabelKey(value: number | null | undefined): string | undefined {
  if (value == null) return undefined;
  return DAMAGE_MODE_LABEL_KEYS[value];
}
