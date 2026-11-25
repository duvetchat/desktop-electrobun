// The desktop's CoreHost (PLAN-E2E-CLIENTES.md, its sections on the core's host and on the desktop's boundary): the
// page's half of the boundary, whose other half is Bun's (src/bun/e2e/rpc.ts). Each request goes in the main window's
// `e2e` message with an id of its own, and its reply, which may come in any order, settles it. A file crosses in
// parts, 16 of 64 KiB a message, and a package's parts one at a time, so no message passes 2 MiB.
import { base64Bytes } from "$lib/activity-thumbnail";
import { getElectrobunRpc } from "$lib/electrobun-rpc";
import { bytesBase64 } from "$lib/staged-images";
import { CoreError } from "./errors";
import {
	ATTACHMENT_PART,
	MAX_SHARE_PARTS,
	OWN_WAY,
	ownWay,
	PART_TAG,
	PARTS_PER_MESSAGE,
	type CoreHost,
	type E2eMessage,
	type E2eOp,
	type HostState,
	type ShareMade,
} from "./host";

/** How the host reaches Bun: the main window's RPC (desktopCoreHost), or a test's stand-in. */
export interface DesktopLink {
	send(message: E2eMessage): void;
	/** Each message Bun sends back, as it comes: anything, until it's read as a reply. */
	listen(handler: (reply: unknown) => void): void;
}

interface Waiting {
	/** The core's instance it was sent for. */
	instance: number;
	resolve(ok: unknown): void;
	reject(error: CoreError): void;
}

/** Bun's reply as it reads one: an id and an instance that are whole numbers, then whatever it answers. */
function readReply(value: unknown): { id: number; instance: number; ok: unknown; error: unknown } | null {
	if (typeof value !== "object" || value === null || !("id" in value) || !("instance" in value)) return null;
	const { id, instance } = value;
	if (typeof id !== "number" || !Number.isSafeInteger(id)) return null;
	if (typeof instance !== "number" || !Number.isSafeInteger(instance)) return null;
	return { id, instance, ok: "ok" in value ? value.ok : undefined, error: "error" in value ? value.error : undefined };
}

export class DesktopCoreHost implements CoreHost {
	readonly #link: DesktopLink;
	#next = 1;
	/** The core's instance Bun named last, 0 before it named one. */
	#instance = 0;
	readonly #waiting = new Map<number, Waiting>();

	constructor(link: DesktopLink) {
		this.#link = link;
		link.listen((reply) => this.#settle(reply));
	}

	/** One request, settled by its own reply: its `ok`, typed by its caller as the op answers, or its CoreError. */
	#ask(op: E2eOp, params?: unknown): Promise<any> {
		const id = this.#next++;
		const instance = this.#instance;
		return new Promise((resolve, reject) => {
			this.#waiting.set(id, { instance, resolve, reject });
			try {
				this.#link.send({ id, op, params, instance });
			} catch {
				this.#waiting.delete(id);
				reject(new CoreError("internal", "the request didn't reach Bun"));
			}
		});
	}

	#settle(value: unknown) {
		const reply = readReply(value);
		if (!reply) return;
		const own = this.#waiting.get(reply.id);
		if (own) {
			this.#waiting.delete(reply.id);
			const { error } = reply;
			if (error === undefined) own.resolve(reply.ok);
			else if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
				own.reject(CoreError.of({ ...error, code: error.code }));
			} else own.reject(new CoreError("internal", "Bun's reply is neither ok nor an error"));
		}
		// A new instance: the core started again, and what still waits from before is lost.
		if (reply.instance > this.#instance) {
			this.#instance = reply.instance;
			for (const [id, waiting] of this.#waiting) {
				if (waiting.instance >= reply.instance) continue;
				this.#waiting.delete(id);
				waiting.reject(new CoreError("internal", "the core started again"));
			}
		}
	}

	open(userId: string): Promise<{ state: HostState; keyStorage?: "keyring" | "file" | "provided" }> {
		return this.#ask("open", { userId });
	}

	async handle<T = unknown>(command: { cmd: string } & Record<string, unknown>): Promise<T> {
		if (OWN_WAY.includes(command.cmd)) throw ownWay(command.cmd);
		return this.#ask("handle", { command });
	}

	sealFile(key: string, attachmentId: string, plain: Blob, progress?: (done: number) => void): Promise<Blob> {
		return this.#parts("sealParts", key, attachmentId, plain, ATTACHMENT_PART, progress);
	}

	openFile(key: string, attachmentId: string, sealed: Blob, progress?: (done: number) => void): Promise<Blob> {
		return this.#parts("openParts", key, attachmentId, sealed, ATTACHMENT_PART + PART_TAG, progress);
	}

	/** A file through the core, `size` bytes a part and 16 parts a message, the last one marked: an empty file is one. */
	async #parts(
		op: E2eOp,
		key: string,
		attachmentId: string,
		file: Blob,
		size: number,
		progress?: (done: number) => void,
	) {
		const count = Math.max(1, Math.ceil(file.size / size));
		const out: Uint8Array<ArrayBuffer>[] = [];
		for (let index = 0; index < count; index += PARTS_PER_MESSAGE) {
			const end = Math.min(count, index + PARTS_PER_MESSAGE);
			const bytes = new Uint8Array(await file.slice(index * size, end * size).arrayBuffer());
			const parts: string[] = [];
			for (let n = 0; n < end - index; n++) parts.push(bytesBase64(bytes.subarray(n * size, (n + 1) * size)));
			const done: { parts?: unknown } = await this.#ask(op, { key, attachmentId, index, last: end === count, parts });
			if (!Array.isArray(done.parts) || done.parts.length !== parts.length) {
				throw new CoreError("internal", "Bun answered other parts than it was sent");
			}
			out.push(...done.parts.map((part: string) => base64Bytes(part)));
			progress?.(Math.min(file.size, end * size));
		}
		return new Blob(out);
	}

	share(command: { cmd: "history_share" | "catch_up" } & Record<string, unknown>): Promise<ShareMade> {
		return this.#ask("share", { command });
	}

	async sharePart(shareId: string, n: number): Promise<Uint8Array> {
		const { part }: { part: string } = await this.#ask("sharePart", { shareId, n });
		return base64Bytes(part);
	}

	async dropShare(shareId: string): Promise<void> {
		await this.#ask("dropShare", { shareId });
	}

	/** Each part handed to Bun in its turn, then imported: the core reads the whole command before it looks at them. */
	async importShare(shareId: string, parts: Uint8Array[]): Promise<{ imported: number }> {
		if (parts.length > MAX_SHARE_PARTS) {
			throw new CoreError("too_large", `a package has ${MAX_SHARE_PARTS} parts at most`, { limit: MAX_SHARE_PARTS });
		}
		for (const [n, part] of parts.entries()) await this.#ask("stash", { shareId, n, part: bytesBase64(part) });
		return this.#ask("importShare", { shareId });
	}

	async close(): Promise<void> {
		await this.#ask("close");
	}

	async destroy(userId: string): Promise<void> {
		await this.#ask("destroy", { userId });
	}
}

/** The desktop's host over the main window's RPC, or null outside the desktop app. */
export async function desktopCoreHost(): Promise<DesktopCoreHost | null> {
	const rpc = await getElectrobunRpc();
	if (!rpc) return null;
	return new DesktopCoreHost({
		send: (message) => rpc.send.e2e(message),
		listen: (handler) => rpc.on.e2eReply(handler),
	});
}
