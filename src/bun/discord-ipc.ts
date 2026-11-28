// The activity games and apps send to Discord's Rich Presence pipe (#600, DISENO-PRESENCIA-DISCORD.md). Discord's SDK
// connects to the first of discord-ipc-0 to -9 that's there, so Duvet holds discord-ipc-0 while Settings → Activity
// privacy lets it, and each connection's activity shows as an IPC app's does (IpcActivities). With Discord running, it
// takes the next free pipe: each connection is relayed to it byte for byte and its activity copied, so both show it.
// Without Discord, Duvet answers as Discord would, and once Discord comes up it ends those connections, so their games
// reconnect through the relay. An activity comes without a name: it's its application's, which Discord's public API
// gives by client_id, with the IDs of its images.
import { rmSync } from "node:fs";
import type { Socket, SocketHandler, UnixSocketListener } from "bun";
import { fitActivity, type ActivityPayload } from "./activities";
import { fetchImageBytes } from "./activity-images";

/** The opcodes of Discord's IPC. A frame is its opcode and its JSON's length in bytes, each a little-endian u32, then
 * the JSON. */
export const Op = { Handshake: 0, Frame: 1, Close: 2, Ping: 3, Pong: 4 } as const;
/** The most bytes a frame's JSON may have: a connection that sends a longer one is closed. */
export const MAX_FRAME_BYTES = 64 << 10;

export interface Frame {
	op: number;
	message: unknown;
}

export function encodeFrame(op: number, payload: unknown): Uint8Array {
	const json = new TextEncoder().encode(JSON.stringify(payload) ?? "null");
	const bytes = new Uint8Array(8 + json.length);
	const head = new DataView(bytes.buffer);
	head.setUint32(0, op, true);
	head.setUint32(4, json.length, true);
	bytes.set(json, 8);
	return bytes;
}

/** One connection's bytes as frames, however its writes were cut. push() gives the frames it completed, leaving out
 * those whose JSON doesn't parse, or null once a frame is longer than MAX_FRAME_BYTES: the connection is closed then. */
export class FrameReader {
	private buffer = new Uint8Array(1024);
	private size = 0;
	private readonly decoder = new TextDecoder();

	push(chunk: Uint8Array): Frame[] | null {
		// Grown by doubling, so a frame that comes a byte at a time is copied a few times, not once per byte.
		if (this.size + chunk.length > this.buffer.length) {
			const grown = new Uint8Array(Math.max(this.buffer.length * 2, this.size + chunk.length));
			grown.set(this.buffer.subarray(0, this.size));
			this.buffer = grown;
		}
		this.buffer.set(chunk, this.size);
		this.size += chunk.length;
		const frames: Frame[] = [];
		let at = 0;
		while (this.size - at >= 8) {
			const head = new DataView(this.buffer.buffer, this.buffer.byteOffset + at, 8);
			const length = head.getUint32(4, true);
			if (length > MAX_FRAME_BYTES) return null;
			if (this.size - at < 8 + length) break;
			try {
				const json = this.decoder.decode(this.buffer.subarray(at + 8, at + 8 + length));
				frames.push({ op: head.getUint32(0, true), message: JSON.parse(json) });
			} catch {
				// Not JSON: dropped.
			}
			at += 8 + length;
		}
		this.buffer.copyWithin(0, at, this.size);
		this.size -= at;
		return frames;
	}
}

/** What Discord's public API says of an application: its name, and its images' IDs by their keys (null when the API
 * didn't list them: its keys then show no image). */
export interface DiscordApp {
	name: string;
	assets: Map<string, string> | null;
}

/** Discord's public API, which names an application and lists its images. */
export const DISCORD_API = "https://discord.com/api/v10";
// How long each of an application's two lookups may take, and how many bytes each answer may have.
const APP_FETCH_MS = 10_000;
const APP_MAX_BYTES = 256 << 10;
// How many applications are kept, the most recently used.
const KEPT_APPS = 64;
/** How long an application the API didn't name, or whose images it didn't list, waits before it's asked again. */
export const RETRY_APP_MS = 2 * 60_000;

