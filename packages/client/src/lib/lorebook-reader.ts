import type { LorebookEntry } from "@marinara-engine/shared";
import type { ActiveLorebookView } from "./chat-lorebooks";

/** Chat metadata key holding the Lorebook Reader's pinned entry ids, in pin order. */
export const LOREBOOK_READER_PINS_KEY = "lorebookPinnedEntryIds";

export interface LorebookReaderEntry {
  entry: LorebookEntry;
  lorebookName: string;
  /** Off when the entry, its chat override, or its lorebook's chat exclusion turns it off. */
  enabled: boolean;
  /** The entry's name (or first key) with macros replaced; empty for an untitled entry. */
  name: string;
  /** The entry's content with macros replaced. */
  content: string;
}

export interface LorebookReaderView {
  pinned: LorebookReaderEntry[];
  groups: Array<{ lorebook: ActiveLorebookView; entries: LorebookReaderEntry[] }>;
}

/** The pinned ids stored under {@link LOREBOOK_READER_PINS_KEY}; anything else reads as none. */
export function readLorebookReaderPins(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

/** Unpins a pinned entry, otherwise pins it last. */
export function toggleLorebookReaderPin(pins: string[], entryId: string): string[] {
  return pins.includes(entryId) ? pins.filter((id) => id !== entryId) : [...pins, entryId];
}

/**
 * Every entry of the chat's lorebooks, disabled ones included: pinned entries first (in pin order),
 * then the rest grouped by lorebook. Names and content have macros replaced, and a query keeps entries
 * whose replaced name or content contains it, so search matches what the Reader shows.
 */
export function buildLorebookReaderView({
  lorebooks,
  entries,
  pins,
  entryStateOverrides,
  query,
  resolveMacros = (text) => text,
}: {
  lorebooks: ActiveLorebookView[];
  entries: LorebookEntry[];
  pins: string[];
  entryStateOverrides?: Record<string, { enabled?: boolean }> | null;
  query: string;
  resolveMacros?: (text: string) => string;
}): LorebookReaderView {
  const needle = query.trim().toLocaleLowerCase();
  const pinOrder = new Map(pins.map((id, index) => [id, index]));
  const lorebookById = new Map(lorebooks.map((lorebook) => [lorebook.id, lorebook]));
  const entriesByLorebook = new Map<string, LorebookReaderEntry[]>();
  const pinned: LorebookReaderEntry[] = [];

  for (const entry of entries) {
    const lorebook = lorebookById.get(entry.lorebookId);
    if (!lorebook) continue;
    const name = resolveMacros(entry.name.trim() || entry.keys[0] || "").trim();
    const content = resolveMacros(entry.content).trim();
    if (needle && !`${name}\n${content}`.toLocaleLowerCase().includes(needle)) continue;
    const readerEntry: LorebookReaderEntry = {
      entry,
      lorebookName: lorebook.name,
      enabled: (entryStateOverrides?.[entry.id]?.enabled ?? entry.enabled) && !lorebook.isExcluded,
      name,
      content,
    };
    if (pinOrder.has(entry.id)) {
      pinned.push(readerEntry);
      continue;
    }
    const group = entriesByLorebook.get(lorebook.id) ?? [];
    group.push(readerEntry);
    entriesByLorebook.set(lorebook.id, group);
  }

  pinned.sort((a, b) => pinOrder.get(a.entry.id)! - pinOrder.get(b.entry.id)!);
  const groups = lorebooks.flatMap((lorebook) => {
    const groupEntries = entriesByLorebook.get(lorebook.id) ?? [];
    return groupEntries.length > 0 ? [{ lorebook, entries: groupEntries }] : [];
  });
  return { pinned, groups };
}
