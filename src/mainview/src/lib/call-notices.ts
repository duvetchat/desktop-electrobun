import { MessageType, type CallNotice, type GatewayReadyActiveCall, type Message } from "$lib/types";

/**
 * Which of its sentences a call notice says to whoever reads it (decision 172):
 * - "in": others got into the call, and so did the reader, or it was theirs: "Alice started a call that lasted 5
 *   minutes.", or "You started…" for its caller;
 * - "missed": others got into it, but not the reader (a group's call): "You missed a call from Alice that lasted 12
 *   minutes.";
 * - "unanswered": nobody but its caller got in, and the reader is the caller: "You started a call. No one answered.";
 * - "missed-unanswered": nobody but its caller got in, and the reader is someone it rang: "You missed a call from
 *   Alice.";
 * - "before-joining": others got into it, before the reader joined its conversation, so it never rang them: "Alice
 *   started a call that lasted 20 minutes.";
 * - "before-joining-unanswered": nobody but its caller got in, before the reader joined: "Alice started a call. No one
 *   answered.".
 * The reader's own calls, and those they were in, read the same whenever they joined (they may have left the group and
 * been added again).
 */
export type CallNoticeCase =
	| "in"
	| "missed"
	| "unanswered"
	| "missed-unanswered"
	| "before-joining"
	| "before-joining-unanswered";

/** The case of a call notice whose caller is callerId, for the reader me (undefined: nobody it knows); beforeJoining:
 * the notice is older than the reader's membership of its conversation. */
export function callNoticeCase(
	call: CallNotice,
	callerId: string,
	me: string | undefined,
	beforeJoining = false,
): CallNoticeCase {
	const mine = me !== undefined && me === callerId;
	if (!call.participants.some((id) => id !== callerId)) {
		if (mine) return "unanswered";
		return beforeJoining ? "before-joining-unanswered" : "missed-unanswered";
	}
	if (mine || (me !== undefined && call.participants.includes(me))) return "in";
	return beforeJoining ? "before-joining" : "missed";
}

/**
 * How long a call lasted, from when it started ringing to its end: "a few seconds" under a minute, then in whole
 * minutes ("1 minute", "N minutes"), and from an hour in hours and minutes ("1 hour", "N hours M minutes").
 */
export function callDuration(call: Pick<CallNotice, "started_at" | "ended_at">): string {
	const ms = Date.parse(call.ended_at) - Date.parse(call.started_at);
	const minutes = Number.isFinite(ms) ? Math.floor(ms / 60_000) : 0;
	if (minutes < 1) return "a few seconds";
	const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
	if (minutes < 60) return count(minutes, "minute");
	const hours = count(Math.floor(minutes / 60), "hour");
	return minutes % 60 === 0 ? hours : `${hours} ${count(minutes % 60, "minute")}`;
}

/** A call notice's sentence for its reader: before, then the caller's name, which stands out as the pin notice's
 * names do (empty when the sentence says "You" for them), then after. */
export interface CallNoticeLine {
	/** The reader missed the call: its phone is red. */
	missed: boolean;
	before: string;
	name: string;
	after: string;
}

/**
 * What a call notice says to its reader me (callNoticeCase), its caller named as the list names its author; null for
 * any other message. joined is the ID of the reader's membership of the notice's conversation (a ConversationMember's):
 * a UUIDv7, minted as they joined, as the notice's is as its call ended, so a notice whose ID is older is from before
 * they joined, as the API's list of their calls counts it. Without it (a membership this client doesn't know), the
 * notice reads as one from after.
 */
export function callNoticeLine(
	message: Pick<Message, "id" | "type" | "author_id" | "author_name" | "call">,
	me: string | undefined,
	joined?: string,
): CallNoticeLine | null {
	const call = message.type === MessageType.Call ? message.call : undefined;
	if (!call) return null;
	const name = message.author_name;
	switch (callNoticeCase(call, message.author_id, me, joined !== undefined && message.id < joined)) {
		case "in":
		case "before-joining":
			return message.author_id === me
				? { missed: false, before: `You started a call that lasted ${callDuration(call)}.`, name: "", after: "" }
				: { missed: false, before: "", name, after: ` started a call that lasted ${callDuration(call)}.` };
		case "missed":
			return { missed: true, before: "You missed a call from ", name, after: ` that lasted ${callDuration(call)}.` };
		case "unanswered":
			return { missed: false, before: "You started a call. No one answered.", name: "", after: "" };
		case "missed-unanswered":
			return { missed: true, before: "You missed a call from ", name, after: "." };
		case "before-joining-unanswered":
			return { missed: false, before: "", name, after: " started a call. No one answered." };
	}
}

