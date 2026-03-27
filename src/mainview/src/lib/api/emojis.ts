import api from "$lib/api/api";
import type { SpaceEmoji } from "$lib/types";

export async function listEmojis(spaceId: string): Promise<SpaceEmoji[]> {
    const response = await api.get(`/api/spaces/${spaceId}/emojis`);
    return response.data;
}

export async function createEmoji(
    spaceId: string,
    name: string,
    file: File,
): Promise<SpaceEmoji> {
    const form = new FormData();
    form.append("name", name);
    form.append("file", file);

    const response = await api.post(`/api/spaces/${spaceId}/emojis`, form);
    return response.data;
}

export async function updateEmoji(
    spaceId: string,
    emojiId: string,
    name: string,
): Promise<SpaceEmoji> {
    const response = await api.patch(`/api/spaces/${spaceId}/emojis/${emojiId}`, { name });
    return response.data;
}

export async function deleteEmoji(
    spaceId: string,
    emojiId: string,
): Promise<void> {
    await api.delete(`/api/spaces/${spaceId}/emojis/${emojiId}`);
}