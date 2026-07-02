import dbmTableData from "$parserData/generated/DbmTable.json";
import {
  DEFAULT_LOCALE,
  PRIMARY_FALLBACK_LOCALE,
  isLocaleCode,
  type LocaleCode,
} from "$lib/i18n";
import { settings } from "$lib/settings-store";

type MultiLangValue = Partial<Record<LocaleCode | "design" | "und", string>>;

export type DbmTableEntry = {
  Id: number;
  CountCDTime?: number;
  Content?: string | null;
  ContentDesign?: string | null;
  Contents?: unknown;
};

function normalizeContents(value: unknown): MultiLangValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: MultiLangValue = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (
      (isLocaleCode(key) || key === "design" || key === "und")
      && typeof rawValue === "string"
      && rawValue.trim()
    ) {
      out[key] = rawValue.trim();
    }
  }
  return out;
}

function currentLocale(): LocaleCode {
  const locale = String(settings.state.live.general.language);
  return isLocaleCode(locale) ? locale : PRIMARY_FALLBACK_LOCALE;
}

function resolveEntryText(entry: DbmTableEntry | undefined): string | null {
  if (!entry) return null;
  const contents = normalizeContents(entry.Contents);
  const locale = currentLocale();
  return (
    contents[locale]
    ?? contents[PRIMARY_FALLBACK_LOCALE]
    ?? contents[DEFAULT_LOCALE]
    ?? contents.design
    ?? contents.und
    ?? entry.Content?.trim()
    ?? entry.ContentDesign?.trim()
    ?? null
  );
}

function lookupDbmEntry(id: number): DbmTableEntry | undefined {
  return (dbmTableData as Record<string, DbmTableEntry>)[String(id)];
}

export function resolveDbmSkillName(
  skillEffectId: number,
  baseSkillId: number,
): string {
  return (
    resolveEntryText(lookupDbmEntry(skillEffectId))
    ?? resolveEntryText(lookupDbmEntry(baseSkillId * 100 + 1))
    ?? `#${skillEffectId}`
  );
}
