// Reads what Spotify plays on this computer, for the "Listening to Spotify" activity. It doesn't talk to Spotify's
// servers or need an account:
// - Windows: the System Media Transport Controls (what the volume flyout shows), through spotify-smtc.ps1, a
//   Windows PowerShell that runs while Spotify does (about 90 MB, #313), which Bun looks for every 10 s;
// - macOS: Spotify's AppleScript, asked every few seconds (macOS asks once whether Duvet may control Spotify);
// - Linux: playerctl, over Spotify's MPRIS, when it's installed.
// Windows gives no track ID or cover URL, so the activity carries neither on any system: clients show Spotify's
// logo and link a search for the song.
import { dlopen, FFIType } from "bun:ffi";
import { clip } from "./activities";
import { readLines } from "./lines";
import smtcScript from "./spotify-smtc.ps1" with { type: "text" };

export interface SpotifyTrack {
	title: string;
	artist: string;
	album: string;
	/** When the song started playing and when it ends, in Unix milliseconds. */
	start: number;
	end: number;
}

export interface SpotifyActivity {
	type: 2;
	name: "Spotify";
	details: string;
	state: string;
	timestamps: { start: number; end: number };
	assets?: { large_text: string };
}

// A start this close to the last one is the same playback read again; further off, the user sought.
const SEEK_TOLERANCE_MS = 3000;
const POLL_MS = 5000;
// Windows dates the position when Spotify last reported it, and gives year 1 when it has no date.
const YEAR_2000_MS = 946_684_800_000;

/** The activity for a track Spotify plays, or null when it plays none (stopped, paused, an ad without artist). */
export function spotifyActivity(track: SpotifyTrack | null): SpotifyActivity | null {
	if (!track || !track.title || !track.artist || !(track.end > track.start)) return null;
	const activity: SpotifyActivity = {
		type: 2,
		name: "Spotify",
		details: clip(track.title),
		state: clip(track.artist),
		timestamps: { start: Math.round(track.start), end: Math.round(track.end) },
	};
	if (track.album) activity.assets = { large_text: clip(track.album) };
	return activity;
}

/** Whether two activities show the same: the same song, started within a few seconds of each other. */
export function sameSpotifyActivity(a: SpotifyActivity | null, b: SpotifyActivity | null): boolean {
	if (!a || !b) return a === b;
	return (
		a.details === b.details &&
		a.state === b.state &&
		a.assets?.large_text === b.assets?.large_text &&
		Math.abs(a.timestamps.start - b.timestamps.start) < SEEK_TOLERANCE_MS &&
		Math.abs(a.timestamps.end - b.timestamps.end) < SEEK_TOLERANCE_MS
	);
}

/** A line spotify-smtc.ps1 printed. The song started at the date Windows gave the position, minus the position. */
export function trackFromSmtc(line: string, now: number): SpotifyTrack | null {
	let data: {
		playing?: unknown;
		title?: unknown;
		artist?: unknown;
		album?: unknown;
		position?: unknown;
		duration?: unknown;
		updated?: unknown;
	} | null;
	try {
		data = JSON.parse(line.charCodeAt(0) === 0xfeff ? line.slice(1) : line);
	} catch {
		return null;
	}
	if (data?.playing !== true) return null;
	const position = Number(data.position) || 0;
	const duration = Number(data.duration) || 0;
	const updated = Number(data.updated) > YEAR_2000_MS ? Number(data.updated) : now;
	const start = updated - position;
	return {
		title: stringOrEmpty(data.title),
		artist: stringOrEmpty(data.artist),
		album: stringOrEmpty(data.album),
		start,
		end: start + duration,
	};
}

function stringOrEmpty(value: unknown): string {
	return typeof value === "string" ? value : "";
}

// Asks only while Spotify runs: a "tell" would start it otherwise.
const APPLESCRIPT = [
	'if application "Spotify" is running then',
	'	tell application "Spotify"',
	"		if player state is playing then",
	"			set t to current track",
	"			return (name of t) & tab & (artist of t) & tab & (album of t) & tab & ((player position * 1000) as integer) & tab & (duration of t)",
	"		end if",
	"	end tell",
	"end if",
	'return ""',
].join("\n");

/** What APPLESCRIPT printed: the title, artist and album, then the position and the length in milliseconds. */
export function trackFromAppleScript(out: string, now: number): SpotifyTrack | null {
	const parts = out.replace(/\r?\n$/, "").split("\t");
	if (parts.length !== 5) return null;
	const [title, artist, album, position, duration] = parts;
	const start = now - (Number(position) || 0);
	return { title, artist, album, start, end: start + (Number(duration) || 0) };
}

