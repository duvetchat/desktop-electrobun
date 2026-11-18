import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	bucketChoice,
	defaultStorageChoice,
	fileKind,
	isLaterTransfer,
	isTransferActive,
	shownFiles,
	takesAll,
	targetRoom,
	tellsTransferEnd,
	transferEndNotice,
	transferFilter,
	transferProgress,
	transferSpaceId,
	type PickableFile,
	type StorageChoice,
} from "$lib/storage-transfers";
import { StorageTransferStatus as S, type StorageTransfer } from "$lib/types";
import type { StorageBucket } from "$lib/api/user";

const file = (id: string, content_type: string, size_bytes = 10): PickableFile => ({ id, content_type, size_bytes });

const transfer = (fields: Partial<StorageTransfer> = {}): StorageTransfer => ({
	id: "t1",
	owner_id: "u1",
	started_by: "u1",
	source_bucket_id: null,
	target_bucket_id: "b1",
	keep_source: false,
	same_bucket: false,
	status: S.Moving,
	error: null,
	total_files: 120,
	total_bytes: 1000,
	moved_files: 0,
	moved_bytes: 0,
	skipped_files: 0,
	failed_files: 0,
	created_at: "2026-10-22T02:41:48.123456Z",
	started_at: null,
	finished_at: null,
	updated_at: "2026-10-22T02:41:48.123456Z",
	...fields,
});

const target = (fields: Partial<StorageChoice> = {}): StorageChoice => ({
	id: "b1",
	name: "My R2",
	isBucket: true,
	active: false,
	maxBytes: null,
	usedBytes: 0,
	fileLimit: null,
	...fields,
});

describe("fileKind", () => {
	test("sorts files by their media type as the API does", () => {
		const cases: [string, string][] = [
			["image/png", "image"],
			["IMAGE/JPEG", "image"],
			["image/svg+xml", "image"],
			[" image/gif ", "image"],
			["video/mp4", "video"],
			["audio/webm;codecs=opus", "audio"],
			["application/pdf", "other"],
			["text/plain; charset=utf-8", "other"],
			["", "other"],
			["not a type", "other"],
			["imagefoo/png", "other"],
			["image", "other"],
			["image/", "other"],
			["image/png extra", "other"],
			["image/png/x", "other"],
		];
		for (const [contentType, kind] of cases) expect([contentType, fileKind(contentType)]).toEqual([contentType, kind]);
	});
});

describe("transferFilter", () => {
	const files = [file("a", "image/png"), file("b", "video/mp4"), file("c", "image/jpeg"), file("d", "text/plain")];

	test("every file of the storage picked, with no kind filter, takes all of them", () => {
		const filter = transferFilter(files, [], new Set(["a", "b", "c", "d"]));
		expect(filter).toEqual({});
		expect(takesAll(filter)).toBe(true);
	});

	test("some files picked by hand go by their IDs, in list order", () => {
		expect(transferFilter(files, [], new Set(["c", "a"]))).toEqual({ attachment_ids: ["a", "c"] });
	});

	test("with a kind filter on, every file it shows picked goes by kind", () => {
		expect(transferFilter(files, ["image"], new Set(["a", "c"]))).toEqual({ kinds: ["image"] });
		expect(transferFilter(files, ["image", "other"], new Set(["a", "c", "d"]))).toEqual({
			kinds: ["image", "other"],
		});
	});

	test("with a kind filter on, part of what it shows goes by IDs", () => {
		expect(transferFilter(files, ["image"], new Set(["c"]))).toEqual({ attachment_ids: ["c"] });
	});

	test("a pick outside the kind filter makes it a hand-picked list", () => {
		expect(transferFilter(files, ["image"], new Set(["a", "b", "c"]))).toEqual({ attachment_ids: ["a", "b", "c"] });
	});

	test("picks of files no longer listed don't count", () => {
		expect(transferFilter(files, [], new Set(["a", "b", "c", "d", "gone"]))).toEqual({});
	});

	test("the kind filters show the files of those kinds", () => {
		expect(shownFiles(files, ["image"]).map((f) => f.id)).toEqual(["a", "c"]);
		expect(shownFiles(files, [])).toBe(files);
	});
});

