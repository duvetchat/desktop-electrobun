import api from "$lib/api/api";
import type { StorageBucket, CreateBucketPayload, UpdateBucketPayload } from "$lib/api/user";

export async function getSpaceBuckets(spaceId: string): Promise<StorageBucket[]> {
    const res = await api.get(`/api/spaces/${spaceId}/buckets`);
    return res.data;
}

export async function createSpaceBucket(spaceId: string, data: CreateBucketPayload): Promise<StorageBucket> {
    const res = await api.post(`/api/spaces/${spaceId}/buckets`, data);
    return res.data;
}

export async function updateSpaceBucket(spaceId: string, bucketId: string, data: UpdateBucketPayload): Promise<StorageBucket> {
    const res = await api.patch(`/api/spaces/${spaceId}/buckets/${bucketId}`, data);
    return res.data;
}

export async function deleteSpaceBucket(spaceId: string, bucketId: string): Promise<void> {
    await api.delete(`/api/spaces/${spaceId}/buckets/${bucketId}`);
}

export async function activateSpaceBucket(spaceId: string, bucketId: string): Promise<void> {
    await api.post(`/api/spaces/${spaceId}/buckets/${bucketId}/activate`);
}

export async function deactivateSpaceBucket(spaceId: string, bucketId: string): Promise<void> {
    await api.post(`/api/spaces/${spaceId}/buckets/${bucketId}/deactivate`);
}