import api from "$lib/api/api";

interface UserMeResult {
	id: string;
	username: string;
	email: string;
	email_verified: boolean;
	password: string;
	alias: string;
	birthdate: string | null;
	phone: string | null;
	avatar: string | null;
	banner: string | null;
	custom: string;
	status_id: string;
	created_at: string;
	updated_at: string;
}

export interface UpdateUserPayload {
	username?: string;
	alias?: string | null;
	avatar?: string | null;
	banner?: string | null;
}

export async function updateUser(data: UpdateUserPayload): Promise<UserMeResult> {
	const response = await api.patch("/api/users/me", data);
	return response.data;
}

export interface UserAttachment {
	id: string;
	message_id: string;
	filename: string;
	content_type: string;
	size_bytes: number;
	width?: number | null;
	height?: number | null;
	created_at: string;
}

export interface StorageStatus {
	used_bytes: number;
	max_bytes: number;
	upload_limit_bytes: number;
	percentage_used: number;
}

export async function getMyStorageStatus(): Promise<StorageStatus> {
	const res = await api.get("/api/users/me/storage");
	return res.data;
}

export async function getMyAttachments(): Promise<UserAttachment[]> {
	const res = await api.get("/api/users/me/attachments");
	return res.data;
}

export async function deleteMyAttachment(id: string): Promise<void> {
	await api.delete(`/api/users/me/attachments/${id}`);
}

export async function deleteAllMyAttachments(): Promise<void> {
	await api.delete("/api/users/me/attachments");
}

// ── Storage Buckets ──────────────────────────────────────────────────────────

export interface StorageBucket {
	id: string;
	owner_id: string;
	name: string;
	endpoint: string;
	region: string;
	bucket_name: string;
	access_key_id: string;
	is_active: boolean;
	is_default: boolean;
	use_path_style: boolean;
	max_bytes?: number | null;
	upload_limit_bytes?: number | null;
	created_at: string;
	updated_at: string;
}

export interface CreateBucketPayload {
	name: string;
	endpoint: string;
	region?: string;
	bucket_name: string;
	access_key_id: string;
	secret_access_key: string;
	use_path_style?: boolean;
	max_bytes?: number | null;
	upload_limit_bytes?: number | null;
}

export interface UpdateBucketPayload {
	name: string;
	endpoint: string;
	region?: string;
	bucket_name: string;
	access_key_id: string;
	secret_access_key: string;
	use_path_style?: boolean;
	max_bytes?: number | null;
	upload_limit_bytes?: number | null;
}

export async function getMyBuckets(): Promise<StorageBucket[]> {
	const res = await api.get("/api/users/me/buckets");
	return res.data;
}

export async function createMyBucket(data: CreateBucketPayload): Promise<StorageBucket> {
	const res = await api.post("/api/users/me/buckets", data);
	return res.data;
}

export async function updateMyBucket(id: string, data: UpdateBucketPayload): Promise<StorageBucket> {
	const res = await api.patch(`/api/users/me/buckets/${id}`, data);
	return res.data;
}

export async function deleteMyBucket(id: string): Promise<void> {
	await api.delete(`/api/users/me/buckets/${id}`);
}

export async function activateMyBucket(id: string): Promise<void> {
	await api.post(`/api/users/me/buckets/${id}/activate`);
}

export async function deactivateMyBucket(id: string): Promise<void> {
	await api.post(`/api/users/me/buckets/${id}/deactivate`);
}

export async function me(): Promise<UserMeResult> {
	const response = await api.get("/api/users/me");
	return response.data;
}
