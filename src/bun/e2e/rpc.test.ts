import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ATTACHMENT_PART, OWN_WAY, PART_TAG, SHARE_PART, type E2eReply } from "../../mainview/src/lib/e2e/host";
import { CONFIRMED, CORE_COMMANDS, e2eBoundary, type BoundaryDeps } from "./rpc";
import { CoreStopped, startCore, type CoreWorker, type WorkerReply } from "./core";
import { IDOK, MB_DEFBUTTON2, MB_OKCANCEL, nativeConfirm, type Question } from "./confirm";

// Bun's half of the desktop's boundary (PLAN-E2E-CLIENTES.md, its section on it, and Task 7): what the page may ask the
// core, what asks the person first, outside the page, and how the bytes cross.

// The core's commands as its contract lists them (duvet-e2e's batch-0-contracts.md, at the commit native/core's
// SOURCE.json names), copied: one the contract adds reaches the page only once it's added here and in rpc.ts on purpose.
const CONTRACT = [
	"status",
	"create_device",
	"create_identity",
	"recover",
	"approval_begin",
	"approval_offer",
	"approval_reveal",
	"approval_check",
	"approval_confirm",
	"approval_accept",
	"approval_from_qr",
	"approval_receive",
	"sign_device_list",
	"observe_user",
	"safety_number",
	"verify_user",
	"reset_identity",
	"rotate_keys",
	"identity_uploaded",
	"device_list_uploaded",
	"key_packages",
	"bind_proof",
	"create_group",
	"commit_result",
	"add_members",
	"remove_members",
	"leave",
	"commit_pending",
	"refresh_due",
	"refresh",
	"join_external",
	"reset_group",
	"group",
	"apply",
	"encrypt",
	"sent",
	"discard",
	"edit",
	"delete",
	"messages",
	"search",
	"without_devices",
	"attachment_key",
	"attachment_encrypt",
	"attachment_decrypt",
	"receive_direct",
	"backup_due",
	"backup_segment",
	"backup_uploaded",
	"backup_import",
	"backup_reencrypt",
	"history_share",
	"history_import",
	"catch_up",
	"catch_up_delivered",
];

const ANA = "0193a4b2-0000-7000-8000-0000000000a1";
const BO = "0193a4b2-0000-7000-8000-0000000000b1";
const APPROVER = "0193a4b2-0000-7000-8000-0000000000a2";
const NEW_A = "0193a4b2-0000-7000-8000-0000000000a3";
const NEW_B = "0193a4b2-0000-7000-8000-0000000000a4";
const BO_DEVICE = "0193a4b2-0000-7000-8000-0000000000b2";
const CONVERSATION = "0193a4b2-0000-7000-8000-0000000000c1";
const MESSAGE = "0193a4b2-0000-7000-8000-0000000000c2";
const ATTACHMENT = "0193a4b2-0000-7000-8000-0000000000c3";
const MIB2 = 2 * 1024 * 1024;

const ROOT = join(import.meta.dir, "../../..");
/** The library native/core carries for this platform's tests, or the build DUVET_E2E_FFI names; none on macOS. */
const LIBRARY: string | null =
	process.env.DUVET_E2E_FFI ||
	(process.arch !== "x64"
		? null
		: process.platform === "linux"
			? join(ROOT, "native/core/linux-x64/libduvet_e2e_ffi.so")
			: process.platform === "win32"
				? join(ROOT, "native/core/win-x64/duvet_e2e_ffi.dll")
				: null);
const withCore = LIBRARY !== null && existsSync(LIBRARY);

