// Lorebook Reader: every chat lorebook entry is readable (disabled ones flagged), pins order the top
// of the list, and pins persist as chat-local view state.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LorebookEntry } from "../../packages/shared/src/index.js";
import type { ActiveLorebookView } from "../../packages/client/src/lib/chat-lorebooks.js";
import {
  buildLorebookReaderView,
  readLorebookReaderPins,
  toggleLorebookReaderPin,
} from "../../packages/client/src/lib/lorebook-reader.js";

const book = (id: string, name: string, isExcluded = false) =>
  ({ id, name, isExcluded, activeReasons: ["Chat"], isPinned: true }) as unknown as ActiveLorebookView;
const entry = (id: string, lorebookId: string, name: string, content: string, enabled = true) =>
  ({ id, lorebookId, name, content, enabled, keys: [] }) as unknown as LorebookEntry;

const lorebooks = [book("world", "World"), book("persona", "Persona notes"), book("muted", "Muted book", true)];
const entries = [
  entry("city", "world", "City", "A harbor town."),
  entry("schedule", "persona", "Class schedule", "Mon: History 101"),
  entry("secret", "persona", "Secret", "Never sent to the model.", false),
  entry("override", "world", "Override", "Turned off in this chat."),
  entry("muted-entry", "muted", "Muted", "Its book is excluded here."),
  entry("stray", "elsewhere", "Stray", "Not in this chat's lorebooks."),
];

const view = buildLorebookReaderView({
  lorebooks,
  entries,
  pins: ["schedule", "city", "deleted-entry"],
  entryStateOverrides: { override: { enabled: false } },
  query: "",
});
assert.deepEqual(
  view.pinned.map((item) => item.entry.id),
  ["schedule", "city"],
  "pinned entries keep pin order and drop pins whose entry is gone",
);
assert.deepEqual(
  view.groups.map((group) => [group.lorebook.id, group.entries.map((item) => item.entry.id)]),
  [
    ["world", ["override"]],
    ["persona", ["secret"]],
    ["muted", ["muted-entry"]],
  ],
  "unpinned entries group by lorebook, pinned entries are not repeated, and other lorebooks are ignored",
);
const enabled = Object.fromEntries(
  [...view.pinned, ...view.groups.flatMap((group) => group.entries)].map((item) => [item.entry.id, item.enabled]),
);
assert.deepEqual(
  enabled,
  { schedule: true, city: true, override: false, secret: false, "muted-entry": false },
  "disabled entries, chat overrides and excluded lorebooks read as off but stay listed",
);

const search = buildLorebookReaderView({ lorebooks, entries, pins: ["schedule"], query: "HISTORY" });
assert.deepEqual(
  search.pinned.map((item) => item.entry.id),
  ["schedule"],
  "search matches content, ignoring case",
);
assert.equal(search.groups.length, 0, "lorebooks without a match are hidden while searching");
assert.deepEqual(
  buildLorebookReaderView({ lorebooks, entries, pins: [], query: "secret" }).groups.flatMap((group) =>
    group.entries.map((item) => item.entry.id),
  ),
  ["secret"],
  "search matches entry names",
);

assert.deepEqual(toggleLorebookReaderPin(["a"], "b"), ["a", "b"], "pinning appends");
assert.deepEqual(toggleLorebookReaderPin(["a", "b"], "a"), ["b"], "pinning again unpins");
assert.deepEqual(readLorebookReaderPins(["a", 1, null, "b"]), ["a", "b"], "stored pins keep only ids");
assert.deepEqual(readLorebookReaderPins("a"), [], "malformed stored pins read as none");

const dataDir = mkdtempSync(join(tmpdir(), "marinara-lorebook-reader-"));
process.env.DATA_DIR = dataDir;
process.env.FILE_STORAGE_DIR = join(dataDir, "storage");
process.env.NODE_ENV = "test";
process.env.MARINARA_LITE = "true";
process.env.LOG_LEVEL = "silent";

const { default: Fastify } = await import("../../packages/server/node_modules/fastify/fastify.js");
const { getDB, closeDB } = await import("../../packages/server/src/db/connection.js");
const { chatsRoutes } = await import("../../packages/server/src/routes/chats.routes.js");
const { chatPresetsRoutes } = await import("../../packages/server/src/routes/chat-presets.routes.js");
const app = Fastify();
app.decorate("db", await getDB());
await app.register(chatsRoutes, { prefix: "/api/chats" });
await app.register(chatPresetsRoutes, { prefix: "/api/chat-presets" });

try {
  const created = await app.inject({
    method: "POST",
    url: "/api/chats",
    payload: { name: "Reader pins", mode: "roleplay", characterIds: [] },
  });
  assert.equal(created.statusCode, 200);
  const chatId = created.json().id as string;
  const readChat = async () => (await app.inject({ method: "GET", url: `/api/chats/${chatId}` })).json();
  const before = await readChat();
  // A clock tick apart, so a touched updatedAt would differ.
  await new Promise((resolve) => setTimeout(resolve, 5));

  const pinned = await app.inject({
    method: "PATCH",
    url: `/api/chats/${chatId}/metadata`,
    payload: { lorebookPinnedEntryIds: ["schedule", "city", "schedule"] },
  });
  assert.equal(pinned.statusCode, 200);
  const after = await readChat();
  assert.deepEqual(after.metadata.lorebookPinnedEntryIds, ["schedule", "city"], "pins persist without duplicates");
  assert.equal(after.updatedAt, before.updatedAt, "pinning is view state, not chat activity");

  const invalid = await app.inject({
    method: "PATCH",
    url: `/api/chats/${chatId}/metadata`,
    payload: { lorebookPinnedEntryIds: ["schedule", 7] },
  });
  assert.equal(invalid.statusCode, 400, "pins must be a list of ids");
  assert.deepEqual(
    (await readChat()).metadata.lorebookPinnedEntryIds,
    ["schedule", "city"],
    "a rejected patch keeps pins",
  );

  const profile = await app.inject({
    method: "POST",
    url: "/api/chat-presets",
    payload: { name: "No pins", mode: "roleplay" },
  });
  assert.equal(profile.statusCode, 200);
  const saved = await app.inject({
    method: "PUT",
    url: `/api/chat-presets/${profile.json().id}/settings`,
    payload: { metadata: (await readChat()).metadata },
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(
    saved.json().settings.metadata.lorebookPinnedEntryIds,
    undefined,
    "pins stay with the chat, never a settings profile",
  );
  console.info("Lorebook Reader view and pin regressions passed.");
} finally {
  await app.close();
  await closeDB();
  rmSync(dataDir, { recursive: true, force: true });
}
