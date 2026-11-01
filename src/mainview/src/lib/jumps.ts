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
