// What the person is asked, outside the page, before the core runs a command the boundary confirms (PLAN-E2E-CLIENTES.md,
// the desktop's boundary, Rulings 6 and 35): the system's own box, whose text Bun writes, Cancel its default, and a device
// named by the fingerprint of the commitment Bun was given, never by a name or an ID the page sends.
//
// On Windows Bun shows the box itself, through user32: Electrobun 1.15.1's showMessageBox calls MessageBoxW with OK and
// Cancel (only for those labels, or Yes and No) and never MB_DEFBUTTON2, so OK would be the default, whatever its
// defaultId says. Elsewhere it's Electrobun's, Cancel first: macOS's NSAlert takes its first button as the default,
// GTK the defaultId. On macOS only the title and the message show, so the message says everything.
import { dlopen, FFIType, type Pointer } from "bun:ffi";

/** A question for the person: its title, what it means, and the label of the button that says yes (no commas). */
export interface Question {
	title: string;
	message: string;
	yes: string;
}

/** Asks the person, outside the page: true for a yes alone. */
export type Confirm = (question: Question) => Promise<boolean>;

export const MB_OKCANCEL = 0x1;
export const MB_ICONWARNING = 0x30;
export const MB_DEFBUTTON2 = 0x100;
export const MB_SETFOREGROUND = 0x10000;
export const IDOK = 1;

/** user32's MessageBoxW, its strings as the text they are. */
type MessageBox = (owner: Pointer | null, text: string, caption: string, flags: number) => number;
/** Electrobun's Utils.showMessageBox. */
type ShowMessageBox = (options: {
	type?: "info" | "warning" | "error" | "question";
	title?: string;
	message?: string;
	buttons?: string[];
	defaultId?: number;
	cancelId?: number;
}) => Promise<{ response: number }>;

const WM_CLOSE = 0x10;

const openUser32 = () =>
	dlopen("user32.dll", {
		MessageBoxW: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
		FindWindowW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
		PostMessageW: { args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64], returns: FFIType.i32 },
	}).symbols;
let user32: ReturnType<typeof openUser32> | null = null;
/** A NUL-terminated UTF-16 string, as the W calls read one. */
const wide = (text: string) => {
	const units = new Uint16Array(text.length + 1);
	for (let at = 0; at < text.length; at++) units[at] = text.charCodeAt(at);
	return units;
};
const messageBoxW: MessageBox = (owner, text, caption, flags) => {
	const symbols = (user32 ??= openUser32());
	return symbols.MessageBoxW(owner, wide(text), wide(caption), flags);
};

/**
 * The system's box, over the main window (`owner`, its HWND on Windows). Bun waits on it as Electrobun's own does: the
 * core's worker and the window go on, and Bun's other messages wait for the answer. A box that can't be shown is a no.
 */
export function nativeConfirm(deps: {
	platform: string;
	owner: () => Pointer | null;
	messageBox?: MessageBox;
	showMessageBox?: ShowMessageBox;
}): Confirm {
	return async (question) => {
		try {
			if (deps.platform === "win32") {
				const flags = MB_OKCANCEL | MB_ICONWARNING | MB_DEFBUTTON2 | MB_SETFOREGROUND;
				return (deps.messageBox ?? messageBoxW)(deps.owner(), question.message, question.title, flags) === IDOK;
			}
			if (!deps.showMessageBox) return false;
			const { response } = await deps.showMessageBox({
				type: "warning",
				title: question.title,
				message: question.message,
				buttons: ["Cancel", question.yes],
				defaultId: 0,
				cancelId: 0,
			});
			return response === 1;
		} catch (error) {
			console.error("[e2e] the confirmation couldn't be shown:", error);
			return false;
		}
	};
}

/** A notice's box while it shows. */
export interface NoticeBox {
	close(): void;
	/**
	 * Shows another notice in its place, where it is, without taking the foreground: a window's (notice-window.ts).
	 * Windows' box has none, and a new box takes the place of the one closed.
	 */
	replace?(notice: Notice): void;
}

/**
 * The system's box for what asks nothing, one at a time: a notice replaces the box shown. It mustn't hold the window or
 * Bun's thread, as a confirmation's does: the person keeps it open while Duvet goes on. On Windows it's user32's box;
 * on Linux and macOS, a window of Bun's, which index.ts hands in as `open` (notice-window.ts; PLAN-E2E-PLATAFORMAS.md,
 * Task 6). Without one nothing shows, and an approving device's words say to compare with a box.
 */
