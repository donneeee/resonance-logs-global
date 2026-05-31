export type PlayerTableMeasureOptions = {
  maxRows: number;
  fallbackRowHeight: number;
  fallbackHeaderHeight: number;
  includeHeader: boolean;
};

export function measurePlayerTableMaxHeight(
  container: HTMLElement | null | undefined,
  options: PlayerTableMeasureOptions,
): number {
  const maxRows = Math.max(1, Math.round(options.maxRows));
  const fallbackRowHeight = Math.max(1, options.fallbackRowHeight);
  const fallbackHeaderHeight = options.includeHeader
    ? Math.max(0, options.fallbackHeaderHeight)
    : 0;

  if (!container) {
    return Math.ceil(fallbackHeaderHeight + fallbackRowHeight * maxRows);
  }

  const headerHeight = options.includeHeader
    ? (container.querySelector("thead")?.getBoundingClientRect().height ??
      fallbackHeaderHeight)
    : 0;
  const rows = Array.from(container.querySelectorAll("tbody tr")).filter(
    (row): row is HTMLTableRowElement =>
      row instanceof HTMLTableRowElement && row.getClientRects().length > 0,
  );
  const sampledRows = rows.slice(0, Math.min(rows.length, maxRows));
  const measuredRowHeight =
    sampledRows.length > 0
      ? sampledRows.reduce(
          (sum, row) => sum + row.getBoundingClientRect().height,
          0,
        ) / sampledRows.length
      : fallbackRowHeight;

  return Math.ceil(
    headerHeight + Math.max(fallbackRowHeight, measuredRowHeight) * maxRows,
  );
}
