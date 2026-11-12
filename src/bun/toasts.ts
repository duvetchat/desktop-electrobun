import type { Subprocess } from "bun";
import toastScript from "./toast.ps1" with { type: "text" };

/** A message's notification on Windows, as the webview asks for it (lib/system-notifications.ts). */
export interface ToastContent {
	/** The message's ID: the toast's tag. */
	tag: string;
	/** The chat's ID: the toast's group, and the header that gathers a chat's toasts. */
	group: string;
	/** Who wrote it. */
	title: string;
	/** What they wrote, as plain text. */
	text: string;
	/** Where: "#room · Space" or a group's name; none in a DM. */
	place: string | null;
	/** The author's photo, cached as a file (notification-avatars.ts); none without one. */
	avatarPath: string | null;
	/** The link a click opens (notification-links.ts). */
	launch: string;
	/** Whether it's silent, as Duvet plays its own sound; otherwise it makes Windows' message sound. */
	silent: boolean;
}

const TEXT_MAX = 500;

// The characters XML 1.0 holds: tab, the line breaks, and everything from the space on, but surrogate halves alone and
// U+FFFE and U+FFFF. LoadXml refuses the others, and with them the toast.
function xmlChars(s: string): string {
	let kept = "";
	for (const ch of s) {
		const c = ch.codePointAt(0) ?? 0;
		const allowed =
			c === 0x9 || c === 0xa || c === 0xd || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || c >= 0x10000;
		if (allowed) kept += ch;
	}
	return kept;
}

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
const xml = (s: string) => xmlChars(s).replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

function cut(text: string): string {
	const chars = [...text];
	return chars.length > TEXT_MAX ? `${chars.slice(0, TEXT_MAX).join("")}…` : text;
}

// A file's path as the file URL a toast's image takes, the same on any platform the tests run on. Windows reads a file
// URL's escapes in the ANSI code page, so a profile folder named José, escaped as UTF-8, isn't found: only what a URL
// can't hold as it is (%, #, ?, a space) is escaped, and the rest stays as it is.
const fileUrl = (path: string) =>
	`file:///${path.replaceAll("\\", "/").replace(/[%#? ]/g, (c) => encodeURIComponent(c))}`;

/**
 * A toast's XML: the author, the text (cut at 500 characters), the photo in a circle when there's one, and the place as
 * the header that gathers a chat's toasts. It's silent while Duvet plays its own sound, and makes Windows' message
 * sound otherwise. A click, on screen or in the notification center, opens its link through Duvet's protocol.
 * Everything others wrote is escaped.
 */
export function toastXml(t: ToastContent): string {
	const header = t.place
		? `<header id="${xml(t.group)}" title="${xml(t.place)}" arguments="${xml(t.launch)}" activationType="protocol"/>`
		: "";
	const image = t.avatarPath
		? `<image placement="appLogoOverride" hint-crop="circle" src="${xml(fileUrl(t.avatarPath))}"/>`
		: "";
	const audio = t.silent ? `<audio silent="true"/>` : `<audio src="ms-winsoundevent:Notification.IM"/>`;
	return (
		`<toast launch="${xml(t.launch)}" activationType="protocol">${header}` +
		`<visual><binding template="ToastGeneric"><text>${xml(t.title)}</text><text>${xml(cut(t.text))}</text>${image}` +
		`</binding></visual>${audio}</toast>`
	);
}

const RESTART_WAIT = 60_000;

/**
 * Shows toasts through a Windows PowerShell that stays open (toast.ps1), as the Spotify reader runs one: the first toast
 * takes about a second, as PowerShell starts, and the next a few milliseconds. One that ended starts again with the
 * next toast, once a minute at most.
 */
export class Toasts {
	#proc: Subprocess<"pipe", "pipe", "ignore"> | null = null;
	#started = 0;
	readonly #aumid: string;

	constructor(aumid: string) {
		this.#aumid = aumid;
	}

	show(t: ToastContent) {
		const proc = this.#running();
		if (!proc) return;
		proc.stdin.write(`${JSON.stringify({ xml: toastXml(t), tag: t.tag, group: t.group })}\n`);
		void proc.stdin.flush();
	}

	stop() {
		this.#proc?.kill();
		this.#proc = null;
	}

	#running() {
		if (this.#proc && this.#proc.exitCode === null) return this.#proc;
		if (this.#proc && Date.now() - this.#started < RESTART_WAIT) return null;
		this.#started = Date.now();
		const command = Buffer.from(`$aumid = '${this.#aumid}'\n${toastScript}`, "utf16le").toString("base64");
		const proc = Bun.spawn(["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", command], {
			stdin: "pipe",
			stdout: "pipe",
			stderr: "ignore",
			windowsHide: true,
		});
		this.#proc = proc;
		void logFailures(proc.stdout);
		return proc;
	}
}

// What toast.ps1 says of a toast that failed, logged.
async function logFailures(stdout: ReadableStream<Uint8Array>) {
	const decoder = new TextDecoder();
	let buffered = "";
	for await (const chunk of stdout) {
		buffered += decoder.decode(chunk, { stream: true });
		for (let i = buffered.indexOf("\n"); i >= 0; i = buffered.indexOf("\n")) {
			const line = buffered.slice(0, i).trim();
			buffered = buffered.slice(i + 1);
			if (line) console.error("[Notifications] A toast failed:", line);
		}
	}
}
