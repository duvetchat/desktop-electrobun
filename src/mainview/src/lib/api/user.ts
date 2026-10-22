import api from "$lib/api/api";
import type { StorageTransfer, StorageTransferFile, StorageTransferFileStatus } from "$lib/types";

interface UserMeResult {
	id: string;
	username: string;
	email: string;
	email_verified: boolean;
	alias: string;
	birthdate: string | null;
	phone: string | null;
	avatar: string | null;
	banner: string | null;
	custom: string;
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
	const response = await api.patch("/api/users/@me", data);
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
	url?: string;
}

export interface StorageStatus {
	used_bytes: number;
	max_bytes: number;
	upload_limit_bytes: number;
	percentage_used: number;
}

export async function getMyStorageStatus(): Promise<StorageStatus> {
	const res = await api.get("/api/users/@me/storage");
	return res.data;
}

/** Your files; with `bucket` ("default" or a bucket ID), only those in that storage. */
export async function getMyAttachments(bucket?: string): Promise<UserAttachment[]> {
	const res = await api.get("/api/users/@me/attachments", { params: { bucket } });
	return res.data;
}

export async function deleteMyAttachment(id: string): Promise<void> {
	await api.delete(`/api/users/@me/attachments/${id}`);
}

export async function deleteAllMyAttachments(): Promise<void> {
	await api.delete("/api/users/@me/attachments");
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
	used_bytes: number;
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
	const res = await api.get("/api/users/@me/buckets");
	return res.data;
}

export async function createMyBucket(data: CreateBucketPayload): Promise<StorageBucket> {
	const res = await api.post("/api/users/@me/buckets", data);
	return res.data;
}

export async function updateMyBucket(id: string, data: UpdateBucketPayload): Promise<StorageBucket> {
	const res = await api.patch(`/api/users/@me/buckets/${id}`, data);
	return res.data;
}

/** Deletes a bucket. One with files is a 409 (`bucket has files`, with their count in `files`) unless
 * `deleteFiles` deletes them first. */
export async function deleteMyBucket(id: string, deleteFiles = false): Promise<void> {
	await api.delete(`/api/users/@me/buckets/${id}`, { params: { delete_files: deleteFiles || undefined } });
}

export async function activateMyBucket(id: string): Promise<void> {
	await api.post(`/api/users/@me/buckets/${id}/activate`);
}

export async function deactivateMyBucket(id: string): Promise<void> {
	await api.post(`/api/users/@me/buckets/${id}/deactivate`);
}

// ── Storage Transfers ────────────────────────────────────────────────────────

/** A move of files between two storages of one owner. With neither `attachment_ids` nor `kinds` it
 * takes every file in the source. */
export interface CreateTransferPayload {
	/** "default" (a user's default storage) or a bucket ID. */
	source: string;
	target: string;
	/** At most 1000, each in the source. Not with `kinds`. */
	attachment_ids?: string[];
	kinds?: ("image" | "video" | "audio" | "other")[];
	/** The originals stay in the source. Only when the source is a bucket. */
	keep_source?: boolean;
}

/** A page of a transfer's files, in attachment ID order: those after `after`, optionally in one status. */
export interface TransferFilesQuery {
	status?: StorageTransferFileStatus;
	after?: string;
	/** 1-1000, 100 by default. */
	limit?: number;
}

export async function createMyTransfer(data: CreateTransferPayload): Promise<StorageTransfer> {
	const res = await api.post("/api/users/@me/storage/transfers", data);
	return res.data;
}

/** Your latest 20 transfers, newest first. */
export async function getMyTransfers(): Promise<StorageTransfer[]> {
	const res = await api.get("/api/users/@me/storage/transfers");
	return res.data;
}

export async function getMyTransfer(id: string): Promise<StorageTransfer> {
	const res = await api.get(`/api/users/@me/storage/transfers/${id}`);
	return res.data;
}

export async function getMyTransferFiles(id: string, query: TransferFilesQuery = {}): Promise<StorageTransferFile[]> {
	const res = await api.get(`/api/users/@me/storage/transfers/${id}/files`, { params: { ...query } });
	return res.data;
}

/** Stops a transfer after the file it's on; what moved stays in the target. */
export async function cancelMyTransfer(id: string): Promise<void> {
	await api.post(`/api/users/@me/storage/transfers/${id}/cancel`);
}

export async function uploadProfileImage(
	kind: "avatar" | "banner",
	file: Blob,
	crop: { x: number; y: number; w: number; h: number },
): Promise<UserMeResult> {
	const form = new FormData();
	form.append(kind, file);
	form.append(`${kind}_crop_x`, String(Math.round(crop.x)));
	form.append(`${kind}_crop_y`, String(Math.round(crop.y)));
	form.append(`${kind}_crop_w`, String(Math.round(crop.w)));
	form.append(`${kind}_crop_h`, String(Math.round(crop.h)));
	const res = await api.patch("/api/users/@me", form);
	return res.data;
}

export async function me(): Promise<UserMeResult> {
	const response = await api.get("/api/users/@me");
	return response.data;
}

// ── Internal (Staff only) ───────────────────────────────────────────────────

export async function updateUserFlagsBadges(userId: string, data: { flags?: number; badges?: number }): Promise<any> {
	const res = await api.patch(`/api/internal/users/${userId}/flags-badges`, data);
	return res.data;
}
