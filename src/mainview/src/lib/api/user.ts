import api, { requestLimits } from "$lib/api/api";
import type { ChosenStatus, StorageTransfer, StorageTransferFile, StorageTransferFileStatus } from "$lib/types";

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
	/** The status the user chose; a bot has none. */
	status?: ChosenStatus;
}

export interface UpdateUserPayload {
	username?: string;
	alias?: string | null;
	avatar?: string | null;
	banner?: string | null;
	/** The bio, at most BIO_MAX_LENGTH characters: "" or null clears it, and leaving it out keeps it. */
	custom?: string | null;
}

/** How many characters (code points, as the API counts them) a bio holds. */
export const BIO_MAX_LENGTH = 190;

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
	/** What it holds: 0 a file as uploaded, 1 a conversation's encrypted file, which only its message names. */
	kind?: number;
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

// The API deletes a file from its storage before it answers, each call within 30 s, so a deletion of every file takes
// as long as their number (#217).
export async function deleteMyAttachment(id: string): Promise<void> {
	await api.delete(`/api/users/@me/attachments/${id}`, { answerMs: requestLimits.slowAnswerMs });
}

export async function deleteAllMyAttachments(): Promise<void> {
	await api.delete("/api/users/@me/attachments", { answerMs: Infinity });
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

/**
 * The most a file of the user's takes where it goes, as the API's checkUploadLimit reads it: their active bucket's limit
 * (none when it has none), else their storage's.
 */
export async function myFileLimit(): Promise<number | null> {
	const active = (await getMyBuckets()).find((bucket) => bucket.is_active);
	if (active) return active.upload_limit_bytes ?? null;
	return (await getMyStorageStatus()).upload_limit_bytes;
}

// The API checks a bucket it registers or edits for 30 s at most before it answers (#217).
export async function createMyBucket(data: CreateBucketPayload): Promise<StorageBucket> {
	const res = await api.post("/api/users/@me/buckets", data, { answerMs: requestLimits.slowAnswerMs });
	return res.data;
}

export async function updateMyBucket(id: string, data: UpdateBucketPayload): Promise<StorageBucket> {
	const res = await api.patch(`/api/users/@me/buckets/${id}`, data, { answerMs: requestLimits.slowAnswerMs });
	return res.data;
}

/** Deletes a bucket. One with files is a 409 (`bucket has files`, with their count in `files`) unless
 * `deleteFiles` deletes them first, which takes as long as their number before the API answers. */
export async function deleteMyBucket(id: string, deleteFiles = false): Promise<void> {
	await api.delete(`/api/users/@me/buckets/${id}`, {
		params: { delete_files: deleteFiles || undefined },
		answerMs: deleteFiles ? Infinity : undefined,
	});
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

// The API probes the transfer's buckets for 30 s at most before it answers (#217).
export async function createMyTransfer(data: CreateTransferPayload): Promise<StorageTransfer> {
	const res = await api.post("/api/users/@me/storage/transfers", data, { answerMs: requestLimits.slowAnswerMs });
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

/** Chooses the user's status, which everyone sees while they're connected. */
export async function setMyStatus(status: ChosenStatus): Promise<UserMeResult> {
	const response = await api.put("/api/users/@me/status", { status });
	return response.data;
}

// ── Internal (Staff only) ───────────────────────────────────────────────────

export async function updateUserFlagsBadges(userId: string, data: { flags?: number; badges?: number }): Promise<any> {
	const res = await api.patch(`/api/internal/users/${userId}/flags-badges`, data);
	return res.data;
}
