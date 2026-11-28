import { searchConversationMessages, type Conversation, type DirectMessage } from "$lib/api/conversations";
import { searchSpaceMessages, type MessageSearch } from "$lib/api/messages";
import type { MessageContent, ShownMessage } from "$lib/e2e/engine/content";
import { apiTakes, deviceSearchOf, type DeviceFound, type DeviceSearch } from "$lib/e2e/engine/search";
import { CoreError } from "$lib/e2e/errors";
import { t } from "$lib/i18n";
import { formatList } from "$lib/i18n/format";
import { directMessageToMessage, gatewayMessageToMessage, type GatewaySpace, type Message } from "$lib/types";

/** A message a search found, and where it is: a room (of spaceId, when the search was everywhere), or a conversation. */
export interface FoundMessage {
	message: Message;
	roomId: string | null;
	spaceId?: string;
	conversationId?: string;
}

/** How many messages the search everywhere shows. */
export const EVERYWHERE_RESULTS = 20;

/** How many messages a page of a conversation's search has, as a page of the API's search has. */
export const CONVERSATION_RESULTS = 25;

/** Where a conversation's next page of results starts: past as many as the device gave, or past the API's last. */
export type SearchPage = { offset: number } | { cursor: string };

/**
 * What a search reads of this device's database (lib/e2e/engine.svelte.ts gives it as its engine starts): its own search
 * of the conversations, its rows of the messages the API's search found, and the API's rows the app already holds (its
 * chats' loaded pages), which a result asks nothing for. Without it, this device can't search.
 */
export interface DeviceReads {
	search(request: DeviceSearch): Promise<DeviceFound>;
	read(conversationId: string, ids: string[]): Promise<{ rows: ShownMessage[] }>;
	loaded(conversationId: string, id: string): DirectMessage | undefined;
}

let device: DeviceReads | null = null;
export function useDeviceSearch(reads: DeviceReads | null) {
	device = reads;
}

/** The most rows a page of the core's search gives. */
const DEVICE_PAGE = 100;

/** A search replaced while it ran ends in its abort: the device's part can't be called off, and what it found goes. */
function dropIfReplaced(signal: AbortSignal | undefined) {
	if (signal?.aborted) throw new DOMException("the search was replaced", "AbortError");
}

/**
 * A failure of the device's search, as the panel says it: not ready, unless the core refused the search itself. The
 * page's engine refuses with `not_ready` when it has none, a code of its own that crosses tabs (#508).
 */
function notReady(error: unknown): never {
	if (error instanceof CoreError && error.code !== "internal" && error.code !== "not_ready") throw error;
	throw new Error(t("e2e_not_ready"));
}

/**
 * The search everywhere, as the mobile app's (its GlobalSearch): each Space's, which the API searches, and one search of
 * this device's over every conversation (decision 42), at once, with no API of its own, then the 20 newest messages
 * found, newest first. One that fails leaves its messages out; all of them failing is a failure. The total is theirs
 * together.
 */
export async function searchEverywhere(
	search: MessageSearch,
	spaces: GatewaySpace[],
	conversations: Conversation[],
	signal?: AbortSignal,
): Promise<{ found: FoundMessage[]; total: number }> {
	const searches = [
		...spaces.map((space) =>
			searchSpaceMessages(space.id, search, signal).then((res) => ({
				found: res.messages.map(
					(m): FoundMessage => ({ message: gatewayMessageToMessage(m, spaces), roomId: m.room_id, spaceId: space.id }),
				),
				total: res.total_results,
			})),
		),
		...conversationsEverywhere(search, conversations, signal),
	];
	const settled = await Promise.allSettled(searches);
	dropIfReplaced(signal);
	const answered = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
	const failed = settled.find((r) => r.status === "rejected");
	if (answered.length === 0 && failed) throw failed.reason;
	const found = answered
		.flatMap((a) => a.found)
		.sort((a, b) => Date.parse(b.message.created_at) - Date.parse(a.message.created_at))
		.slice(0, EVERYWHERE_RESULTS);
	return { found, total: answered.reduce((sum, a) => sum + a.total, 0) };
}

/**
 * The conversations' part of a search everywhere: the device's own search of them all, none without conversations or
 * an engine to search them. Without words, one that needs what only the API knows (pinned:, has:sticker) goes to its
 * search of the 5 newest conversations, the list's first, as a message moves its conversation up; with words, those can
 * go to neither, and no conversation is searched.
 */
