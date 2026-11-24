import { transferReason } from "$lib/api/error-wording";
import type { StorageBucket, StorageStatus } from "$lib/api/user";
import { t, type MessageKey } from "$lib/i18n";
import { StorageTransferStatus, type StorageTransfer } from "$lib/types";

/** The kinds a transfer can take files by, from their content type. */
export const FILE_KINDS = ["image", "video", "audio", "other"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/** Each kind's name, as the file lists' kind filters show it: a key of the app's words. */
export const FILE_KIND_KEYS: Record<FileKind, MessageKey> = {
	image: "storage_kind_images",
	video: "storage_kind_videos",
	audio: "storage_kind_audio",
	other: "storage_kind_other",
};

/** Each kind's name in the language of the moment, read when it's drawn (FILE_KIND_KEYS, as words). */
export const FILE_KIND_LABELS: Readonly<Record<FileKind, string>> = {
	get image() {
		return t(FILE_KIND_KEYS.image);
	},
	get video() {
		return t(FILE_KIND_KEYS.video);
	},
	get audio() {
		return t(FILE_KIND_KEYS.audio);
	},
	get other() {
		return t(FILE_KIND_KEYS.other);
	},
};

// A media type's token is printable ASCII but space and these (Go's mime tspecials).
const TSPECIALS = '()<>@,;:\\"/[]?=';

function isToken(s: string): boolean {
	if (s === "") return false;
	for (const ch of s) {
		const code = ch.codePointAt(0) ?? 0;
		if (code <= 0x20 || code >= 0x7f || TSPECIALS.includes(ch)) return false;
	}
	return true;
}

/** A file's kind by its content type, as the API sorts it (transfers.KindOf): the type of a valid
 * `type/subtype`, and "other" for anything else. The API also sorts a type with malformed parameters
 * as "other"; parameters aren't checked here. */
export function fileKind(contentType: string): FileKind {
	const [type = "", subtype, ...rest] = contentType.split(";", 1)[0]!.trim().toLowerCase().split("/");
	if (subtype === undefined || rest.length > 0 || !isToken(type) || !isToken(subtype)) return "other";
	return type === "image" || type === "video" || type === "audio" ? type : "other";
}

/** What picking a file for a transfer needs to know of it. */
export interface PickableFile {
	id: string;
	content_type: string;
	size_bytes: number;
}

/** The files of the source a transfer takes: some IDs, some kinds, or (neither) all of them. */
export interface TransferFilter {
	attachment_ids?: string[];
	kinds?: FileKind[];
}

/** The most files a transfer takes by ID. */
export const MAX_PICKED_FILES = 1000;

/** The files the kind filters let through: all of them when none is on. */
export function shownFiles<T extends PickableFile>(files: T[], kinds: readonly FileKind[]): T[] {
	return kinds.length === 0 ? files : files.filter((f) => kinds.includes(fileKind(f.content_type)));
}

/**
 * The filter that moves the picked files of a storage's list: none when they're all of its files (the
 * transfer then takes every file in the source), the kinds when a kind filter is on and every file it
 * shows is picked, and their IDs otherwise.
 */
export function transferFilter(
	files: PickableFile[],
	kinds: readonly FileKind[],
	picked: ReadonlySet<string>,
): TransferFilter {
	const pickedFiles = files.filter((f) => picked.has(f.id));
	const pickedExactly = (list: PickableFile[]) =>
		list.length === pickedFiles.length && list.every((f) => picked.has(f.id));
	if (kinds.length === 0 && pickedExactly(files)) return {};
	if (kinds.length > 0 && pickedExactly(shownFiles(files, kinds))) return { kinds: [...kinds] };
	return { attachment_ids: pickedFiles.map((f) => f.id) };
}

/** Whether a filter takes every file in the source. */
export function takesAll(filter: TransferFilter): boolean {
	return filter.attachment_ids === undefined && filter.kinds === undefined;
}

/** The ID a transfer gives a user's default storage. */
export const DEFAULT_STORAGE = "default";

/** A storage files can move from or to. */
export interface StorageChoice {
	/** As a transfer names it: DEFAULT_STORAGE or a bucket ID. */
	id: string;
	name: string;
	isBucket: boolean;
	/** It gets the new uploads. */
	active: boolean;
	/** Its total limit; null for none. */
	maxBytes: number | null;
	usedBytes: number;
	/** Its per-file limit; null for none. */
	fileLimit: number | null;
}

export function bucketChoice(bucket: StorageBucket): StorageChoice {
	return {
		id: bucket.id,
		name: bucket.name,
		isBucket: true,
		active: bucket.is_active,
		maxBytes: bucket.max_bytes ?? null,
		usedBytes: bucket.used_bytes,
		fileLimit: bucket.upload_limit_bytes ?? null,
	};
}

/**
 * How a sentence about moving files names one of the storages, the case of its `to` or `from` select: "default" for the
 * default storage (bucketId null), which each sentence says in words of its own, as each language needs its own article
 * or preposition with it ("in den Standardspeicher"); "named" for a bucket, by its name; "unknown" for a bucket whose
 * name isn't known.
 */
export function storageCase(bucketId: string | null, name: string | null | undefined): "default" | "named" | "unknown" {
	if (bucketId === null) return "default";
	return name ? "named" : "unknown";
}

/** A user's default storage, which gets the uploads while none of their buckets is active. Its name is for where it's
 * named on its own (the move dialog's target picker); a sentence says it by storageCase's "default". */
export function defaultStorageChoice(status: StorageStatus, buckets: StorageBucket[]): StorageChoice {
	return {
		id: DEFAULT_STORAGE,
		name: t("storage_default_name"),
		isBucket: false,
		active: !buckets.some((b) => b.is_active),
		maxBytes: status.max_bytes,
		usedBytes: status.used_bytes,
		fileLimit: status.upload_limit_bytes,
	};
}

/** How a transfer's files fit in its target. */
export interface TargetRoom {
	/** The files that go: those within the target's per-file limit. */
	files: number;
	bytes: number;
	/** The files over that limit, which the transfer skips. */
	skipped: number;
	/** The target's free bytes; null when it has no total limit. */
	free: number | null;
	fits: boolean;
}

/** How files fit in a target, as the API checks it: those over its per-file limit are skipped and don't
 * count, and the rest must fit in what its total limit leaves. */
export function targetRoom(target: StorageChoice, files: PickableFile[]): TargetRoom {
	const going = files.filter((f) => target.fileLimit === null || f.size_bytes <= target.fileLimit);
	const bytes = going.reduce((sum, f) => sum + f.size_bytes, 0);
	const room = { files: going.length, bytes, skipped: files.length - going.length };
	if (target.maxBytes === null) return { ...room, free: null, fits: true };
	return {
		...room,
		free: Math.max(target.maxBytes - target.usedBytes, 0),
		fits: target.usedBytes + bytes <= target.maxBytes,
	};
}

/** Queued or moving. */
export function isTransferActive(transfer: Pick<StorageTransfer, "status">): boolean {
	return transfer.status === StorageTransferStatus.Queued || transfer.status === StorageTransferStatus.Moving;
}

/** The space whose files a transfer moves, or null for the user's own: a user only moves their own
 * files, so the owner of their transfers is who started them. */
export function transferSpaceId(transfer: Pick<StorageTransfer, "owner_id" | "started_by">): string | null {
	return transfer.owner_id === transfer.started_by ? null : transfer.owner_id;
}

/** Where a page is, for who tells a transfer's end: the main window, with the settings windows open beside it (each
 * by its Space, null for Settings' own), or one of those windows. */
export type TransferTeller =
	| { window: "main"; open: ReadonlySet<string | null> }
	| { window: "settings"; spaceId: string | null };

/**
 * Whether this window tells a transfer's end (its toast, with Show for the files that failed). In the desktop app the
 * main window and the settings windows all hear of it, and each told it: one does. The window whose screen shows the
 * transfer, Settings for the user's own files and a Space's settings for that Space's, tells it while it is open;
 * with it closed, the main window does.
 */
export function tellsTransferEnd(
	here: TransferTeller,
	transfer: Pick<StorageTransfer, "owner_id" | "started_by">,
): boolean {
	const spaceId = transferSpaceId(transfer);
	return here.window === "main" ? !here.open.has(spaceId) : here.spaceId === spaceId;
}

function filesDone(transfer: StorageTransfer): number {
	return transfer.moved_files + transfer.skipped_files + transfer.failed_files;
}

/** How far a transfer is: its files done (moved, skipped or failed) of its total, and the percent of its
 * bytes moved. */
export function transferProgress(transfer: StorageTransfer): { done: number; total: number; percent: number } {
	const done = filesDone(transfer);
	const { moved_bytes, total_bytes, total_files } = transfer;
	const ratio = total_bytes > 0 ? moved_bytes / total_bytes : total_files > 0 ? done / total_files : 0;
	return { done, total: total_files, percent: Math.max(0, Math.min(Math.floor(ratio * 100), 100)) };
}

/** Whether `next` is a state of the transfer no older than `prev`. A transfer only moves forward
 * (queued, moving, ended) and its counts only grow, so states that cross on the way (an event and a
 * reload) are told apart without clocks. */
export function isLaterTransfer(next: StorageTransfer, prev: StorageTransfer): boolean {
	const stage = (transfer: StorageTransfer) =>
		isTransferActive(transfer) ? transfer.status : StorageTransferStatus.Done;
	if (stage(next) !== stage(prev)) return stage(next) > stage(prev);
	return filesDone(next) >= filesDone(prev);
}

export interface TransferNotice {
	text: string;
	type: "success" | "error" | "info";
}

/** Which of a finished transfer's files stayed behind: those that failed, those skipped, or both. */
function leftBehind(transfer: StorageTransfer): "failed" | "skipped" | "both" | null {
	if (transfer.failed_files > 0) return transfer.skipped_files > 0 ? "both" : "failed";
	return transfer.skipped_files > 0 ? "skipped" : null;
}

/** What to tell about a transfer that ended. `target` is its target bucket's name, when it's known; the default
 * storage is said in each sentence's own words (storageCase). */
export function transferEndNotice(transfer: StorageTransfer, target: string | null): TransferNotice {
	const to = storageCase(transfer.target_bucket_id, target);
	// Where they went, when the sentence can say it: the default storage, or a bucket by its name.
	const named = to !== "unknown";
	const counts = {
		moved: transfer.moved_files,
		total: transfer.total_files,
		failed: transfer.failed_files,
		skipped: transfer.skipped_files,
		to,
		target: target ?? "",
	};
	switch (transfer.status) {
		case StorageTransferStatus.Done: {
			const left = leftBehind(transfer);
			if (left === null) {
				const key = named ? "storage_transfer_done_to" : "storage_transfer_done";
				return { text: t(key, { ...counts, count: transfer.moved_files }), type: "success" };
			}
			return {
				text: t(named ? "storage_transfer_done_partly_to" : "storage_transfer_done_partly", { ...counts, left }),
				type: transfer.failed_files > 0 ? "error" : "success",
			};
		}
		case StorageTransferStatus.Failed: {
			const error = transfer.error;
			if (error) {
				const key = named ? "storage_transfer_failed_to_reason" : "storage_transfer_failed_reason";
				return { text: t(key, { ...counts, reason: transferReason(error) }), type: "error" };
			}
			return { text: t(named ? "storage_transfer_failed_to" : "storage_transfer_failed", counts), type: "error" };
		}
		default:
			return {
				text: t(named ? "storage_transfer_cancelled_to" : "storage_transfer_cancelled", counts),
				type: "info",
			};
	}
}
