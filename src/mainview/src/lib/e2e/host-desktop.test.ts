import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCore, type CoreWorker } from "../../../../bun/e2e/core";
import { e2eBoundary } from "../../../../bun/e2e/rpc";
import { CoreError } from "./errors";
import { ATTACHMENT_PART, PART_TAG, type E2eMessage, type E2eReply } from "./host";
import { DesktopCoreHost } from "./host-desktop";
import { coreLibrary } from "./testing/host-bun";

// The page's half of the desktop's boundary (PLAN-E2E-CLIENTES.md, its section on it, and Task 7): each request with
// its id, settled by its own reply, and the bytes of a file or a package cut in parts.

const USER = "0193a4b2-0000-7000-8000-0000000000a1";
const ATTACHMENT = "0193a4b2-0000-7000-8000-0000000000c3";

/** The RPC as a test plays Bun: what the page sent, and a reply handed to it; with `answer`, each request gets its own. */
function link(answer?: (message: E2eMessage) => E2eReply) {
	const sent: E2eMessage[] = [];
	let hear: (reply: unknown) => void = () => {};
	const reply = (message: unknown) => hear(message);
	return {
		sent,
		reply,
		send: (message: E2eMessage) => {
			sent.push(message);
			if (answer) queueMicrotask(() => reply(answer(message)));
		},
		listen: (handler: (reply: unknown) => void) => {
			hear = handler;
		},
	};
}

describe("each request and its reply", () => {
	test("a reply settles its own request", async () => {
		const wire = link();
		const host = new DesktopCoreHost(wire);
		const status = host.handle({ cmd: "status" });
		const group = host.handle({ cmd: "group", conversation_id: USER });
		const [one, two] = wire.sent.map(({ id }) => id);
		expect(wire.sent.map(({ op, params }) => [op, params])).toEqual([
			["handle", { command: { cmd: "status" } }],
			["handle", { command: { cmd: "group", conversation_id: USER } }],
		]);
		expect(two).toBe(one! + 1);

		// Out of their order, between one for no request and some that are no reply at all.
		wire.reply({ id: Number.MAX_SAFE_INTEGER, instance: 0, ok: "nobody's" });
		for (const odd of ["not a reply", null, { id: `${two}` }, { id: two }, { id: two, instance: "0" }]) wire.reply(odd);
		wire.reply({
			id: two,
			instance: 0,
			error: { code: "not_found", message: "no such group", what: "group", key: "x" },
		});
		wire.reply({ id: one, instance: 0, ok: { protocol: 1 } });
		expect(await status).toEqual({ protocol: 1 });
		const refused = await group.catch((error: unknown) => error);
		expect(refused).toBeInstanceOf(CoreError);
		expect(refused).toMatchObject({ code: "not_found", what: "group", message: "no such group" });
		// Only the fields the core writes: CoreError.of keeps those alone.
		expect(refused).not.toHaveProperty("key");
		// A second reply to one that's settled changes nothing.
		wire.reply({ id: one, instance: 0, ok: "again" });
		expect(await status).toEqual({ protocol: 1 });
	});

	test("two hosts on one page settle their own requests", async () => {
		// One link, as the page has one RPC, whose replies every host hears.
		const listeners: ((reply: unknown) => void)[] = [];
		const sent: E2eMessage[] = [];
		const shared = { send: (message: E2eMessage) => sent.push(message), listen: listeners.push.bind(listeners) };
		const a = new DesktopCoreHost(shared);
		const b = new DesktopCoreHost(shared);
		const fromA = a.handle({ cmd: "status" });
		const fromB = b.handle({ cmd: "group", conversation_id: USER });
		const [toA, toB] = sent.map(({ id }) => id);
		expect(toA).not.toBe(toB);
		const reply = (message: E2eReply) => listeners.forEach((listener) => listener(message));
		reply({ id: toB!, instance: 0, ok: "b's" });
		reply({ id: toA!, instance: 0, ok: "a's" });
		expect(await fromA).toBe("a's");
		expect(await fromB).toBe("b's");
	});

	test("a request without a reply is internal once the page is told the core restarted", async () => {
		const wire = link();
		const host = new DesktopCoreHost(wire);
		const opened = host.open(USER);
		expect(wire.sent[0]).toMatchObject({ op: "open", params: { userId: USER }, instance: 0 });
		wire.reply({ id: wire.sent[0]!.id, instance: 4, ok: { state: "ready", keyStorage: "keyring" } });
		expect(await opened).toEqual({ state: "ready", keyStorage: "keyring" });

		const lost = host.handle({ cmd: "status" });
		const alsoLost = host.sharePart(USER, 0);
		expect(wire.sent.slice(1).map(({ instance }) => instance)).toEqual([4, 4]);
		wire.reply({ id: 0, instance: 5 });
		for (const request of [lost, alsoLost]) {
			const error = await request.catch((caught: unknown) => caught);
			expect(error).toBeInstanceOf(CoreError);
			expect(error).toMatchObject({ code: "internal" });
		}
		// What it asks now is for the core that started again, and a late reply for the one before changes nothing.
		const next = host.handle({ cmd: "status" });
		const asked = wire.sent.at(-1)!;
		expect(asked).toMatchObject({ instance: 5 });
		wire.reply({ id: wire.sent[1]!.id, instance: 4, ok: {} });
		wire.reply({ id: asked.id, instance: 5, ok: { protocol: 1 } });
		expect(await next).toEqual({ protocol: 1 });
	});

	test("open, close and destroy wait for their own replies, which Bun sends whatever the instance", async () => {
		const wire = link();
		const host = new DesktopCoreHost(wire);
		const destroyed = host.destroy(USER);
		const closed = host.close();
		const status = host.handle({ cmd: "status" });
		wire.reply({ id: 0, instance: 5 });
		await expect(status).rejects.toMatchObject({ code: "internal" });
		const [destroy, close] = wire.sent;
		wire.reply({ id: destroy!.id, instance: 5, ok: {} });
		wire.reply({ id: close!.id, instance: 5, ok: {} });
		expect(await destroyed).toBeUndefined();
		expect(await closed).toBeUndefined();
	});

	test("what has a way of its own never goes as a command", async () => {
		const wire = link();
		const host = new DesktopCoreHost(wire);
		for (const cmd of ["attachment_encrypt", "attachment_decrypt", "history_share", "catch_up", "history_import"]) {
			await expect(host.handle({ cmd })).rejects.toMatchObject({ code: "bad_command", field: "cmd" });
		}
		expect(wire.sent).toEqual([]);
	});

	test("a package goes in part by part, in its order, then is imported", async () => {
		const wire = link((message) => ({
			id: message.id,
			instance: 0,
			ok:
				message.op === "importShare"
					? { imported: 2 }
					: message.op === "sharePart"
						? { part: "AQID" }
						: message.op === "share"
							? { share_id: USER, parts: 1, size: 3, start: 0, truncated: false, keys: [] }
							: {},
		}));
		const host = new DesktopCoreHost(wire);
		expect(await host.importShare(USER, [new Uint8Array([1]), new Uint8Array([2, 3])])).toEqual({ imported: 2 });
		expect(wire.sent.map(({ op, params }) => [op, params])).toEqual([
			["stash", { shareId: USER, n: 0, part: "AQ==" }],
			["stash", { shareId: USER, n: 1, part: "AgM=" }],
			["importShare", { shareId: USER }],
		]);
		await expect(host.importShare(USER, Array(65).fill(new Uint8Array([1])))).rejects.toMatchObject({
			code: "too_large",
		});
		expect(wire.sent).toHaveLength(3);

		const command = { cmd: "history_share" as const, conversation_id: USER, to_user: USER, range: "all", devices: [] };
		expect(await host.share(command)).toMatchObject({ share_id: USER, parts: 1 });
		expect(await host.sharePart(USER, 0)).toEqual(new Uint8Array([1, 2, 3]));
		await host.dropShare(USER);
		expect(wire.sent.slice(3).map(({ op, params }) => [op, params])).toEqual([
			["share", { command }],
			["sharePart", { shareId: USER, n: 0 }],
			["dropShare", { shareId: USER }],
		]);
	});
});

