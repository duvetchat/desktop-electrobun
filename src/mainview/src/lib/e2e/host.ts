// What the engine sees of the core, the same on every platform (PLAN-E2E-CLIENTES.md, its section on the core's host):
// the desktop's, through Bun (Task 7); the web's, in a worker (Task 8); and testing/host-bun.ts's, through bun:ffi in
// tests.
import { CoreError } from "./errors";

export { CoreError };

export type HostState = "ready" | "locked" | "unsupported" | "failed";

/** What `open` answers: its state, where the key is kept once ready, and why it failed: the core's code, `bad_key` for a
 * database its key no longer opens (lost for good), anything else a failure another open may get past. */
export interface HostOpened {
	state: HostState;
	keyStorage?: "keyring" | "file" | "provided";
	reason?: string;
}

/** What `share` answers: `history_share`'s or `catch_up`'s reply, its parts kept in the host and counted here. */
export interface ShareMade {
	share_id: string;
	/** How many parts the package has, which `sharePart` hands out one by one. */
	parts: number;
	/** The parts' bytes together. */
	size: number;
	/** The package holds every record the device has from this time on, in Unix milliseconds. */
	start: number;
	/** Older records were left out, as they didn't fit. */
	truncated: boolean;
	/** The package's key, sealed to each of the recipient's devices: a message for its inbox. */
	keys: { device_id: string; message: string }[];
}

export interface CoreHost {
	/** Opens this user's database on this device, or makes it. */
	open(userId: string): Promise<HostOpened>;
	/** Runs one command. Resolves with the reply's `ok`; rejects with a CoreError (its code and extra fields). */
	handle<T = unknown>(command: { cmd: string } & Record<string, unknown>): Promise<T>;
	/** Seals or opens a whole file, part by part, with the bytes never in one JSON. */
	sealFile(key: string, attachmentId: string, plain: Blob, progress?: (done: number) => void): Promise<Blob>;
	openFile(key: string, attachmentId: string, sealed: Blob, progress?: (done: number) => void): Promise<Blob>;
	/** `history_share` or `catch_up`: its reply without the parts, which stay in the host until dropped. */
	share(command: { cmd: "history_share" | "catch_up" } & Record<string, unknown>): Promise<ShareMade>;
	sharePart(shareId: string, n: number): Promise<Uint8Array>;
	dropShare(shareId: string): Promise<void>;
	/** `history_import`, with the parts handed in one by one. */
	importShare(shareId: string, parts: Uint8Array[]): Promise<{ imported: number }>;
	close(): Promise<void>;
	/** Closes, then deletes the database and its key. */
	destroy(userId: string): Promise<void>;
	/** An approval's attempt is over: the desktop's Bun takes its box of the attempt's fingerprints away (#557). */
	endApproval?(): Promise<void>;
}

/** The commands `handle` refuses: each has a way of its own, which keeps its bytes out of one JSON. */
export const OWN_WAY = ["attachment_encrypt", "attachment_decrypt", "history_share", "catch_up", "history_import"];

/** A file's parts as the core seals them: 64 KiB of the file each, and its 16-byte tag. */
export const ATTACHMENT_PART = 65_536;
export const PART_TAG = 16;
/** The most parts `importShare` hands the core at once, which reads the whole command before it looks at them. */
export const MAX_SHARE_PARTS = 64;

/** The CoreError `handle` refuses a command of `OWN_WAY` with. */
export const ownWay = (cmd: string) => new CoreError("bad_command", `${cmd} has a way of its own`, { field: "cmd" });

// The desktop's boundary (PLAN-E2E-CLIENTES.md, its section on it): the page asks Bun with one RPC message, `e2e`, and
// Bun answers each with another, `e2eReply`, by the request's `id`. Neither has a time limit, which Electrobun's
// requests share one of, as a command can take long. Both halves read these shapes: host-desktop.ts in the page and
// src/bun/e2e/rpc.ts in Bun.

/** What the page may ask of Bun's core. */
export const E2E_OPS = [
	"open",
	"handle",
	"sealParts",
	"openParts",
	"share",
	"sharePart",
	"dropShare",
	"stash",
	"importShare",
	"close",
	"destroy",
	"endApproval",
] as const;
export type E2eOp = (typeof E2E_OPS)[number];
/** The ops Bun runs whatever core instance they were sent for: each names its user or needs none, and gets its reply. */
export const STANDALONE_OPS: readonly E2eOp[] = ["open", "close", "destroy", "endApproval"];

/** The page's request. */
export interface E2eMessage {
	id: number;
	op: E2eOp;
	params: unknown;
	/** The core's instance the page last heard of, 0 before any: Bun refuses an op meant for one that's gone. */
	instance: number;
}

/** Bun's answer to the request of its `id`. `id` 0 answers nothing: it only says the core started again. */
export interface E2eReply {
	id: number;
	/** The core's instance now. A new one means the core started again, and what the page still waits for is lost. */
	instance: number;
	ok?: unknown;
	error?: { code: string } & Record<string, unknown>;
}

/** The most parts of a file one message carries: 16 of 64 KiB are about 1.4 MB in base64, under 2 MiB. */
export const PARTS_PER_MESSAGE = 16;
/** A package's part, as `share` makes them and `stash` takes them one at a time: 1 MiB of it, and its tag. */
export const SHARE_PART = 1_048_576 + PART_TAG;
