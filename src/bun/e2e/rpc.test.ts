import { afterAll, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ATTACHMENT_PART, OWN_WAY, PART_TAG, SHARE_PART, type E2eReply } from "../../mainview/src/lib/e2e/host";
import { CONFIRMED, CORE_COMMANDS, e2eBoundary, fileMark, type BoundaryDeps, type UserMark } from "./rpc";
import { CoreStopped, startCore, type CoreWorker, type WorkerReply } from "./core";
import {
	COMPARE_WITH_THE_BOX,
	IDOK,
	MB_DEFBUTTON2,
	MB_OKCANCEL,
	nativeConfirm,
	nativeNotice,
	newDeviceNotice,
	rotationQuestion,
	type Notice,
	type Question,
} from "./confirm";
import { approvalFingerprint } from "../../mainview/src/lib/e2e/conventions";
import en from "../../mainview/messages/en.json";
import conventions from "../../mainview/src/lib/e2e/testing/e2e-conventions.json";

// Some of its cases run real cores, which a machine busy with other work takes past Bun's 5 s (#547), as fake-api's
// tests allow for.
setDefaultTimeout(60_000);

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
	"forget_group",
	"forgotten",
	"drop_forgotten",
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

/** The account opened last, kept in memory: a page of its own starts with none. */
function memoryMark(): UserMark {
	let last: string | null = null;
	return { read: () => last, write: (userId) => void (last = userId) };
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
		show: () => {},
		lastUser: memoryMark(),
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
		// The contract's 58 but approval_from_qr: the desktop never scans a QR (Ruling 21), so only a script would ask it.
		expect([...CORE_COMMANDS].sort()).toEqual(CONTRACT.filter((cmd) => cmd !== "approval_from_qr").sort());
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
			"approval_from_qr",
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
	test("six commands: create_identity, which the core runs as reset_identity, verify_user, and no QR on the desktop", () => {
		expect([...CONFIRMED].sort()).toEqual([
			"approval_confirm",
			"create_identity",
			"reset_identity",
			"rotate_keys",
			"sign_device_list",
			"verify_user",
		]);
	});

	test("a commitment no core makes, longer or not a text, is refused before anything reads it", async () => {
		const core = fakeCore((op) =>
			op === "open" ? { ok: { state: "ready", keyStorage: "file", handle: 1 } } : { ok: { offer: "AAAA" } },
		);
		const page = pageOf({ start: core.start });
		await page.ask("open", { userId: ANA });
		for (const commitment of ["A".repeat(516), 7, undefined, ["A"]]) {
			expect((await page.run({ cmd: "approval_offer", commitment })).error).toMatchObject({
				code: "bad_command",
				field: "commitment",
			});
		}
		expect(core.calls.filter(({ op }) => op === "handle")).toEqual([]);
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

	// PLAN-E2E-PLATAFORMAS.md, Task 6: off Windows the box is Electrobun's: macOS's NSAlert, whose first button is its
	// Return, and GTK's dialog, its default response the first and Esc or its window's close answering cancelId. A command
	// the box was asked for runs on its second button alone.
	test("off Windows the box is Electrobun's, Cancel first, and a no runs nothing", async () => {
		const boxes: unknown[] = [];
		let response = 0;
		const core = fakeCore((op) => (op === "open" ? { ok: { state: "ready", handle: 1 } } : { ok: {} }));
		const page = pageOf({
			start: core.start,
			confirm: nativeConfirm({
				platform: "linux",
				owner: () => null,
				showMessageBox: async (options) => {
					boxes.push(options);
					return { response };
				},
			}),
		});
		await page.ask("open", { userId: ANA });
		const remove = [BO];
		// Cancel (Enter), Esc or a closed window (cancelId), or anything else Electrobun answers.
		for (response of [0, -1, 2]) {
			expect((await page.run({ cmd: "sign_device_list", remove })).error).toMatchObject({ code: "refused" });
		}
		expect(boxes).toHaveLength(3);
		expect(boxes[0]).toMatchObject({ buttons: ["Cancel", "Remove"], defaultId: 0, cancelId: 0 });
		expect(core.calls.filter(({ op }) => op === "handle")).toEqual([]);
		response = 1;
		expect((await page.run({ cmd: "sign_device_list", remove })).ok).toEqual({});
		expect(core.calls.filter(({ op }) => op === "handle")).toMatchObject([
			{ params: { command: { cmd: "sign_device_list", remove } } },
		]);
	});

	// #557's re-review, RM6: the box's lines are the conventions' fingerprints, which the Android app reads too: the
	// commitment's (approval_fingerprints) and the QR's (approval_qr_fingerprint), each of its bytes as the page's
	// approvalFingerprint gives it.
	test("the box's lines are the conventions' fingerprints of the core's commitment and QR", async () => {
		const [made] = conventions.approval_fingerprints;
		const scanned = conventions.approval_qr_fingerprint;
		const notices: (Notice | null)[] = [];
		const core = fakeCore((op) =>
			op === "open" ? { ok: { state: "ready", handle: 1 } } : { ok: { commitment: made.commitment, qr: scanned.qr } },
		);
		const page = pageOf({ start: core.start, show: (notice) => notices.push(notice) });
		await page.ask("open", { userId: ANA });
		await page.run({ cmd: "approval_begin" });
		const message = notices.at(-1)?.message ?? "";
		expect(message).toContain(`With a code:\n${made.fingerprint}`);
		expect(message).toContain(`Scanning its QR code with your phone:\n${scanned.fingerprint}`);
		expect(await approvalFingerprint(Buffer.from(scanned.qr, "base64"))).toBe(scanned.fingerprint);
	});

	// #557's re-review, RC1: every approving device says the same of the new device's fingerprint, the web's page too.
	test("the approver's box says what the approving page says of the new device's fingerprint", () => {
		expect(COMPARE_WITH_THE_BOX).toBe(en.e2e_approval_fingerprint_line);
	});

	test("a notice replaces the one shown, and none takes it away; without the core's platform nothing shows", () => {
		const boxes: { title: string; closed: boolean }[] = [];
		const show = nativeNotice({
			platform: "win32",
			open: ({ title }) => {
				const box = { title, closed: false };
				boxes.push(box);
				return { close: () => (box.closed = true) };
			},
		});
		show({ title: "one", message: "1" });
		show({ title: "two", message: "2" });
		expect(boxes).toEqual([
			{ title: "one", closed: true },
			{ title: "two", closed: false },
		]);
		show(null);
		expect(boxes.at(-1)?.closed).toBe(true);
		expect(() => nativeNotice({ platform: "linux" })({ title: "three", message: "3" })).not.toThrow();
	});

	// #557's re-review, RM5: the QR's renewal brings a box up every 9 minutes while the setup's sheet shows it; only the
	// first of a run of them is raised over what the person is doing.
	test("a box that replaces one already shown doesn't take the foreground", () => {
		const raised: [string, boolean][] = [];
		const show = nativeNotice({
			platform: "win32",
			open: ({ title }, foreground) => {
				raised.push([title, foreground]);
				return { close: () => {} };
			},
		});
		show({ title: "one", message: "1" });
		show({ title: "two", message: "2" });
		show(null);
		show({ title: "three", message: "3" });
		expect(raised).toEqual([
			["one", true],
			["two", false],
			["three", true],
		]);
	});

	// #557's re-review, RM4: the box is the new device's whole defense, and one that can't show would stop every new
	// computer's approval with nothing in the log. Here user32 doesn't load, as a box that fails on Windows doesn't.
	test.skipIf(process.platform === "win32")("a notice's box that can't show says why in the log", async () => {
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			nativeNotice({ platform: "win32" })({ title: "Set up this device (0000 1111 2222 3333)", message: "…" });
			const said = () =>
				logged.mock.calls.some(([line]) => String(line).includes("the notice's box couldn't be shown"));
			for (let tries = 0; tries < 100 && !said(); tries++) await Bun.sleep(20);
			expect(said()).toBe(true);
		} finally {
			logged.mockRestore();
		}
	});

	// The real box, on Windows alone: it shows while Bun goes on (its loop below runs meanwhile), and closing takes it
	// away. It shows over the screen for a moment.
	test.skipIf(process.platform !== "win32")(
		"on Windows a notice is the system's box, which holds nothing",
		async () => {
			const { dlopen, FFIType } = await import("bun:ffi");
			const { FindWindowW } = dlopen("user32.dll", {
				FindWindowW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
			}).symbols;
			const wide = (text: string) => new Uint16Array([...Array.from(text, (char) => char.charCodeAt(0)), 0]);
			const notice = newDeviceNotice({ code: "0000 1111 2222 3333", scan: "4444 5555 6666 7777" });
			const up = () => Boolean(FindWindowW(wide("#32770"), wide(notice.title)));
			const show = nativeNotice({ platform: "win32" });
			show(notice);
			for (let tries = 0; !up() && tries < 50; tries++) await Bun.sleep(100);
			expect(up()).toBe(true);
			show(null);
			for (let tries = 0; up() && tries < 50; tries++) await Bun.sleep(100);
			expect(up()).toBe(false);
		},
	);

	// Round 3: the yes runs Bun's own verify_user, by the QR of the number its box showed, never the page's command; and
	// what the page sends while the box is open waits for it, as every request waits for the one before.
	test("after the yes, the core gets Bun's verify_user, by the QR of the number it showed, and nothing runs meanwhile", async () => {
		const digits = "11111 22222 33333 44444 55555 66666 77777 88888 99999 00000 12345 67890";
		const qr = "oWF2AQ==";
		const core = fakeCore((op, params) => {
			if (op === "open") return { ok: { state: "ready", keyStorage: "file", handle: 1 } };
			const { cmd } = params.command;
			return { ok: cmd === "safety_number" ? { digits, qr } : cmd === "verify_user" ? { verified: true } : {} };
		});
		let shown = () => {};
		const open = new Promise<void>((resolve) => (shown = resolve));
		let answer = (_yes: boolean) => {};
		const page = pageOf({
			start: core.start,
			confirm: () =>
				new Promise<boolean>((resolve) => {
					answer = resolve;
					shown();
				}),
		});
		await page.ask("open", { userId: ANA });
		const handed = () => core.calls.filter(({ op }) => op === "handle").map(({ params }) => params.command);
		const verifying = page.run({ cmd: "verify_user", user_id: BO, digits, note: "the page's" });
		await open;
		const status = page.run({ cmd: "status" });
		await Bun.sleep(20);
		expect(handed()).toEqual([{ cmd: "safety_number", user_id: BO }]);
		answer(true);
		expect((await verifying).ok).toEqual({ verified: true });
		await status;
		expect(handed()).toEqual([
			{ cmd: "safety_number", user_id: BO },
			{ cmd: "verify_user", user_id: BO, qr },
			{ cmd: "status" },
		]);
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

/** Another device of Ana's, asking to be approved: its own core, with its commitment. */
async function newDevice(id: string) {
	const core = realCore()();
	await core.run("open", { userId: ANA });
	await core.run("handle", { command: { cmd: "create_device", user_id: ANA, device_id: id } });
	const begun: any = await core.run("handle", { command: { cmd: "approval_begin" } });
	const commitment: string = begun.ok.commitment;
	return { core, commitment };
}

/** The approver offers `commitment`, the device that holds its keys reveals, and the approver checks: the code. */
async function reveal(approver: ReturnType<typeof pageOf>, device: { core: CoreWorker }, commitment: string) {
	const offered = await approver.run({ cmd: "approval_offer", commitment });
	expect(offered.ok).toHaveProperty("offer");
	const revealed: any = await device.core.run("handle", {
		command: { cmd: "approval_reveal", offer: offered.ok.offer },
	});
	const checked = await approver.run({ cmd: "approval_check", reveal: revealed.ok.reveal });
	const code: string = checked.ok.code;
	return { code };
}

/** The fingerprint the new device's screen shows of a commitment (conventions.ts). */
const fingerprintOf = (commitment: string) => approvalFingerprint(Buffer.from(commitment, "base64"));

/** A commitment with another device's ID in it, as a script would write one: its keys and hash as they were. */
function withDevice(commitment: string, device: string): string {
	const bytes = Buffer.from(commitment, "base64");
	const at = bytes.indexOf(Buffer.from([0x66, ...Buffer.from("device"), 0x50])) + 8;
	Buffer.from(device.replaceAll("-", ""), "hex").copy(bytes, at);
	return bytes.toString("base64");
}

describe.skipIf(!withCore)("approving a device asks outside the page", () => {
	test("approval_confirm names the fingerprint of the commitment under way, and runs on a yes alone", async () => {
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
		const { code } = await reveal(approver, two, two.commitment);
		const before = (await approver.run({ cmd: "status" })).ok.device_list;

		expect((await approver.run({ cmd: "approval_confirm", code })).error).toMatchObject({ code: "refused" });
		expect(asked).toHaveLength(2);
		// What the person compares with the new device's screen: the fingerprint of what the core certifies.
		expect(asked[1].message).toContain(await fingerprintOf(two.commitment));
		expect(asked[1].message).not.toContain(await fingerprintOf(one.commitment));
		expect(asked[1].message).toContain("it shows the same 16 characters");
		expect((await approver.run({ cmd: "status" })).ok.device_list).toBe(before);

		expect((await approver.run({ cmd: "approval_confirm", code })).ok).toHaveProperty("transfer");
		expect((await approver.run({ cmd: "status" })).ok.device_list).not.toBe(before);
		// The attempt is over: a confirm now asks nothing.
		expect((await approver.run({ cmd: "approval_confirm", code })).error).toMatchObject({ code: "refused" });
		expect(asked).toHaveLength(3);
	});

	test("a commitment with the new device's ID and a script's keys names a fingerprint the device doesn't show", async () => {
		const { asked, confirm } = person(true, false);
		const approver = await approverOf(confirm);
		const device = await newDevice(NEW_A);
		// A script in the approver's page: an attempt of its own (another core's keys and hash), under the ID of the
		// device the person is setting up, which the API's list shows.
		const script = await newDevice(NEW_B);
		const forged = withDevice(script.commitment, NEW_A);
		const { code } = await reveal(approver, script, forged);

		expect((await approver.run({ cmd: "approval_confirm", code })).error).toMatchObject({ code: "refused" });
		expect(asked[1].message).toContain(NEW_A);
		expect(asked[1].message).toContain(await fingerprintOf(forged));
		expect(asked[1].message).not.toContain(await fingerprintOf(device.commitment));
	});

	// #557: a script in the new device's page sends an attempt of its own, and draws its fingerprint where the page shows
	// the core's. Bun shows the fingerprints of its own core's attempt in a box of its own, which the approver's box
	// tells the person to compare with.
	test("the new device's own box names its core's fingerprints, never those of an attempt its page sends", async () => {
		const notices: (Notice | null)[] = [];
		const device = pageOf({ start: realCore(), show: (notice) => notices.push(notice) });
		await device.ask("open", { userId: ANA });
		await device.run({ cmd: "create_device", user_id: ANA, device_id: NEW_A });
		const begun = (await device.run({ cmd: "approval_begin" })).ok;
		// The script's attempt: another core's keys and hash, under this device's ID.
		const script = await newDevice(NEW_B);
		const forged = withDevice(script.commitment, NEW_A);
		const { asked, confirm } = person(true, false);
		const approver = await approverOf(confirm);
		const { code } = await reveal(approver, script, forged);
		expect((await approver.run({ cmd: "approval_confirm", code })).error).toMatchObject({ code: "refused" });

		const own = notices.at(-1)?.message ?? "";
		expect(own).toContain(await fingerprintOf(begun.commitment));
		// The QR's bytes aren't the commitment's: a phone that scans it names the QR's own fingerprint.
		expect(own).toContain(await fingerprintOf(begun.qr));
		expect(own).not.toContain(await fingerprintOf(forged));
		const approving = asked[1]?.message ?? "";
		expect(approving).toContain(await fingerprintOf(forged));
		expect(approving).not.toContain(await fingerprintOf(begun.commitment));
		expect(approving).toContain("in a box of its own, outside its window");
	});

	test("the new device's box goes with its attempt: the next one replaces it, and its transfer taken closes it", async () => {
		const notices: (Notice | null)[] = [];
		const device = pageOf({ start: realCore(), show: (notice) => notices.push(notice) });
		await device.ask("open", { userId: ANA });
		await device.run({ cmd: "create_device", user_id: ANA, device_id: NEW_A });
		const first = (await device.run({ cmd: "approval_begin" })).ok;
		expect(notices.at(-1)?.message).toContain(await fingerprintOf(first.commitment));
		const second = (await device.run({ cmd: "approval_begin" })).ok;
		expect(notices.at(-1)?.message).toContain(await fingerprintOf(second.commitment));
		expect(notices.at(-1)?.message).not.toContain(await fingerprintOf(first.commitment));

		// The honest way through, by the code: the box stays while the approver confirms, and goes with the transfer.
		const approver = await approverOf(person(true, true).confirm);
		const { offer } = (await approver.run({ cmd: "approval_offer", commitment: second.commitment })).ok;
		const { reveal: revealed } = (await device.run({ cmd: "approval_reveal", offer })).ok;
		const { code } = (await approver.run({ cmd: "approval_check", reveal: revealed })).ok;
		expect((await device.run({ cmd: "approval_accept", code })).ok).toEqual({});
		const { transfer } = (await approver.run({ cmd: "approval_confirm", code })).ok;
		expect(notices.at(-1)).not.toBeNull();
		expect((await device.run({ cmd: "approval_receive", transfer })).ok).toHaveProperty("identity_key");
		expect(notices.at(-1)).toBeNull();
	});

	// #557's re-review, RM5: the setup's sheet closed, the page's attempt is over, and its box mustn't say to keep it open.
	test("the page's end of an attempt takes the new device's box away", async () => {
		const notices: (Notice | null)[] = [];
		const device = pageOf({ start: realCore(), show: (notice) => notices.push(notice) });
		await device.ask("open", { userId: ANA });
		await device.run({ cmd: "create_device", user_id: ANA, device_id: NEW_A });
		await device.run({ cmd: "approval_begin" });
		expect(notices.at(-1)).not.toBeNull();
		expect((await device.ask("endApproval")).ok).toEqual({});
		expect(notices.at(-1)).toBeNull();
	});

	test("an offer the core takes and Bun can't read leaves nothing to approve", async () => {
		const { asked, confirm } = person(true);
		const approver = await approverOf(confirm);
		const one = await newDevice(NEW_A);
		const two = await newDevice(NEW_B);
		await approver.run({ cmd: "approval_offer", commitment: one.commitment });
		// The key "device" with a length byte of its own: CBOR the core reads, and Bun's strict reader doesn't.
		const bytes = Buffer.from(two.commitment, "base64");
		const at = bytes.indexOf(Buffer.from([0x66, ...Buffer.from("device")]));
		const loose = Buffer.concat([bytes.subarray(0, at), Buffer.from([0x78, 0x06]), bytes.subarray(at + 1)]);
		const { code } = await reveal(approver, two, loose.toString("base64"));

		expect((await approver.run({ cmd: "approval_confirm", code })).error).toMatchObject({ code: "refused" });
		expect(asked).toHaveLength(1);
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

	// duvetchat/e2e#49: run again, rotate_keys goes on without the devices gone names, as the server no longer has them,
	// so a server that stops serving a device's certificate would have this device drop one that's still there.
	test("rotate_keys names the devices gone leaves out, and runs on a yes alone", async () => {
		// The identity's yes, the change's, then the no and the yes to going on without a device.
		const { asked, confirm } = person(true, true, false, true);
		const approver = await approverOf(confirm);
		expect((await approver.run({ cmd: "rotate_keys", remove: [] })).ok).toHaveProperty("recovery_key");
		const before = (await approver.run({ cmd: "status" })).ok;
		const without = { cmd: "rotate_keys", remove: [], gone: [NEW_A], served_list: "AAAA" };

		expect((await approver.run(without)).error).toMatchObject({ code: "refused" });
		expect(asked[2]).toEqual(rotationQuestion([], true, [NEW_A]));
		expect(asked[2].message).toContain(NEW_A);
		expect(asked[2].title).not.toBe(rotationQuestion([], true).title);
		expect((await approver.run({ cmd: "status" })).ok).toEqual(before);
		// On the yes, the core judges it: that device isn't one the change keeps.
		expect((await approver.run(without)).error).toMatchObject({ code: "bad_command", field: "gone" });

		// What Bun can't name, it doesn't ask about.
		for (const gone of ["x", [7], ["not a device"], Array.from({ length: 21 }, () => NEW_A)]) {
			expect((await approver.run({ ...without, gone })).error).toMatchObject({ code: "bad_command", field: "gone" });
		}
		expect(asked).toHaveLength(4);
	});

	// Task 24: a script in the page can't take the user's devices off their account.
	test("sign_device_list names the devices it removes, and runs on a yes alone", async () => {
		const { asked, confirm } = person(true, true, false, true);
		const approver = await approverOf(confirm);
		// A device of Ana's on her list, approved by its code: the list to take it off.
		const device = await newDevice(NEW_A);
		const { code } = await reveal(approver, device, device.commitment);
		expect((await approver.run({ cmd: "approval_confirm", code })).ok).toHaveProperty("transfer");
		const before = (await approver.run({ cmd: "status" })).ok.device_list;

		expect((await approver.run({ cmd: "sign_device_list", remove: [NEW_A] })).error).toMatchObject({
			code: "refused",
		});
		expect(asked[2].message).toContain(NEW_A);
		expect((await approver.run({ cmd: "status" })).ok.device_list).toBe(before);
		expect((await approver.run({ cmd: "sign_device_list", remove: [NEW_A] })).ok).toHaveProperty("device_list");
		expect((await approver.run({ cmd: "status" })).ok.device_list).not.toBe(before);

		// What Bun can't name, it doesn't ask about, nor a list that takes nothing off (M8).
		for (const remove of [[], undefined, "x", [7], ["not a device"], Array.from({ length: 21 }, () => NEW_A)]) {
			expect((await approver.run({ cmd: "sign_device_list", remove })).error).toMatchObject({
				code: "bad_command",
				field: "remove",
			});
		}
		expect(asked).toHaveLength(4);
	});

	// Task 28's review (Ruling 6's sixth): a script in the page can't mark a contact verified unseen. Bun reads the
	// security number itself, names it in its box, and runs verify_user on a yes alone, for the digits the page showed.
	test("verify_user names the security number Bun reads itself, and runs on a yes alone, for those digits", async () => {
		const { asked, confirm } = person(true, false, true);
		const ana = pageOf({ start: realCore(), confirm });
		const bo = pageOf({ start: realCore(), confirm: async () => true });
		const made: Record<string, { identity_key: string; device_list: string; certificate: string }> = {};
		for (const [page, user, device] of [
			[ana, ANA, APPROVER],
			[bo, BO, BO_DEVICE],
		] as const) {
			await page.ask("open", { userId: user });
			await page.run({ cmd: "create_device", user_id: user, device_id: device });
			made[user] = (await page.run({ cmd: "create_identity" })).ok;
			await page.run({ cmd: "identity_uploaded" });
		}
		const { identity_key, device_list, certificate } = made[BO];
		const seen = async () =>
			(await ana.run({ cmd: "observe_user", user_id: BO, identity_key, device_list, certificates: [certificate] })).ok;
		expect(await seen()).toMatchObject({ state: "new", verified: false });
		const { digits } = (await ana.run({ cmd: "safety_number", user_id: BO })).ok;
		const other = digits.replace(/\d/, (digit: string) => String((Number(digit) + 1) % 10));

		// A script's: no digits, other digits than the core holds, or a QR, which the desktop never scans.
		expect((await ana.run({ cmd: "verify_user", user_id: BO })).error).toMatchObject({
			code: "bad_command",
			field: "digits",
		});
		expect((await ana.run({ cmd: "verify_user", user_id: BO, digits: other })).error).toMatchObject({
			code: "refused",
		});
		expect((await ana.run({ cmd: "verify_user", user_id: BO, digits, qr: "AAAA" })).error).toMatchObject({
			code: "bad_command",
			field: "qr",
		});
		expect(asked).toHaveLength(1);

		// The person's no marks nothing; the box names Bun's own digits, and the contact's ID.
		expect((await ana.run({ cmd: "verify_user", user_id: BO, digits })).error).toMatchObject({ code: "refused" });
		expect(asked[1]?.message.replace(/\s+/g, " ")).toContain(digits);
		expect(asked[1]?.message).toContain(BO);
		expect((await seen()).verified).toBe(false);
		expect((await ana.run({ cmd: "verify_user", user_id: BO, digits })).ok).toEqual({ verified: true });
		expect((await seen()).verified).toBe(true);
		expect(asked).toHaveLength(3);
	});

	// Round 3: the core marks the identities Bun's box showed, compared in its own transaction, so another one pinned while
	// the box is open (by any other way into the core: the page's requests wait for the box) gets no mark.
	test("a re-pin that lands while verify_user's box is open ends unverified, with no mark", async () => {
		const startAna = realCore();
		let anaCore: CoreWorker | null = null;
		let whileOpen: (() => Promise<void>) | null = null;
		const ana = pageOf({
			start: () => (anaCore = startAna()),
			confirm: async () => {
				await whileOpen?.();
				return true;
			},
		});
		const bo = pageOf({ start: realCore(), confirm: async () => true });
		// Another identity of Bo's, which a script, or a server with it, would have the core pin.
		const forged = pageOf({ start: realCore(), confirm: async () => true });
		type Made = { identity_key: string; device_list: string; certificate: string };
		const made: Record<string, Made> = {};
		for (const [page, user, device, name] of [
			[ana, ANA, APPROVER, "ana"],
			[bo, BO, BO_DEVICE, "bo"],
			[forged, BO, "0193a4b2-0000-7000-8000-0000000000b3", "forged"],
		] as const) {
			await page.ask("open", { userId: user });
			await page.run({ cmd: "create_device", user_id: user, device_id: device });
			made[name] = (await page.run({ cmd: "create_identity" })).ok;
			await page.run({ cmd: "identity_uploaded" });
		}
		const observe = ({ identity_key, device_list, certificate }: Made) => ({
			...{ cmd: "observe_user", user_id: BO, identity_key, device_list, certificates: [certificate] },
		});
		expect((await ana.run(observe(made.bo))).ok).toMatchObject({ state: "new", verified: false });
		const { digits } = (await ana.run({ cmd: "safety_number", user_id: BO })).ok;
		let repinned: WorkerReply | null = null;
		whileOpen = async () => {
			repinned = (await anaCore?.run("handle", { command: observe(made.forged) })) ?? null;
		};
		expect((await ana.run({ cmd: "verify_user", user_id: BO, digits })).ok).toEqual({ verified: false });
		expect(repinned).toMatchObject({ ok: { state: "changed", verified: false } });
		expect((await ana.run(observe(made.forged))).ok).toMatchObject({ state: "same", verified: false });
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
	test("starts again, says so, refuses what was meant for the one before, and opens its database again", async () => {
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
		// What the page sent for the core before is refused, and never reaches a new one.
		expect((await page.ask("handle", { command: { cmd: "status" } }, first)).error).toMatchObject({
			code: "internal",
		});
		expect(core.started).toHaveLength(1);
		// The next op: the new worker closes what the old one left open, opens the same database, then runs it.
		expect((await page.run({ cmd: "status" })).ok).toEqual({ reached: "handle" });
		expect(core.started).toHaveLength(2);
		expect(core.calls.slice(-3)).toEqual([
			{ op: "forget", params: { handle: 7 } },
			{ op: "open", params: { userId: ANA } },
			{ op: "handle", params: { command: { cmd: "status" } } },
		]);
	});

	test("a database that doesn't open again is internal, and is tried again with the next op", async () => {
		let stop = true;
		const opened = [
			{ state: "ready", keyStorage: "file", handle: 7 },
			{ state: "locked" },
			{ state: "ready", keyStorage: "file", handle: 8 },
		];
		const core = fakeCore((op) => {
			if (op === "open") return { ok: opened.shift() };
			if (op === "handle" && stop) {
				stop = false;
				throw new CoreStopped();
			}
			return { ok: { reached: op } };
		});
		const page = pageOf({ start: core.start });
		await page.ask("open", { userId: ANA });
		expect((await page.run({ cmd: "status" })).error).toMatchObject({ code: "internal" });
		expect((await page.run({ cmd: "status" })).error).toMatchObject({ code: "internal" });
		expect((await page.run({ cmd: "status" })).ok).toEqual({ reached: "handle" });
		expect(core.calls.filter(({ op }) => op === "open")).toHaveLength(3);
	});

	test("a closed core isn't opened again, whether the worker stops as it closes or after", async () => {
		/** A page whose core's worker stops at its first `op`, and how many times it opened a database. */
		const stopping = (op: string) => {
			let stop = true;
			const core = fakeCore((ran) => {
				if (ran === "open") return { ok: { state: "ready", keyStorage: "file", handle: 7 } };
				if (ran === op && stop) {
					stop = false;
					throw new CoreStopped();
				}
				return { ok: { reached: ran } };
			});
			const opens = () => core.calls.filter((call) => call.op === "open").length;
			return { page: pageOf({ start: core.start }), opens };
		};

		const asItCloses = stopping("close");
		await asItCloses.page.ask("open", { userId: ANA });
		expect((await asItCloses.page.ask("close")).error).toMatchObject({ code: "internal" });
		await asItCloses.page.run({ cmd: "status" });
		expect(asItCloses.opens()).toBe(1);

		const after = stopping("handle");
		await after.page.ask("open", { userId: ANA });
		expect((await after.page.ask("close")).ok).toEqual({});
		expect((await after.page.run({ cmd: "status" })).error).toMatchObject({ code: "internal" });
		await after.page.run({ cmd: "status" });
		expect(after.opens()).toBe(1);
	});

	test.skipIf(!withCore)("a worker that's gone is started again, and its database opens for the next op", async () => {
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
		// The stopped worker's handle is closed for it, so the database opens again, unlocked, with its device.
		expect((await page.run({ cmd: "status" })).ok.device_id).toBe(NEW_A);
	});

	test.skipIf(!withCore)("an op with no core open is internal, never the core's not_found", async () => {
		const page = pageOf({ start: realCore() });
		await page.ask("close");
		expect((await page.run({ cmd: "status" })).error).toEqual({ code: "internal", message: "no core is open" });
		await page.ask("open", { userId: ANA });
		await page.ask("close");
		expect((await page.run({ cmd: "status" })).error).toEqual({ code: "internal", message: "no core is open" });
	});
});

describe("a reply Bun can't send", () => {
	test("goes again as a small internal error", async () => {
		let first = true;
		const sent = new Promise<E2eReply>((resolve) => {
			const send = e2eBoundary({
				start: null,
				confirm: async () => false,
				show: () => {},
				lastUser: memoryMark(),
				reply: (reply) => {
					if (first) {
						first = false;
						throw new Error("the socket refused it");
					}
					resolve(reply);
				},
			});
			send({ id: 9, op: "open", params: { userId: ANA }, instance: 0 });
		});
		expect(await sent).toEqual({ id: 9, instance: 1, error: { code: "internal" } });
	});
});

// #558: each account that used this installation keeps its database here (decision 13), and a script in one account's
// page could name another's.
describe("whose database Bun opens", () => {
	const ready = () => fakeCore((op) => (op === "open" ? { ok: { state: "ready", handle: 1 } } : { ok: {} }));
	const opens = (core: ReturnType<typeof ready>) =>
		core.calls.filter(({ op }) => op === "open").map(({ params }) => params);

	test("another account than the one opened last asks first, and only that one's database is destroyed", async () => {
		const core = ready();
		const { asked, confirm } = person(false, true);
		const page = pageOf({ start: core.start, confirm });
		expect((await page.ask("open", { userId: ANA })).ok).toEqual({ state: "ready" });
		expect(asked).toEqual([]);

		// Bo's database, as a script in Ana's page asks it: the person's no opens nothing. Ana's closed before the box, so
		// a page left signed in as Bo after Ana signed out, its close lost, can't read hers either.
		expect((await page.ask("open", { userId: BO })).error).toMatchObject({ code: "refused" });
		expect(asked).toHaveLength(1);
		expect(asked[0]?.message).toContain(BO);
		expect(opens(core)).toEqual([{ userId: ANA }]);
		expect(core.calls.map(({ op }) => op)).toEqual(["open", "close"]);
		expect((await page.ask("destroy", { userId: BO })).error).toMatchObject({ code: "refused" });
		expect((await page.ask("destroy", { userId: ANA })).error).toMatchObject({ code: "refused" });
		expect(core.calls.some(({ op }) => op === "destroy")).toBe(false);

		// The person's yes: Bo's opens, and is the one opened last, which opens again without asking.
		expect((await page.ask("open", { userId: BO })).ok).toEqual({ state: "ready" });
		expect((await page.ask("open", { userId: BO })).ok).toEqual({ state: "ready" });
		expect(asked).toHaveLength(2);
		expect((await page.ask("destroy", { userId: ANA })).error).toMatchObject({ code: "refused" });
		expect((await page.ask("destroy", { userId: BO })).ok).toEqual({});
		expect(core.calls.filter(({ op }) => op === "destroy")).toEqual([{ op: "destroy", params: { userId: BO } }]);
	});

	test("the account opened last is the installation's, from one start of the app to the next", async () => {
		const folder = mkdtempSync(join(tmpdir(), "duvet-boundary-"));
		folders.push(folder);
		const mark = join(folder, "e2e", "last-user");
		const first = pageOf({ start: ready().start, lastUser: fileMark(mark) });
		await first.ask("open", { userId: ANA });

		const { asked, confirm } = person(false);
		const lost = fakeCore((op) => (op === "open" ? { ok: { state: "failed", reason: "bad_key" } } : { ok: {} }));
		const next = pageOf({ start: lost.start, confirm, lastUser: fileMark(mark) });
		expect((await next.ask("open", { userId: BO })).error).toMatchObject({ code: "refused" });
		expect((await next.ask("destroy", { userId: BO })).error).toMatchObject({ code: "refused" });
		expect(asked).toHaveLength(1);
		expect((await next.ask("open", { userId: ANA })).ok).toEqual({ state: "failed", reason: "bad_key" });
		expect(asked).toHaveLength(1);
		// Its key lost, Ana's database didn't open, and it's still hers: its data can go (Ruling 26's way out).
		expect((await next.ask("destroy", { userId: ANA })).ok).toEqual({});
		// A mark Bun can't read is no account: the next open asks nothing of the first account to open here.
		writeFileSync(mark, "not an account");
		expect(fileMark(mark).read()).toBeNull();
		expect(fileMark(join(folder, "nothing")).read()).toBeNull();
	});

	// #558's re-review, RM3 (a): a script that asks for another account right after the person's yes to one shouldn't
	// get a box the person takes for the one they just answered.
	test("a second switch to another account in one run asks in other words than the first", async () => {
		const { asked, confirm } = person(true, true);
		const page = pageOf({ start: ready().start, confirm });
		await page.ask("open", { userId: ANA });
		expect((await page.ask("open", { userId: BO })).ok).toEqual({ state: "ready" });
		expect((await page.ask("open", { userId: ANA })).ok).toEqual({ state: "ready" });
		expect(asked).toHaveLength(2);
		expect(asked[1]?.title).not.toBe(asked[0]?.title);
		expect(asked[1]?.message).toContain("already switched");
		expect(asked[1]?.message).toContain(ANA);
	});

	// RM3 (b): a mark the file didn't take would let the next switch back go unasked.
	test("a mark the file didn't take asks, as Bun opened another account since", async () => {
		const { asked, confirm } = person(true, false);
		// A file that keeps saying Ana, whatever Bun writes.
		const stuck: UserMark = { read: () => ANA, write: () => {} };
		const page = pageOf({ start: ready().start, confirm, lastUser: stuck });
		await page.ask("open", { userId: ANA });
		expect((await page.ask("open", { userId: BO })).ok).toEqual({ state: "ready" });
		expect((await page.ask("open", { userId: ANA })).error).toMatchObject({ code: "refused" });
		expect(asked).toHaveLength(2);
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
