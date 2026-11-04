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
 * Where the next page below a jump's pages starts: after the newest message those pages have loaded, the one before
 * (`after`) or the newest of the page that just came. Never after a message that came meanwhile (another member's, or
 * one the user sent), which isn't one of those pages: the messages between it and the pages would never load.
 */
export function loadedTo(after: string, page: { id: string }[]): string {
	return page.reduce((newest, m) => (m.id > newest ? m.id : newest), after);
}
