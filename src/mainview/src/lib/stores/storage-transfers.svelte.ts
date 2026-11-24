import { FetchError, getApiError } from "$lib/api/api";
import {
	activateMyBucket,
	cancelMyTransfer,
	createMyTransfer,
	deactivateMyBucket,
	getMyTransfer,
	getMyTransferFiles,
	getMyTransfers,
	type CreateTransferPayload,
	type StorageBucket,
	type TransferFilesQuery,
} from "$lib/api/user";
import {
	activateSpaceBucket,
	cancelSpaceTransfer,
	createSpaceTransfer,
	getSpaceTransfer,
	getSpaceTransferFiles,
	getSpaceTransfers,
} from "$lib/api/space-buckets";
import { t } from "$lib/i18n";
import { toast } from "$lib/stores/toast.svelte";
import {
	isLaterTransfer,
	isTransferActive,
	transferEndNotice,
	transferSpaceId,
	type StorageChoice,
} from "$lib/storage-transfers";
import { formatFileSize } from "$lib/utils/format";
import type { StorageTransfer, StorageTransferFile } from "$lib/types";

interface TransferRoutes {
	create(data: CreateTransferPayload): Promise<StorageTransfer>;
	list(): Promise<StorageTransfer[]>;
	get(id: string): Promise<StorageTransfer>;
	files(id: string, query?: TransferFilesQuery): Promise<StorageTransferFile[]>;
	cancel(id: string): Promise<void>;
}

/** The transfer routes of a space, or of the user when `spaceId` is null. */
export function transferRoutes(spaceId: string | null): TransferRoutes {
	if (spaceId === null) {
		return {
			create: createMyTransfer,
			list: getMyTransfers,
			get: getMyTransfer,
			files: getMyTransferFiles,
			cancel: cancelMyTransfer,
		};
	}
	return {
		create: (data) => createSpaceTransfer(spaceId, data),
		list: () => getSpaceTransfers(spaceId),
		get: (id) => getSpaceTransfer(spaceId, id),
		files: (id, query) => getSpaceTransferFiles(spaceId, id, query),
		cancel: (id) => cancelSpaceTransfer(spaceId, id),
	};
}

/** Makes a storage the one that gets new uploads: activates a bucket or, for a user's default storage,
 * deactivates the bucket that is active. */
export async function activateStorage(
	spaceId: string | null,
	target: StorageChoice,
	choices: StorageChoice[],
): Promise<void> {
	if (target.isBucket) {
		await (spaceId === null ? activateMyBucket(target.id) : activateSpaceBucket(spaceId, target.id));
		return;
	}
	const active = choices.find((c) => c.isBucket && c.active);
	if (active) await deactivateMyBucket(active.id);
}

/** The files a bucket delete was refused for (409 `bucket has files`), or null for any other error. */
export function bucketFilesCount(err: unknown): number | null {
	if (!(err instanceof FetchError) || err.response?.status !== 409) return null;
	const data = err.response.data;
	return data?.error === "bucket has files" && typeof data.files === "number" ? data.files : null;
}

/** Why a transfer didn't start; for one that doesn't fit (413), how much room it lacks. */
export function transferStartError(err: unknown): string {
	const message = getApiError(err, t("storage_move_start_failed"));
	const missing = err instanceof FetchError && err.response?.status === 413 ? err.response.data?.missing_bytes : null;
	return typeof missing === "number"
		? t("storage_move_start_failed_more_needed", { reason: message, size: formatFileSize(missing) })
		: message;
}

// A view showing an active transfer checks it this often, and re-reads it when no state of it arrived for
// STALE_MS (its events come every 2 s or so while it moves, to who started it).
const POLL_MS = 5000;
const STALE_MS = 4000;

class StorageTransferStore {
	/** The latest state known of each transfer, by ID: from the API's lists and STORAGE_TRANSFER_UPDATE. */
	byId = $state<Record<string, StorageTransfer>>({});
	/** The transfer whose failed files StorageTransferFailures lists. */
	failures = $state<StorageTransfer | null>(null);
	// When a state of each transfer last arrived: the polls skip the transfers events keep fresh.
	private seenAt = new Map<string, number>();
	private bucketNames = new Map<string, string>();
	private endListeners = new Set<(transfer: StorageTransfer) => void>();
	/** Whether this page tells a transfer's end: every one, unless the app's windows share them, where one window
	 * tells each (lib/storage-transfers.ts: tellsTransferEnd; the settings links set it). */
	tellsEnd: (transfer: StorageTransfer) => boolean = () => true;