function conversationsEverywhere(search: MessageSearch, conversations: Conversation[], signal?: AbortSignal) {
	const onDevice = deviceSearchOf(search);
	if (onDevice) {
		return device && conversations.length
			? [deviceFinds({ ...onDevice, limit: DEVICE_PAGE }, conversations, EVERYWHERE_RESULTS)]
			: [];
	}
	if (!apiTakes(search)) return [];
	return conversations.slice(0, 5).map((conversation) => apiFinds(conversation, search, undefined, signal));
}

/**
 * A conversation's search (decision 42): its words, from:, mentions:, dates and has: on this device, which holds its
 * messages' text; pinned: and has:sticker, which the API keeps in the clear, through the API's search, without words,
 * each message's text the device's. What needs both (words, or has:image, video or sound, with either of those) can go
 * to neither: it's refused, saying so. A page of what it found, with its total and where the next page starts.
 */
export async function searchConversation(
	conversation: Conversation,
	search: MessageSearch,
	from?: SearchPage,
	signal?: AbortSignal,
): Promise<{ found: FoundMessage[]; total: number; next: SearchPage | null }> {
	const onDevice = deviceSearchOf(search);
	if (!onDevice && !apiTakes(search)) throw new Error(t("e2e_search_split"));
	const found = onDevice
		? await deviceFinds(
				{ ...onDevice, conversation_id: conversation.id, limit: CONVERSATION_RESULTS },
				[conversation],
				CONVERSATION_RESULTS,
				from && "offset" in from ? from.offset : 0,
			)
		: await apiFinds(conversation, search, from && "cursor" in from ? from.cursor : undefined, signal);
	dropIfReplaced(signal);
	return found;
}

/**
 * What the device's search finds, as results: `most` of them, newest first, the core's pages read from `offset` on past
 * the rows a result leaves out (shownRow). The next page starts past the last row read.
 */
async function deviceFinds(request: DeviceSearch, conversations: Conversation[], most: number, offset = 0) {
	const reads = device;
	if (!reads) throw new Error(t("e2e_not_ready"));
	const found: FoundMessage[] = [];
	for (;;) {
		const { total, messages } = await reads.search({ ...request, offset }).catch(notReady);
		for (const row of messages) {
			offset++;
			const shown = shownRow(row, conversations, reads);
			if (shown) found.push(shown);
			if (found.length === most) return { found, total, next: offset < total ? { offset } : null };
		}
		if (!messages.length || offset >= total) return { found, total, next: null };
	}
}

/** What the API's search of a conversation finds: its rows, their text and their quotes' the device's own. */
async function apiFinds(conversation: Conversation, search: MessageSearch, cursor?: string, signal?: AbortSignal) {
	// It takes no words (apiTakes): a query of punctuation alone goes no further than here.
	const res = await searchConversationMessages(conversation.id, { ...search, query: undefined, cursor }, signal);
	const ids = res.messages.flatMap((m) => {
		const quoted = m.referenced_message?.message_id;
		return quoted ? [m.id, quoted] : [m.id];
	});
	if (ids.length && !device) throw new Error(t("e2e_not_ready"));
	const rows = device && ids.length ? (await device.read(conversation.id, ids).catch(notReady)).rows : [];
	// A row the conversation doesn't draw (#575) is no result; the pages still go by what the API gave.
	const found = res.messages.flatMap((m): FoundMessage[] => {
		const message = directMessageToMessage(m, conversation.members, holding(rows));
		return message ? [{ message, roomId: null, conversationId: conversation.id }] : [];
	});
	const last = res.messages.at(-1);
	return {
		found,
		total: res.total_results,
		next: last && res.messages.length === CONVERSATION_RESULTS ? { cursor: last.id } : null,
	};
}

/**
 * A row of the device's as a result draws it: the message as the API lists one, its text the row's. None for one it
 * can't open (the person's own still being sent has no ID yet), one of a conversation the app doesn't list (a group the
 * person left), or a sticker's empty envelope whose sticker only the API's row says: drawn when the app already holds
 * that row, as asking for it would tell the API what the search found.
 */
