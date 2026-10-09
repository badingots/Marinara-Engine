// ──────────────────────────────────────────────
// Lorebook Reader: the chat's lorebook entries for the player to read
//
// A chat control window that lists every entry of the chat's lorebooks (disabled ones
// dimmed). Opening an entry swaps the list for that entry's own view: its content as
// Markdown with macros replaced, no prompt settings. Pinned entries are listed first;
// pins are saved with the chat.
// ──────────────────────────────────────────────
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BookMarked,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Pin,
  PinOff,
  Search,
} from "lucide-react";
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
import { applyInlineMarkdown, renderMarkdownBlocks } from "../../lib/markdown";
import {
  LOREBOOK_READER_PINS_KEY,
  buildLorebookReaderView,
  readLorebookReaderPins,
  toggleLorebookReaderPin,
  type LorebookReaderEntry,
} from "../../lib/lorebook-reader";
import { cn } from "../../lib/utils";
import { useUIStore } from "../../stores/ui.store";
import { NEUTRAL_PANEL_SCROLL_AREA } from "../ui/neutral-surface-styles";
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
      icon={<BookMarked size={14} />}
      slot={slot}
      phoneSlot={phoneSlot}
      width={340}
      height={440}
      // The list and an open entry scroll separately, so going back keeps the list where it was.
      scroll={false}
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
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Where the list was scrolled and which row was opened, restored on the way back.
  const returnRef = useRef<{ scrollTop: number; entryId: string } | null>(null);
  const { entries, isLoading, isError } = useEntriesAcrossLorebooks(lorebooks.map((lorebook) => lorebook.id));
  const { data: characters } = useCharacters();
  const { data: personas } = usePersonas();
  const updateMetadata = useUpdateChatMetadata();
  const storedPins: unknown = chatMeta[LOREBOOK_READER_PINS_KEY];
  const pins = useMemo(() => readLorebookReaderPins(storedPins), [storedPins]);

  // ponytail: display-only macros reuse the chat input's resolver, so chat variables ({{getvar}}) and
  // lorebook-only macros stay unresolved. Upgrade path: a server route using buildPromptMacroContext.
  const resolveMacros = useMemo(() => {
    const resolve = createInputMacroResolverForChat(chat, characters as Array<{ id: string; data: unknown }>, personas);
    // Search rebuilds the view on every keystroke; replace each text once per chat context.
    const resolved = new Map<string, string>();
    return (text: string) => {
      let value = resolved.get(text);
      if (value === undefined) resolved.set(text, (value = resolve(text)));
      return value;
    };
  }, [chat, characters, personas]);
  const view = useMemo(
    () =>
      buildLorebookReaderView({
        lorebooks,
        entries: entries ?? [],
        pins,
        entryStateOverrides: chatMeta.entryStateOverrides,
        query,
        resolveMacros,
      }),
    [lorebooks, entries, pins, chatMeta.entryStateOverrides, query, resolveMacros],
  );
  // The search cannot change while an entry is open, so the open entry is always in the view;
  // one deleted meanwhile falls back to the list.
  const selected = selectedEntryId
    ? [...view.pinned, ...view.groups.flatMap((group) => group.entries)].find(
        (item) => item.entry.id === selectedEntryId,
      )
    : undefined;

  useLayoutEffect(() => {
    const target = returnRef.current;
    if (selected || !target || !listRef.current) return;
    returnRef.current = null;
    listRef.current.scrollTop = target.scrollTop;
    listRef.current.querySelector<HTMLElement>(`[data-reader-entry="${CSS.escape(target.entryId)}"]`)?.focus();
  }, [selected]);

  const openEntry = (entryId: string) => {
    returnRef.current = { scrollTop: listRef.current?.scrollTop ?? 0, entryId };
    setSelectedEntryId(entryId);
  };
  const togglePin = (entryId: string) =>
    updateMetadata.mutate({ id: chat.id, [LOREBOOK_READER_PINS_KEY]: toggleLorebookReaderPin(pins, entryId) });

  if (selected) {
    return (
      <LorebookReaderDetail
        item={selected}
        pinned={pins.includes(selected.entry.id)}
        onBack={() => setSelectedEntryId(null)}
        onTogglePin={() => togglePin(selected.entry.id)}
      />
    );
  }

  const renderEntry = (item: LorebookReaderEntry, pinned: boolean) => (
    <LorebookReaderListRow key={item.entry.id} item={item} pinned={pinned} onOpen={() => openEntry(item.entry.id)} />
  );

  return (
    <div data-component="LorebookReader" className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 p-2">
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
      <div
        ref={listRef}
        className={cn(NEUTRAL_PANEL_SCROLL_AREA, "min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2")}
      >
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
    </div>
  );
}

