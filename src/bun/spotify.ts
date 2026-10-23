// Reads what Spotify plays on this computer, for the "Listening to Spotify" activity. It doesn't talk to Spotify's
// servers or need an account:
// - Windows: the System Media Transport Controls (what the volume flyout shows), through spotify-smtc.ps1, a
//   Windows PowerShell that runs while the reader does;
// - macOS: Spotify's AppleScript, asked every few seconds (macOS asks once whether Duvet may control Spotify);
// - Linux: playerctl, over Spotify's MPRIS, when it's installed.
// Windows gives no track ID or cover URL, so the activity carries neither on any system: clients show Spotify's
// logo and link a search for the song.
import { clip } from "./activities";
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
			? readWindows(report)
			: process.platform === "darwin"
				? poll(readAppleScript, report)
				: poll(readPlayerctl(), report);
	return () => {
		stopped = true;
		stop();
	};
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

function readWindows(report: (track: SpotifyTrack | null) => void): () => void {
	let proc: ReturnType<typeof spawnSmtcReader> | null = null;
	let stopped = false;
	let restart: ReturnType<typeof setTimeout> | undefined;
	const run = () => {
		const startedAt = Date.now();
		let child: ReturnType<typeof spawnSmtcReader>;
		try {
			child = spawnSmtcReader();
		} catch (err) {
			console.error("[Spotify] Couldn't start the Windows reader:", err);
			return;
		}
		proc = child;
		void readLines(child.stdout, (line) => report(trackFromSmtc(line, Date.now())));
		void readLines(child.stderr, (line) => console.warn("[Spotify]", line));
		void child.exited.then((code) => {
			if (stopped) return;
			report(null);
			// One that ran a while died (PowerShell killed, say): it starts again. One that died at once can't run.
			if (Date.now() - startedAt < 10_000) {
				console.error(`[Spotify] The Windows reader can't run (exit code ${code})`);
				return;
			}
			restart = setTimeout(run, 5000);
		});
	};
	run();
	return () => {
		stopped = true;
		clearTimeout(restart);
		proc?.kill();
	};
}

async function readLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
	const decoder = new TextDecoder();
	let buffered = "";
	for await (const chunk of stream) {
		buffered += decoder.decode(chunk, { stream: true });
		let newline = buffered.indexOf("\n");
		while (newline >= 0) {
			const line = buffered.slice(0, newline).trim();
			buffered = buffered.slice(newline + 1);
			if (line) onLine(line);
			newline = buffered.indexOf("\n");
		}
	}
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
