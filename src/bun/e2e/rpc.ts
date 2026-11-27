// Bun's half of the desktop's boundary (PLAN-E2E-CLIENTES.md, its section on it, Rulings 5 and 6, and Task 7): what the
// page may ask of the core, and what asks the person first. A script in the page, an XSS in what a message draws, can
// ask whatever the page can, and so read and write while it lasts. But the core takes the commands of its contract
// alone, and approving a device, making an identity, changing the keys or taking a device off the account takes a yes
// in the system's own box, whose text Bun writes (confirm.ts). A new device's attempt to be approved shows its own core's
// fingerprints in a box of Bun's too, outside the page (#557). The page asks in the main window's `e2e` message alone
// (index.ts): the pop-out's and the Settings windows' RPC have no handler for it. Ops wait their turn, one at a time,
// so nothing runs between a question and the command it answers. A worker that stops is started again, with the
// database it had open.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
	ATTACHMENT_PART,
	E2E_OPS,
	MAX_SHARE_PARTS,
	OWN_WAY,
	PART_TAG,
	PARTS_PER_MESSAGE,
	SHARE_PART,
	STANDALONE_OPS,
	type E2eReply,
} from "../../mainview/src/lib/e2e/host";
import { approvalFingerprint } from "../../mainview/src/lib/e2e/conventions";
import {
	approvalQuestion,
	newDeviceNotice,
	newKeysQuestion,
	otherAccountQuestion,
	qrBytes,
	removalQuestion,
	readCommitment,
	rotationQuestion,
	verifyQuestion,
	type Confirm,
	type Notice,
	type Question,
	type Show,
} from "./confirm";
import { CoreStopped, type CoreFailure, type CoreWorker, type WorkerReply } from "./core";

/**
 * The core's commands, as its contract lists them (rpc.test.ts keeps a copy), but approval_from_qr: the desktop never
 * scans a QR (Ruling 21), so only a script would ask it. `handle` takes these alone.
 */
export const CORE_COMMANDS: ReadonlySet<string> = new Set([
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
]);

/**
 * What asks the person first: create_identity too, which the core runs as it runs reset_identity (a new identity on a
 * device without one), so asking for the one alone would leave the other as a way around it; sign_device_list, whose
 * list takes devices off the account (Task 24); and verify_user, whose mark a script could set on a forged key (Task 28).
 * Not forgotten nor drop_forgotten (#594): a kept record is user IDs the page already shows, and the person's yes, which
 * the page gives, lets one go as drop_forgotten does.
 */
export const CONFIRMED: ReadonlySet<string> = new Set([
	"approval_confirm",
	"rotate_keys",
	"reset_identity",
	"create_identity",
	"sign_device_list",
	"verify_user",
]);

/** What gives this device its identity, which ends any attempt of its to be approved. */
const SET_UP: ReadonlySet<string> = new Set(["approval_receive", "recover", "create_identity", "reset_identity"]);
const OPS: ReadonlySet<string> = new Set(E2E_OPS);
const STANDALONE: ReadonlySet<string> = new Set(STANDALONE_OPS);
/** A commitment's base64 at most: the core makes them of about 240 characters, and Bun reads none longer. */
const MAX_COMMITMENT = 512;
/** The devices a list has at most (the API's), so a rotation's question can name every one it removes. */
const LIST = 20;
/** A text field's length at most: an ID, a file's key. */
const SHORT = 256;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface BoundaryDeps {
	/** Starts the core's worker (core.ts); null when the build carries no library, and the core is unsupported. */
	start: (() => CoreWorker) | null;
	/** The person's answer, outside the page (confirm.ts). */
	confirm: Confirm;
	/** What Bun shows the person outside the page that asks nothing (confirm.ts): a new device's fingerprints. */
	show: Show;
	/** The account whose database this installation opened last (fileMark). */
	lastUser: UserMark;
	/** Sends the page a reply: the main window's `e2eReply` message. */
	reply: (reply: E2eReply) => void;
}

/** The account whose database this installation opened last: its ID, or none; a mark Bun can't read throws. */
export interface UserMark {
	read(): string | null;
	write(userId: string): void;
}

