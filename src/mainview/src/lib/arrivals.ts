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

export type ArrivalAction = "bottom" | "unread" | null;

/**
 * What a list does for a message that came: it goes down to it ("bottom") when this window sent it, or when the
 * list follows its bottom (the user is there, looking). Otherwise it stays where the user reads, and someone
 * else's message gets the unread divider ("unread"). The user's own messages that come some other way (their
 * pin notices, what they send from another device) are no news to them, and leave them be.
 */
export function arrivalAction(arrived: Arrival, me: string | undefined, following: boolean): ArrivalAction {
	if (arrived.sent || following) return "bottom";
	return arrived.message.author_id === me ? null : "unread";
}