export function nativeNotice(deps: {
	platform: string;
	open?: (notice: Notice, foreground: boolean) => NoticeBox;
}): Show {
	const open = deps.open ?? (deps.platform === "win32" ? windowsNotice : null);
	let shown: NoticeBox | null = null;
	return (notice) => {
		// Only the first box of a run takes the foreground: the QR's renewal replaces it every 9 minutes (RM5).
		const replacing = shown !== null;
		// A box that shows the new notice where it is keeps it there, behind what the person is doing.
		if (notice && shown?.replace) {
			try {
				shown.replace(notice);
				return;
			} catch (error) {
				console.error("[e2e] a notice couldn't be replaced:", error);
			}
		}
		try {
			shown?.close();
		} catch (error) {
			console.error("[e2e] a notice couldn't be closed:", error);
		}
		shown = null;
		if (!notice || !open) return;
		try {
			shown = open(notice, !replacing);
		} catch (error) {
			console.error("[e2e] a notice couldn't be shown:", error);
		}
	};
}

/** How long a notice's box being closed is looked for, as its worker may not have shown it yet: 50 times, 0.1 s apart. */
const CLOSE_TRIES = 50;

/**
 * A notice on Windows: MessageBoxW in a worker of its own, with no owner, so the window and Bun's thread go on while it
 * shows. Closing it finds it by its title, which names its fingerprint, and sends it WM_CLOSE.
 */
function windowsNotice(notice: Notice, foreground: boolean): NoticeBox {
	const url = URL.createObjectURL(
		new Blob([`(${noticeWorker.toString()})(${JSON.stringify({ ...notice, foreground })});`], {
			type: "application/javascript",
		}),
	);
	const worker = new Worker(url);
	let up = true;
	const ended = () => {
		up = false;
		worker.terminate();
		URL.revokeObjectURL(url);
	};
	// A box that can't show leaves the new device with nothing to compare (RM4): the log says why, as a confirmation's does.
	worker.addEventListener("message", (event: MessageEvent<unknown>) => {
		const { data } = event;
		if (typeof data === "object" && data !== null && "failed" in data) {
			console.error("[e2e] the notice's box couldn't be shown:", data.failed);
		}
		ended();
	});
	worker.addEventListener("error", (event: ErrorEvent) => {
		console.error("[e2e] the notice's worker stopped:", event.message);
		ended();
	});
	return {
		close() {
			const symbols = (user32 ??= openUser32());
			let tries = 0;
			const look = () => {
				if (!up) return;
				const box = symbols.FindWindowW(wide("#32770"), wide(notice.title));
				if (box) symbols.PostMessageW(box, WM_CLOSE, 0, 0);
				else if (++tries < CLOSE_TRIES) setTimeout(look, 100);
			};
			look();
		},
	};
}

/**
 * A notice's worker, run from its own source (windowsNotice), as core.ts runs the core's: every name it uses is in it,
 * or a global. It shows the box, then says it closed, or what failed: the library, or the box (MessageBoxW answers 0).
 */
export function noticeWorker({ title, message, foreground }: Notice & { foreground: boolean }): void {
	void (async () => {
		let failed: string | null = null;
		try {
			const ffi = await import("bun:ffi");
			const { ptr, i32, u32 } = ffi.FFIType;
			const utf16 = (text: string) => {
				const units = new Uint16Array(text.length + 1);
				for (let at = 0; at < text.length; at++) units[at] = text.charCodeAt(at);
				return units;
			};
			const { MessageBoxW } = ffi.dlopen("user32.dll", {
				MessageBoxW: { args: [ptr, ptr, ptr, u32], returns: i32 },
			}).symbols;
			// MB_OK | MB_ICONINFORMATION | MB_TOPMOST: above the window, which stays usable; MB_SETFOREGROUND for a first box.
			if (MessageBoxW(null, utf16(message), utf16(title), 0x40 | 0x40000 | (foreground ? 0x10000 : 0)) === 0) {
				throw new Error("MessageBoxW failed");
			}
		} catch (error) {
			failed = error instanceof Error ? error.message : String(error);
		} finally {
			postMessage(failed === null ? "closed" : { failed });
		}
	})();
}

/**
 * Approving a device: what the core will certify, by the fingerprint of the commitment it takes (approvalFingerprint).
 * A new device of the Duvet app shows its own in a box of Bun's (newDeviceNotice), where nothing in its page can change
 * it (#557). The ID is the commitment's writer's to choose: it's shown, not compared.
 */
