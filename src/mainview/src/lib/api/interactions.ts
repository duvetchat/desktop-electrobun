import api from "$lib/api/api";
import type { UsedOption } from "$lib/commands";
import type { SpaceCommands } from "$lib/types";

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

/** What a person sends about the command they used: the command, as the space's list has it, and its options. */
export interface CommandUse {
	id: string;
	name: string;
	type: 1;
	options: UsedOption[];
}

/** Uses an application's command in a room, and answers the type of the bot's first response, as a component's. */
export async function sendCommandInteraction(roomId: string, applicationId: string, data: CommandUse): Promise<number> {
	try {
		const res = await api.post<{ type: number }>("/api/interactions", {
			type: 2,
			room_id: roomId,
			application_id: applicationId,
			data,
		});
		return res.data.type;
	} catch (err) {
		// The command may have changed or gone: the next "/" asks for the lists again.
		spaceCommands.clear();
		throw err;
	}
}

// The spaces' commands, asked for when the "/" menu opens and kept for a few minutes, or until the space's
// members change (a bot came or went). A failed request isn't kept.
const commandsTTL = 5 * 60 * 1000;
const spaceCommands = new Map<string, { at: number; list: Promise<SpaceCommands> }>();

export function getSpaceCommands(spaceId: string): Promise<SpaceCommands> {
	const cached = spaceCommands.get(spaceId);
	if (cached && Date.now() - cached.at < commandsTTL) return cached.list;
	const list = api.get<SpaceCommands>(`/api/spaces/${spaceId}/commands`).then((res) => res.data);
	spaceCommands.set(spaceId, { at: Date.now(), list });
	list.catch(() => {
		if (spaceCommands.get(spaceId)?.list === list) spaceCommands.delete(spaceId);
	});
	return list;
}

export function forgetSpaceCommands(spaceId: string) {
	spaceCommands.delete(spaceId);
}