	/** The queued or moving transfer of an owner (a user or a space), if any: there's one at most. */
	active(ownerId: string | null | undefined): StorageTransfer | null {
		if (!ownerId) return null;
		return (
			Object.values(this.byId).find((transfer) => transfer.owner_id === ownerId && isTransferActive(transfer)) ?? null
		);
	}

	/** Records a state of a transfer, unless the one known is later. `live` is for STORAGE_TRANSFER_UPDATE:
	 * an end first heard of there is told too, while a list's ended transfers are old news. */
	set(transfer: StorageTransfer, live = false) {
		const prev = this.byId[transfer.id];
		if (prev && !isLaterTransfer(transfer, prev)) return;
		this.byId[transfer.id] = transfer;
		this.seenAt.set(transfer.id, Date.now());
		if (!isTransferActive(transfer) && (prev ? isTransferActive(prev) : live)) this.ended(transfer);
	}

	/** Calls `listener` with each transfer that ends; returns what stops that. */
	onEnd(listener: (transfer: StorageTransfer) => void): () => void {
		this.endListeners.add(listener);
		return () => {
			this.endListeners.delete(listener);
		};
	}

	/** Names the buckets the end notices may mention. */
	nameBuckets(buckets: Pick<StorageBucket, "id" | "name">[]) {
		for (const b of buckets) this.bucketNames.set(b.id, b.name);
	}

	/** A transfer's source or target by name (null is the default storage), when it's known. */
	storageName(bucketId: string | null): string | null {
		return bucketId === null ? t("storage_default_name") : (this.bucketNames.get(bucketId) ?? null);
	}

	/** Loads the latest transfers of a space, or of the user (null). A failure (an API without transfers
	 * answers 404) leaves what's known. */
	async load(spaceId: string | null) {
		try {
			for (const transfer of await transferRoutes(spaceId).list()) this.set(transfer);
		} catch (err) {
			console.warn("[transfers] Failed to load the transfers:", getApiError(err, "unknown error"));
		}
	}

	/** Re-reads a transfer. */
	async refresh(transfer: StorageTransfer) {
		try {
			this.set(await transferRoutes(transferSpaceId(transfer)).get(transfer.id));
		} catch (err) {
			console.warn("[transfers] Failed to re-read a transfer:", getApiError(err, "unknown error"));
		}
	}

	/** Keeps the transfers of a space, or of the user (null), fresh while a view shows them: loads them,
	 * then re-reads the active one when no state of it arrived for a while (only who started a transfer
	 * gets its events). Returns what stops it. */
	watch(spaceId: string | null): () => void {
		void this.load(spaceId);
		const timer = setInterval(() => {
			for (const transfer of Object.values(this.byId)) {
				if (transferSpaceId(transfer) !== spaceId || !isTransferActive(transfer)) continue;
				if (Date.now() - (this.seenAt.get(transfer.id) ?? 0) >= STALE_MS) void this.refresh(transfer);
			}
		}, POLL_MS);
		return () => clearInterval(timer);
	}

	/** Stops a transfer after the file it's on. One that ended meanwhile (409) just gets re-read. */
	async cancel(transfer: StorageTransfer) {
		try {
			await transferRoutes(transferSpaceId(transfer)).cancel(transfer.id);
		} catch (err) {
			if (!(err instanceof FetchError && err.response?.status === 409)) throw err;
		}
		await this.refresh(transfer);
	}

	/** A page of a transfer's files. */
	files(transfer: StorageTransfer, query: TransferFilesQuery): Promise<StorageTransferFile[]> {
		return transferRoutes(transferSpaceId(transfer)).files(transfer.id, query);
	}

	private ended(transfer: StorageTransfer) {
		const notice = transferEndNotice(transfer, this.storageName(transfer.target_bucket_id));
		const show =
			transfer.failed_files > 0
				? {
						label: t("storage_transfer_failures_show"),
						run: () => {
							this.failures = transfer;
						},
					}
				: undefined;
		// A notice with failures stays longer, for its Show button. Another window tells it when this one doesn't;
		// whoever listens here still hears of the end.
		if (this.tellsEnd(transfer)) toast(notice.text, notice.type, show ? 12000 : 6000, show);
		for (const listener of this.endListeners) listener(transfer);
	}
}

export const storageTransfers = new StorageTransferStore();
