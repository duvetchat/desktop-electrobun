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

const openUser32 = () =>
	dlopen("user32.dll", {
		MessageBoxW: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
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

/**
 * Approving a device: what the core will certify, by the fingerprint of the commitment it takes (approvalFingerprint),
 * which the new device's screen shows of its own. The ID is the commitment's writer's to choose: it's shown, not compared.
 */
export function approvalQuestion({ device, fingerprint }: { device: string; fingerprint: string }): Question {
	return {
		title: "Approve a new device?",
		message:
			"A new device will be added to your account, and it will read your encrypted conversations." +
			`\n\nFingerprint: ${fingerprint}` +
			"\n\nApprove it only if it's the device you're setting up now, and its screen shows the same 16 characters." +
			`\n\nIts ID: ${device}`,
		yes: "Approve",
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

/** Changing the keys (rotate_keys), with the devices it takes off the list; `finishing`, a rotation already made. */
export function rotationQuestion(remove: string[], finishing: boolean): Question {
	const devices = remove.length > 0 ? `\n\nThese devices will be removed from your account:\n${remove.join("\n")}` : "";
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
