// ──────────────────────────────────────────────
// Lorebook Reader: the chat's lorebook entries for the player to read
//
// A chat control window that lists every entry of the chat's lorebooks (disabled ones
// dimmed) as plain reading: name and content with macros replaced, no prompt settings.
// Pinned entries stay open at the top; pins are saved with the chat.
// ──────────────────────────────────────────────
import { useMemo, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, ExternalLink, Loader2, Pin, PinOff, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Chat, Lorebook } from "@marinara-engine/shared";
import { useCharacters, usePersonas } from "../../hooks/use-characters";
import { useUpdateChatMetadata } from "../../hooks/use-chats";
import { useEntriesAcrossLorebooks, useLorebooks } from "../../hooks/use-lorebooks";
import {
  deriveActiveLorebookViews,
  getChatActiveLorebookIds,
  getChatExcludedLorebookIds,
  type ActiveLorebookView,
} from "../../lib/chat-lorebooks";
import { createInputMacroResolverForChat } from "../../lib/chat-macros";
import {
  LOREBOOK_READER_PINS_KEY,
  buildLorebookReaderView,
  readLorebookReaderPins,
  toggleLorebookReaderPin,
  type LorebookReaderEntry,
} from "../../lib/lorebook-reader";
import { cn } from "../../lib/utils";
import { useUIStore } from "../../stores/ui.store";
import { CHAT_CONTROL_WINDOW_IDS, ChatControlWindow } from "./ChatControlWindow";

type ReaderChat = Pick<Chat, "id" | "metadata" | "characterIds" | "personaId" | "personaCharacterId" | "mode">;

/** The chat's lorebooks, as the Reader lists them; the Reader shows only while there is one. */
export function useLorebookReaderLorebooks(chat: ReaderChat | null | undefined): ActiveLorebookView[] {
  const { data: lorebooks } = useLorebooks();
  return useMemo(
    () =>
      chat
        ? deriveActiveLorebookViews({
            activeLorebookIds: getChatActiveLorebookIds(chat),
            chat,
            excludedLorebookIds: getChatExcludedLorebookIds(chat),
            lorebooks: (lorebooks ?? []) as Lorebook[],
          })
        : [],
    [chat, lorebooks],
  );
}

/** The Reader's control window, for the lorebooks from {@link useLorebookReaderLorebooks}. */
export function LorebookReaderWindow({
  chat,
  chatMeta,
  lorebooks,
  slot,
  phoneSlot,
}: {
  chat: ReaderChat;
  chatMeta: Record<string, any>;
  lorebooks: ActiveLorebookView[];
  slot: number;
  phoneSlot?: number;
}) {
  const { t } = useTranslation();
  if (lorebooks.length === 0) return null;
  return (
    <ChatControlWindow
      id={CHAT_CONTROL_WINDOW_IDS.lorebookReader}
      title={t("chat.lorebookReader.title")}
      icon={<BookOpen size={14} />}
      slot={slot}
      phoneSlot={phoneSlot}
      width={340}
      height={440}
    >
      <LorebookReaderContent chat={chat} chatMeta={chatMeta} lorebooks={lorebooks} />
    </ChatControlWindow>
  );
}