/** The account opened last, kept in a file: what isn't an account's ID in it, or no file, is none. */
export function fileMark(file: string): UserMark {
	return {
		read() {
			let kept: string;
			try {
				kept = readFileSync(file, "utf8");
			} catch (error) {
				if (isRecord(error) && error.code === "ENOENT") return null;
				throw error;
			}
			return UUID.test(kept) ? kept : null;
		},
		write(userId) {
			try {
				mkdirSync(dirname(file), { recursive: true });
				writeFileSync(file, userId);
			} catch (error) {
				console.error("[e2e] the account opened last wasn't kept:", error);
			}
		},
	};
}

/** What answers a request with an error. */
class Refusal extends Error {
	constructor(readonly failure: CoreFailure & { message: string }) {
		super(failure.message);
	}
}
const refused = (code: string, message: string, extra: Record<string, unknown> = {}) =>
	new Refusal({ code, message, ...extra });
const bad = (field: string, message: string) => refused("bad_command", message, { field });

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, field: string): string => {
	if (typeof value !== "string" || value.length > SHORT) throw bad(field, `${field} is a short text`);
	return value;
};
const count = (value: unknown, field: string): number => {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw bad(field, `${field} is a count`);
	return value;
};
const uuid = (value: unknown, field: string): string => {
	if (typeof value !== "string" || !UUID.test(value)) throw bad(field, `${field} is a UUID`);
	return value;
};
/** The longest base64 of `bytes` bytes. */
const base64Length = (bytes: number) => Math.ceil(bytes / 3) * 4;
/** A worker's reply as an op's result: its `ok`, JSON as the core's contract gives it, or its error thrown. */
const unwrap = (answer: WorkerReply): any => {
	if ("error" in answer) throw new Refusal({ message: answer.error.code, ...answer.error });
	return answer.ok;
};

/** A file's parts for sealParts or openParts: 16 at most, each of `limit` bytes at most, in base64. */
function fileParts(params: Record<string, unknown>, limit: number) {
	const key = text(params.key, "key");
	const attachmentId = text(params.attachmentId, "attachmentId");
	const index = count(params.index, "index");
	const { last, parts } = params;
	if (typeof last !== "boolean") throw bad("last", "last says whether the parts end the file");
	if (!Array.isArray(parts) || parts.length === 0 || !parts.every((part) => typeof part === "string")) {
		throw bad("parts", "parts are base64, one at least");
	}
	if (parts.length > PARTS_PER_MESSAGE) {
		throw refused("too_large", `a message carries ${PARTS_PER_MESSAGE} parts at most`, { limit: PARTS_PER_MESSAGE });
	}
	if (parts.some((part: string) => part.length > base64Length(limit))) {
		throw refused("too_large", `a part has ${limit} bytes at most`, { limit });
	}
	return { key, attachmentId, index, last, parts };
}

/** The devices a command names, which its question names: their IDs, as many as a list holds. */
function devices(value: unknown, field = "remove"): string[] {
	if (!Array.isArray(value) || value.length > LIST || !value.every((id) => typeof id === "string" && UUID.test(id))) {
		throw bad(field, `${field} is a list of devices' IDs`);
	}
	return value;
}

/**
 * Bun's half of the boundary: the handler of the main window's `e2e` message. It answers each request with `reply`, in
 * the order they came, and never throws: a throw in the app's worker would end it, and the app with it.
 */
