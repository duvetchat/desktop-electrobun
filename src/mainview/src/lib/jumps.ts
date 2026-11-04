import type { ReferencedMessage } from "$lib/types";
import type { MessageLink } from "$lib/urls";

/**
 * Where a click on a reply's quote jumps: to the message it quotes, which is in the reply's own room or conversation,
 * as the API takes no reply to a message elsewhere. A list without a space is a conversation's (the list's channel is
 * the conversation), and its jump names the conversation, as every jump to a conversation's message does: its view
 * fetches the message, which the rooms' API doesn't have, and a conversation's reference has no room. A room's jump
 * names the room and space its reference gives, or else the list's. Nothing for a quote that names no message.
 */
export function quoteJump(
	ref: Pick<ReferencedMessage, "message_id" | "room_id" | "space_id">,
	list: { spaceId: string; channelId: string },
): MessageLink | null {
	const messageId = ref.message_id;
	if (!messageId) return null;
	if (!list.spaceId) return { spaceId: "", roomId: "", messageId, conversationId: list.channelId };
	return { spaceId: ref.space_id ?? list.spaceId, roomId: ref.room_id ?? list.channelId, messageId };
}

/**
 * Whether a conversation counts as read once the user leaves it: the newest message its list has is read (the view
 * acked it, or the read position is there already, as a call notice of a call the user saw moves it), and is the
 * conversation's newest. After a jump, while newer messages are still to load below the jump's pages (moreBelow), the
 * list's newest is the conversation's only when it came after those pages (loadedBelowTo), live: another member's
 * message, a call's notice, or one the user sent.
 */
export function readWhenLeft(
	list: { newest: string; moreBelow: boolean; loadedBelowTo: string },
	acked: string | undefined,
	readUpTo: string | undefined,
): boolean {
	const conversationsNewest = !list.moreBelow || list.newest > list.loadedBelowTo;
	return conversationsNewest && (acked === list.newest || (readUpTo ?? "") >= list.newest);
}

/**
 * What leaving a room's or a conversation's list does: it acks the newest message only from the bottom of a list that
 * reaches it, with no newer messages to load below (the bottom of a jump's pages is no sign of having read them), and
 * the list stays unread when it has an unread divider and isn't read once left (readWhenLeft).
 */
export function leaving(
	list: { atBottom: boolean; newest: string; moreBelow: boolean; loadedBelowTo: string },
	unreadAfter: string | null | undefined,
	acked: string | undefined,
	readUpTo: string | undefined,
): { ack: boolean; unread: boolean } {
	const ack = list.atBottom && !list.moreBelow && !!list.newest;
	const read = readWhenLeft(list, ack ? list.newest : acked, readUpTo);
	return { ack, unread: !!unreadAfter && !read };
}

/**
 * Where the next page below a jump's pages starts: after the newest message those pages have loaded, the one before
 * (`after`) or the newest of the page that just came. Never after a message that came meanwhile (another member's, or
 * one the user sent), which isn't one of those pages: the messages between it and the pages would never load.
 */
export function loadedTo(after: string, page: { id: string }[]): string {
	return page.reduce((newest, m) => (m.id > newest ? m.id : newest), after);
}

type Listed = { id: string; nonce?: string | null };

/**
 * What a list shows while newer messages are still to load below a jump's pages: its messages up to the newest of
 * those pages (loadedBelowTo), and the ones being sent (their ID is their nonce), which take the reader to the
 * present. A message that came live past the pages (another member's) shows when the pages below reach it, rather
 * than right after the jump's pages, where the messages between would seem not to exist.
 */
export function inWindow<T extends Listed>(messages: T[], loadedBelowTo: string): T[] {
	if (!loadedBelowTo) return messages;
	const shown = messages.filter((m) => m.id <= loadedBelowTo || m.id === m.nonce);
	return shown.length === messages.length ? messages : shown;
}

type Sendable = Listed & { author_id?: string; content?: string | null; created_at?: string };

// How long before a message being sent (by the client's clock) the API's copy of it can be dated (by the API's).
const SENT_COPY_SKEW = 2 * 60_000;

/**
 * A list taken to the present, from a jump's pages: the newest page, with the messages still being sent (their ID is
 * their nonce) and those that came after the page was cut (newer than its newest), each once. The jump's pages go.
 *
 * The page can list a message still being sent already, without its nonce: the API lists a message while its files go
 * up. That copy goes, the one being sent staying until the API's answer or its event takes its place: a copy is a
 * message of the page the list didn't have, by the same author with the same text, dated no earlier than shortly
 * before the one being sent.
 */
export function withPresent<T extends Sendable>(current: T[], page: T[]): T[] {
	const newest = page.reduce((max, m) => (m.id > max ? m.id : max), "");
	const inPage = new Set(page.map((m) => m.id));
	const kept = current.filter((m) => !inPage.has(m.id) && (m.id === m.nonce || m.id > newest));
	const listed = new Set(current.map((m) => m.id));
	const copies = new Set<string>();
	for (const sending of kept.filter((m) => m.id === m.nonce)) {
		const since = Date.parse(sending.created_at ?? "") - SENT_COPY_SKEW;
		const copy = page.find(
			(m) =>
				!listed.has(m.id) &&
				!copies.has(m.id) &&
				m.author_id === sending.author_id &&
				(m.content ?? "") === (sending.content ?? "") &&
				Date.parse(m.created_at ?? "") >= since,
		);
		if (copy) copies.add(copy.id);
	}
	return [...(copies.size ? page.filter((m) => !copies.has(m.id)) : page), ...kept];
}

/**
 * Where the unread divider goes once a message came past a jump's pages, which the list shows only when the pages below
 * reach it (inWindow): after the read position (readUpTo), or above everything ("0") when there's none, if another
 * member's message came there that the read position doesn't cover. Leaving then keeps the room or conversation unread,
 * and the divider shows as the pages below reach the message. Null when nothing like that came: the user's own messages
 * (from another device, a pin notice), one still being sent, and a seen call's notice (the read position covers it).
 */
export function dividerPastWindow(
	messages: (Listed & { author_id: string })[],
	loadedBelowTo: string,
	me: string | undefined,
	readUpTo: string | undefined,
): string | null {
	const news = messages.some(
		(m) => m.id > loadedBelowTo && m.id !== m.nonce && m.author_id !== me && m.id > (readUpTo ?? ""),
	);
	return news ? (readUpTo ?? "0") : null;
}