function LorebookReaderContent({
  chat,
  chatMeta,
  lorebooks,
}: {
  chat: ReaderChat;
  chatMeta: Record<string, any>;
  lorebooks: ActiveLorebookView[];
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const { entries, isLoading, isError } = useEntriesAcrossLorebooks(lorebooks.map((lorebook) => lorebook.id));
  const { data: characters } = useCharacters();
  const { data: personas } = usePersonas();
  const updateMetadata = useUpdateChatMetadata();
  const storedPins: unknown = chatMeta[LOREBOOK_READER_PINS_KEY];
  const pins = useMemo(() => readLorebookReaderPins(storedPins), [storedPins]);

  // ponytail: display-only macros reuse the chat input's resolver, so chat variables ({{getvar}}) and
  // lorebook-only macros stay unresolved. Upgrade path: a server route using buildPromptMacroContext.
  const resolveMacros = useMemo(
    () => createInputMacroResolverForChat(chat, characters as Array<{ id: string; data: unknown }>, personas),
    [chat, characters, personas],
  );
  const view = useMemo(
    () =>
      buildLorebookReaderView({
        lorebooks,
        entries: entries ?? [],
        pins,
        entryStateOverrides: chatMeta.entryStateOverrides,
        query,
      }),
    [lorebooks, entries, pins, chatMeta.entryStateOverrides, query],
  );

  const togglePin = (entryId: string) =>
    updateMetadata.mutate({ id: chat.id, [LOREBOOK_READER_PINS_KEY]: toggleLorebookReaderPin(pins, entryId) });

  const renderEntry = (item: LorebookReaderEntry, pinned: boolean) => (
    <LorebookReaderEntryRow
      key={item.entry.id}
      item={item}
      pinned={pinned}
      resolveMacros={resolveMacros}
      onTogglePin={() => togglePin(item.entry.id)}
    />
  );

  return (
    <div data-component="LorebookReader" className="pb-2">
      <div className="sticky top-0 z-10 bg-[var(--marinara-chat-chrome-panel-bg)] p-2">
        <div className="relative">
          <Search
            size="0.8125rem"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("chat.lorebookReader.searchPlaceholder")}
            aria-label={t("chat.lorebookReader.searchLabel")}
            className="mari-chrome-field h-8 w-full !rounded-md pl-8 pr-2 text-xs"
          />
        </div>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 px-3 py-4 text-xs text-[var(--muted-foreground)]">
          <Loader2 size="0.75rem" className="animate-spin" />
          {t("chat.lorebookReader.loading")}
        </div>
      ) : isError ? (
        <p className="px-3 py-4 text-xs text-[var(--destructive)]">{t("chat.lorebookReader.loadError")}</p>
      ) : view.pinned.length === 0 && view.groups.length === 0 ? (
        <p className="px-3 py-4 text-center text-xs text-[var(--muted-foreground)]">
          {query.trim() ? t("chat.lorebookReader.noMatches") : t("chat.lorebookReader.empty")}
        </p>
      ) : (
        <div className="space-y-3 px-2">
          {view.pinned.length > 0 && (
            <section aria-label={t("chat.lorebookReader.pinned")}>
              <h4 className="mb-1 flex items-center gap-1 px-1 text-[0.625rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                <Pin size="0.625rem" />
                {t("chat.lorebookReader.pinned")}
              </h4>
              <div className="space-y-1">{view.pinned.map((item) => renderEntry(item, true))}</div>
            </section>
          )}
          {view.groups.map(({ lorebook, entries: groupEntries }) => (
            <section key={lorebook.id} aria-label={lorebook.name}>
              <h4 className="mb-1 flex items-center gap-1 px-1 text-[0.625rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                <BookOpen size="0.625rem" />
                <span className="truncate">{lorebook.name}</span>
              </h4>
              <div className="space-y-1">{groupEntries.map((item) => renderEntry(item, false))}</div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function LorebookReaderEntryRow({
  item,
  pinned,
  resolveMacros,
  onTogglePin,
}: {
  item: LorebookReaderEntry;
  pinned: boolean;
  resolveMacros: (template: string) => string;
  onTogglePin: () => void;
}) {
  const { t } = useTranslation();
  // Pinned entries are the ones the player reaches for, so they start open.
  const [expanded, setExpanded] = useState(pinned);
  const { entry, enabled } = item;
  const name = entry.name.trim() || entry.keys[0] || t("chat.lorebookReader.untitled");
  const content = expanded ? resolveMacros(entry.content).trim() : "";
  const actionClassName =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]";

  return (
    <div className={cn("rounded-lg text-xs ring-1 ring-[var(--border)]", !enabled && "opacity-60")}>
      <div className="flex items-center gap-1 pl-1 pr-1">
        <button
          type="button"
          className="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 rounded px-1 text-left"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? (
            <ChevronDown size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" />
          ) : (
            <ChevronRight size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" />
          )}
          <span className="min-w-0 flex-1 truncate font-medium text-[var(--foreground)]">{name}</span>
          {pinned && (
            <span className="shrink-0 truncate text-[0.625rem] text-[var(--muted-foreground)]">
              {item.lorebookName}
            </span>
          )}
          {!enabled && (
            <span className="shrink-0 rounded bg-[var(--accent)] px-1 py-0.5 text-[0.5rem] font-semibold uppercase text-[var(--muted-foreground)]">
              {t("chat.lorebookReader.off")}
            </span>
          )}
        </button>
        <button
          type="button"
          className={actionClassName}
          aria-pressed={pinned}
          aria-label={t(pinned ? "chat.lorebookReader.unpin" : "chat.lorebookReader.pin", { entry: name })}
          title={t(pinned ? "chat.lorebookReader.unpin" : "chat.lorebookReader.pin", { entry: name })}
          onClick={onTogglePin}
        >
          {pinned ? <PinOff size="0.75rem" /> : <Pin size="0.75rem" />}
        </button>
        <button
          type="button"
          className={actionClassName}
          aria-label={t("chat.lorebookReader.openInEditor", { entry: name })}
          title={t("chat.lorebookReader.openInEditor", { entry: name })}
          onClick={() => useUIStore.getState().openLorebookDetail(entry.lorebookId, { entryId: entry.id })}
        >
          <ExternalLink size="0.75rem" />
        </button>
      </div>
      {expanded && (
        <p className="select-text whitespace-pre-wrap break-words border-t border-[var(--border)] px-2.5 py-2 text-[0.75rem] leading-relaxed text-[var(--foreground)]">
          {content || <span className="text-[var(--muted-foreground)]">{t("chat.lorebookReader.emptyEntry")}</span>}
        </p>
      )}
    </div>
  );
}
