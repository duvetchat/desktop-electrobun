import { userSession } from "$lib/stores.svelte";
import { getHostURL } from "$lib/common/common";

import type { GatewayMessage, MessageReference } from "$lib/types";

const HOST = getHostURL();

export async function getMessages(
	roomId: string,
	before?: Date,
	signal?: AbortSignal,
): Promise<GatewayMessage[]> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const query = new URLSearchParams({
		count: "100",
	});
	if (before) {
		query.set("before", before.toISOString());
	}

	const response = await fetch(
		`${HOST}/api/rooms/${roomId}/messages?${query}`,
		{
			headers: {
				Authorization: userSession.token,
			},
			signal,
		},
	);

	if (!response.ok) {
		throw new Error(`Failed to fetch messages: ${await response.text()}`);
	}

	return response.json() as Promise<GatewayMessage[]>;
}

export async function getMessagesAfter(
	roomId: string,
	after: Date,
	signal?: AbortSignal,
): Promise<GatewayMessage[]> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const query = new URLSearchParams({
		count: "100",
		after: after.toISOString(),
		order: "asc",
	});

	const response = await fetch(
		`${HOST}/api/rooms/${roomId}/messages?${query}`,
		{
			headers: {
				Authorization: userSession.token,
			},
			signal,
		},
	);

	if (!response.ok) {
		throw new Error(`Failed to fetch messages: ${await response.text()}`);
	}

	return response.json() as Promise<GatewayMessage[]>;
}

export async function getMessageById(
	roomId: string,
	messageId: string,
	signal?: AbortSignal,
): Promise<GatewayMessage> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const response = await fetch(
		`${HOST}/api/rooms/${roomId}/messages/${messageId}`,
		{
			headers: {
				Authorization: userSession.token,
			},
			signal,
		},
	);

	if (!response.ok) {
		throw new Error(`Failed to fetch message: ${await response.text()}`);
	}

	return response.json() as Promise<GatewayMessage>;
}

export async function sendMessage(
	roomId: string,
	content: string,
	nonce?: string,
	messageReference?: MessageReference,
): Promise<GatewayMessage> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const response = await fetch(`${HOST}/api/rooms/${roomId}/messages`, {
		method: "POST",
		headers: {
			Authorization: userSession.token,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			content,
			nonce,
			...(messageReference ? { message_reference: messageReference } : {}),
		}),
	});

	if (!response.ok) {
		throw new Error(`Failed to send message: ${await response.text()}`);
	}

	return response.json() as Promise<GatewayMessage>;
}

export async function updateMessage(
	messageId: string,
	content: string,
	roomId: string,
): Promise<GatewayMessage> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const response = await fetch(
		`${HOST}/api/rooms/${roomId}/messages/${messageId}`,
		{
			method: "PATCH",
			headers: {
				Authorization: userSession.token,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ content }),
		},
	);

	if (!response.ok) {
		throw new Error(`Failed to update message: ${await response.text()}`);
	}

	return response.json() as Promise<GatewayMessage>;
}

export async function sendTypingIndicator(roomId: string): Promise<void> {
	if (!userSession.token) return;
	await fetch(`${HOST}/api/rooms/${roomId}/typing`, {
		method: "POST",
		headers: { Authorization: userSession.token },
	}).catch(() => {});
}

export async function deleteMessage(
	messageId: string,
	roomId: string,
): Promise<void> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const response = await fetch(
		`${HOST}/api/rooms/${roomId}/messages/${messageId}`,
		{
			method: "DELETE",
			headers: {
				Authorization: userSession.token,
			},
		},
	);

	if (!response.ok) {
		throw new Error(`Failed to delete message: ${await response.text()}`);
	}
}