/**
 * The shared chat-message heading sizes (h1 is 1.5rem) dwarf the Reader's 0.75rem text, and their image cap
 * (28rem) is wider than the window. `!` is needed to beat the more specific `.mari-message-content` rules.
 */
const READER_MARKDOWN_SIZES =
  "[&_.mari-md-heading]:!text-[0.8125rem] [&_h1.mari-md-heading]:!text-[0.9375rem] [&_h2.mari-md-heading]:!text-[0.875rem] [&_img]:!max-w-full";

const READER_ICON_BUTTON =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]";

function readerEntryName(item: LorebookReaderEntry, untitled: string) {
  return item.name || untitled;
}

function OffBadge() {
  const { t } = useTranslation();
  return (
    <span className="shrink-0 rounded bg-[var(--accent)] px-1 py-0.5 text-[0.5rem] font-semibold uppercase text-[var(--muted-foreground)]">
      {t("chat.lorebookReader.off")}
    </span>
  );
}

/** One entry in the list: the whole row opens its detail view. */
function LorebookReaderListRow({
  item,
  pinned,
  onOpen,
}: {
  item: LorebookReaderEntry;
  pinned: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-reader-entry={item.entry.id}
      onClick={onOpen}
      className={cn(
        "flex min-h-9 w-full items-center gap-1.5 rounded-lg px-2.5 text-left text-xs ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)]",
        !item.enabled && "opacity-60",
      )}
    >
      <span className="min-w-0 flex-1 truncate font-medium text-[var(--foreground)]">
        {readerEntryName(item, t("chat.lorebookReader.untitled"))}
      </span>
      {pinned && (
        <span className="shrink-0 truncate text-[0.625rem] text-[var(--muted-foreground)]">{item.lorebookName}</span>
      )}
      {!item.enabled && <OffBadge />}
      <ChevronRight size="0.875rem" className="shrink-0 text-[var(--muted-foreground)]" />
    </button>
  );
}

/** One entry's own view: its name and actions above its content, with a way back to the list. */
function LorebookReaderDetail({
  item,
  pinned,
  onBack,
  onTogglePin,
}: {
  item: LorebookReaderEntry;
  pinned: boolean;
  onBack: () => void;
  onTogglePin: () => void;
}) {
  const { t } = useTranslation();
  const backRef = useRef<HTMLButtonElement>(null);
  const { entry } = item;
  const name = readerEntryName(item, t("chat.lorebookReader.untitled"));
  const renderedContent = useMemo(
    () =>
      item.content ? renderMarkdownBlocks(item.content, applyInlineMarkdown, `lorebook-reader-${entry.id}`) : null,
    [item.content, entry.id],
  );
  useEffect(() => backRef.current?.focus(), []);

  return (
    <div data-component="LorebookReaderDetail" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--border)] px-1 py-1">
        <button
          ref={backRef}
          type="button"
          className={READER_ICON_BUTTON}
          aria-label={t("chat.lorebookReader.back")}
          title={t("chat.lorebookReader.back")}
          onClick={onBack}
        >
          <ChevronLeft size="1rem" />
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-xs font-semibold text-[var(--foreground)]">{name}</h3>
          <p className="truncate text-[0.625rem] text-[var(--muted-foreground)]">{item.lorebookName}</p>
        </div>
        {!item.enabled && <OffBadge />}
        <button
          type="button"
          className={READER_ICON_BUTTON}
          aria-pressed={pinned}
          aria-label={t(pinned ? "chat.lorebookReader.unpin" : "chat.lorebookReader.pin", { entry: name })}
          title={t(pinned ? "chat.lorebookReader.unpin" : "chat.lorebookReader.pin", { entry: name })}
          onClick={onTogglePin}
        >
          {pinned ? <PinOff size="0.8125rem" /> : <Pin size="0.8125rem" />}
        </button>
        <button
          type="button"
          className={READER_ICON_BUTTON}
          aria-label={t("chat.lorebookReader.openInEditor", { entry: name })}
          title={t("chat.lorebookReader.openInEditor", { entry: name })}
          onClick={() => useUIStore.getState().openLorebookDetail(entry.lorebookId, { entryId: entry.id })}
        >
          <ExternalLink size="0.8125rem" />
        </button>
      </div>
      <div className={cn(NEUTRAL_PANEL_SCROLL_AREA, "min-h-0 flex-1 overflow-y-auto overscroll-contain")}>
        <div
          className={cn(
            "mari-message-content select-text whitespace-pre-wrap break-words px-3 py-2.5 text-[0.75rem] leading-relaxed",
            READER_MARKDOWN_SIZES,
          )}
        >
          {renderedContent ?? (
            <span className="text-[var(--muted-foreground)]">{t("chat.lorebookReader.emptyEntry")}</span>
          )}
        </div>
      </div>
    </div>
  );
}
