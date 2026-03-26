import { userSession } from "$lib/stores.svelte";
import { getHostURL } from "$lib/common/common";

const HOST = getHostURL();

export async function addRoomReaction(roomId: string, messageId: string, emojiName: string, emojiId?: string | null): Promise<void> {
	if (!userSession.token) throw new Error("No user session token found");
	const res = await fetch(`${HOST}/api/rooms/${roomId}/messages/${messageId}/reactions`, {
		method: "PUT",
		headers: { Authorization: userSession.token, "Content-Type": "application/json" },
		body: JSON.stringify({ emoji_name: emojiName, emoji_id: emojiId ?? null }),
	});
	if (!res.ok) throw new Error(`Failed to add reaction: ${await res.text()}`);
}

export async function removeRoomReaction(roomId: string, messageId: string, emojiName: string): Promise<void> {
	if (!userSession.token) throw new Error("No user session token found");
	const res = await fetch(`${HOST}/api/rooms/${roomId}/messages/${messageId}/reactions/${encodeURIComponent(emojiName)}`, {
		method: "DELETE",
		headers: { Authorization: userSession.token },
	});
	if (!res.ok) throw new Error(`Failed to remove reaction: ${await res.text()}`);
}

export async function addConversationReaction(convId: string, messageId: string, emojiName: string, emojiId?: string | null): Promise<void> {
	if (!userSession.token) throw new Error("No user session token found");
	const res = await fetch(`${HOST}/api/users/@me/conversations/${convId}/messages/${messageId}/reactions`, {
		method: "PUT",
		headers: { Authorization: userSession.token, "Content-Type": "application/json" },
		body: JSON.stringify({ emoji_name: emojiName, emoji_id: emojiId ?? null }),
	});
	if (!res.ok) throw new Error(`Failed to add reaction: ${await res.text()}`);
}

export async function removeConversationReaction(convId: string, messageId: string, emojiName: string): Promise<void> {
	if (!userSession.token) throw new Error("No user session token found");
	const res = await fetch(`${HOST}/api/users/@me/conversations/${convId}/messages/${messageId}/reactions/${encodeURIComponent(emojiName)}`, {
		method: "DELETE",
		headers: { Authorization: userSession.token },
	});
	if (!res.ok) throw new Error(`Failed to remove reaction: ${await res.text()}`);
}
