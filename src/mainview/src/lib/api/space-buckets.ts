import api, { requestLimits } from "$lib/api/api";
import type {
	StorageBucket,
	CreateBucketPayload,
	UpdateBucketPayload,
	CreateTransferPayload,
	TransferFilesQuery,
} from "$lib/api/user";
import type { StorageTransfer, StorageTransferFile } from "$lib/types";

export async function getSpaceBuckets(spaceId: string): Promise<StorageBucket[]> {
	const res = await api.get(`/api/spaces/${spaceId}/buckets`);
	return res.data;
}

// The API checks a bucket it registers or edits for 30 s at most before it answers (#217).
export async function createSpaceBucket(spaceId: string, data: CreateBucketPayload): Promise<StorageBucket> {
	const res = await api.post(`/api/spaces/${spaceId}/buckets`, data, { answerMs: requestLimits.slowAnswerMs });
	return res.data;
}

export async function updateSpaceBucket(
	spaceId: string,
	bucketId: string,
	data: UpdateBucketPayload,
): Promise<StorageBucket> {
	const res = await api.patch(`/api/spaces/${spaceId}/buckets/${bucketId}`, data, {
		answerMs: requestLimits.slowAnswerMs,
	});
	return res.data;
}

/** Deletes a bucket. One with files is a 409 (`bucket has files`, with their count in `files`) unless
 * `deleteFiles` deletes them first, with the emojis and stickers made from them, which takes as long as their number
 * before the API answers. */
export async function deleteSpaceBucket(spaceId: string, bucketId: string, deleteFiles = false): Promise<void> {
	await api.delete(`/api/spaces/${spaceId}/buckets/${bucketId}`, {
		params: { delete_files: deleteFiles || undefined },
		answerMs: deleteFiles ? Infinity : undefined,
	});
}

export async function activateSpaceBucket(spaceId: string, bucketId: string): Promise<void> {
	await api.post(`/api/spaces/${spaceId}/buckets/${bucketId}/activate`);
}

export async function deactivateSpaceBucket(spaceId: string, bucketId: string): Promise<void> {
	await api.post(`/api/spaces/${spaceId}/buckets/${bucketId}/deactivate`);
}

// ── Storage Transfers ────────────────────────────────────────────────────────
// A space moves files only between its buckets: `source` and `target` are bucket IDs.

// The API probes the transfer's buckets for 30 s at most before it answers (#217).
export async function createSpaceTransfer(spaceId: string, data: CreateTransferPayload): Promise<StorageTransfer> {
	const res = await api.post(`/api/spaces/${spaceId}/storage/transfers`, data, {
		answerMs: requestLimits.slowAnswerMs,
	});
	return res.data;
}

/** The space's latest 20 transfers, newest first. */
export async function getSpaceTransfers(spaceId: string): Promise<StorageTransfer[]> {
	const res = await api.get(`/api/spaces/${spaceId}/storage/transfers`);
	return res.data;
}

export async function getSpaceTransfer(spaceId: string, transferId: string): Promise<StorageTransfer> {
	const res = await api.get(`/api/spaces/${spaceId}/storage/transfers/${transferId}`);
	return res.data;
}

export async function getSpaceTransferFiles(
	spaceId: string,
	transferId: string,
	query: TransferFilesQuery = {},
): Promise<StorageTransferFile[]> {
	const res = await api.get(`/api/spaces/${spaceId}/storage/transfers/${transferId}/files`, {
		params: { ...query },
	});
	return res.data;
}

/** Stops a transfer after the file it's on; what moved stays in the target. */
export async function cancelSpaceTransfer(spaceId: string, transferId: string): Promise<void> {
	await api.post(`/api/spaces/${spaceId}/storage/transfers/${transferId}/cancel`);
}