const PLAYERCTL_FORMAT = [
	"{{status}}",
	"{{title}}",
	"{{artist}}",
	"{{album}}",
	"{{position}}",
	"{{mpris:length}}",
].join("\t");

/** What playerctl printed: the status, title, artist and album, then the position and the length in microseconds.
 * Spotify's MPRIS can report position 0 all along: a song that was already playing then keeps the start it had. */
export function trackFromPlayerctl(out: string, now: number, last: SpotifyTrack | null): SpotifyTrack | null {
	const parts = out.replace(/\r?\n$/, "").split("\t");
	if (parts.length !== 6 || parts[0] !== "Playing") return null;
	const [, title, artist, album, position, length] = parts;
	const positionMs = (Number(position) || 0) / 1000;
	const keep =
		positionMs === 0 && last !== null && last.title === title && last.artist === artist && last.album === album;
	const start = keep && last ? last.start : now - positionMs;
	return { title, artist, album, start, end: start + (Number(length) || 0) / 1000 };
}

/** Reads Spotify until the returned function stops it, calling onChange with each change of what it plays. */
export function startSpotifyReader(onChange: (activity: SpotifyActivity | null) => void): () => void {
	let current: SpotifyActivity | null = null;
	let stopped = false;
	const report = (track: SpotifyTrack | null) => {
		const next = spotifyActivity(track);
		if (stopped || sameSpotifyActivity(current, next)) return;
		current = next;
		onChange(next);
	};
	const stop =
		process.platform === "win32"
			? readWhileRunning(spotifyRuns, () => readWindows(report), () => report(null), SPOTIFY_CHECK_MS)
			: process.platform === "darwin"
				? poll(readAppleScript, report)
				: poll(readPlayerctl(), report);
	return () => {
		stopped = true;
		stop();
	};
}

/** How often the Windows reader looks whether Spotify runs. */
const SPOTIFY_CHECK_MS = 10_000;

/**
 * Runs a reader while a program runs, as isRunning says every everyMs: started as the program starts, and stopped as
 * it quits, when quit tells that nothing plays. The returned function stops it all.
 */
export function readWhileRunning(
	isRunning: () => boolean,
	start: () => () => void,
	quit: () => void,
	everyMs: number,
): () => void {
	let stop: (() => void) | null = null;
	const look = () => {
		const running = isRunning();
		if (running && !stop) {
			stop = start();
		} else if (!running && stop) {
			stop();
			stop = null;
			quit();
		}
	};
	look();
	const timer = setInterval(look, everyMs);
	return () => {
		clearInterval(timer);
		stop?.();
		stop = null;
	};
}

// Spotify's desktop app, or the Microsoft Store's, whose executable has the same name. A look that fails counts as
// Spotify running, so the reader runs as it did before it looked (logged once).
let spotifyLookFailed = false;
function spotifyRuns(): boolean {
	try {
		return processRunning("Spotify.exe");
	} catch (err) {
		if (!spotifyLookFailed) console.error("[Spotify] Can't list the running programs:", err);
		spotifyLookFailed = true;
		return true;
	}
}

// Windows' process list (Toolhelp32), from kernel32, opened at the first look.
let toolhelp: ReturnType<typeof openToolhelp> | null = null;
function openToolhelp() {
	return dlopen("kernel32.dll", {
		CreateToolhelp32Snapshot: { args: [FFIType.u32, FFIType.u32], returns: FFIType.i64 },
		Process32FirstW: { args: [FFIType.i64, FFIType.ptr], returns: FFIType.i32 },
		Process32NextW: { args: [FFIType.i64, FFIType.ptr], returns: FFIType.i32 },
		CloseHandle: { args: [FFIType.i64], returns: FFIType.i32 },
	}).symbols;
}
const TH32CS_SNAPPROCESS = 0x2;
const INVALID_HANDLE_VALUE = -1n;
// PROCESSENTRY32W on 64-bit Windows: dwSize at 0, the executable's name (MAX_PATH UTF-16 code units, ending with a
// NUL) at 44, 568 bytes in all.
const ENTRY_SIZE = 568;
const EXE_NAME_AT = 44;
const EXE_NAME_BYTES = 520;

/** Whether a program whose executable is named exe (in any case) runs, from Windows' process list, without starting
 * anything. Windows only. */
