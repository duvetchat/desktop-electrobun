import api from "$lib/api/api";

/** What a person sends about the component of a bot's message they used. */
export interface ComponentUse {
	custom_id: string;
	component_type: number;
	/** What a select's choice was: its options' values, or the IDs of the members, roles or rooms. */
	values?: string[];
}

/**
 * Uses a component of a bot's message in a room. The API waits up to 3 seconds for the bot's first
 * response and answers its type; without one, 504.
 */
export async function sendComponentInteraction(roomId: string, messageId: string, data: ComponentUse): Promise<number> {
	const res = await api.post<{ type: number }>("/api/interactions", {
		type: 3,
		room_id: roomId,
		message_id: messageId,
		data,
	});
	return res.data.type;
}
