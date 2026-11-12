import { readLines } from "./lines";
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
/** How long a toast waits for the helper's answer: the first one waits for PowerShell to start, a second or so. */
const ANSWER_MS = 10_000;

/** What Toasts needs of the helper's process, as Bun.spawn gives it; tests hand it their own. */
export interface ToastHelper {
	stdin: { write(chunk: string): unknown; flush(): unknown };
	stdout: ReadableStream<Uint8Array>;
	stderr: ReadableStream<Uint8Array>;
	exited: Promise<number>;
	exitCode: number | null;
	kill(): void;
}

const spawnHelper = (argv: string[]): ToastHelper =>
	Bun.spawn(argv, { stdin: "pipe", stdout: "pipe", stderr: "pipe", windowsHide: true });

// A helper that runs, and its toasts still waiting for its answer, by tag.
interface Running {
	proc: ToastHelper;
	waiting: Map<string, (shown: boolean) => void>;
}

/**
 * Shows toasts through a Windows PowerShell that stays open (toast.ps1), as the Spotify reader runs one: the first toast
 * takes about a second, as PowerShell starts, and the next a few milliseconds. One that ended starts again with the
 * next toast, once a minute at most. What it writes to stderr, and its end, are logged.
 */
export class Toasts {
	#helper: Running | null = null;
	#started = 0;
	readonly #aumid: string;
	readonly #start: (argv: string[]) => ToastHelper;
	readonly #answerMs: number;

	constructor(aumid: string, start = spawnHelper, answerMs = ANSWER_MS) {
		this.#aumid = aumid;
		this.#start = start;
		this.#answerMs = answerMs;
	}

	/** Shows a toast, and answers whether it showed, as the helper says within its time: false without an answer. */
	show(t: ToastContent): Promise<boolean> {
		const helper = this.#running();
		if (!helper) return Promise.resolve(false);
		return new Promise((resolve) => {
			const done = (shown: boolean) => {
				clearTimeout(timer);
				helper.waiting.delete(t.tag);
				resolve(shown);
			};
			const timer = setTimeout(() => done(false), this.#answerMs);
			helper.waiting.set(t.tag, done);
			try {
				helper.proc.stdin.write(`${JSON.stringify({ xml: toastXml(t), tag: t.tag, group: t.group })}\n`);
				Promise.resolve(helper.proc.stdin.flush()).catch(() => done(false));
			} catch {
				done(false);
			}
		});
	}

	stop() {
		this.#helper?.proc.kill();
		this.#helper = null;
	}

	#running(): Running | null {
		if (this.#helper && this.#helper.proc.exitCode === null) return this.#helper;
		if (this.#helper && Date.now() - this.#started < RESTART_WAIT) return null;
		this.#started = Date.now();
		const command = Buffer.from(`$aumid = '${this.#aumid}'\n${toastScript}`, "utf16le").toString("base64");
		let proc: ToastHelper;
		try {
			proc = this.#start(["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", command]);
		} catch (err) {
			console.error("[Notifications] The toast helper can't start:", err);
			return null;
		}
		const helper: Running = { proc, waiting: new Map() };
		this.#helper = helper;
		void readLines(proc.stdout, (line) => heard(helper, line));
		void readLines(proc.stderr, (line) => console.error("[Notifications] The toast helper says:", line));
		void proc.exited.then((code) => {
			// The toasts it hadn't answered didn't show.
			for (const done of [...helper.waiting.values()]) done(false);
			if (this.#helper === helper) console.error(`[Notifications] The toast helper ended (exit code ${code})`);
		});
		return helper;
	}
}

// An answer of toast.ps1's: {"tag"} for a toast it showed, {"tag", "error"} for one it couldn't, which is logged.
function heard(helper: Running, line: string) {
	let answer: unknown;
	try {
		answer = JSON.parse(line);
	} catch {
		answer = null;
	}
	if (typeof answer !== "object" || answer === null || !("tag" in answer) || typeof answer.tag !== "string") {
		console.error("[Notifications] The toast helper says:", line);
		return;
	}
	const said = "error" in answer ? answer.error : null;
	const error = said == null ? null : typeof said === "string" ? said : JSON.stringify(said);
	if (error !== null) console.error("[Notifications] A toast failed:", error);
	helper.waiting.get(answer.tag)?.(error === null);
}