/** A call notice's whole sentence. */
export function callNoticeText(line: CallNoticeLine): string {
	return line.before + line.name + line.after;
}

/**
 * Whether the user saw a call, as the API counts it for its notice (decision 143): they were in it (its participants:
 * its caller, and whoever joined its voice), or they answered it from one of their devices, accepting or declining it,
 * which their sessions hear as CALL_ACCEPTED or CALL_DECLINED with their own ID. The API leaves the conversation read
 * for them up to the notice; it's unread only for those the call rang who never answered.
 */
export function callNoticeSeen(call: CallNotice, me: string, answered: boolean): boolean {
	return answered || call.participants.includes(me);
}

/**
 * The calls the user answered from one of their devices, accepting or declining them, by conversation, as this client
 * hears it: CALL_ACCEPTED or CALL_DECLINED with their own ID. Such a call's notice, once it ends, is seen
 * (callNoticeSeen), and uses its answer up. An answer goes when a new call rings the user in its conversation (its
 * CALL_INCOMING, or a READY that lists it still ringing them), as it was to an earlier call, and when they leave the
 * group, whose notices no longer reach them.
 */
export class CallAnswers {
	readonly #conversations = new Set<string>();

	/** The user answered the call going on in the conversation. */
	answered(conversationId: string) {
		this.#conversations.add(conversationId);
	}

	/** A new call rings the user in the conversation, or they left it: an answer kept there no longer counts. */
	drop(conversationId: string) {
		this.#conversations.delete(conversationId);
	}

	/** A new session's READY: a call it lists still ringing the user, they haven't answered. A gateway that doesn't say
	 * whether it rings drops nothing. */
	ready(calls: Pick<GatewayReadyActiveCall, "conversation_id" | "ringing">[]) {
		for (const call of calls) if (call.ringing === true) this.drop(call.conversation_id);
	}

	/** Whether the user answered the call a notice of the conversation tells of; the notice uses the answer up. */
	take(conversationId: string): boolean {
		return this.#conversations.delete(conversationId);
	}
}

/** A conversation's read state on this client: whether it shows unread, and the user's read position in it, as
 * lastReadConvs has it (undefined when they never read it, or READY gave no read positions). */
export interface ConversationRead {
	unread: boolean;
	lastRead: string | undefined;
}

/**
 * The newest message a client knows of in a conversation, a call notice that just came aside: what its list has loaded,
 * and what it knows without having loaded it (known: READY's last_msg_convs and what arrived since, lib/jumps.ts), which
 * can be the notice itself, as the same event feeds it and a READY can name it. No message of either kind proves there
 * are no others: READY gives none past the API's 90 days, nor does an older gateway.
 */
export function newestBesidesNotice(
	noticeId: string,
	listed: { id: string; nonce?: string | null }[],
	known: string,
): string | undefined {
	const ids = [...listed.filter((m) => m.id !== m.nonce).map((m) => m.id), known];
	return ids.reduce<string | undefined>(
		(max, id) => (!id || id === noticeId || (max !== undefined && max >= id) ? max : id),
		undefined,
	);
}

/**
 * A conversation's read state once one of its call notices comes (DM_MESSAGE_CREATE), as the API leaves the user's.
 * The notice's ID is minted as its call ends, so the API can post it late, after newer messages.
 * - A call the user saw (callNoticeSeen) leaves the conversation read up to the notice: their read position moves to
 *   it, unless it's further on already. It stays unread only for a newer message they haven't read; newest is the
 *   newest message this client knows of in the conversation, the notice aside (newestBesidesNotice).
 * - One they missed makes it unread, as any message does, unless their read position is past the notice already.
 */
export function readAfterCallNotice(
	read: ConversationRead,
	noticeId: string,
	seen: boolean,
	newest: string | undefined,
): ConversationRead {
	if (!seen) return { unread: read.unread || noticeId > (read.lastRead ?? ""), lastRead: read.lastRead };
	const lastRead = read.lastRead !== undefined && read.lastRead > noticeId ? read.lastRead : noticeId;
	return { unread: read.unread && newest !== undefined && newest > lastRead, lastRead };
}
