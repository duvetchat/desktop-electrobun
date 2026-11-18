import api, { type UploadOptions } from "$lib/api/api";
import type { SpaceSticker } from "$lib/types";

export async function listStickers(spaceId: string): Promise<SpaceSticker[]> {
	const response = await api.get(`/api/spaces/${spaceId}/stickers`);
	return response.data;
}

/** The stickers of every Space the user is in, by Space then name, which they may send anywhere. */
export async function listMyStickers(): Promise<SpaceSticker[]> {
	const response = await api.get("/api/users/@me/stickers");
	return response.data;
}

export async function createSticker(
	spaceId: string,
	name: string,
	file: File,
	upload?: UploadOptions,
): Promise<SpaceSticker> {
	const form = new FormData();
	form.append("name", name);
	form.append("file", file);

	const response = await api.post(`/api/spaces/${spaceId}/stickers`, form, upload);
	return response.data;
}

export async function updateSticker(spaceId: string, stickerId: string, name: string): Promise<SpaceSticker> {
	const response = await api.patch(`/api/spaces/${spaceId}/stickers/${stickerId}`, { name });
	return response.data;
}

export async function deleteSticker(spaceId: string, stickerId: string): Promise<void> {
	await api.delete(`/api/spaces/${spaceId}/stickers/${stickerId}`);
}