function shownRow(row: ShownMessage, conversations: Conversation[], reads: DeviceReads): FoundMessage | null {
	const conversation = conversations.find((c) => c.id === row.conversation_id);
	if (row.status !== "ok" || !row.message_id || !conversation) return null;
	const empty = !row.text && !row.attachments.length;
	const sticker = empty ? reads.loaded(conversation.id, row.message_id)?.sticker_attachment_id : null;
	if (empty && !sticker) return null;
	const at = new Date(row.sent_at).toISOString();
	const listed: DirectMessage = {
		...{ id: row.message_id, conversation_id: conversation.id, author_id: row.user_id, content: null, type: 0 },
		...{ created_at: at, updated_at: at, seq: row.seq ?? 0, sent_at: row.sent_at, sticker_attachment_id: sticker },
	};
	const message = directMessageToMessage(listed, conversation.members, holding([row]));
	return message && { message, roomId: null, conversationId: conversation.id };
}

/** What a result draws of the device: these rows, and nothing still to come, so one it doesn't hold waits. */
function holding(rows: ShownMessage[]): MessageContent {
	const byId = new Map(rows.map((row) => [row.message_id, row]));
	return { held: (id) => byId.get(id) ?? null, typed: () => undefined, through: () => Number.POSITIVE_INFINITY };
}

/** What has: takes. */
export const SEARCH_HAS = ["link", "embed", "file", "image", "video", "sound", "sticker"];
/** What has: takes in a conversation: its messages have no previews, and the device can't search their links. */
export const CONVERSATION_HAS = ["file", "image", "video", "sound", "sticker"];

/** A local day as the search's dates are written: YYYY-MM-DD. */
export const isoDay = (d: Date) =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** A room's name as in:'s value, without spaces so the search splits into words and filters. */
export const roomSlug = (name: string) => name.toLowerCase().replace(/\s+/g, "-");

function parseDay(value: string): Date | null {
	const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
	if (!m) return null;
	const d = new Date(+m[1]!, +m[2]! - 1, +m[3]!);
	return d.getMonth() === +m[2]! - 1 ? d : null;
}

const nextDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

/**
 * The search box's text as a search, or why it isn't one. from: and mentions: name one of members, in: one of rooms,
 * has: one of `has`. As in Discord, after: and before: leave the day out, and during: is that day. Dates narrow each
 * other: the latest start and the earliest end count, so after: one day and during: an earlier one find nothing, as the
 * mobile app's parseSearch reads them. now is the day an error gives as an example.
 */
export function parseSearch(
	text: string,
	members: { id: string; username: string; raw_username: string }[],
	rooms: { id: string; name: string }[],
	now = new Date(),
	has: readonly string[] = SEARCH_HAS,
): { search: MessageSearch } | { error: string } {
	const search: MessageSearch = {};
	const words: string[] = [];
	const add = (list: "authorIds" | "mentions" | "roomIds" | "has", v: string) => (search[list] ??= []).push(v);
	for (const part of text.split(/\s+/).filter(Boolean)) {
		const m = /^(from|mentions|in|has|pinned|before|after|during):(.*)$/i.exec(part);
		if (!m) {
			words.push(part);
			continue;
		}
		const key = m[1]!.toLowerCase();
		const value = m[2]!.toLowerCase();
		if (!value) continue;
		if (key === "from" || key === "mentions") {
			const member =
				members.find((u) => u.raw_username.toLowerCase() === value) ??
				members.find((u) => u.username.toLowerCase() === value);
			if (!member) return { error: t("chat_search_no_member", { name: m[2]! }) };
			add(key === "from" ? "authorIds" : "mentions", member.id);
		} else if (key === "in") {
			const room = rooms.find((r) => roomSlug(r.name) === value);
			if (!room) return { error: t("chat_search_no_room", { name: m[2]! }) };
			add("roomIds", room.id);
		} else if (key === "has") {
			if (!has.includes(value))
				return {
					error: t("chat_search_has_takes", { values: formatList(has, { type: "unit", style: "short" }) }),
				};
			add("has", value);
		} else if (key === "pinned") {
			if (value !== "true" && value !== "false") return { error: t("chat_search_pinned_takes") };
			search.pinned = value === "true";
		} else {
			const day = parseDay(value);
			if (!day) return { error: t("chat_search_date_takes", { filter: key, example: isoDay(now) }) };
			const [start, end] =
				key === "before" ? [undefined, day] : key === "after" ? [nextDay(day), undefined] : [day, nextDay(day)];
			if (start && (!search.after || start > new Date(search.after))) search.after = start.toISOString();
			if (end && (!search.before || end < new Date(search.before))) search.before = end.toISOString();
		}
	}
	search.query = words.join(" ");
	return { search };
}
