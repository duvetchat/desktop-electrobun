import api from "$lib/api/api";
import type { SpaceSticker } from "$lib/types";

export async function listStickers(spaceId: string): Promise<SpaceSticker[]> {
	const response = await api.get(`/api/spaces/${spaceId}/stickers`);
	return response.data;
}

export async function createSticker(spaceId: string, name: string, file: File): Promise<SpaceSticker> {
	const form = new FormData();
	form.append("name", name);
	form.append("file", file);

	const response = await api.post(`/api/spaces/${spaceId}/stickers`, form);
	return response.data;
}

export async function updateSticker(spaceId: string, stickerId: string, name: string): Promise<SpaceSticker> {
	const response = await api.patch(`/api/spaces/${spaceId}/stickers/${stickerId}`, { name });
	return response.data;
}

export async function deleteSticker(spaceId: string, stickerId: string): Promise<void> {
	await api.delete(`/api/spaces/${spaceId}/stickers/${stickerId}`);
}