/** A Discord ID as its SDK sends one: a string of digits, the only thing that goes into the API's paths. */
export const isSnowflake = (value: unknown): value is string => typeof value === "string" && /^\d{1,20}$/.test(value);

/** The applications activities come from, each asked of Discord's public API once and kept. */
export class DiscordApps {
	private readonly kept = new Map<string, { app: Promise<DiscordApp | null>; failedAt?: number }>();

	constructor(
		private readonly fetchBytes: (url: string) => Promise<Uint8Array | null> = (url) =>
			fetchImageBytes(url, undefined, APP_FETCH_MS, APP_MAX_BYTES),
		private readonly now: () => number = Date.now,
	) {}

	/** clientId's application, or null when the API doesn't name it. */
	lookup(clientId: string): Promise<DiscordApp | null> {
		let entry = this.kept.get(clientId);
		this.kept.delete(clientId);
		if (!entry || (entry.failedAt !== undefined && this.now() - entry.failedAt >= RETRY_APP_MS)) {
			const asked: { app: Promise<DiscordApp | null>; failedAt?: number } = { app: this.ask(clientId) };
			void asked.app.then((app) => {
				if (!app?.assets) asked.failedAt = this.now();
			});
			entry = asked;
		}
		// The most recently used goes last, so it's the last to go.
		this.kept.set(clientId, entry);
		if (this.kept.size > KEPT_APPS) this.kept.delete(this.kept.keys().next().value!);
		return entry.app;
	}

	private async ask(clientId: string): Promise<DiscordApp | null> {
		const [rpc, assets] = await Promise.all([
			this.json(`${DISCORD_API}/applications/${clientId}/rpc`),
			this.json(`${DISCORD_API}/oauth2/applications/${clientId}/assets`),
		]);
		const name = isObject(rpc) && typeof rpc.name === "string" && rpc.name.trim() ? rpc.name : null;
		if (!name) return null;
		if (!Array.isArray(assets)) return { name, assets: null };
		const ids = new Map<string, string>();
		for (const asset of assets) {
			if (isObject(asset) && typeof asset.name === "string" && isSnowflake(asset.id)) ids.set(asset.name, asset.id);
		}
		return { name, assets: ids };
	}

	private async json(url: string): Promise<unknown> {
		const bytes = await this.fetchBytes(url);
		if (!bytes) return null;
		try {
			return JSON.parse(new TextDecoder().decode(bytes));
		} catch {
			return null;
		}
	}
}

/** An activity's image as a URL: one by URL as it is, one of Discord's media proxy (mp:…) at its address, or one of
 * the application's own, by its key or its ID. Anything else shows no image. */
