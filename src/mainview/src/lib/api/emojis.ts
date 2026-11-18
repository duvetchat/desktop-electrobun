import api, { type UploadOptions } from "$lib/api/api";
import type { SpaceEmoji } from "$lib/types";

export async function listEmojis(spaceId: string): Promise<SpaceEmoji[]> {
	const response = await api.get(`/api/spaces/${spaceId}/emojis`);
	return response.data;
}

/** The emojis of every Space the user is in, by Space then name, which they may use anywhere. */
export async function listMyEmojis(): Promise<SpaceEmoji[]> {
	const response = await api.get("/api/users/@me/emojis");
	return response.data;
}

export async function createEmoji(
	spaceId: string,
	name: string,
	file: File,
	upload?: UploadOptions,
): Promise<SpaceEmoji> {
	const form = new FormData();
	form.append("name", name);
	form.append("file", file);

	const response = await api.post(`/api/spaces/${spaceId}/emojis`, form, upload);
	return response.data;
}

export async function updateEmoji(spaceId: string, emojiId: string, name: string): Promise<SpaceEmoji> {
	const response = await api.patch(`/api/spaces/${spaceId}/emojis/${emojiId}`, { name });
	return response.data;
}

export async function deleteEmoji(spaceId: string, emojiId: string): Promise<void> {
	await api.delete(`/api/spaces/${spaceId}/emojis/${emojiId}`);
}