export function e2eBoundary({ start, confirm, show, lastUser, reply }: BoundaryDeps): (message: unknown) => void {
	let worker: CoreWorker | null = null;
	/** The account the page opened last, whether its database opened or not: the only one whose data it may delete. */
	let current: string | null = null;
	/** The account whose database Bun opened last in this run, which a mark the file didn't take can't hide (RM3). */
	let openedLast: string | null = null;
	/** Whether the person said yes to another account's database in this run already. */
	let switched = false;
	/** The core's instance: one more each time its worker stops, which the page is told. */
	let instance = 1;
	/** The handle of the database the worker has open, and one a stopped worker left open in the library. */
	let opened: number | null = null;
	let leaked: number | null = null;
	/** The user whose database is open, which the worker started after a stop opens again before the next op. */
	let user: string | null = null;
	let reopen = false;
	/** What the approval under way would approve: the commitment of the last offer the core took, read by Bun. */
	let underWay: { device: string; fingerprint: string } | null = null;
	let turn: Promise<void> = Promise.resolve();

	const tell = (message: E2eReply) => {
		try {
			reply(message);
		} catch (error) {
			console.error("[e2e] couldn't answer the page:", error);
			// Once more, small: a request whose reply never comes would wait for good.
			try {
				reply({ id: message.id, instance: message.instance, error: { code: "internal" } });
			} catch (again) {
				console.error("[e2e] couldn't answer the page again:", again);
			}
		}
	};

	/** A notice, or none: one that can't be shown is no reason to fail the op. */
	const notify = (notice: Notice | null) => {
		try {
			show(notice);
		} catch (error) {
			console.error("[e2e] a notice couldn't be shown:", error);
		}
	};

	/**
	 * A new device's attempt, as its own core made it: its fingerprints in Bun's box, which a script in this page can't
	 * draw on, and which the approving device's words say to compare with (#557). What Bun can't read, it names nothing
	 * of: the box of an attempt before it goes too.
	 */
	async function showAttempt(begun: unknown) {
		const { commitment, qr } = isRecord(begun) ? begun : {};
		const made = typeof commitment === "string" ? readCommitment(commitment) : null;
		const scanned = typeof qr === "string" ? qrBytes(qr) : null;
		if (!made || !scanned) return notify(null);
		notify(newDeviceNotice({ code: await approvalFingerprint(made.bytes), scan: await approvalFingerprint(scanned) }));
	}

	/**
	 * Another account than the one this installation opened last asks the person first (#558): signing out leaves each
	 * account's database here (decision 13), and a script in one account's page would read or delete another's. What's
	 * open closes before the box, so a no leaves no database open. A mark Bun can't read asks too, and so does one that
	 * isn't the account Bun opened last in this run: its write didn't go down (RM3). A second switch has words of its own.
	 */
	async function mayOpen(userId: string) {
		let last: string | null | undefined;
		try {
			last = lastUser.read();
		} catch (error) {
			console.error("[e2e] the account opened last couldn't be read:", error);
		}
		const another =
			last === undefined || (openedLast !== null && last !== openedLast) || (last !== null && last !== userId);
		if (another) {
			if (worker) unwrap(await core("close"));
			opened = null;
			let yes = false;
			try {
				yes = await confirm(otherAccountQuestion(userId, switched));
			} catch (error) {
				console.error("[e2e] the confirmation failed:", error);
			}
			if (!yes) throw refused("refused", "the person didn't confirm it");
			switched = true;
		}
		if (last !== userId) lastUser.write(userId);
		openedLast = userId;
	}

	/**
	 * One op in the core's worker, started for it if there's none, after closing what a stopped one left open. An op
	 * that needs the core gets the database a stopped worker had open, opened again first.
	 */
	async function core(op: string, params?: unknown): Promise<WorkerReply> {
		if (!start) throw refused("internal", "there's no core for this platform");
		try {
			if (!worker) {
				worker = start();
				if (leaked !== null) {
					await worker.run("forget", { handle: leaked });
					leaked = null;
				}
			}
			if (reopen && !STANDALONE.has(op)) {
				const again = await worker.run("open", { userId: user });
				const reopened = "ok" in again && isRecord(again.ok) ? again.ok : null;
				if (reopened?.state !== "ready" || typeof reopened.handle !== "number") {
					throw refused("internal", "the core started again, and its database didn't open");
				}
				opened = reopened.handle;
				reopen = false;
			}
			return await worker.run(op, params);
		} catch (error) {
			if (!(error instanceof CoreStopped)) throw error;
			worker = null;
			leaked = opened ?? leaked;
			opened = null;
			underWay = null;
			reopen = user !== null;
			instance++;
			tell({ id: 0, instance });
			throw refused("internal", "the core started again");
		}
	}

	/**
	 * Asks the person before one of CONFIRMED runs, naming what Bun itself read: a no throws `refused`. It gives what runs
	 * on the yes: the page's command, or for verify_user Bun's own.
	 */
	async function askFirst(cmd: string, command: Record<string, unknown>): Promise<Record<string, unknown>> {
		let question: Question;
		let runs = command;
		if (cmd === "approval_confirm") {
			// Bun learns what an approval would approve from its offer: one made before the app started, or before another
			// open, or of a commitment Bun can't read, is unknown here, and is offered again (the same commitment gets the
			// same offer).
			if (underWay === null) throw refused("refused", "this device can't tell what it would approve");
			question = approvalQuestion(underWay);
		} else if (cmd === "verify_user") {
			const userId = uuid(command.user_id, "user_id");
			// The desktop compares digits and scans no code (Ruling 21): a QR would be a script's.
			if (command.qr !== undefined) throw bad("qr", "the desktop verifies by the digits the person compared");
			if (typeof command.digits !== "string") throw bad("digits", "the digits the person compared are a text");
			// Bun reads the number itself: other digits than the core holds (a script's, or a number that changed since the
			// page showed it) are refused, as nothing would match them.
			const { digits, qr } = unwrap(await core("handle", { command: { cmd: "safety_number", user_id: userId } }));
			if (command.digits !== digits) throw refused("refused", "those aren't the digits of the security number");
			// Without its QR the core would mark whatever it pins as it runs.
			if (typeof qr !== "string") throw refused("internal", "the core gave the security number no QR");
			question = verifyQuestion({ user: userId, digits });
			// The core marks by the QR of the number the box shows, compared with what it pins then: an identity pinned
			// since, by any other way into the core, gets no mark.
			runs = { cmd: "verify_user", user_id: userId, qr };
		} else if (cmd === "sign_device_list") {
			const remove = devices(command.remove);
			// A list that takes off no device would be a box that names none (M8).
			if (remove.length === 0) throw bad("remove", "a device list is signed to take off at least one device");
			question = removalQuestion(remove);
		} else {
			const remove = cmd === "rotate_keys" ? devices(command.remove) : [];
			// Run again with gone, it goes on without those devices: each is named (duvetchat/e2e#49).
			const gone = cmd === "rotate_keys" && command.gone !== undefined ? devices(command.gone, "gone") : [];
			// Run again before its upload, the command makes nothing new: it hands back what it made.
			const status = unwrap(await core("handle", { command: { cmd: "status" } }));
			question =
				cmd === "rotate_keys"
					? rotationQuestion(remove, status.waiting_upload === "rotate_keys", gone)
					: newKeysQuestion(status.waiting_upload === "create_identity");
		}
		let yes = false;
		try {
			yes = await confirm(question);
		} catch (error) {
			console.error("[e2e] the confirmation failed:", error);
		}
		if (!yes) throw refused("refused", "the person didn't confirm it");
		return runs;
	}

	async function handleCommand(command: unknown): Promise<unknown> {
		if (!isRecord(command)) throw bad("command", "a command is an object");
		const { cmd } = command;
		if (typeof cmd !== "string" || !CORE_COMMANDS.has(cmd)) throw bad("cmd", "no such command");
		if (OWN_WAY.includes(cmd)) throw bad("cmd", `${cmd} has a way of its own`);
		let offered: { device: string; fingerprint: string } | null = null;
		if (cmd === "approval_offer") {
			const { commitment } = command;
			if (typeof commitment !== "string" || commitment.length > MAX_COMMITMENT) {
				throw bad("commitment", "a commitment is an approval's, in base64");
			}
			const read = readCommitment(commitment);
			if (read) offered = { device: read.device, fingerprint: await approvalFingerprint(read.bytes) };
		}
		const runs = CONFIRMED.has(cmd) ? await askFirst(cmd, command) : command;
		const result = await core("handle", { command: runs });
		if (cmd === "approval_offer" && "ok" in result) underWay = offered;
		if (cmd === "approval_confirm" && "ok" in result) underWay = null;
		if (cmd === "approval_begin" && "ok" in result) await showAttempt(result.ok);
		// This device has its identity, by the transfer or another way: nothing of an attempt is compared any more.
		if (SET_UP.has(cmd) && "ok" in result) notify(null);
		return unwrap(result);
	}

	async function run(op: unknown, params: unknown, under: unknown): Promise<unknown> {
		if (typeof op !== "string" || !OPS.has(op)) throw bad("op", "no such op");
		if (!STANDALONE.has(op) && under !== instance) throw refused("internal", "the core started again: open it again");
		const p = isRecord(params) ? params : {};
		switch (op) {
			case "open": {
				const userId = uuid(p.userId, "userId");
				underWay = null;
				user = null;
				reopen = false;
				notify(null);
				current = null;
				if (!start) return { state: "unsupported" };
				await mayOpen(userId);
				current = userId;
				// The core's handle stays in Bun.
				const { handle, ...opening } = unwrap(await core("open", { userId }));
				opened = typeof handle === "number" ? handle : null;
				if (opening.state === "ready") user = userId;
				return opening;
			}
			case "close":
				underWay = null;
				user = null;
				reopen = false;
				notify(null);
				current = null;
				if (worker) unwrap(await core("close"));
				opened = null;
				return {};
			case "destroy": {
				const userId = uuid(p.userId, "userId");
				// The account the page opened: a script in its page can't delete another's (#558).
				if (userId !== current) throw refused("refused", "only the database of the account opened here is deleted");
				underWay = null;
				user = null;
				reopen = false;
				notify(null);
				const destroyed = await core("destroy", { userId });
				opened = null;
				return unwrap(destroyed);
			}
			case "handle":
				return handleCommand(p.command);
			case "sealParts":
				return unwrap(await core(op, fileParts(p, ATTACHMENT_PART)));
			case "openParts":
				return unwrap(await core(op, fileParts(p, ATTACHMENT_PART + PART_TAG)));
			case "share": {
				const { command } = p;
				if (!isRecord(command) || (command.cmd !== "history_share" && command.cmd !== "catch_up")) {
					throw bad("cmd", "a package is made by history_share or catch_up");
				}
				return unwrap(await core("share", { command }));
			}
			case "sharePart":
				return unwrap(await core("sharePart", { shareId: text(p.shareId, "shareId"), n: count(p.n, "n") }));
			case "dropShare":
				return unwrap(await core("dropShare", { shareId: text(p.shareId, "shareId") }));
			case "stash": {
				const shareId = text(p.shareId, "shareId");
				const n = count(p.n, "n");
				const { part } = p;
				if (typeof part !== "string") throw bad("part", "a part is base64");
				if (part.length > base64Length(SHARE_PART)) {
					throw refused("too_large", `a part has ${SHARE_PART} bytes at most`, { limit: SHARE_PART });
				}
				if (n >= MAX_SHARE_PARTS) {
					throw refused("too_large", `a package has ${MAX_SHARE_PARTS} parts at most`, { limit: MAX_SHARE_PARTS });
				}
				return unwrap(await core("stash", { shareId, n, part }));
			}
			case "importShare":
				return unwrap(await core("importShare", { shareId: text(p.shareId, "shareId") }));
			case "endApproval":
				// The page's attempt is over (its setup's sheet closed): its box goes, as close's does (RM5).
				notify(null);
				return {};
		}
		throw bad("op", "no such op");
	}

	async function answer(id: number, message: Record<string, unknown>): Promise<void> {
		let failure: CoreFailure | null = null;
		let ok: unknown;
		try {
			ok = await run(message.op, message.params, message.instance);
		} catch (error) {
			if (!(error instanceof Refusal)) console.error("[e2e] an op failed:", error);
			failure = error instanceof Refusal ? error.failure : { code: "internal", message: "Bun couldn't run it" };
		}
		tell(failure ? { id, instance, error: failure } : { id, instance, ok });
	}

	return (message) => {
		try {
			if (!isRecord(message)) return;
			const { id } = message;
			if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) return;
			turn = turn
				.then(() => answer(id, message))
				.catch((error: unknown) => console.error("[e2e] an op failed:", error));
		} catch (error) {
			console.error("[e2e] a request couldn't be read:", error);
		}
	};
}