export function approvalQuestion({ device, fingerprint }: { device: string; fingerprint: string }): Question {
	return {
		title: "Approve a new device?",
		message:
			"A new device will be added to your account, and it will read your encrypted conversations." +
			`\n\nFingerprint: ${fingerprint}` +
			`\n\n${COMPARE_WITH_THE_BOX}` +
			`\n\nIts ID: ${device}`,
		yes: "Approve",
	};
}

/**
 * What every approving device says of the new device's fingerprint: this box, the page's (e2e_approval_fingerprint_line,
 * the web's only gate) and the Android app's (mobile#363). A computer's is in a box of the Duvet app's own, not in its
 * window, which a script there could draw on; a browser has no box, and its page is its only screen (decision 58).
 */
export const COMPARE_WITH_THE_BOX =
	"Approve it only if it's the device you're setting up now, and it shows the same 16 characters. The Duvet app on a " +
	"computer shows them in a box of its own, outside its window: don't approve it if they're only in its window. Duvet " +
	"in a browser shows them on its page.";

/** What Bun shows the person, outside the page, that asks nothing. */
export interface Notice {
	title: string;
	message: string;
}

/** Shows a notice in place of the one shown, or takes it away (null), without waiting for the person. */
export type Show = (notice: Notice | null) => void;

/**
 * A new device's attempt to be approved (approval_begin), as its own core made it: the fingerprints an approving device
 * shows of it (Ruling 35), in a box the page can't draw on (#557). A phone that scans the QR shows the QR's own, as its
 * bytes aren't the commitment's; an approval by the code shows the commitment's.
 */
export function newDeviceNotice({ code, scan }: { code: string; scan: string }): Notice {
	return {
		title: `Set up this device (${code})`,
		message:
			"Approve this device on another of yours only if that one shows the same 16 characters as here." +
			`\n\nWith a code:\n${code}` +
			`\n\nScanning its QR code with your phone:\n${scan}` +
			"\n\nCompare them with this box, not with Duvet's window, and keep it open until this device is set up.",
	};
}

/**
 * Marking a contact verified (verify_user): the security number Bun read from the core itself, which the person compared
 * with the contact's, and the contact by their ID, which is what the core marks.
 */
export function verifyQuestion({ user, digits }: { user: string; digits: string }): Question {
	const groups = digits.split(" ");
	const lines = [0, 4, 8].map((at) => groups.slice(at, at + 4).join(" ")).join("\n");
	return {
		title: "Mark this contact as verified?",
		message:
			"Duvet will mark this contact as verified on this device." +
			`\n\nSecurity number:\n${lines}` +
			"\n\nMark them only if you compared this number with the one on their device, and they're the same." +
			`\n\nTheir ID: ${user}`,
		yes: "Mark verified",
	};
}

/**
 * Opening the database of another account than the one this installation opened last (#558): each account that used
 * Duvet here keeps its own, which signing out leaves. By its ID, which is all Bun knows of it. `again`, a second switch
 * since the app started, in words of its own: a script that asks right after the person's yes to the first would
 * otherwise get a box they take for the one they just answered.
 */
export function otherAccountQuestion(user: string, again = false): Question {
	if (again) {
		return {
			title: "Switch accounts again?",
			message:
				"Duvet already switched to another account's encrypted conversations since it started, and now it's asked to " +
				"switch again.\n\nOpen this account's only if you've just signed out and signed in to it here." +
				`\n\nIts ID: ${user}`,
			yes: "Open",
		};
	}
	return {
		title: "Open another account's encrypted conversations?",
		message:
			"Duvet will open the encrypted conversations this computer keeps for another account than the one it opened last." +
			"\n\nOpen them only if you've just signed in to that account here." +
			`\n\nIts ID: ${user}`,
		yes: "Open",
	};
}

/** Taking devices off the account (sign_device_list): each one by its ID, which is all Bun can tell of it. */
export function removalQuestion(remove: string[]): Question {
	const one = remove.length === 1;
	return {
		title: one ? "Remove a device from your account?" : "Remove devices from your account?",
		message:
			`${one ? "This device" : "These devices"} will be removed from your account, and won't read your encrypted ` +
			`conversations from now on:\n${remove.join("\n")}\n\nRemove ${one ? "it" : "them"} only if you asked for it.`,
		yes: "Remove",
	};
}

