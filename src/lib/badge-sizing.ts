export function scaledBadgeSize(baseSize: number, scalePercent: number | undefined): number {
  const safeBase = Number.isFinite(baseSize) ? baseSize : 24;
  const numericScale = typeof scalePercent === "number" && Number.isFinite(scalePercent)
    ? scalePercent
    : 100;
  const safeScale = Math.max(25, Math.min(250, numericScale));

  return Math.max(8, Math.round((safeBase * safeScale) / 100));
}
