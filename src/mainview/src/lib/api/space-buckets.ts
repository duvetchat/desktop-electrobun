import { userSession } from "$lib/stores.svelte";
import { getHostURL } from "$lib/common/common";
import type { StorageBucket, CreateBucketPayload, UpdateBucketPayload } from "$lib/api/user";

const HOST = getHostURL();

export async function getSpaceBuckets(spaceId: string): Promise<StorageBucket[]> {
	if (!userSession.token) throw new Error("No user session token found");
	const res = await fetch(`${HOST}/api/spaces/${spaceId}/buckets`, {
		headers: { Authorization: userSession.token },
	});
	if (!res.ok) throw new Error(`Failed to fetch buckets: ${await res.text()}`);
	return res.json();
}

export async function createSpaceBucket(spaceId: string, data: CreateBucketPayload): Promise<StorageBucket> {
	if (!userSession.token) throw new Error("No user session token found");
	const res = await fetch(`${HOST}/api/spaces/${spaceId}/buckets`, {
		method: "POST",
		headers: { Authorization: userSession.token, "Content-Type": "application/json" },
		body: JSON.stringify(data),
	});
	if (!res.ok) {
		const b = await res.json().catch(() => null);
		throw new Error(b?.error ?? "Failed to create bucket");
	}
	return res.json();
}

export async function updateSpaceBucket(spaceId: string, bucketId: string, data: UpdateBucketPayload): Promise<StorageBucket> {
	if (!userSession.token) throw new Error("No user session token found");
	const res = await fetch(`${HOST}/api/spaces/${spaceId}/buckets/${bucketId}`, {
		method: "PATCH",
		headers: { Authorization: userSession.token, "Content-Type": "application/json" },
		body: JSON.stringify(data),
	});
	if (!res.ok) {
		const b = await res.json().catch(() => null);
		throw new Error(b?.error ?? "Failed to update bucket");
	}
	return res.json();
}

export async function deleteSpaceBucket(spaceId: string, bucketId: string): Promise<void> {
	if (!userSession.token) throw new Error("No user session token found");
	const res = await fetch(`${HOST}/api/spaces/${spaceId}/buckets/${bucketId}`, {
		method: "DELETE",
		headers: { Authorization: userSession.token },
	});
	if (!res.ok) throw new Error("Failed to delete bucket");
}

export async function activateSpaceBucket(spaceId: string, bucketId: string): Promise<void> {
	if (!userSession.token) throw new Error("No user session token found");
	const res = await fetch(`${HOST}/api/spaces/${spaceId}/buckets/${bucketId}/activate`, {
		method: "POST",
		headers: { Authorization: userSession.token },
	});
	if (!res.ok) throw new Error("Failed to activate bucket");
}

export async function deactivateSpaceBucket(spaceId: string, bucketId: string): Promise<void> {
	if (!userSession.token) throw new Error("No user session token found");
	const res = await fetch(`${HOST}/api/spaces/${spaceId}/buckets/${bucketId}/deactivate`, {
		method: "POST",
		headers: { Authorization: userSession.token },
	});
	if (!res.ok) throw new Error("Failed to deactivate bucket");
}
