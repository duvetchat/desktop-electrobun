import api from "$lib/api/api";
import type { UsedOption } from "$lib/commands";
import type { ModalAnswer } from "$lib/modals";
import { interactionModal, type ModalContext } from "$lib/stores/interactionModal.svelte";
import type { Modal, SpaceCommands } from "$lib/types";

/** What a person sends about the component of a bot's message they used. */
export interface ComponentUse {
	custom_id: string;
	component_type: number;
	/** What a select's choice was: its options' values, or the IDs of the members, roles or rooms. */
	values?: string[];
}

/** What a person's interaction answers: the type of the bot's first response, and for a modal (9), the modal and its application. */
interface InteractionCreated {
	type: number;
	data?: Modal;
	application_id?: string;
}

// The type of the bot's first response; a modal (9) opens, where the interaction happened.
function answered(res: InteractionCreated, where: ModalContext): number {
	if (res.type === 9 && res.data && res.application_id) {
		interactionModal.open({ ...where, modal: res.data, applicationId: res.application_id });
	}
	return res.type;
}

/**
 * Uses a component of a bot's message in a room. The API waits up to 3 seconds for the bot's first
 * response and answers its type; without one, 504. A modal it answers with opens.
 */
export async function sendComponentInteraction(
	roomId: string,
	messageId: string,
	data: ComponentUse,
	where: Omit<ModalContext, "roomId" | "messageId">,
): Promise<number> {
	const res = await api.post<InteractionCreated>("/api/interactions", {
		type: 3,
		room_id: roomId,
		message_id: messageId,
		data,
	});
	return answered(res.data, { ...where, roomId, messageId });
}

/**
 * What a person sends about the command they used: the command, as the space's list has it, and its options, a
 * subcommand's under it in its group (commandUse, lib/commands.ts).
 */
export interface CommandUse {
	id: string;
	name: string;
	type: 1;
	options: UsedOption[];
}

/** Uses an application's command in a room, and answers the type of the bot's first response, as a component's. */
export async function sendCommandInteraction(
	roomId: string,
	applicationId: string,
	data: CommandUse,
	where: Omit<ModalContext, "roomId" | "messageId">,
): Promise<number> {
	try {
		const res = await api.post<InteractionCreated>("/api/interactions", {
			type: 2,
			room_id: roomId,
			application_id: applicationId,
			data,
		});
		return answered(res.data, { ...where, roomId });
	} catch (err) {
		// The command may have changed or gone: the next "/" asks for the lists again.
		spaceCommands.clear();
		throw err;
	}
}

/** What a person sends about a modal they submit: its custom_id, and its labels with what they entered. */
export interface ModalSubmit {
	custom_id: string;
	components: ModalAnswer[];
}

/**
 * Submits a modal the application's bot opened in a room (from the message whose component opened it), and
 * answers the type of the bot's first response, as a component's. A modal is submitted once.
 */
export async function sendModalSubmit(
	roomId: string,
	applicationId: string,
	messageId: string | undefined,
	data: ModalSubmit,
): Promise<number> {
	const res = await api.post<InteractionCreated>("/api/interactions", {
		type: 5,
		room_id: roomId,
		application_id: applicationId,
		message_id: messageId,
		data,
	});
	return res.data.type;
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