describe("targetRoom", () => {
	const files = [file("a", "image/png", 300), file("b", "video/mp4", 500), file("c", "audio/ogg", 200)];

	test("a target without a total limit has room for anything", () => {
		expect(targetRoom(target(), files)).toEqual({ files: 3, bytes: 1000, skipped: 0, free: null, fits: true });
	});

	test("files fit in what the total limit leaves", () => {
		expect(targetRoom(target({ maxBytes: 1500, usedBytes: 500 }), files)).toEqual({
			files: 3,
			bytes: 1000,
			skipped: 0,
			free: 1000,
			fits: true,
		});
		expect(targetRoom(target({ maxBytes: 1500, usedBytes: 501 }), files).fits).toBe(false);
	});

	test("files over the per-file limit are skipped and don't count toward the room", () => {
		expect(targetRoom(target({ maxBytes: 600, fileLimit: 300 }), files)).toEqual({
			files: 2,
			bytes: 500,
			skipped: 1,
			free: 600,
			fits: true,
		});
	});

	test("a target already over its limit has no room, even for empty files", () => {
		const room = targetRoom(target({ maxBytes: 100, usedBytes: 150 }), [file("e", "image/png", 0)]);
		expect(room.free).toBe(0);
		expect(room.fits).toBe(false);
	});

	test("the default storage is limited by the quota and active while no bucket is", () => {
		const status = { used_bytes: 10, max_bytes: 100, upload_limit_bytes: 50, percentage_used: 10 };
		const bucket: StorageBucket = {
			id: "b1",
			owner_id: "u1",
			name: "My R2",
			endpoint: "https://r2.example.com",
			region: "auto",
			bucket_name: "files",
			access_key_id: "key",
			is_active: true,
			is_default: false,
			use_path_style: false,
			max_bytes: null,
			upload_limit_bytes: null,
			used_bytes: 7,
			created_at: "2026-10-22T02:41:48Z",
			updated_at: "2026-10-22T02:41:48Z",
		};
		expect(defaultStorageChoice(status, [bucket])).toEqual({
			id: "default",
			name: "Default storage",
			isBucket: false,
			active: false,
			maxBytes: 100,
			usedBytes: 10,
			fileLimit: 50,
		});
		expect(defaultStorageChoice(status, [{ ...bucket, is_active: false }]).active).toBe(true);
		expect(bucketChoice(bucket)).toEqual({
			id: "b1",
			name: "My R2",
			isBucket: true,
			active: true,
			maxBytes: null,
			usedBytes: 7,
			fileLimit: null,
		});
	});
});

describe("transfer state", () => {
	test("progress counts every file done and the percent of bytes moved", () => {
		expect(
			transferProgress(transfer({ moved_files: 30, skipped_files: 5, failed_files: 2, moved_bytes: 459 })),
		).toEqual({ done: 37, total: 120, percent: 45 });
		expect(transferProgress(transfer({ total_bytes: 0, total_files: 4, moved_files: 1 })).percent).toBe(25);
		expect(transferProgress(transfer({ moved_bytes: 999 })).percent).toBe(99);
	});

	test("queued and moving are active, the rest ended", () => {
		expect([S.Queued, S.Moving, S.Done, S.Failed, S.Cancelled].map((status) => isTransferActive({ status }))).toEqual([
			true,
			true,
			false,
			false,
			false,
		]);
	});

	test("a user's own transfer has no space", () => {
		expect(transferSpaceId(transfer())).toBeNull();
		expect(transferSpaceId(transfer({ owner_id: "s1" }))).toBe("s1");
	});

	test("a state only replaces one it's no older than", () => {
		const queued = transfer({ status: S.Queued });
		const moving = transfer({ moved_files: 3 });
		const further = transfer({ moved_files: 3, failed_files: 1 });
		const done = transfer({ status: S.Done, moved_files: 120 });
		expect(isLaterTransfer(moving, queued)).toBe(true);
		expect(isLaterTransfer(queued, moving)).toBe(false);
		expect(isLaterTransfer(further, moving)).toBe(true);
		expect(isLaterTransfer(moving, further)).toBe(false);
		expect(isLaterTransfer(moving, moving)).toBe(true);
		expect(isLaterTransfer(done, further)).toBe(true);
		expect(isLaterTransfer(further, done)).toBe(false);
	});
});

