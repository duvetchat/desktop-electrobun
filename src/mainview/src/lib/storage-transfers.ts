import type { StorageBucket, StorageStatus } from "$lib/api/user";
import { StorageTransferStatus, type StorageTransfer } from "$lib/types";

/** The kinds a transfer can take files by, from their content type. */
export const FILE_KINDS = ["image", "video", "audio", "other"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const FILE_KIND_LABELS: Record<FileKind, string> = {
	image: "Images",
	video: "Videos",
	audio: "Audio",
	other: "Other",
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
	const [type, subtype, ...rest] = contentType.split(";", 1)[0].trim().toLowerCase().split("/");
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

/** A user's default storage, which gets the uploads while none of their buckets is active. */
export function defaultStorageChoice(status: StorageStatus, buckets: StorageBucket[]): StorageChoice {
	return {
		id: DEFAULT_STORAGE,
		name: "Default storage",
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
export function isTransferActive(t: Pick<StorageTransfer, "status">): boolean {
	return t.status === StorageTransferStatus.Queued || t.status === StorageTransferStatus.Moving;
}

/** The space whose files a transfer moves, or null for the user's own: a user only moves their own
 * files, so the owner of their transfers is who started them. */
export function transferSpaceId(t: Pick<StorageTransfer, "owner_id" | "started_by">): string | null {
	return t.owner_id === t.started_by ? null : t.owner_id;
}

function filesDone(t: StorageTransfer): number {
	return t.moved_files + t.skipped_files + t.failed_files;
}

/** How far a transfer is: its files done (moved, skipped or failed) of its total, and the percent of its
 * bytes moved. */
export function transferProgress(t: StorageTransfer): { done: number; total: number; percent: number } {
	const done = filesDone(t);
	const ratio = t.total_bytes > 0 ? t.moved_bytes / t.total_bytes : t.total_files > 0 ? done / t.total_files : 0;
	return { done, total: t.total_files, percent: Math.max(0, Math.min(Math.floor(ratio * 100), 100)) };
}

/** Whether `next` is a state of the transfer no older than `prev`. A transfer only moves forward
 * (queued, moving, ended) and its counts only grow, so states that cross on the way (an event and a
 * reload) are told apart without clocks. */
export function isLaterTransfer(next: StorageTransfer, prev: StorageTransfer): boolean {
	const stage = (t: StorageTransfer) => (isTransferActive(t) ? t.status : StorageTransferStatus.Done);
	if (stage(next) !== stage(prev)) return stage(next) > stage(prev);
	return filesDone(next) >= filesDone(prev);
}

export function countFiles(n: number): string {
	return `${n} ${n === 1 ? "file" : "files"}`;
}

export interface TransferNotice {
	text: string;
	type: "success" | "error" | "info";
}

/** What to tell about a transfer that ended. `target` is its target's name, when it's known. */
export function transferEndNotice(t: StorageTransfer, target: string | null): TransferNotice {
	const to = target ? ` to ${target}` : "";
	const ofTotal = `${t.moved_files} of ${countFiles(t.total_files)}`;
	switch (t.status) {
		case StorageTransferStatus.Done: {
			const left = [
				t.failed_files > 0 ? `${t.failed_files} failed` : "",
				t.skipped_files > 0 ? `${t.skipped_files} skipped` : "",
			].filter(Boolean);
			if (left.length === 0) return { text: `Moved ${countFiles(t.moved_files)}${to}.`, type: "success" };
			return {
				text: `Moved ${ofTotal}${to}: ${left.join(", ")}.`,
				type: t.failed_files > 0 ? "error" : "success",
			};
		}
		case StorageTransferStatus.Failed:
			return {
				text: `Moving files${to} failed${t.error ? `: ${t.error}` : ""}. ${ofTotal} moved.`,
				type: "error",
			};
		default:
			return { text: `Moving files${to} was cancelled. ${ofTotal} moved.`, type: "info" };
	}
}