export function assetImage(key: unknown, clientId: string, app: DiscordApp): string | undefined {
	if (typeof key !== "string" || !key) return undefined;
	if (/^https?:\/\//i.test(key)) return key;
	if (key.startsWith("mp:")) return `https://media.discordapp.net/${key.slice(3)}`;
	const id = app.assets?.get(key) ?? app.assets?.get(key.toLowerCase()) ?? (isSnowflake(key) ? key : undefined);
	return id ? `https://cdn.discordapp.com/app-assets/${clientId}/${id}.png` : undefined;
}

/** A SET_ACTIVITY's activity as Duvet shows it (fitActivity): with its application's name, its times in milliseconds
 * and its images by URL, which IpcActivities makes inline. null without an application or an activity. */
export function duvetActivity(activity: unknown, clientId: string, app: DiscordApp | null): ActivityPayload | null {
	if (!app || !isObject(activity)) return null;
	const { timestamps, assets } = activity;
	return fitActivity({
		type: activity.type,
		name: app.name,
		details: activity.details,
		state: activity.state,
		timestamps: isObject(timestamps) ? { start: millis(timestamps.start), end: millis(timestamps.end) } : undefined,
		assets: isObject(assets)
			? {
					large_image: assetImage(assets.large_image, clientId, app),
					large_text: assets.large_text,
					small_image: assetImage(assets.small_image, clientId, app),
					small_text: assets.small_text,
				}
			: undefined,
	});
}

// Discord's SDK sends Unix seconds and some libraries milliseconds: below 10¹² (2001, in milliseconds) it's seconds.
const millis = (time: unknown) => (typeof time === "number" && time < 1e12 ? time * 1000 : time);

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** Where each connection's activity goes: the IPC apps' (IpcActivities), each connection a client of its own. */
export interface ActivitySink {
	set(client: object, activity: ActivityPayload | null): void;
	clear(client: object): void;
}

export interface DiscordPipeOptions {
	/** Where Duvet listens: discord-ipc-0. */
	path: string;
	/** Where Discord listens when it runs, the lowest first: discord-ipc-1 to -9. The first that answers is Discord. */
	discordPaths: string[];
	activities: ActivitySink;
	apps?: Pick<DiscordApps, "lookup">;
	/** Whether the path is a file, a Unix socket: one a process that ended left is removed before listening, and Duvet's
	 * own once it lets go. */
	socketFile?: boolean;
	retryMs?: number;
	discordCheckMs?: number;
	handshakeMs?: number;
	log?: (line: string) => void;
}

/** How long Duvet waits to try discord-ipc-0 again, while something else holds it. */
export const RETRY_PIPE_MS = 30_000;
/** How often Duvet looks for Discord while it answers connections itself. */
export const DISCORD_CHECK_MS = 5_000;
/** How long a connection may go without its handshake. */
export const HANDSHAKE_MS = 10_000;
// How long a connection to one of Discord's pipes may take to open.
const CONNECT_MS = 1_000;
/** The most bytes that may wait to go out on a socket that doesn't read them: past it, the connection is closed. */
export const MAX_WAITING_BYTES = 1 << 20;

// What Discord answers a handshake with: its user stands for no account.
const READY = {
	cmd: "DISPATCH",
	evt: "READY",
	nonce: null,
	data: {
		v: 1,
		config: { cdn_host: "cdn.discordapp.com", api_endpoint: "//discord.com/api", environment: "production" },
		user: {
			id: "1000000000000000000",
			username: "duvet",
			discriminator: "0",
			global_name: "Duvet",
			avatar: null,
			bot: false,
			flags: 0,
			premium_type: 0,
		},
	},
};

/**
 * Discord's IPC pipe, held by Duvet: start() takes it, or tries again every retryMs while something else holds it, and
 * stop() lets go of it, ending its connections and their activities, so that Discord can take it. Both may be called
 * again, in any order, as the switch is turned.
 */
export class DiscordPipe {
	readonly apps: Pick<DiscordApps, "lookup">;
	readonly activities: ActivitySink;
	readonly handshakeMs: number;
	readonly log: (line: string) => void;
	private readonly links = new Set<GameLink>();
	private readonly answered = new Set<GameLink>();
	// The connections Bun has open on the pipe, until each one's close: one still open keeps the pipe's name.
	private readonly sockets = new Set<Socket<GameLink>>();
	private released: Promise<void> = Promise.resolve();
	private release: (() => void) | null = null;
	private server: UnixSocketListener<GameLink> | null = null;
	private taking: Promise<boolean> | null = null;
	private wanted = false;
	private saidTaken = false;
	private retry: ReturnType<typeof setTimeout> | undefined;
	private watch: ReturnType<typeof setInterval> | undefined;
	private looking = false;
	private nextId = 1;

	constructor(private readonly options: DiscordPipeOptions) {
		this.apps = options.apps ?? new DiscordApps();
		this.activities = options.activities;
		this.handshakeMs = options.handshakeMs ?? HANDSHAKE_MS;
		this.log = options.log ?? ((line) => console.log(`[Discord IPC] ${line}`));
	}

	/** Whether Duvet listens on the pipe now. */
	get listening(): boolean {
		return this.server !== null;
	}

	/** Takes the pipe, or tries again later: whether Duvet listens on it now. */
	start(): Promise<boolean> {
		this.wanted = true;
		return this.attempt();
	}

	stop() {
		this.wanted = false;
		clearTimeout(this.retry);
		clearInterval(this.watch);
		this.watch = undefined;
		for (const link of [...this.links]) link.close();
		if (!this.server) return;
		// In the Bun the app ships (1.3.9), stop(true) leaves a connected pipe open, and listening again while one is
		// open kills the process: each one is closed here, and the pipe is taken again only once all of them have.
		this.server.stop();
		this.server = null;
		if (this.sockets.size) this.released = new Promise((resolve) => (this.release = resolve));
		for (const socket of this.sockets) socket.terminate();
		if (this.options.socketFile) this.removeFile();
		this.log(`let go of ${this.options.path}`);
	}

	private attempt(): Promise<boolean> {
		return (this.taking ??= this.take().finally(() => (this.taking = null)));
	}

	private async take(): Promise<boolean> {
		await this.released;
		if (!this.wanted || this.server) return this.server !== null;
		const { path } = this.options;
		const free = await freeToListen(path, this.options.socketFile ?? false);
		if (!this.wanted) return false;
		if (free && this.listen()) return true;
		if (!free && !this.saidTaken) {
			this.saidTaken = true;
			const every = (this.options.retryMs ?? RETRY_PIPE_MS) / 1000;
			this.log(`${path} is taken (Discord, or another Duvet): trying again every ${every} s`);
		}
		this.retry = setTimeout(() => void this.attempt(), this.options.retryMs ?? RETRY_PIPE_MS);
		return false;
	}

	private listen(): boolean {
		const { path } = this.options;
		if (this.options.socketFile) this.removeFile();
		try {
			this.server = Bun.listen<GameLink>({
				unix: path,
				socket: {
					open: (socket) => {
						this.sockets.add(socket);
						const link = new GameLink(socket, this, this.nextId++);
						socket.data = link;
						this.links.add(link);
						void this.findDiscord(link).then((discord) => link.decide(discord));
					},
					data: (socket, chunk) => socket.data.fromGame(chunk),
					drain: (socket) => socket.data.drainGame(),
					close: (socket) => {
						this.sockets.delete(socket);
						socket.data?.close();
						if (!this.sockets.size) this.release?.();
					},
					error: (_socket, err) => this.log(`a connection failed: ${err.message}`),
				},
			});
		} catch (err) {
			this.log(`can't listen on ${path}: ${err}`);
			return false;
		}
		this.saidTaken = false;
		this.log(`listening on ${path}`);
		return true;
	}

	private removeFile() {
		try {
			rmSync(this.options.path, { force: true });
		} catch (err) {
			this.log(`couldn't remove ${this.options.path}: ${err}`);
		}
	}

	/** The first of Discord's pipes that answers, connected to for link's relay, or null when none does. */
	private async findDiscord(link?: GameLink): Promise<Socket | null> {
		const handlers: SocketHandler<undefined> = {
			data: (socket, chunk) => link?.fromDiscord(socket, chunk),
			drain: (socket) => link?.drainDiscord(socket),
			close: (socket) => link?.discordClosed(socket),
			error: (_socket, err) => this.log(`Discord's pipe failed: ${err.message}`),
		};
		for (const path of this.options.discordPaths) {
			const socket = await connectWithin(path, handlers, CONNECT_MS);
			if (socket) return socket;
		}
		return null;
	}

	/** link is answered here, as Discord isn't running: it's ended once Discord is. */
	answeredHere(link: GameLink) {
		this.answered.add(link);
		const every = this.options.discordCheckMs ?? DISCORD_CHECK_MS;
		this.watch ??= setInterval(() => {
			this.lookForDiscord().catch((err: unknown) => this.log(`looking for Discord failed: ${err}`));
		}, every);
	}

	forget(link: GameLink) {
		this.links.delete(link);
		this.answered.delete(link);
	}

	private async lookForDiscord() {
		if (this.looking) return;
		if (!this.answered.size) {
			clearInterval(this.watch);
			this.watch = undefined;
			return;
		}
		this.looking = true;
		try {
			const discord = await this.findDiscord();
			discord?.end();
			if (!discord || !this.server) return;
			this.log(`Discord is up: ending ${this.answered.size} connection(s) answered here, to reconnect through it`);
			for (const link of [...this.answered]) link.close();
		} finally {
			this.looking = false;
		}
	}
}

/** One game's connection to Duvet's pipe: relayed to Discord's, or answered here when Discord doesn't run. */
class GameLink {
	closed = false;
	private mode: "deciding" | "relayed" | "answered" = "deciding";
	// The game's bytes before Duvet knows whether Discord runs.
	private early: Uint8Array[] = [];
	private earlyBytes = 0;
	private readonly frames = new FrameReader();
	private clientId: string | null = null;
	private activityChanges = 0;
	private discord: Socket | null = null;
	private toDiscord: Outbox | null = null;
	private readonly toGame: Outbox;
	private readonly handshakeTimer: ReturnType<typeof setTimeout>;

	constructor(
		private readonly game: Socket<GameLink>,
		private readonly pipe: DiscordPipe,
		private readonly id: number,
	) {
		this.toGame = new Outbox(game, () => this.close("it doesn't read what it's sent"));
		this.handshakeTimer = setTimeout(() => this.close("no handshake"), pipe.handshakeMs);
	}

	/** Whether Discord runs, which the game's bytes so far waited for: its connection, or null. */
	decide(discord: Socket | null) {
		if (this.closed) {
			discord?.end();
			return;
		}
		if (discord) {
			this.discord = discord;
			this.toDiscord = new Outbox(discord, () => this.close("Discord doesn't read what it's sent"));
			this.mode = "relayed";
		} else {
			this.mode = "answered";
			this.pipe.answeredHere(this);
		}
		const early = this.early;
		this.early = [];
		for (const chunk of early) this.fromGame(chunk);
	}

	fromGame(chunk: Uint8Array) {
		if (this.closed) return;
		if (this.mode === "deciding") {
			this.early.push(chunk.slice());
			this.earlyBytes += chunk.length;
			if (this.earlyBytes > MAX_WAITING_BYTES) this.close("too much before Discord was looked for");
			return;
		}
		this.toDiscord?.send(chunk);
		const frames = this.frames.push(chunk);
		if (!frames) return this.close(`a frame over ${MAX_FRAME_BYTES} bytes`);
		for (const frame of frames) {
			if (this.closed) return;
			this.handle(frame);
		}
	}

	fromDiscord(socket: Socket, chunk: Uint8Array) {
		if (socket === this.discord && !this.closed) this.toGame.send(chunk);
	}

	drainGame() {
		this.toGame.flush();
	}

	drainDiscord(socket: Socket) {
		if (socket === this.discord) this.toDiscord?.flush();
	}

	discordClosed(socket: Socket) {
		if (socket === this.discord) this.close("Discord ended it");
	}

	close(why?: string) {
		if (this.closed) return;
		this.closed = true;
		clearTimeout(this.handshakeTimer);
		this.pipe.forget(this);
		if (this.activityChanges) this.pipe.activities.clear(this);
		if (why) this.pipe.log(`#${this.id} (${this.clientId ?? "before its handshake"}) closed: ${why}`);
		this.game.end();
		this.discord?.end();
	}

	// What the game sends, relayed or not: its handshake names its application, and its activities are copied. Answered
	// here, it gets Discord's answers too.
	private handle({ op, message }: Frame) {
		const body = isObject(message) ? message : {};
		if (op === Op.Handshake) {
			if (this.clientId) return;
			if (!isSnowflake(body.client_id)) {
				if (this.mode !== "answered") return;
				this.send(Op.Close, { code: 4000, message: "Invalid Client ID" });
				return this.close("a handshake without a client ID");
			}
			this.clientId = body.client_id;
			clearTimeout(this.handshakeTimer);
			// Its name and images, ahead of its first activity.
			void this.pipe.apps.lookup(this.clientId);
			if (this.mode === "answered") this.send(Op.Frame, READY);
			return;
		}
		if (op === Op.Frame && this.clientId && body.cmd === "SET_ACTIVITY") this.copyActivity(this.clientId, body.args);
		if (this.mode === "answered") this.answer(op, message, body);
	}

	private answer(op: number, message: unknown, body: Record<string, unknown>) {
		if (op === Op.Ping) return this.send(Op.Pong, message);
		if (op === Op.Close) return this.close();
		if (op !== Op.Frame) return;
		if (!this.clientId) return this.close("a command before its handshake");
		const { cmd, evt } = body;
		const nonce = body.nonce ?? null;
		const args = isObject(body.args) ? body.args : {};
		if (cmd === "SET_ACTIVITY") this.send(Op.Frame, { cmd, data: args.activity ?? null, evt: null, nonce });
		// With the event, as Discord answers: answered with none, osu!'s library (Lachee's DiscordRPC) sends nothing more.
		else if (cmd === "SUBSCRIBE" || cmd === "UNSUBSCRIBE")
			this.send(Op.Frame, { cmd, data: { evt }, evt: null, nonce });
		// Anything else takes Discord itself.
		else this.send(Op.Frame, { cmd, data: { code: 4002, message: "Invalid command" }, evt: "ERROR", nonce });
	}

	private copyActivity(clientId: string, args: unknown) {
		const change = ++this.activityChanges;
		const activity = isObject(args) ? args.activity : undefined;
		if (!isObject(activity)) return this.pipe.activities.clear(this);
		this.pipe.apps.lookup(clientId).then(
			(app) => {
				// A newer one came meanwhile, or the connection ended.
				if (this.closed || change !== this.activityChanges) return;
				this.pipe.activities.set(this, duvetActivity(activity, clientId, app));
			},
			(err: unknown) => this.pipe.log(`#${this.id} (${clientId}): its application wasn't looked up: ${err}`),
		);
	}

	private send(op: number, payload: unknown) {
		this.toGame.send(encodeFrame(op, payload));
	}
}

/** What goes out on a socket, in order: Bun's sockets take what they can and leave the rest to their caller. */
class Outbox {
	private waiting: Uint8Array[] = [];
	private bytes = 0;

	constructor(
		private readonly socket: Socket<GameLink> | Socket,
		private readonly tooMuch: () => void,
	) {}

	send(data: Uint8Array) {
		let rest = data;
		if (!this.waiting.length) {
			const wrote = this.socket.write(data);
			if (wrote < 0 || wrote === data.length) return; // closed, or all of it went
			rest = data.subarray(wrote);
		}
		this.waiting.push(rest.slice());
		this.bytes += rest.length;
		if (this.bytes > MAX_WAITING_BYTES) this.tooMuch();
	}

	flush() {
		while (this.waiting.length) {
			const next = this.waiting[0];
			const wrote = this.socket.write(next);
			if (wrote < 0) {
				this.waiting = [];
				this.bytes = 0;
				return;
			}
			this.bytes -= wrote;
			if (wrote < next.length) {
				this.waiting[0] = next.subarray(wrote);
				return;
			}
			this.waiting.shift();
		}
	}
}

/**
 * Whether Duvet may listen on path: a connection to it fails because it isn't there (ENOENT), or, for a socket file,
 * because nothing listens on it (ECONNREFUSED: a process that ended left it). A Windows pipe that refuses still has
 * connections open, with no one listening (its owner letting go of it): in the Bun the app ships (1.3.9), listening
 * there, as on a pipe that answers, kills the process past any try (#188).
 */
export async function freeToListen(path: string, socketFile: boolean): Promise<boolean> {
	try {
		const socket = await Bun.connect({ unix: path, socket: { data() {} } });
		socket.end();
		return false;
	} catch (err) {
		const code = err instanceof Error && "code" in err ? err.code : undefined;
		return code === "ENOENT" || (socketFile && code === "ECONNREFUSED");
	}
}

// A connection to path, or null when it fails or doesn't open within ms. One that opens after that is ended.
async function connectWithin(path: string, socket: SocketHandler<undefined>, ms: number): Promise<Socket | null> {
	const attempt = Bun.connect({ unix: path, socket }).catch(() => null);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ms)));
	const first = await Promise.race([attempt, late]);
	clearTimeout(timer);
	if (!first) void attempt.then((opened) => opened?.end());
	return first;
}