export function processRunning(exe: string): boolean {
	toolhelp ??= openToolhelp();
	const snapshot = toolhelp.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
	if (snapshot === INVALID_HANDLE_VALUE) throw new Error("CreateToolhelp32Snapshot failed");
	try {
		const entry = new Uint8Array(ENTRY_SIZE);
		new DataView(entry.buffer).setUint32(0, ENTRY_SIZE, true);
		const names = new TextDecoder("utf-16le");
		const wanted = exe.toLowerCase();
		for (let more = toolhelp.Process32FirstW(snapshot, entry); more; more = toolhelp.Process32NextW(snapshot, entry)) {
			const name = names.decode(entry.subarray(EXE_NAME_AT, EXE_NAME_AT + EXE_NAME_BYTES));
			const end = name.indexOf("\0");
			if ((end === -1 ? name : name.slice(0, end)).toLowerCase() === wanted) return true;
		}
		return false;
	} finally {
		toolhelp.CloseHandle(snapshot);
	}
}

// The script goes on PowerShell's command line, in the form it takes there (UTF-16LE in base64), so no file holds it
// for anyone to change before it runs.
const SMTC_COMMAND = Buffer.from(smtcScript, "utf16le").toString("base64");

function spawnSmtcReader() {
	return Bun.spawn(["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", SMTC_COMMAND], {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		windowsHide: true,
	});
}

/** How long the Windows reader waits to start again after it ended, the wait before that being [lastDelayMs]. One
 * that [worked] (it read a song, or that nothing plays, and ran 10 s at least) died afterwards (PowerShell killed, say)
 * and starts again soon. Any other couldn't run: Windows' media controls refused it or didn't answer (RequestAsync
 * failed with RPC_E_CALL_CANCELED, or never answered, on 2026-10-25), or something kills it at once, so it tries
 * again less and less often, up to every 5 minutes, and reads again once it can. */
export function readerRestartDelay(worked: boolean, lastDelayMs: number): number {
	if (worked) return 5_000;
	return Math.min(Math.max(lastDelayMs * 2, 30_000), 300_000);
}

function readWindows(report: (track: SpotifyTrack | null) => void): () => void {
	let proc: ReturnType<typeof spawnSmtcReader> | null = null;
	let stopped = false;
	let restart: ReturnType<typeof setTimeout> | undefined;
	let delay = 0;
	const again = (worked: boolean, why: string) => {
		delay = readerRestartDelay(worked, delay);
		if (!worked) console.error(`[Spotify] The Windows reader can't run (${why}); trying again in ${delay / 1000} s`);
		restart = setTimeout(run, delay);
	};
	const run = () => {
		const startedAt = Date.now();
		let read = false;
		let child: ReturnType<typeof spawnSmtcReader>;
		try {
			child = spawnSmtcReader();
		} catch (err) {
			again(false, `${err}`);
			return;
		}
		proc = child;
		void readLines(child.stdout, (line) => {
			read = true;
			report(trackFromSmtc(line, Date.now()));
		});
		void readLines(child.stderr, (line) => console.warn("[Spotify]", line));
		void child.exited.then((code) => {
			if (stopped) return;
			// It worked if it read and ran a while: one that dies right after a line is failing too.
			again(read && Date.now() - startedAt >= 10_000, `exit code ${code}`);
			report(null);
		});
	};
	run();
	return () => {
		stopped = true;
		clearTimeout(restart);
		proc?.kill();
	};
}

function poll(read: () => Promise<SpotifyTrack | null>, report: (track: SpotifyTrack | null) => void): () => void {
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const tick = async () => {
		let track: SpotifyTrack | null;
		try {
			track = await read();
		} catch (err) {
			// playerctl or osascript missing: nothing to read until the setting is turned on again.
			console.error("[Spotify] Can't read Spotify:", err);
			report(null);
			return;
		}
		report(track);
		if (!stopped) timer = setTimeout(tick, POLL_MS);
	};
	void tick();
	return () => {
		stopped = true;
		clearTimeout(timer);
	};
}

async function readAppleScript(): Promise<SpotifyTrack | null> {
	// AppleScript looks Spotify up as it compiles a script that names it, which on a Mac without Spotify can ask
	// where it is: osascript runs only while Spotify's process does.
	if (!(await output(["pgrep", "-x", "Spotify"]))) return null;
	return trackFromAppleScript(await output(["osascript", "-e", APPLESCRIPT]), Date.now());
}

function readPlayerctl(): () => Promise<SpotifyTrack | null> {
	let last: SpotifyTrack | null = null;
	return async () => {
		const out = await output(["playerctl", "--player=spotify", "metadata", "--format", PLAYERCTL_FORMAT]);
		last = trackFromPlayerctl(out, Date.now(), last);
		return last;
	};
}

/** What a command prints, or nothing when it fails (playerctl with no Spotify running, osascript not allowed). */
async function output(cmd: string[]): Promise<string> {
	const proc = Bun.spawn(cmd, { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
	const out = await new Response(proc.stdout).text();
	return (await proc.exited) === 0 ? out : "";
}
