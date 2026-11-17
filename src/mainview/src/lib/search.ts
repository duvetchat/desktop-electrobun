import { searchConversationMessages, type Conversation } from "$lib/api/conversations";
import { searchSpaceMessages, type MessageSearch } from "$lib/api/messages";
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

/**
 * The search everywhere, as the mobile app's (its GlobalSearch): each Space's, and the 5 newest conversations' (the
 * list's first, as a message moves its conversation up), at once, with no API of its own, then the 20 newest messages
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
		...conversations.slice(0, 5).map((conversation) =>
			searchConversationMessages(conversation.id, search, signal).then((res) => ({
				found: res.messages.map(
					(m): FoundMessage => ({
						message: directMessageToMessage(m, conversation.members),
						roomId: null,
						conversationId: conversation.id,
					}),
				),
				total: res.total_results,
			})),
		),
	];
	const settled = await Promise.allSettled(searches);
	const answered = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
	const failed = settled.find((r) => r.status === "rejected");
	if (answered.length === 0 && failed) throw failed.reason;
	const found = answered
		.flatMap((a) => a.found)
		.sort((a, b) => Date.parse(b.message.created_at) - Date.parse(a.message.created_at))
		.slice(0, EVERYWHERE_RESULTS);
	return { found, total: answered.reduce((sum, a) => sum + a.total, 0) };
}

/** What has: takes. */
export const SEARCH_HAS = ["link", "embed", "file", "image", "video", "sound", "sticker"];

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
 * The search box's text as a search, or why it isn't one. from: and mentions: name one of members, in: one of rooms.
 * As in Discord, after: and before: leave the day out, and during: is that day. Dates narrow each other: the latest
 * start and the earliest end count, so after: one day and during: an earlier one find nothing, as the mobile app's
 * parseSearch reads them. now is the day an error gives as an example.
 */
export function parseSearch(
	text: string,
	members: { id: string; username: string; raw_username: string }[],
	rooms: { id: string; name: string }[],
	now = new Date(),
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
			if (!member) return { error: `No member is called ${m[2]}` };
			add(key === "from" ? "authorIds" : "mentions", member.id);
		} else if (key === "in") {
			const room = rooms.find((r) => roomSlug(r.name) === value);
			if (!room) return { error: `No room is called ${m[2]}` };
			add("roomIds", room.id);
		} else if (key === "has") {
			if (!SEARCH_HAS.includes(value)) return { error: `has: takes ${SEARCH_HAS.join(", ")}` };
			add("has", value);
		} else if (key === "pinned") {
			if (value !== "true" && value !== "false") return { error: "pinned: takes true or false" };
			search.pinned = value === "true";
		} else {
			const day = parseDay(value);
			if (!day) return { error: `${key}: takes a date like ${isoDay(now)}` };
			const [start, end] =
				key === "before" ? [undefined, day] : key === "after" ? [nextDay(day), undefined] : [day, nextDay(day)];
			if (start && (!search.after || start > new Date(search.after))) search.after = start.toISOString();
			if (end && (!search.before || end < new Date(search.before))) search.before = end.toISOString();
		}
	}
	search.query = words.join(" ");
	return { search };
}
