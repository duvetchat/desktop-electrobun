import api from "$lib/api/api";
import { reactedWith, reactionKey } from "$lib/reactions";
import type { Message } from "$lib/types";
import { pathSegment } from "$lib/urls";

// A reaction's emoji_name is whatever its first sender put (the API takes any text): one segment of the path
// (pathSegment), as ".." would point the removal of a reaction at the message itself.

export async function addRoomReaction(
	roomId: string,
	messageId: string,
	emojiName: string,
	emojiId?: string | null,
): Promise<void> {
	await api.put(`/api/rooms/${roomId}/messages/${messageId}/reactions`, {
		emoji_name: emojiName,
		emoji_id: emojiId ?? null,
	});
}

/** Takes back the user's reaction with emoji: a custom emoji's ID (that reaction alone), or a Unicode emoji. */
export async function removeRoomReaction(roomId: string, messageId: string, emoji: string): Promise<void> {
	await api.delete(`/api/rooms/${roomId}/messages/${messageId}/reactions/${pathSegment(emoji)}`);
}

export async function addConversationReaction(
	convId: string,
	messageId: string,
	emojiName: string,
	emojiId?: string | null,
): Promise<void> {
	await api.put(`/api/users/@me/conversations/${convId}/messages/${messageId}/reactions`, {
		emoji_name: emojiName,
		emoji_id: emojiId ?? null,
	});
}

/** A conversation's removeRoomReaction: emoji is a custom emoji's ID or a Unicode emoji. */
export async function removeConversationReaction(convId: string, messageId: string, emoji: string): Promise<void> {
	await api.delete(`/api/users/@me/conversations/${convId}/messages/${messageId}/reactions/${pathSegment(emoji)}`);
}

/**
 * Adds the user's reaction to a message, or takes it back when they had reacted with that emoji already: in a room of a
 * space, or in a conversation (spaceId "", channelId the conversation). The gateway's REACTION_ADD or REACTION_REMOVE
 * then shows it. A failure is only logged, as nothing has changed.
 */
export async function toggleReaction(
	where: { spaceId: string; channelId: string },
	message: Pick<Message, "id" | "reactions">,
	me: string,
	emojiName: string,
	emojiId?: string | null,
): Promise<void> {
	// A custom emoji's reaction is its ID's, as two Spaces can each have one of that name: it's found and taken back by it.
	const emoji = reactionKey({ emoji_name: emojiName, emoji_id: emojiId });
	const reacted = reactedWith(message, me, emoji);
	const { spaceId, channelId } = where;
	try {
		if (!spaceId) {
			if (reacted) await removeConversationReaction(channelId, message.id, emoji);
			else await addConversationReaction(channelId, message.id, emojiName, emojiId);
		} else if (reacted) {
			await removeRoomReaction(channelId, message.id, emoji);
		} else {
			await addRoomReaction(channelId, message.id, emojiName, emojiId);
		}
	} catch (e) {
		console.error("Failed to toggle reaction:", e);
	}
}