describe("transferEndNotice", () => {
	test("a transfer that moved everything says how many files went where", () => {
		expect(transferEndNotice(transfer({ status: S.Done, moved_files: 120 }), "My R2")).toEqual({
			text: "Moved 120 files to My R2.",
			type: "success",
		});
		expect(transferEndNotice(transfer({ status: S.Done, total_files: 1, moved_files: 1 }), null).text).toBe(
			"Moved 1 file.",
		);
	});

	test("files left behind are counted, and failures make it an error", () => {
		expect(transferEndNotice(transfer({ status: S.Done, moved_files: 118, skipped_files: 2 }), "My R2")).toEqual({
			text: "Moved 118 of 120 files to My R2: 2 skipped.",
			type: "success",
		});
		expect(
			transferEndNotice(transfer({ status: S.Done, moved_files: 115, failed_files: 3, skipped_files: 2 }), "My R2"),
		).toEqual({ text: "Moved 115 of 120 files to My R2: 3 failed, 2 skipped.", type: "error" });
	});

	test("a failed transfer gives its error, and a cancelled one what it moved", () => {
		expect(
			transferEndNotice(transfer({ status: S.Failed, error: "target full", moved_files: 37 }), "Default storage"),
		).toEqual({ text: "Moving files to Default storage failed: target full. 37 of 120 files moved.", type: "error" });
		expect(transferEndNotice(transfer({ status: S.Cancelled, moved_files: 37 }), "My R2")).toEqual({
			text: "Moving files to My R2 was cancelled. 37 of 120 files moved.",
			type: "info",
		});
	});
});

// From the Windows builder's hand-back: with a settings window open, the end of a transfer showed its toast in both
// windows. Each window hears of the end (the main one from the gateway, the others from the main one): one tells it.
describe("which window tells a transfer's end", () => {
	const own = { owner_id: "u1", started_by: "u1" };
	const ofSpace = (spaceId: string) => ({ owner_id: spaceId, started_by: "u1" });
	const main = (...open: (string | null)[]) => ({ window: "main" as const, open: new Set(open) });
	const settings = (spaceId: string | null) => ({ window: "settings" as const, spaceId });

	test("with no settings window open, the main window tells every end", () => {
		expect(tellsTransferEnd(main(), own)).toBe(true);
		expect(tellsTransferEnd(main(), ofSpace("s1"))).toBe(true);
	});

	test("Settings, open, tells the end of the user's own transfers, and the main window doesn't", () => {
		expect(tellsTransferEnd(settings(null), own)).toBe(true);
		expect(tellsTransferEnd(main(null), own)).toBe(false);
		// A Space's transfer isn't on its screen: the main window still tells it.
		expect(tellsTransferEnd(settings(null), ofSpace("s1"))).toBe(false);
		expect(tellsTransferEnd(main(null), ofSpace("s1"))).toBe(true);
	});

	test("a Space's settings, open, tell that Space's, and no other's", () => {
		expect(tellsTransferEnd(settings("s1"), ofSpace("s1"))).toBe(true);
		expect(tellsTransferEnd(main("s1"), ofSpace("s1"))).toBe(false);
		expect(tellsTransferEnd(settings("s1"), ofSpace("s2"))).toBe(false);
		expect(tellsTransferEnd(settings("s1"), own)).toBe(false);
		expect(tellsTransferEnd(main("s1"), ofSpace("s2"))).toBe(true);
		expect(tellsTransferEnd(main("s1"), own)).toBe(true);
	});

	test("exactly one window tells each end, whichever windows are open", () => {
		const transfers = [own, ofSpace("s1"), ofSpace("s2")];
		for (const open of [[], [null], ["s1"], [null, "s1"], [null, "s1", "s2"]] as (string | null)[][]) {
			for (const moved of transfers) {
				const tellers = [main(...open), ...open.map(settings)].filter((here) => tellsTransferEnd(here, moved));
				expect(tellers).toHaveLength(1);
			}
		}
	});

	// The store asks before its toast, and each end of the windows' link says where it is.
	test("the store asks before it tells, and both links answer", () => {
		const read = (path: string) => readFileSync(join(import.meta.dir, path), "utf8");
		expect(read("stores/storage-transfers.svelte.ts")).toContain("if (this.tellsEnd(t)) toast(");
		expect(read("stores/settings-guest-link.svelte.ts")).toContain(
			'storageTransfers.tellsEnd = (transfer) => tellsTransferEnd({ window: "settings", spaceId }, transfer);',
		);
		expect(read("stores/settings-host-link.svelte.ts")).toContain(
			'storageTransfers.tellsEnd = (transfer) => tellsTransferEnd({ window: "main", open: listening }, transfer);',
		);
	});
});
