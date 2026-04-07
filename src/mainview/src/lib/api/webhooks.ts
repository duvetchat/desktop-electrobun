import api from "$lib/api/api";

export interface Webhook {
	id: string;
	room_id: string;
	username: string;
	avatar: string | null;
	created_at: string;
	updated_at: string;
}

export interface WebhookCreateResponse {
	webhook: Webhook;
	token: string;
}

export async function listWebhooks(spaceId: string, roomId: string): Promise<Webhook[]> {
	const res = await api.get(`/api/spaces/${spaceId}/rooms/${roomId}/webhooks`);
	return res.data;
}

export async function createWebhook(
	spaceId: string,
	roomId: string,
	username: string,
	avatar?: File,
): Promise<WebhookCreateResponse> {
	const form = new FormData();
	form.append("username", username);
	if (avatar) form.append("avatar", avatar);
	const res = await api.post(`/api/spaces/${spaceId}/rooms/${roomId}/webhooks`, form);
	return res.data;
}

export async function updateWebhook(
	spaceId: string,
	roomId: string,
	webhookId: string,
	data: { username?: string; avatar?: File; remove_avatar?: boolean },
): Promise<Webhook> {
	const form = new FormData();
	if (data.username) form.append("username", data.username);
	if (data.avatar) form.append("avatar", data.avatar);
	if (data.remove_avatar) form.append("remove_avatar", "true");
	const res = await api.patch(`/api/spaces/${spaceId}/rooms/${roomId}/webhooks/${webhookId}`, form);
	return res.data;
}

export async function deleteWebhook(spaceId: string, roomId: string, webhookId: string): Promise<void> {
	await api.delete(`/api/spaces/${spaceId}/rooms/${roomId}/webhooks/${webhookId}`);
}

export async function resetWebhookToken(spaceId: string, roomId: string, webhookId: string): Promise<string> {
	const res = await api.post(`/api/spaces/${spaceId}/rooms/${roomId}/webhooks/${webhookId}/reset-token`);
	return res.data.token;
}
