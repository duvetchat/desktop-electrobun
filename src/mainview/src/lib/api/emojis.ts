import { userSession } from "$lib/stores.svelte";
import { getHostURL } from "$lib/common/common";
import type { SpaceEmoji } from "$lib/types";

const HOST = getHostURL();

export async function listEmojis(spaceId: string): Promise<SpaceEmoji[]> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const response = await fetch(`${HOST}/api/spaces/${spaceId}/emojis`, {
		headers: { Authorization: userSession.token },
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch emojis: ${await response.text()}`);
	}

	return response.json() as Promise<SpaceEmoji[]>;
}

export async function createEmoji(
	spaceId: string,
	name: string,
	file: File,
): Promise<SpaceEmoji> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const form = new FormData();
	form.append("name", name);
	form.append("file", file);

	const response = await fetch(`${HOST}/api/spaces/${spaceId}/emojis`, {
		method: "POST",
		headers: { Authorization: userSession.token },
		body: form,
	});

	if (!response.ok) {
		const errorData = (await response.json().catch(() => ({}))) as {
			error?: string;
		};
		throw new Error(errorData.error || "Failed to create emoji");
	}

	return response.json() as Promise<SpaceEmoji>;
}

export async function updateEmoji(
	spaceId: string,
	emojiId: string,
	name: string,
): Promise<SpaceEmoji> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const response = await fetch(
		`${HOST}/api/spaces/${spaceId}/emojis/${emojiId}`,
		{
			method: "PATCH",
			headers: {
				Authorization: userSession.token,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ name }),
		},
	);

	if (!response.ok) {
		const errorData = (await response.json().catch(() => ({}))) as {
			error?: string;
		};
		throw new Error(errorData.error || "Failed to update emoji");
	}

	return response.json() as Promise<SpaceEmoji>;
}

export async function deleteEmoji(
	spaceId: string,
	emojiId: string,
): Promise<void> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const response = await fetch(
		`${HOST}/api/spaces/${spaceId}/emojis/${emojiId}`,
		{
			method: "DELETE",
			headers: { Authorization: userSession.token },
		},
	);

	if (!response.ok) {
		const errorData = (await response.json().catch(() => ({}))) as {
			error?: string;
		};
		throw new Error(errorData.error || "Failed to delete emoji");
	}
}