const folders: string[] = [];
const workers: CoreWorker[] = [];
afterAll(() => {
	for (const worker of workers) worker.stop();
	for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** A device's core, as the app starts it: in a worker of its own, each start on the same folder with the same key. */
function realCore(): () => CoreWorker {
	const folder = mkdtempSync(join(tmpdir(), "duvet-boundary-"));
	folders.push(folder);
	const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
	return () => {
		const worker = startCore({ library: LIBRARY!, folder, key });
		workers.push(worker);
		return worker;
	};
}

/** A core of no library: each op answers what `answer` says, and is noted. */
function fakeCore(answer: (op: string, params: any) => WorkerReply = () => ({ ok: {} })) {
	const calls: { op: string; params: any }[] = [];
	const started: CoreWorker[] = [];
	const start = () => {
		const worker: CoreWorker = {
			run: async (op, params) => {
				calls.push({ op, params });
				return answer(op, params);
			},
			stop: () => {},
		};
		started.push(worker);
		return worker;
	};
	return { calls, started, start };
}

/** The person's answers, in turn, and what they were asked. */
function person(...answers: boolean[]) {
	const asked: Question[] = [];
	const confirm = async (question: Question) => {
		asked.push(question);
		return answers.shift() ?? false;
	};
	return { asked, confirm };
}

/** A reply as the page reads it from JSON: its `ok` and its error whatever the op gives. */
type Reply = { id: number; instance: number; ok?: any; error?: any };

/** The page's side, as a test drives it: a request by its id, the instance Bun named last, and every reply. */
function pageOf(deps: Partial<BoundaryDeps>) {
	const replies: Reply[] = [];
	const waiting = new Map<number, (reply: Reply) => void>();
	let next = 1;
	let instance = 0;
	const send = e2eBoundary({
		start: null,
		confirm: async () => false,
		...deps,
		reply: (reply: E2eReply) => {
			replies.push(reply);
			instance = reply.instance;
			waiting.get(reply.id)?.(reply);
			waiting.delete(reply.id);
		},
	});
	const ask = (op: unknown, params?: unknown, under?: number) =>
		new Promise<Reply>((resolve) => {
			const id = next++;
			waiting.set(id, resolve);
			send({ id, op, params, instance: under ?? instance });
		});
	/** A command's reply, its `ok` or its error, as handle answers it. */
	const run = (command: Record<string, unknown>) => ask("handle", { command });
	return {
		send,
		ask,
		run,
		replies,
		get instance() {
			return instance;
		},
	};
}

describe("what the page may ask", () => {
	test("a command off the list is refused", async () => {
		expect([...CORE_COMMANDS].sort()).toEqual([...CONTRACT].sort());
		const core = fakeCore((op) =>
			op === "open" ? { ok: { state: "ready", keyStorage: "file", handle: 1 } } : { ok: { reached: op } },
		);
		const page = pageOf({ start: core.start });
		// The core's own handle stays in Bun.
		expect((await page.ask("open", { userId: ANA })).ok).toEqual({ state: "ready", keyStorage: "file" });

		const nul = String.fromCharCode(0);
		for (const cmd of [
			"drop_everything",
			"__proto__",
			"constructor",
			"toString",
			"",
			"STATUS",
			" status",
			`status${nul}`,
		]) {
			expect((await page.run({ cmd })).error).toMatchObject({ code: "bad_command", field: "cmd" });
		}
		for (const command of [undefined, null, "status", 7, [], {}, { cmd: 7 }, { cmd: ["status"] }]) {
			expect((await page.ask("handle", { command })).error).toMatchObject({ code: "bad_command" });
		}
		// The five with ways of their own: their bytes never go in one JSON.
		for (const cmd of OWN_WAY) {
			expect((await page.run({ cmd })).error).toEqual({
				code: "bad_command",
				message: `${cmd} has a way of its own`,
				field: "cmd",
			});
		}
		for (const op of ["eval", "__proto__", "constructor", "hasOwnProperty", "handle ", 7, null]) {
			expect((await page.ask(op, {})).error).toMatchObject({ code: "bad_command", field: "op" });
		}
		expect(core.calls.filter(({ op }) => op === "handle")).toEqual([]);

		// What the list has goes on to the core as the page sent it.
		expect((await page.run({ cmd: "status" })).ok).toEqual({ reached: "handle" });
		expect(core.calls.at(-1)).toEqual({ op: "handle", params: { command: { cmd: "status" } } });
	});

	test("a request with no id to answer gets nothing, and nothing a page sends throws", async () => {
		const page = pageOf({ start: fakeCore().start });
		for (const message of [
			undefined,
			null,
			7,
			"open",
			[],
			{},
			{ id: "1", op: "open" },
			{ id: 0, op: "close" },
			{ id: -1, op: "close" },
			{ id: 1.5, op: "close" },
			{ id: Number.MAX_SAFE_INTEGER + 1, op: "close" },
		]) {
			expect(() => page.send(message)).not.toThrow();
		}
		// Bun answers in turn: once this one is answered, those before it were handled.
		const last = await page.ask("close");
		expect(page.replies).toEqual([last]);
	});
});

describe("what asks the person first, outside the page", () => {
	test("the four commands, and create_identity, which is reset_identity in the core", () => {
		expect([...CONFIRMED].sort()).toEqual([
			"approval_confirm",
			"approval_from_qr",
			"create_identity",
			"reset_identity",
			"rotate_keys",
		]);
	});

	test("the box is the system's own, with Cancel the default, and only its yes is a yes", async () => {
		const question: Question = { title: "Approve a new device?", message: "A new device…", yes: "Approve" };
		const boxes: { owner: unknown; text: string; caption: string; flags: number }[] = [];
		let answer = IDOK;
		const onWindows = nativeConfirm({
			platform: "win32",
			owner: () => null,
			messageBox: (owner, text, caption, flags) => {
				boxes.push({ owner, text, caption, flags });
				return answer;
			},
		});
		expect(await onWindows(question)).toBe(true);
		expect(boxes[0]).toMatchObject({ caption: question.title, text: question.message });
		// OK and Cancel, Cancel the default: Enter cancels, as Escape does.
		expect(boxes[0].flags & 0xf).toBe(MB_OKCANCEL);
		expect(boxes[0].flags & MB_DEFBUTTON2).toBe(MB_DEFBUTTON2);
		for (answer of [2, 0, -1, 7]) expect(await onWindows(question)).toBe(false);

		// Elsewhere Electrobun's box, Cancel first: macOS takes the first button as the default, GTK the default id.
		const asked: unknown[] = [];
		let response = 1;
		const elsewhere = nativeConfirm({
			platform: "darwin",
			owner: () => null,
			showMessageBox: async (options) => {
				asked.push(options);
				return { response };
			},
		});
		expect(await elsewhere(question)).toBe(true);
		expect(asked[0]).toMatchObject({
			title: question.title,
			message: question.message,
			buttons: ["Cancel", "Approve"],
			defaultId: 0,
			cancelId: 0,
		});
		for (response of [0, -1, 2]) expect(await elsewhere(question)).toBe(false);
		// A box that fails to show is a no.
		const broken = nativeConfirm({
			platform: "linux",
			owner: () => null,
			showMessageBox: () => Promise.reject(new Error("no display")),
		});
		expect(await broken(question)).toBe(false);
	});
});

/** A device of Ana's with her identity, the API having taken it, behind a boundary of its own. */
async function approverOf(confirm: (question: Question) => Promise<boolean>) {
	const page = pageOf({ start: realCore(), confirm });
	expect((await page.ask("open", { userId: ANA })).ok).toMatchObject({ state: "ready" });
	await page.run({ cmd: "create_device", user_id: ANA, device_id: APPROVER });
	expect((await page.run({ cmd: "create_identity" })).ok).toHaveProperty("recovery_key");
	await page.run({ cmd: "identity_uploaded" });
	return page;
}

/** Another device of Ana's, asking to be approved: its own core, with its QR and its commitment. */
async function newDevice(id: string) {
	const core = realCore()();
	await core.run("open", { userId: ANA });
	await core.run("handle", { command: { cmd: "create_device", user_id: ANA, device_id: id } });
	const begun: any = await core.run("handle", { command: { cmd: "approval_begin" } });
	return { core, qr: begun.ok.qr, commitment: begun.ok.commitment };
}

describe.skipIf(!withCore)("approving a device asks outside the page", () => {
	test("approval_from_qr names the device its QR shows, and runs on a yes alone", async () => {
		const { asked, confirm } = person(true, false, true);
		const approver = await approverOf(confirm);
		const before = (await approver.run({ cmd: "status" })).ok;
		const { qr } = await newDevice(NEW_A);

		// A name the page sends goes nowhere near the question.
		const no = await approver.run({ cmd: "approval_from_qr", qr, name: "Ana's phone" });
		expect(no.error).toMatchObject({ code: "refused" });
		expect(asked).toHaveLength(2);
		expect(asked[1].message).toContain(NEW_A);
		expect(JSON.stringify(asked[1])).not.toContain("phone");
		// Nothing was certified: the list is the one from before.
		expect((await approver.run({ cmd: "status" })).ok.device_list).toBe(before.device_list);

		const yes = await approver.run({ cmd: "approval_from_qr", qr });
		expect(yes.ok).toHaveProperty("transfer");
		expect((await approver.run({ cmd: "status" })).ok.device_list).not.toBe(before.device_list);
	});

	test("a QR Bun can't read is refused without asking", async () => {
		const { asked, confirm } = person(true);
		const approver = await approverOf(confirm);
		const { qr, commitment } = await newDevice(NEW_A);
		const bytes = Buffer.from(qr, "base64");
		const changed = (edit: (copy: Buffer) => Buffer) => edit(Buffer.from(bytes)).toString("base64");
		for (const odd of [
			"",
			"not base64!",
			commitment, // a commitment, not a QR
			changed((copy) => Buffer.concat([copy, Buffer.from([0])])), // something after it
			changed((copy) => copy.subarray(0, copy.length - 1)), // cut short
			changed((copy) => Buffer.from([0xa7, ...copy.subarray(1), 0x61, 0x78, 0x01])), // a seventh key
			changed((copy) => copy.fill(0x02, 3, 4)), // v: 2
		]) {
			expect((await approver.run({ cmd: "approval_from_qr", qr: odd })).error).toMatchObject({
				code: "bad_command",
				field: "qr",
			});
		}
		for (const value of [undefined, 7, ["x"]]) {
			expect((await approver.run({ cmd: "approval_from_qr", qr: value })).error).toMatchObject({
				code: "bad_command",
				field: "qr",
			});
		}
		expect(asked).toHaveLength(1);
	});

	test("approval_confirm names the device of the commitment under way, and runs on a yes alone", async () => {
		const { asked, confirm } = person(true, false, true);
		const approver = await approverOf(confirm);
		const one = await newDevice(NEW_A);
		const two = await newDevice(NEW_B);

		// No offer yet this session: Bun can't tell which device, so nothing is asked and nothing runs.
		expect((await approver.run({ cmd: "approval_confirm", code: "000000" })).error).toMatchObject({
			code: "refused",
		});
		expect(asked).toHaveLength(1);

		// Two offers: the attempt under way is the last one's, to which a script in the page could have switched it.
		await approver.run({ cmd: "approval_offer", commitment: one.commitment });
		const offered = await approver.run({ cmd: "approval_offer", commitment: two.commitment });
		const { offer } = offered.ok;
		const revealed: any = await two.core.run("handle", { command: { cmd: "approval_reveal", offer } });
		const checked = await approver.run({ cmd: "approval_check", reveal: revealed.ok.reveal });
		const { code } = checked.ok;
		const before = (await approver.run({ cmd: "status" })).ok.device_list;

		expect((await approver.run({ cmd: "approval_confirm", code })).error).toMatchObject({ code: "refused" });
		expect(asked).toHaveLength(2);
		expect(asked[1].message).toContain(NEW_B);
		expect(asked[1].message).not.toContain(NEW_A);
		expect((await approver.run({ cmd: "status" })).ok.device_list).toBe(before);

		expect((await approver.run({ cmd: "approval_confirm", code })).ok).toHaveProperty("transfer");
		expect((await approver.run({ cmd: "status" })).ok.device_list).not.toBe(before);
		// The attempt is over: a confirm now asks nothing.
		expect((await approver.run({ cmd: "approval_confirm", code })).error).toMatchObject({ code: "refused" });
		expect(asked).toHaveLength(3);
	});

	test("rotate_keys names the devices it removes, and runs on a yes alone", async () => {
		const { asked, confirm } = person(true, false, true, true);
		const approver = await approverOf(confirm);
		const before = (await approver.run({ cmd: "status" })).ok;

		expect((await approver.run({ cmd: "rotate_keys", remove: [NEW_A] })).error).toMatchObject({ code: "refused" });
		expect(asked[1].message).toContain(NEW_A);
		expect((await approver.run({ cmd: "status" })).ok.waiting_upload).toBe(before.waiting_upload);

		const rotated = (await approver.run({ cmd: "rotate_keys", remove: [] })).ok;
		expect(rotated).toHaveProperty("recovery_key");
		expect((await approver.run({ cmd: "status" })).ok.waiting_upload).toBe("rotate_keys");
		// Run again before its upload, it's the same rotation, which the question says.
		const again = (await approver.run({ cmd: "rotate_keys", remove: [] })).ok;
		expect(again.identity_key).toBe(rotated.identity_key);
		expect(asked[3].title).not.toBe(asked[2].title);

		// What Bun can't name, it doesn't ask about.
		for (const remove of [undefined, "x", [7], ["not a device"], Array.from({ length: 21 }, () => NEW_A)]) {
			expect((await approver.run({ cmd: "rotate_keys", remove })).error).toMatchObject({
				code: "bad_command",
				field: "remove",
			});
		}
		expect(asked).toHaveLength(4);
	});

	test.each(["reset_identity", "create_identity"])("%s asks first, and runs on a yes alone", async (cmd) => {
		const { asked, confirm } = person(false, true);
		const page = pageOf({ start: realCore(), confirm });
		await page.ask("open", { userId: ANA });
		await page.run({ cmd: "create_device", user_id: ANA, device_id: NEW_A });

		expect((await page.run({ cmd })).error).toMatchObject({ code: "refused" });
		expect((await page.run({ cmd: "status" })).ok.has_identity).toBe(false);
		expect((await page.run({ cmd })).ok).toHaveProperty("recovery_key");
		expect((await page.run({ cmd: "status" })).ok.has_identity).toBe(true);
		expect(asked).toHaveLength(2);
		expect(asked[0]).toEqual(asked[1]);
	});

	test("a box that fails is a no", async () => {
		const page = pageOf({ start: realCore(), confirm: () => Promise.reject(new Error("no display")) });
		await page.ask("open", { userId: ANA });
		await page.run({ cmd: "create_device", user_id: ANA, device_id: NEW_A });
		expect((await page.run({ cmd: "reset_identity" })).error).toMatchObject({ code: "refused" });
		expect((await page.run({ cmd: "status" })).ok.has_identity).toBe(false);
	});
});

/** A file's bytes in parts of `size`, in base64, an empty file being one empty part. */
const cut = (bytes: Uint8Array, size: number) =>
	Array.from({ length: Math.max(1, Math.ceil(bytes.length / size)) }, (_, n) =>
		Buffer.from(bytes.subarray(n * size, (n + 1) * size)).toString("base64"),
	);

describe("bytes cross in parts", () => {
	test.skipIf(!withCore)("a file goes through in parts, 16 a message at most, no message over 2 MiB", async () => {
		const page = pageOf({ start: realCore() });
		await page.ask("open", { userId: ANA });
		const { key } = (await page.run({ cmd: "attachment_key" })).ok;
		const file = crypto.getRandomValues(new Uint8Array(20 * ATTACHMENT_PART + 100));

		const through = async (op: "sealParts" | "openParts", parts: string[]) => {
			const out: string[] = [];
			for (let first = 0; first < parts.length; first += 16) {
				const params = { key, attachmentId: ATTACHMENT, index: first, last: first + 16 >= parts.length };
				const message = { ...params, parts: parts.slice(first, first + 16) };
				expect(JSON.stringify(message).length).toBeLessThan(MIB2);
				const reply = await page.ask(op, message);
				expect(JSON.stringify(reply).length).toBeLessThan(MIB2);
				out.push(...reply.ok.parts);
			}
			return out;
		};
		const sealed = await through("sealParts", cut(file, ATTACHMENT_PART));
		expect(sealed).toHaveLength(21);
		const opened = await through("openParts", sealed);
		expect(Buffer.concat(opened.map((part) => Buffer.from(part, "base64")))).toEqual(Buffer.from(file));
	});

	test("too many parts, or one too large, is refused before the core", async () => {
		const core = fakeCore((op) =>
			op === "open" ? { ok: { state: "ready", keyStorage: "file", handle: 1 } } : { ok: {} },
		);
		const page = pageOf({ start: core.start });
		await page.ask("open", { userId: ANA });
		const part = "A".repeat(87_384); // 64 KiB in base64
		const file = { key: "k", attachmentId: ATTACHMENT, index: 0, last: true };

		expect((await page.ask("sealParts", { ...file, parts: Array(17).fill(part) })).error).toMatchObject({
			code: "too_large",
			limit: 16,
		});
		expect((await page.ask("sealParts", { ...file, parts: [`${part}AAAA`] })).error).toMatchObject({
			code: "too_large",
			limit: ATTACHMENT_PART,
		});
		expect((await page.ask("openParts", { ...file, parts: [`${part}AAAAAAAAAAAAAAAAAAAAAAAA`] })).error).toMatchObject({
			code: "too_large",
			limit: ATTACHMENT_PART + PART_TAG,
		});
		for (const odd of [
			{ ...file, parts: [] },
			{ ...file, parts: [7] },
			{ ...file, parts: "AAAA" },
			{ ...file, index: -1, parts: [part] },
			{ ...file, index: 1.5, parts: [part] },
			{ ...file, last: "yes", parts: [part] },
			{ ...file, key: 7, parts: [part] },
			{ ...file, attachmentId: null, parts: [part] },
		]) {
			expect((await page.ask("sealParts", odd)).error).toMatchObject({ code: "bad_command" });
		}
		const share = "B".repeat(Math.ceil(SHARE_PART / 3) * 4 + 4);
		expect((await page.ask("stash", { shareId: ATTACHMENT, n: 0, part: share })).error).toMatchObject({
			code: "too_large",
			limit: SHARE_PART,
		});
		for (const odd of [
			{ shareId: ATTACHMENT, n: -1, part: "AAAA" },
			{ shareId: 7, n: 0, part: "AAAA" },
			{ shareId: ATTACHMENT, n: 0, part: 7 },
		]) {
			expect((await page.ask("stash", odd)).error).toMatchObject({ code: "bad_command" });
		}
		expect((await page.ask("share", { command: { cmd: "status" } })).error).toMatchObject({
			code: "bad_command",
			field: "cmd",
		});
		expect((await page.ask("sharePart", { shareId: ATTACHMENT, n: "0" })).error).toMatchObject({
			code: "bad_command",
			field: "n",
		});
		expect(core.calls.map(({ op }) => op)).toEqual(["open"]);
	});

	test.skipIf(!withCore)("a package's parts cross one at a time, and go into the core in their order", async () => {
		const { ana, bo, identities } = await dm();
		const nonce = crypto.randomUUID();
		const { ciphertext } = (
			await ana.run({
				...{ cmd: "encrypt", conversation_id: CONVERSATION, nonce, envelope: { text: "shared with Bo" } },
			})
		).ok;
		expect(ciphertext).toBeTruthy();
		await ana.run({ cmd: "sent", conversation_id: CONVERSATION, nonce, message_id: MESSAGE, seq: 3 });

		const shared = await ana.ask("share", {
			command: {
				...{ cmd: "history_share", conversation_id: CONVERSATION, to_user: BO, range: "all" },
				devices: [identities[BO].certificate],
			},
		});
		const made = shared.ok;
		expect(made.parts).toBeGreaterThan(0);
		const parts: string[] = [];
		for (let n = 0; n < made.parts; n++) {
			const reply = await ana.ask("sharePart", { shareId: made.share_id, n });
			expect(JSON.stringify(reply).length).toBeLessThan(MIB2);
			parts.push(reply.ok.part);
		}
		expect((await ana.ask("sharePart", { shareId: made.share_id, n: made.parts })).error).toMatchObject({
			code: "not_found",
		});
		await ana.ask("dropShare", { shareId: made.share_id });
		expect((await ana.ask("sharePart", { shareId: made.share_id, n: 0 })).error).toMatchObject({ code: "not_found" });

		await bo.run({
			cmd: "receive_direct",
			message: made.keys[0].message,
			from_certificate: identities[ANA].certificate,
		});
		// A part out of its turn is refused: they go in in order.
		expect((await bo.ask("stash", { shareId: made.share_id, n: 1, part: parts[0] })).error).toMatchObject({
			code: "bad_command",
			field: "n",
		});
		for (const [n, part] of parts.entries()) {
			expect((await bo.ask("stash", { shareId: made.share_id, n, part })).ok).toEqual({});
		}
		expect((await bo.ask("importShare", { shareId: made.share_id })).ok).toEqual({ imported: 1 });
		const read = (await bo.run({ cmd: "messages", conversation_id: CONVERSATION, ids: [MESSAGE] })).ok;
		expect(read.messages).toEqual([expect.objectContaining({ message_id: MESSAGE, text: "shared with Bo" })]);
	});
});

/** A DM between Ana and Bo, a device each behind a boundary of its own, its group made by Ana and joined by Bo. */
async function dm() {
	const yes = async () => true;
	const ana = pageOf({ start: realCore(), confirm: yes });
	const bo = pageOf({ start: realCore(), confirm: yes });
	const identities: Record<string, { identity_key: string; device_list: string; certificate: string }> = {};
	for (const [page, user, device] of [
		[ana, ANA, APPROVER],
		[bo, BO, BO_DEVICE],
	] as const) {
		await page.ask("open", { userId: user });
		await page.run({ cmd: "create_device", user_id: user, device_id: device });
		identities[user] = (await page.run({ cmd: "create_identity" })).ok;
		await page.run({ cmd: "identity_uploaded" });
	}
	for (const page of [ana, bo]) {
		for (const user of [ANA, BO]) {
			const { identity_key, device_list, certificate } = identities[user];
			await page.run({ cmd: "observe_user", user_id: user, identity_key, device_list, certificates: [certificate] });
		}
	}
	const { key_packages } = (await bo.run({ cmd: "key_packages" })).ok;
	const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
	const sender = Buffer.from(await crypto.subtle.exportKey("raw", keys.publicKey)).toString("base64");
	const made = (
		await ana.run({
			...{ cmd: "create_group", conversation_id: CONVERSATION, kind: "dm", members: [ANA, BO] },
			key_packages: { [BO]: [key_packages.find((kp: { last_resort: boolean }) => !kp.last_resort).data] },
			external_sender: sender,
			legacy: false,
		})
	).ok;
	await ana.run({ cmd: "commit_result", conversation_id: CONVERSATION, accepted: true, seq: 1 });
	const joined = await bo.run({
		...{ cmd: "apply", conversation_id: CONVERSATION, external_sender: sender },
		entries: [{ seq: 2, kind: "welcome", data: made.welcome }],
	});
	expect(joined.ok.applied_through).toBe(2);
	return { ana, bo, identities };
}

describe("a core that stops", () => {
	test("starts again, says so, and refuses what was meant for the one before", async () => {
		let stopped = false;
		const core = fakeCore((op) => {
			if (op === "open") return { ok: { state: "ready", keyStorage: "file", handle: 7 } };
			if (op === "handle" && !stopped) {
				stopped = true;
				throw new CoreStopped();
			}
			return { ok: { reached: op } };
		});
		const page = pageOf({ start: core.start });
		await page.ask("open", { userId: ANA });
		const first = page.instance;

		// The command in flight is lost: its reply says so, and a notice tells the page the core started again.
		expect(await page.run({ cmd: "status" })).toMatchObject({ error: { code: "internal" }, instance: first + 1 });
		expect(page.replies).toContainEqual({ id: 0, instance: first + 1 });
		// What the page sent for the core before is refused; the new one runs, once it's told what the old one left open.
		expect((await page.ask("handle", { command: { cmd: "status" } }, first)).error).toMatchObject({
			code: "internal",
		});
		expect((await page.ask("open", { userId: ANA })).ok).toEqual({ state: "ready", keyStorage: "file" });
		expect(core.started).toHaveLength(2);
		expect(core.calls.filter(({ op }) => op === "forget")).toEqual([{ op: "forget", params: { handle: 7 } }]);
		expect((await page.run({ cmd: "status" })).ok).toEqual({ reached: "handle" });
	});

	test.skipIf(!withCore)("a worker that's gone is started again, and its database opens", async () => {
		const start = realCore();
		let current: CoreWorker | null = null;
		const page = pageOf({
			start: () => {
				current = start();
				return current;
			},
		});
		expect((await page.ask("open", { userId: ANA })).ok).toMatchObject({ state: "ready" });
		await page.run({ cmd: "create_device", user_id: ANA, device_id: NEW_A });
		current!.stop();
		expect((await page.run({ cmd: "status" })).error).toMatchObject({ code: "internal" });
		// The stopped worker's handle is closed for it: the database isn't left locked.
		expect((await page.ask("open", { userId: ANA })).ok).toMatchObject({ state: "ready" });
		expect((await page.run({ cmd: "status" })).ok.device_id).toBe(NEW_A);
	});
});

describe("without the core's library", () => {
	test("the core is unsupported, and nothing else runs", async () => {
		const page = pageOf({ start: null });
		expect((await page.ask("open", { userId: ANA })).ok).toEqual({ state: "unsupported" });
		expect((await page.run({ cmd: "status" })).error).toMatchObject({ code: "internal" });
	});
});

// The pop-out of the voice controls and the Settings windows have RPC instances of their own (media-window-open.ts,
// settings-window-native.ts). Electrobun's API, which their modules load, needs the app, so a Bun of its own gives them a
// stand-in for it (a plugin's module): in the run of every file at once, others stand in for it with their own exports,
// and a module's exports can't change once a file has loaded it.
test("the pop-out's RPC has no e2e messages, nor do the Settings windows'", () => {
	const script = `
		const configs = [];
		class StandInWindow {
			static next = 1;
			id = StandInWindow.next++;
			ptr = null;
			webview = { on() {}, setNavigationRules() {} };
			setAlwaysOnTop() {}
			on() {}
			close() {}
			isMinimized() { return false; }
		}
		Bun.plugin({
			setup(build) {
				build.module("electrobun/bun", () => ({
					loader: "object",
					exports: {
						PATHS: { VIEWS_FOLDER: "/no/such/app/views" },
						BrowserView: { defineRPC: (config) => (configs.push(config), { send: {}, request: {} }) },
						BrowserWindow: StandInWindow,
						Screen: { getAllDisplays: () => [] },
					},
				}));
			},
		});
		const { mediaWindowOpener } = await import(${JSON.stringify(join(import.meta.dir, "../media-window-open.ts"))});
		const { createSettingsWindow } = await import(${JSON.stringify(join(import.meta.dir, "../settings-window-native.ts"))});
		const command = async () => ({ ok: true, result: null });
		mediaWindowOpener({ url: "views://mainview/voice-controls.html", renderer: "native", platform: "win32", appkit: null, rules: [], command })(
			{ x: 0, y: 0, width: 320, height: 200 },
			false,
		);
		createSettingsWindow(
			{ kind: "settings", page: "settings", title: "Settings", frame: { x: 0, y: 0, width: 800, height: 600 }, titleBarStyle: "hidden", nativeButtons: false, preload: "" },
			{ renderer: "native", pageUrl: (page) => page, rules: [], appkit: null, openExternal: () => {}, command },
		);
		console.log(JSON.stringify(configs.map(({ handlers }) => [...Object.keys(handlers.messages ?? {}), ...Object.keys(handlers.requests ?? {})])));
	`;
	const run = Bun.spawnSync([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
	expect(run.stderr.toString()).toBe("");
	const windows: string[][] = JSON.parse(run.stdout.toString().trim().split("\n").at(-1)!);
	expect(windows).toHaveLength(2);
	for (const names of windows) {
		expect(names.length).toBeGreaterThan(0);
		// No e2e, no catch-all that would take it, and nothing else of the boundary's.
		expect(names.filter((name) => name === "*" || name === "_" || name.toLowerCase().includes("e2e"))).toEqual([]);
	}
});
