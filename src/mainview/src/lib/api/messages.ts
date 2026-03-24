import { userSession } from "$lib/stores.svelte";
import { getHostURL } from "$lib/common/common";

import type { GatewayMessage, MessageReference } from "$lib/types";

const HOST = getHostURL();

export async function getMessages(
	roomId: string,
	before?: string,
	signal?: AbortSignal,
): Promise<GatewayMessage[]> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const query = new URLSearchParams({
		count: "100",
	});
	if (before) {
		query.set("before", before);
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
	after: string,
	signal?: AbortSignal,
): Promise<GatewayMessage[]> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const query = new URLSearchParams({
		count: "100",
		after,
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

export async function getMessageThread(
	roomId: string,
	messageId: string,
	signal?: AbortSignal,
): Promise<GatewayMessage[]> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const response = await fetch(
		`${HOST}/api/rooms/${roomId}/messages/${messageId}/thread`,
		{
			headers: {
				Authorization: userSession.token,
			},
			signal,
		},
	);

	if (!response.ok) {
		throw new Error(`Failed to fetch thread: ${await response.text()}`);
	}

	return response.json() as Promise<GatewayMessage[]>;
}

export async function sendMessage(
	roomId: string,
	content: string,
	nonce?: string,
	messageReference?: MessageReference,
	files?: File[],
): Promise<GatewayMessage> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	let body: BodyInit;
	let headers: HeadersInit = { Authorization: userSession.token };

	if (files && files.length > 0) {
		const form = new FormData();
		form.append("content", content);
		if (nonce) form.append("nonce", nonce);
		if (messageReference) form.append("message_reference", JSON.stringify(messageReference));
		for (const f of files) form.append("files", f);
		body = form;
		// Don't set Content-Type - browser sets it with boundary
	} else {
		headers["Content-Type"] = "application/json";
		body = JSON.stringify({
			content,
			nonce,
			...(messageReference ? { message_reference: messageReference } : {}),
		});
	}

	const response = await fetch(`${HOST}/api/rooms/${roomId}/messages`, {
		method: "POST",
		headers,
		body,
	});

	if (!response.ok) {
		const body = await response.json().catch(() => null);
		throw new Error(body?.error ?? `Failed to send message (${response.status})`);
	}

	return response.json() as Promise<GatewayMessage>;
}

export async function sendVoiceNote(
	roomId: string,
	audioBlob: Blob,
	nonce?: string,
): Promise<GatewayMessage> {
	if (!userSession.token) throw new Error("No user session token found");

	const form = new FormData();
	form.append("type", "1");
	if (nonce) form.append("nonce", nonce);
	form.append("files", audioBlob, "voice-note.webm");

	const response = await fetch(`${HOST}/api/rooms/${roomId}/messages`, {
		method: "POST",
		headers: { Authorization: userSession.token },
		body: form,
	});

	if (!response.ok) {
		const body = await response.json().catch(() => null);
		throw new Error(body?.error ?? `Failed to send voice note (${response.status})`);
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

export async function ackRoom(roomId: string, messageId: string): Promise<void> {
	if (!userSession.token) return;
	const res = await fetch(`${HOST}/api/rooms/${roomId}/ack`, {
		method: "POST",
		headers: {
			Authorization: userSession.token,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ message_id: messageId }),
	});
	if (!res.ok) {
		console.error(`[ack] failed ${res.status} for room=${roomId} msg=${messageId}`);
	}
}

export async function getMentionCounts(): Promise<Record<string, number>> {
	if (!userSession.token) return {};
	const res = await fetch(`${HOST}/api/users/me/mentions/counts`, {
		headers: { Authorization: userSession.token },
	});
	if (!res.ok) return {};
	return res.json();
}