const folders: string[] = [];
const workers: CoreWorker[] = [];
afterAll(() => {
	for (const worker of workers) worker.stop();
	for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

describe.skipIf(!coreLibrary)("through Bun's half, to a real core", () => {
	test("a file crosses in parts, 16 a message at most, and comes back whole", async () => {
		const folder = mkdtempSync(join(tmpdir(), "duvet-desktop-host-"));
		folders.push(folder);
		const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
		const sent: E2eMessage[] = [];
		let toPage: (reply: unknown) => void = () => {};
		// As Electrobun carries them: in JSON, each way.
		const bun = e2eBoundary({
			start: () => {
				const worker = startCore({ library: coreLibrary!, folder, key });
				workers.push(worker);
				return worker;
			},
			confirm: async () => false,
			show: () => {},
			lastUser: { read: () => null, write: () => {} },
			reply: (reply) => toPage(JSON.parse(JSON.stringify(reply))),
		});
		const host = new DesktopCoreHost({
			send: (message) => {
				sent.push(message);
				bun(JSON.parse(JSON.stringify(message)));
			},
			listen: (handler) => {
				toPage = handler;
			},
		});
		expect(await host.open(USER)).toEqual({ state: "ready", keyStorage: "provided" });
		const { key: fileKey } = await host.handle<{ key: string }>({ cmd: "attachment_key" });
		const file = crypto.getRandomValues(new Uint8Array(20 * ATTACHMENT_PART + 100));

		const done: number[] = [];
		const sealed = await host.sealFile(fileKey, ATTACHMENT, new Blob([file]), (n) => done.push(n));
		expect(done).toEqual([16 * ATTACHMENT_PART, file.length]);
		expect(sealed.size).toBe(file.length + 21 * PART_TAG);
		const opened = await host.openFile(fileKey, ATTACHMENT, sealed);
		expect(new Uint8Array(await opened.arrayBuffer())).toEqual(file);

		const batches = sent
			.filter(({ op }) => op === "sealParts" || op === "openParts")
			.map(({ params }) => JSON.parse(JSON.stringify(params)).parts.length);
		expect(batches).toEqual([16, 5, 16, 5]);
		for (const message of sent) expect(JSON.stringify(message).length).toBeLessThan(2 * 1024 * 1024);

		// An empty file is one empty part, sealed and opened as one.
		const empty = await host.sealFile(fileKey, USER, new Blob([]));
		expect(empty.size).toBe(PART_TAG);
		expect((await host.openFile(fileKey, USER, empty)).size).toBe(0);
		await host.close();
	});
});
