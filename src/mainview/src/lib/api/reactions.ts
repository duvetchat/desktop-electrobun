import api from "$lib/api/api";

export async function addRoomReaction(roomId: string, messageId: string, emojiName: string, emojiId?: string | null): Promise<void> {
    await api.put(`/api/rooms/${roomId}/messages/${messageId}/reactions`, {
        emoji_name: emojiName,
        emoji_id: emojiId ?? null
    });
}

export async function removeRoomReaction(roomId: string, messageId: string, emojiName: string): Promise<void> {
    await api.delete(`/api/rooms/${roomId}/messages/${messageId}/reactions/${encodeURIComponent(emojiName)}`);
}

export async function addConversationReaction(convId: string, messageId: string, emojiName: string, emojiId?: string | null): Promise<void> {
    await api.put(`/api/users/@me/conversations/${convId}/messages/${messageId}/reactions`, {
        emoji_name: emojiName,
        emoji_id: emojiId ?? null
    });
}

export async function removeConversationReaction(convId: string, messageId: string, emojiName: string): Promise<void> {
    await api.delete(`/api/users/@me/conversations/${convId}/messages/${messageId}/reactions/${encodeURIComponent(emojiName)}`);
}