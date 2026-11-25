// What the engine sees of the core, the same on every platform (PLAN-E2E-CLIENTES.md, its section on the core's host):
// the desktop's, through Bun (Task 7); the web's, in a worker (Task 8); and testing/host-bun.ts's, through bun:ffi in
// tests.
import { CoreError } from "./errors";

export { CoreError };

export type HostState = "ready" | "locked" | "unsupported" | "failed";

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
	open(userId: string): Promise<{ state: HostState; keyStorage?: "keyring" | "file" | "provided" }>;
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