/**
 * Changing the keys (rotate_keys), with the devices it takes off the list; `finishing`, a rotation already made; `gone`,
 * the devices a rotation that waits goes on without, as the server no longer has them (duvetchat/e2e#49), each by its
 * ID: a server that stopped serving a device's certificate would have this device drop one that's still there.
 */
export function rotationQuestion(remove: string[], finishing: boolean, gone: string[] = []): Question {
	const devices = remove.length > 0 ? `\n\nThese devices will be removed from your account:\n${remove.join("\n")}` : "";
	if (gone.length > 0) {
		return {
			title: "Finish changing your security keys without these devices?",
			message:
				"Duvet will finish the change of security keys it started, and show your new recovery key again, without " +
				`these devices, which aren't on your account any more:\n${gone.join("\n")}${devices}\n\nFinish without ` +
				"them only if you removed them from your account, here or on another of your devices.",
			yes: "Finish",
		};
	}
	return finishing
		? {
				title: "Finish changing your security keys?",
				message: `Duvet will finish the change of security keys it started, and show your new recovery key again.${devices}`,
				yes: "Finish",
			}
		: {
				title: "Change your security keys?",
				message:
					"Duvet will make new security keys and a new recovery key for your account, and your contacts will see " +
					`that your keys changed.${devices}\n\nChange them only if you asked for it.`,
				yes: "Change keys",
			};
}

/** A new identity (create_identity, or reset_identity, which the core runs alike); `finishing`, one already made. */
export function newKeysQuestion(finishing: boolean): Question {
	return finishing
		? {
				title: "Finish making your security keys?",
				message: "Duvet will finish making the security keys it started, and show your recovery key again.",
				yes: "Finish",
			}
		: {
				title: "Make new security keys?",
				message:
					"Duvet will make new security keys and a recovery key for your account." +
					"\n\nIf your account has security keys already, this starts over: what you have from before can't be " +
					"read here, and your other devices need setting up again.\n\nContinue only if you asked for it.",
				yes: "Make keys",
			};
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** A QR's bytes, from the text approval_begin gives (standard base64): what a phone that scans it fingerprints. */
export function qrBytes(base64: string): Uint8Array | null {
	return BASE64.test(base64) ? new Uint8Array(Buffer.from(base64, "base64")) : null;
}
/** The CBOR heads of what a commitment holds, as the core writes them: a 16-byte ID, a 32-byte key. */
const BYTES_16 = [0x50];
const BYTES_32 = [0x58, 0x20];

/**
 * The device a commitment asks to have approved, and the commitment's bytes: the core's own CBOR map of v, user,
 * device, signature_key, hpke_key and hash. Read strictly, so it can't be read otherwise than the core reads it:
 * standard base64, a map of those six keys once each, v 1, byte strings of their lengths, nothing after.
 */
export function readCommitment(base64: string): { user: string; device: string; bytes: Uint8Array } | null {
	if (!BASE64.test(base64)) return null;
	const bytes = Buffer.from(base64, "base64");
	// A Map, not an object: a key the page writes, "__proto__" say, finds nothing in it.
	const heads = new Map([
		["user", BYTES_16],
		["device", BYTES_16],
		["signature_key", BYTES_32],
		["hpke_key", BYTES_32],
		["hash", BYTES_32],
	]);
	const read = new Map<string, Buffer>();
	let at = 0;
	if (bytes[at++] !== 0xa6) return null;
	for (let field = 0; field < 6; field++) {
		const head = bytes[at++];
		// A key: a text of up to 23 bytes, its length in its head.
		if (head === undefined || head < 0x60 || head > 0x77) return null;
		const name = bytes.subarray(at, at + head - 0x60).toString("latin1");
		at += head - 0x60;
		if (read.has(name) || at > bytes.length) return null;
		if (name === "v") {
			if (bytes[at++] !== 0x01) return null;
			read.set(name, Buffer.alloc(0));
			continue;
		}
		const expected = heads.get(name);
		if (!expected || !expected.every((byte, n) => bytes[at + n] === byte)) return null;
		at += expected.length;
		const size = expected.length === 1 ? 16 : 32;
		if (at + size > bytes.length) return null;
		read.set(name, bytes.subarray(at, at + size));
		at += size;
	}
	if (at !== bytes.length || read.size !== 6) return null;
	const uuid = (id: Buffer) => id.toString("hex").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
	return { user: uuid(read.get("user")!), device: uuid(read.get("device")!), bytes: new Uint8Array(bytes) };
}
