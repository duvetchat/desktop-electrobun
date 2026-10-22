import api from "$lib/api/api";
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

export async function removeRoomReaction(roomId: string, messageId: string, emojiName: string): Promise<void> {
	await api.delete(`/api/rooms/${roomId}/messages/${messageId}/reactions/${pathSegment(emojiName)}`);
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

export async function removeConversationReaction(convId: string, messageId: string, emojiName: string): Promise<void> {
	await api.delete(`/api/users/@me/conversations/${convId}/messages/${messageId}/reactions/${pathSegment(emojiName)}`);
}
