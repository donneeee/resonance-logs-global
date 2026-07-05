import damageAttrIdNamesData from "$parserData/generated/DamageAttrIdNameRuntime.json";
import recountTableData from "$parserData/generated/RecountTable.json";
import { DEFAULT_LOCALE, type LocaleCode } from "$lib/i18n";
import {
  resolveLocalizedText,
  type LocalizedTextMap,
} from "$lib/config/recount-table";

export type DamageSearchResult = {
  key: string;
  name: string;
  ids: number[];
  isGroup: boolean;
};

type CatalogEntry = DamageSearchResult & { nameLower: string };

type DamageNameEntry = {
  Id?: number | string;
  Name?: string;
  Names?: LocalizedTextMap;
};

type RecountEntry = {
  Id?: number | string;
  RecountName?: string;
  Name?: string;
  Names?: LocalizedTextMap;
  DamageId?: Array<number | string>;
};

const damageAttrIdNames = damageAttrIdNamesData as Record<string, DamageNameEntry>;
const recountTable = recountTableData as Record<string, RecountEntry>;
const CATALOG_BY_LOCALE = new Map<string, CatalogEntry[]>();

function toFiniteId(value: unknown): number | null {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function resolveEntryName(
  names: LocalizedTextMap | undefined,
  locale: string,
  fallback: string | undefined,
): string {
  return resolveLocalizedText(names, locale, fallback ?? "").trim();
}

function pushEntry(
  entries: CatalogEntry[],
  seenKeys: Set<string>,
  entry: DamageSearchResult,
): void {
  if (!entry.name || entry.ids.length === 0) return;
  if (seenKeys.has(entry.key)) return;
  seenKeys.add(entry.key);
  entries.push({
    ...entry,
    nameLower: entry.name.toLowerCase(),
  });
}

function buildCatalog(locale: string): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  const seenKeys = new Set<string>();

  for (const [fallbackId, entry] of Object.entries(recountTable)) {
    const recountId = toFiniteId(entry.Id ?? fallbackId);
    if (!recountId || !entry.DamageId?.length) continue;

    const ids = entry.DamageId.map(toFiniteId).filter(
      (id): id is number => id !== null,
    );
    if (ids.length === 0) continue;

    const name = resolveEntryName(
      entry.Names,
      locale,
      entry.RecountName ?? entry.Name,
    );
    pushEntry(entries, seenKeys, {
      key: `g:${recountId}`,
      name,
      ids,
      isGroup: true,
    });
  }

  for (const [fallbackId, entry] of Object.entries(damageAttrIdNames)) {
    const id = toFiniteId(entry.Id ?? fallbackId);
    if (!id) continue;

    const name = resolveEntryName(entry.Names, locale, entry.Name);
    pushEntry(entries, seenKeys, {
      key: `s:${id}`,
      name,
      ids: [id],
      isGroup: false,
    });
  }

  entries.sort(
    (a, b) =>
      Number(b.isGroup) - Number(a.isGroup) ||
      a.name.localeCompare(b.name, locale),
  );

  return entries;
}

function getCatalog(locale: string): CatalogEntry[] {
  const cached = CATALOG_BY_LOCALE.get(locale);
  if (cached) return cached;
  const built = buildCatalog(locale);
  CATALOG_BY_LOCALE.set(locale, built);
  return built;
}

export function searchForbiddenDamage(
  query: string,
  locale: LocaleCode = DEFAULT_LOCALE,
  limit = 60,
): { results: DamageSearchResult[]; total: number } {
  const q = query.trim().toLowerCase();
  if (!q) return { results: [], total: 0 };

  const matched: CatalogEntry[] = [];
  for (const entry of getCatalog(locale)) {
    if (entry.nameLower.includes(q) || entry.ids.some((id) => String(id).includes(q))) {
      matched.push(entry);
    }
  }

  return {
    results: matched.slice(0, limit).map(({ nameLower: _nameLower, ...entry }) => entry),
    total: matched.length,
  };
}
