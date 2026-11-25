import type { Message } from "$lib/types";

/** A message list's newest end: how many messages it has, its newest confirmed one, and those being sent. */
export interface ListEnd {
	count: number;
	newest: Message | null;
	sending: number;
	// The last message being sent: the newest of them, as each is added at the end of the list.
	lastSending: Message | null;
}

export function listEnd(messages: Message[]): ListEnd {
	const end: ListEnd = { count: messages.length, newest: null, sending: 0, lastSending: null };
	for (const m of messages) {
		// A message being sent has its nonce for an ID: a random UUID, not in time order as the API's are.
		if (m.id === m.nonce) {
			end.sending++;
			end.lastSending = m;
		} else if (!end.newest || m.id > end.newest.id) {
			end.newest = m;
		}
	}
	return end;
}

/** A message that came to a list's newest end; sent when this window is sending it. */
export interface Arrival {
	message: Message;
	sent: boolean;
}

/**
 * What came to a list's newest end between two of its ends, if anything did: a message this window sends, or
 * else a confirmed one newer than the newest before. A list also grows when scrolling up loads older
 * messages, and those come to its oldest end, wherever the list puts them.
 */
export function arrival(before: ListEnd, after: ListEnd): Arrival | null {
	if (before.count === 0 || after.count <= before.count) return null;
	if (after.sending > before.sending && after.lastSending) return { message: after.lastSending, sent: true };
	if (after.newest && (!before.newest || after.newest.id > before.newest.id)) {
		return { message: after.newest, sent: false };
	}
	return null;
}

export type ArrivalAction = "bottom" | "present" | "unread" | null;

/**
 * What a list does for a message that came: it goes down to it ("bottom") when this window sent it, or when the
 * list follows its bottom (the user is there, looking). Otherwise it stays where the user reads, and someone
 * else's message gets the unread divider ("unread"). The user's own messages that come some other way (their
 * pin notices, what they send from another device) are no news to them, and leave them be.
 *
 * After a jump, while newer messages are still to load below (newerBelow), the list's bottom isn't the room's: what
 * comes there is a page of history the reader scrolls into, which neither takes them to its end nor gets the divider.
 * A message this window sends from there takes the reader to the present ("present"): the list loads the newest
 * messages and goes down to it, rather than to the bottom of the jump's pages.
 *
 * Nor does a message at or before the user's read position (readUpTo), which they have read already: a conversation's
 * call notice of a call they saw, which the API leaves read for them.
 */
export function arrivalAction(
	arrived: Arrival,
	me: string | undefined,
	following: boolean,
	newerBelow = false,
	readUpTo?: string,
): ArrivalAction {
	if (arrived.sent) return newerBelow ? "present" : "bottom";
	if (newerBelow) return null;
	if (following) return "bottom";
	if (readUpTo !== undefined && arrived.message.id <= readUpTo) return null;
	return arrived.message.author_id === me ? null : "unread";
}

/**
 * The API's copy of the person's message being sent (by its nonce), with the text its pending row shows while the copy
 * has none: an encrypted message's, whose text the device's database gives a moment later.
 */
export function withTyped<T extends { id: string; content: string | null }>(messages: T[], nonce: string, sent: T): T {
	const pending = messages.find((m) => m.id === nonce);
	return pending && sent.content == null ? { ...sent, content: pending.content } : sent;
}

/**
 * A room's or a conversation's messages once the API answered a send of this window's: its copy of the message takes
 * the place of the one being sent, whose ID is the send's nonce, and drops any other copy. The list is as it was when
 * the one being sent is gone, which the gateway's event replaced already.
 */
export function withSentMessage<T extends { id: string }>(messages: T[], nonce: string, sent: T): T[] {
	if (!messages.some((m) => m.id === nonce)) return messages;
	return messages.filter((m) => m.id !== sent.id).map((m) => (m.id === nonce ? sent : m));
}
