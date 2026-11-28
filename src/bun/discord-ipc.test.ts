import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Socket } from "bun";
import { atMostEvery, type ActivityPayload } from "./activities";
import { IpcActivities } from "./activity-images";
import {
	assetImage,
	DISCORD_API,
	DiscordApps,
	DiscordPipe,
	duvetActivity,
	encodeFrame,
	FrameReader,
	freeToListen,
	MAX_FRAME_BYTES,
	MAX_WAITING_BYTES,
	Op,
	Outbox,
	RETRY_APP_MS,
	type DiscordApp,
	type DiscordPipeOptions,
	type Frame,
} from "./discord-ipc";

// osu! (lazer)'s application, whose activity the probe of #600 relayed.
const OSU = "1216669957799018608";
const bytes = (text: string) => new TextEncoder().encode(text);
const joined = (...parts: Uint8Array[]) => new Uint8Array(parts.flatMap((part) => [...part]));

// The tests' own pipes, never discord-ipc-N or duvet-ipc: named pipes on Windows, sockets in the temp folder elsewhere.
const socketFile = process.platform !== "win32";
let made = 0;
function testPaths() {
	const base = `duvet-dipc-${process.pid}-${++made}`;
	const at = (n: number) => (socketFile ? join(tmpdir(), `${base}-${n}`) : `\\\\.\\pipe\\${base}-${n}`);
	return { duvet: at(0), discord: [at(1), at(2)] };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

async function until(what: string, check: () => boolean, ms = 3000) {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) throw new Error(`waited ${ms} ms for ${what}`);
		await Bun.sleep(5);
	}
}

/** Discord's public API as the tests have it: each application by its ID, with the URLs asked. */
function discordApi(apps: Record<string, { name: string; assets?: { id: string; name: string }[] }>) {
	const asked: string[] = [];
	const lookups = new DiscordApps(async (url) => {
		asked.push(url);
		const rpc = /\/applications\/(\d+)\/rpc$/.exec(url);
		const listed = /\/oauth2\/applications\/(\d+)\/assets$/.exec(url);
		const app = apps[(rpc ?? listed)?.[1] ?? ""];
		if (!app) return null;
		return bytes(JSON.stringify(rpc ? { id: rpc[1], name: app.name } : (app.assets ?? [])));
	});
	return { asked, lookups };
}
const osuApi = () => discordApi({ [OSU]: { name: "osu!", assets: [{ id: "111", name: "osu_logo_lazer" }] } });

/** The activities shown, by connection, as IpcActivities keeps them. */
class Shown {
	private readonly by = new Map<object, ActivityPayload>();
	set(client: object, activity: ActivityPayload | null) {
		if (activity) this.by.set(client, activity);
		else this.by.delete(client);
	}
	clear(client: object) {
		this.by.delete(client);
	}
	get all() {
		return [...this.by.values()];
	}
}

/** A game on the pipe, as Discord's SDK talks to it. */
class Game {
	readonly frames: Frame[] = [];
	closed = false;
	received = 0;
	private read = 0;
	private readonly reader = new FrameReader();
	private socket!: Socket;

	static async connect(path: string): Promise<Game> {
		const game = new Game();
		game.socket = await Bun.connect({
			unix: path,
			socket: {
				data: (_socket, chunk) => {
					game.received += chunk.length;
					game.frames.push(...(game.reader.push(chunk) ?? []));
				},
				close: () => {
					game.closed = true;
				},
			},
		});
		cleanups.push(() => game.socket.end());
		return game;
	}

	send(op: number, payload: unknown) {
		this.write(encodeFrame(op, payload));
	}

	write(data: Uint8Array) {
		this.socket.write(data);
	}

	async next(): Promise<Frame> {
		await until("a frame", () => this.frames.length > this.read);
		return this.frames[this.read++];
	}

	end() {
		this.socket.end();
	}
}

const discordReady = encodeFrame(Op.Frame, { cmd: "DISPATCH", evt: "READY", data: { user: { username: "real" } } });

/** What Discord answers a frame with: READY to the handshake, and its own word to each command. */
function asDiscord({ op, message }: Frame): Uint8Array | null {
	const nonce = typeof message === "object" && message && "nonce" in message ? message.nonce : null;
	if (op === Op.Handshake) return discordReady;
	if (op === Op.Frame) return encodeFrame(Op.Frame, { cmd: "SET_ACTIVITY", data: "from Discord", evt: null, nonce });
	return null;
}

/** Discord on one of its pipes: it keeps the bytes it gets, and answers each frame as reply says (as Discord, unless
 * told otherwise). Stopped, it ends its connections, as Discord quitting does: on Windows, Bun's stop(true) leaves
 * them open. */
function fakeDiscord(path: string, reply: (frame: Frame) => Uint8Array | null = asDiscord) {
	const got: Uint8Array[] = [];
	const connections = new Set<Socket<FrameReader>>();
	const server = Bun.listen<FrameReader>({
		unix: path,
		socket: {
			open: (socket) => {
				socket.data = new FrameReader();
				connections.add(socket);
			},
			close: (socket) => {
				connections.delete(socket);
			},
			data: (socket, chunk) => {
				got.push(chunk.slice());
				for (const frame of socket.data.push(chunk) ?? []) {
					const answer = reply(frame);
					if (answer) socket.write(answer);
				}
			},
		},
	});
	const stop = () => {
		server.stop(true);
		for (const socket of connections) socket.terminate();
		if (socketFile) rmSync(path, { force: true });
	};
	cleanups.push(stop);
	return { got: () => joined(...got), stop };
}

function holdPipe(paths: ReturnType<typeof testPaths>, shown: Shown, more: Partial<DiscordPipeOptions> = {}) {
	const pipe = new DiscordPipe({
		path: paths.duvet,
		discordPaths: paths.discord,
		activities: shown,
		apps: osuApi().lookups,
		socketFile,
		log: () => {},
		...more,
	});
	cleanups.push(() => {
		pipe.stop();
		if (socketFile) rmSync(paths.duvet, { force: true });
	});
	return pipe;
}

const handshake = { v: 1, client_id: OSU };
const osuIdle = { state: "Idle", timestamps: { start: 1_764_273_000 }, assets: { large_image: "osu_logo_lazer" } };
const osuShown = {
	name: "osu!",
	state: "Idle",
	timestamps: { start: 1_764_273_000_000 },
	assets: { large_image: `https://cdn.discordapp.com/app-assets/${OSU}/111.png` },
};

describe("FrameReader", () => {
	const handshakeFrame = encodeFrame(Op.Handshake, handshake);
	const subscribeFrame = encodeFrame(Op.Frame, { cmd: "SUBSCRIBE", evt: "ACTIVITY_JOIN", nonce: "1" });
	const both = [
		{ op: Op.Handshake, message: handshake },
		{ op: Op.Frame, message: { cmd: "SUBSCRIBE", evt: "ACTIVITY_JOIN", nonce: "1" } },
	];

	test("reads frames however their bytes were cut", () => {
		const all = joined(handshakeFrame, subscribeFrame);
		for (let cut = 0; cut <= all.length; cut++) {
			const reader = new FrameReader();
			expect([...reader.push(all.subarray(0, cut))!, ...reader.push(all.subarray(cut))!]).toEqual(both);
		}
		const reader = new FrameReader();
		const oneByOne = [...all].flatMap((byte) => reader.push(new Uint8Array([byte]))!);
		expect(oneByOne).toEqual(both);
	});

	test("drops a frame that isn't JSON, and reads the next", () => {
		const notJson = joined(new Uint8Array([1, 0, 0, 0, 3, 0, 0, 0]), bytes("{x}"));
		expect(new FrameReader().push(joined(handshakeFrame, notJson, subscribeFrame))).toEqual(both);
	});

	test("gives up on a frame over 64 KiB, and reads one of 64 KiB", () => {
		const longest = "x".repeat(MAX_FRAME_BYTES - 2);
		expect(new FrameReader().push(encodeFrame(Op.Frame, longest))).toEqual([{ op: Op.Frame, message: longest }]);
		const head = new Uint8Array(8);
		new DataView(head.buffer).setUint32(4, MAX_FRAME_BYTES + 1, true);
		expect(new FrameReader().push(head)).toBeNull();
	});
});

describe("DiscordApps", () => {
	test("names an application and lists its images, asking Discord's API once", async () => {
		const api = discordApi({
			[OSU]: {
				name: "osu!",
				assets: [
					{ id: "111", name: "osu_logo_lazer" },
					{ id: "not an ID", name: "bad" },
				],
			},
		});
		expect(await api.lookups.lookup(OSU)).toEqual({ name: "osu!", assets: new Map([["osu_logo_lazer", "111"]]) });
		await api.lookups.lookup(OSU);
		expect(api.asked).toEqual([
			`${DISCORD_API}/applications/${OSU}/rpc`,
			`${DISCORD_API}/oauth2/applications/${OSU}/assets`,
		]);
	});

	test("asks again a while after the API didn't answer", async () => {
		let now = 0;
		let up = false;
		const asked: string[] = [];
		const lookups = new DiscordApps(
			async (url) => {
				asked.push(url);
				if (!up) return null;
				return bytes(url.endsWith("/rpc") ? '{"name":"osu!"}' : "[]");
			},
			() => now,
		);
		expect(await lookups.lookup(OSU)).toBeNull();
		up = true;
		now = RETRY_APP_MS - 1;
		expect(await lookups.lookup(OSU)).toBeNull();
		expect(asked).toHaveLength(2);
		now = RETRY_APP_MS;
		expect(await lookups.lookup(OSU)).toEqual({ name: "osu!", assets: new Map() });
		expect(asked).toHaveLength(4);
	});

	test("has no application without a name, and none for an answer that isn't JSON", async () => {
		const lookups = new DiscordApps(async (url) => bytes(url.endsWith("/rpc") ? '{"name":"  "}' : "{"));
		expect(await lookups.lookup(OSU)).toBeNull();
		const unlisted = new DiscordApps(async (url) => bytes(url.endsWith("/rpc") ? '{"name":"osu!"}' : "{"));
		expect(await unlisted.lookup(OSU)).toEqual({ name: "osu!", assets: null });
	});
});

describe("duvetActivity", () => {
	const osu: DiscordApp = {
		name: "osu!",
		assets: new Map([
			["osu_logo_lazer", "111"],
			["mode_0", "222"],
		]),
	};

	test("names an activity after its application, its keys as its images and its times in milliseconds", () => {
		const activity = {
			type: 0,
			state: "Choosing a beatmap",
			details: "Score 1,000",
			timestamps: { start: 1_764_273_000_123, end: 1_764_273_600 },
			assets: { large_image: "osu_logo_lazer", large_text: "player", small_image: "mode_0", small_text: "osu!" },
			buttons: [{ label: "Join", url: "https://osu.ppy.sh" }],
		};
		expect(duvetActivity(activity, OSU, osu)).toEqual({
			name: "osu!",
			state: "Choosing a beatmap",
			details: "Score 1,000",
			timestamps: { start: 1_764_273_000_123, end: 1_764_273_600_000 },
			assets: {
				large_image: `https://cdn.discordapp.com/app-assets/${OSU}/111.png`,
				large_text: "player",
				small_image: `https://cdn.discordapp.com/app-assets/${OSU}/222.png`,
				small_text: "osu!",
			},
		});
		expect(duvetActivity({ type: 2, details: "A song" }, OSU, osu)).toEqual({
			type: 2,
			name: "osu!",
			details: "A song",
		});
	});

	test("takes an image by URL, through Discord's media proxy, or by its ID, and no other", () => {
		expect(assetImage("https://i.example/a.png", OSU, osu)).toBe("https://i.example/a.png");
		expect(assetImage("mp:external/abc/https/i.example/a.png", OSU, osu)).toBe(
			"https://media.discordapp.net/external/abc/https/i.example/a.png",
		);
		expect(assetImage("333", OSU, osu)).toBe(`https://cdn.discordapp.com/app-assets/${OSU}/333.png`);
		expect(assetImage("OSU_LOGO_LAZER", OSU, osu)).toBe(`https://cdn.discordapp.com/app-assets/${OSU}/111.png`);
		for (const key of ["unknown_key", "", 5, null, "javascript:alert(1)", "file:///etc/passwd"]) {
			expect(assetImage(key, OSU, osu)).toBeUndefined();
		}
		expect(assetImage("osu_logo_lazer", OSU, { name: "osu!", assets: null })).toBeUndefined();
	});

	test("is nothing without an application or an activity", () => {
		expect(duvetActivity({ state: "Idle" }, OSU, null)).toBeNull();
		expect(duvetActivity(null, OSU, osu)).toBeNull();
		expect(duvetActivity("Idle", OSU, osu)).toBeNull();
	});
});

describe("DiscordPipe without Discord", () => {
	test("answers as Discord does: READY, the subscription with its event, the activity, PING and anything else", async () => {
		const paths = testPaths();
		const shown = new Shown();
		const pipe = holdPipe(paths, shown);
		expect(await pipe.start()).toBe(true);
		const game = await Game.connect(paths.duvet);
		game.send(Op.Handshake, handshake);
		expect(await game.next()).toMatchObject({
			op: Op.Frame,
			message: { cmd: "DISPATCH", evt: "READY", nonce: null, data: { v: 1, user: { username: "duvet" } } },
		});
		game.send(Op.Frame, { cmd: "SUBSCRIBE", evt: "ACTIVITY_JOIN", args: {}, nonce: "1" });
		expect(await game.next()).toEqual({
			op: Op.Frame,
			message: { cmd: "SUBSCRIBE", data: { evt: "ACTIVITY_JOIN" }, evt: null, nonce: "1" },
		});
		game.send(Op.Frame, { cmd: "SET_ACTIVITY", args: { pid: 4242, activity: osuIdle }, nonce: "2" });
		expect(await game.next()).toEqual({
			op: Op.Frame,
			message: { cmd: "SET_ACTIVITY", data: osuIdle, evt: null, nonce: "2" },
		});
		await until("the activity", () => shown.all.length === 1);
		expect(shown.all).toEqual([osuShown]);
		game.send(Op.Ping, { at: 1 });
		expect(await game.next()).toEqual({ op: Op.Pong, message: { at: 1 } });
		game.send(Op.Frame, { cmd: "GET_GUILDS", args: {}, nonce: "3" });
		expect(await game.next()).toMatchObject({ op: Op.Frame, message: { cmd: "GET_GUILDS", evt: "ERROR", nonce: "3" } });
		game.send(Op.Frame, { cmd: "SET_ACTIVITY", args: { pid: 4242, activity: null }, nonce: "4" });
		expect(await game.next()).toEqual({
			op: Op.Frame,
			message: { cmd: "SET_ACTIVITY", data: null, evt: null, nonce: "4" },
		});
		await until("the activity cleared", () => shown.all.length === 0);
	});

	test("clears a connection's activity once it ends, and keeps the others'", async () => {
		const paths = testPaths();
		const shown = new Shown();
		await holdPipe(paths, shown).start();
		const games = [await Game.connect(paths.duvet), await Game.connect(paths.duvet)];
		for (const [i, game] of games.entries()) {
			game.send(Op.Handshake, handshake);
			await game.next();
			game.send(Op.Frame, { cmd: "SET_ACTIVITY", args: { activity: { ...osuIdle, state: `Game ${i}` } }, nonce: "1" });
		}
		await until("both activities", () => shown.all.length === 2);
		games[0].end();
		await until("the first one's cleared", () => shown.all.length === 1);
		expect(shown.all[0]?.state).toBe("Game 1");
		// A game that ended its connection itself takes nothing to its next one.
		const next = await Game.connect(paths.duvet);
		next.send(Op.Handshake, handshake);
		await next.next();
		await Bun.sleep(30);
		expect(shown.all.map((activity) => activity.state)).toEqual(["Game 1"]);
	});

	test("shows a game's activity once a lookup that failed names its application, as the game doesn't send it again", async () => {
		const paths = testPaths();
		const shown = new Shown();
		let named = false;
		const apps = { lookup: async () => (named ? { name: "osu!", assets: new Map<string, string>() } : null) };
		await holdPipe(paths, shown, { apps, appRetryMs: 30 }).start();
		const game = await Game.connect(paths.duvet);
		game.send(Op.Handshake, handshake);
		await game.next();
		game.send(Op.Frame, { cmd: "SET_ACTIVITY", args: { activity: { state: "Idle" } }, nonce: "1" });
		await game.next();
		await Bun.sleep(20);
		expect(shown.all).toEqual([]);
		named = true;
		await until("the activity, once named", () => shown.all.length === 1);
		expect(shown.all).toEqual([{ name: "osu!", state: "Idle" }]);
	});

	test("shows only a connection's last activity, whatever its lookup's pace", async () => {
		const paths = testPaths();
		const shown = new Shown();
		let answer!: () => void;
		const slow = new Promise<void>((resolve) => (answer = resolve));
		const apps = {
			lookup: async () => {
				await slow;
				return { name: "osu!", assets: new Map<string, string>() };
			},
		};
		await holdPipe(paths, shown, { apps }).start();
		const game = await Game.connect(paths.duvet);
		game.send(Op.Handshake, handshake);
		await game.next();
		game.send(Op.Frame, { cmd: "SET_ACTIVITY", args: { activity: { state: "first" } }, nonce: "1" });
		game.send(Op.Frame, { cmd: "SET_ACTIVITY", args: { activity: { state: "second" } }, nonce: "2" });
		await game.next();
		await game.next();
		answer();
		await until("the activity", () => shown.all.length === 1);
		await Bun.sleep(20);
		expect(shown.all).toEqual([{ name: "osu!", state: "second" }]);
	});
});

describe("a game's activity on its way out", () => {
	test("goes out at most once an interval, however often the game sets it, and its last one goes", async () => {
		const paths = testPaths();
		const sent: ActivityPayload[][] = [];
		const noImages = { known: () => undefined, inline: async () => undefined };
		// As index.ts has them: the IPC apps' activities, which go out through atMostEvery.
		const send = atMostEvery(50, () => sent.push(activities.activities()));
		const activities = new IpcActivities(noImages, () => send());
		await holdPipe(paths, new Shown(), { activities }).start();
		const game = await Game.connect(paths.duvet);
		game.send(Op.Handshake, handshake);
		await game.next();
		const start = performance.now();
		for (let i = 1; i <= 30; i++) {
			game.send(Op.Frame, { cmd: "SET_ACTIVITY", args: { activity: { state: `Score ${i}` } }, nonce: `${i}` });
			await Bun.sleep(10);
		}
		await until("the last activity", () => sent.at(-1)?.[0]?.state === "Score 30");
		const elapsed = performance.now() - start;
		expect(sent.length).toBeLessThanOrEqual(Math.ceil(elapsed / 50) + 1);
		expect(sent.at(-1)).toEqual([{ name: "osu!", state: "Score 30" }]);
	});
});

describe("Outbox", () => {
	test("sends what a socket couldn't take once it drains, in order, and gives up past 1 MiB waiting", () => {
		const written: number[] = [];
		let room = 3;
		const socket = {
			write: (data: Uint8Array) => {
				const took = Math.min(room, data.length);
				written.push(...data.subarray(0, took));
				room -= took;
				return took;
			},
		};
		let full = 0;
		const out = new Outbox(socket, () => full++);
		out.send(new Uint8Array([1, 2, 3, 4, 5]));
		out.send(new Uint8Array([6, 7]));
		expect(written).toEqual([1, 2, 3]);
		room = 3;
		out.flush();
		expect(written).toEqual([1, 2, 3, 4, 5, 6]);
		room = 10;
		out.flush();
		expect(written).toEqual([1, 2, 3, 4, 5, 6, 7]);
		room = 0;
		out.send(new Uint8Array(MAX_WAITING_BYTES));
		expect(full).toBe(0);
		out.send(new Uint8Array(1));
		expect(full).toBe(1);
	});
});

describe("DiscordPipe's limits", () => {
	test("closes a connection that sends a frame over 64 KiB", async () => {
		const paths = testPaths();
		await holdPipe(paths, new Shown()).start();
		const game = await Game.connect(paths.duvet);
		game.send(Op.Handshake, handshake);
		await game.next();
		const head = new Uint8Array(8);
		new DataView(head.buffer).setUint32(4, MAX_FRAME_BYTES + 1, true);
		game.write(head);
		await until("the connection closed", () => game.closed);
	});

	test("drops a frame that isn't JSON, and answers the next", async () => {
		const paths = testPaths();
		await holdPipe(paths, new Shown()).start();
		const game = await Game.connect(paths.duvet);
		game.send(Op.Handshake, handshake);
		await game.next();
		game.write(joined(new Uint8Array([1, 0, 0, 0, 3, 0, 0, 0]), bytes("{x}")));
		game.send(Op.Ping, "still here");
		expect(await game.next()).toEqual({ op: Op.Pong, message: "still here" });
		expect(game.closed).toBe(false);
	});

	test("closes a connection that never shakes hands", async () => {
		const paths = testPaths();
		await holdPipe(paths, new Shown(), { handshakeMs: 50 }).start();
		const game = await Game.connect(paths.duvet);
		await until("the connection closed", () => game.closed, 2000);
	});

	test("refuses a handshake without a client ID as Discord does, and a command before any", async () => {
		const paths = testPaths();
		await holdPipe(paths, new Shown()).start();
		const unnamed = await Game.connect(paths.duvet);
		unnamed.send(Op.Handshake, { v: 1, client_id: "../../users/@me" });
		expect(await unnamed.next()).toEqual({ op: Op.Close, message: { code: 4000, message: "Invalid Client ID" } });
		await until("the connection closed", () => unnamed.closed);
		const hasty = await Game.connect(paths.duvet);
		hasty.send(Op.Frame, { cmd: "SET_ACTIVITY", args: { activity: osuIdle }, nonce: "1" });
		await until("the connection closed", () => hasty.closed);
	});
});

describe("DiscordPipe with Discord running", () => {
	test("relays a connection to the lowest of Discord's pipes there are, byte for byte, and copies its activity", async () => {
		const paths = testPaths();
		const shown = new Shown();
		const said: string[] = [];
		// Discord on the second of its pipes: nothing is at the first.
		const discord = fakeDiscord(paths.discord[1]);
		await holdPipe(paths, shown, { log: (line) => said.push(line) }).start();
		const game = await Game.connect(paths.duvet);
		const sent = [
			encodeFrame(Op.Handshake, handshake),
			encodeFrame(Op.Frame, { cmd: "SET_ACTIVITY", args: { pid: 4242, activity: osuIdle }, nonce: "1" }),
		];
		game.write(sent[0]);
		expect(await game.next()).toMatchObject({ message: { evt: "READY", data: { user: { username: "real" } } } });
		game.write(sent[1]);
		expect(await game.next()).toEqual({
			op: Op.Frame,
			message: { cmd: "SET_ACTIVITY", data: "from Discord", evt: null, nonce: "1" },
		});
		await until("the activity", () => shown.all.length === 1);
		expect(shown.all).toEqual([osuShown]);
		expect(discord.got()).toEqual(joined(...sent));
		// Discord quits: Duvet answers the game from then on, which keeps its connection and its activity.
		discord.stop();
		await until("Duvet answering the game", () => said.some((line) => line.includes("answered here")));
		expect(game.closed).toBe(false);
		expect(shown.all).toEqual([osuShown]);
		game.send(Op.Ping, "still there?");
		expect(await game.next()).toEqual({ op: Op.Pong, message: "still there?" });
		game.send(Op.Frame, { cmd: "SET_ACTIVITY", args: { activity: { ...osuIdle, state: "Playing" } }, nonce: "2" });
		expect(await game.next()).toMatchObject({ message: { cmd: "SET_ACTIVITY", evt: null, nonce: "2" } });
		await until("the game's next activity", () => shown.all[0]?.state === "Playing");
	});

	test("keeps a game's activity through Discord's restart, though the game doesn't send it again", async () => {
		const paths = testPaths();
		const shown = new Shown();
		const said: string[] = [];
		const first = fakeDiscord(paths.discord[0]);
		await holdPipe(paths, shown, { discordCheckMs: 20, log: (line) => said.push(line) }).start();
		const game = await Game.connect(paths.duvet);
		game.send(Op.Handshake, handshake);
		await game.next();
		game.send(Op.Frame, { cmd: "SET_ACTIVITY", args: { activity: osuIdle }, nonce: "1" });
		await game.next();
		await until("the activity", () => shown.all.length === 1);
		first.stop();
		await until("Duvet answering the game", () => said.some((line) => line.includes("answered here")));
		// Discord back, on another of its pipes: the game's connection is ended, to reconnect through it.
		fakeDiscord(paths.discord[1]);
		await until("the connection ended", () => game.closed);
		const again = await Game.connect(paths.duvet);
		again.send(Op.Handshake, handshake);
		expect(await again.next()).toMatchObject({ message: { data: { user: { username: "real" } } } });
		// As osu! does, it sends no activity until it changes: Duvet shows the one it had.
		await until("the activity carried over", () => shown.all.length === 1);
		expect(shown.all).toEqual([osuShown]);
	});

	test("ends a relayed connection whose Discord quits before answering its handshake", async () => {
		const paths = testPaths();
		const discord = fakeDiscord(paths.discord[0], () => null);
		await holdPipe(paths, new Shown()).start();
		const game = await Game.connect(paths.duvet);
		game.send(Op.Handshake, handshake);
		await until("Discord got the handshake", () => discord.got().length > 0);
		discord.stop();
		await until("the connection ended", () => game.closed);
	});

	test("ends a relayed connection whose Discord quits in the middle of a frame", async () => {
		const paths = testPaths();
		const discord = fakeDiscord(paths.discord[0], (frame) =>
			frame.op === Op.Handshake ? discordReady : discordReady.subarray(0, 5),
		);
		await holdPipe(paths, new Shown()).start();
		const game = await Game.connect(paths.duvet);
		game.send(Op.Handshake, handshake);
		await game.next();
		game.send(Op.Frame, { cmd: "SET_ACTIVITY", args: { activity: osuIdle }, nonce: "1" });
		await until("half of Discord's answer relayed", () => game.received === discordReady.length + 5);
		discord.stop();
		await until("the connection ended", () => game.closed);
	});

	test("ends the connections it answered once Discord comes up, so they reconnect through it", async () => {
		const paths = testPaths();
		const shown = new Shown();
		await holdPipe(paths, shown, { discordCheckMs: 20 }).start();
		const game = await Game.connect(paths.duvet);
		game.send(Op.Handshake, handshake);
		expect(await game.next()).toMatchObject({ message: { data: { user: { username: "duvet" } } } });
		game.send(Op.Frame, { cmd: "SET_ACTIVITY", args: { activity: osuIdle }, nonce: "1" });
		await until("the activity", () => shown.all.length === 1);
		fakeDiscord(paths.discord[0]);
		await until("the connection ended", () => game.closed);
		expect(shown.all).toEqual([]);
		const again = await Game.connect(paths.duvet);
		again.send(Op.Handshake, handshake);
		expect(await again.next()).toMatchObject({ message: { data: { user: { username: "real" } } } });
		// Duvet shows the activity its last connection had, which the game doesn't send again.
		await until("the activity carried over", () => shown.all.length === 1);
		expect(shown.all).toEqual([osuShown]);
	});
});

describe("DiscordPipe's switch", () => {
	test("lets go of the pipe: its connections end with their activities, and it can be taken again", async () => {
		const paths = testPaths();
		const shown = new Shown();
		const pipe = holdPipe(paths, shown);
		await pipe.start();
		const game = await Game.connect(paths.duvet);
		game.send(Op.Handshake, handshake);
		await game.next();
		game.send(Op.Frame, { cmd: "SET_ACTIVITY", args: { activity: osuIdle }, nonce: "1" });
		await until("the activity", () => shown.all.length === 1);
		pipe.stop();
		expect(pipe.listening).toBe(false);
		expect(shown.all).toEqual([]);
		await until("the game's connection ended", () => game.closed);
		if (socketFile) expect(existsSync(paths.duvet)).toBe(false);
		expect(await freeToListen(paths.duvet, socketFile)).toBe(true);
		// Turned on again at once: taken once its connections are gone, with nothing of theirs.
		expect(await pipe.start()).toBe(true);
		const back = await Game.connect(paths.duvet);
		back.send(Op.Handshake, handshake);
		expect(await back.next()).toMatchObject({ message: { evt: "READY" } });
		await Bun.sleep(30);
		expect(shown.all).toEqual([]);
	});

	test("tries a taken pipe again on one timer, however often it's started meanwhile", async () => {
		const paths = testPaths();
		let checks = 0;
		const other = Bun.listen({
			unix: paths.duvet,
			socket: {
				open: () => {
					checks++;
				},
				data() {},
			},
		});
		cleanups.push(() => other.stop(true));
		const pipe = holdPipe(paths, new Shown(), { retryMs: 100 });
		// Started again before each try, as each page load does.
		for (let i = 0; i < 4; i++) {
			expect(await pipe.start()).toBe(false);
			await Bun.sleep(25);
		}
		const before = checks;
		const start = performance.now();
		await Bun.sleep(600);
		const elapsed = performance.now() - start;
		// One check every 100 ms at most: the four starts make one chain of tries, not four.
		expect(checks - before).toBeLessThanOrEqual(Math.ceil(elapsed / 100) + 1);
	});

	test.skipIf(socketFile)(
		"takes a Windows pipe whose listener stopped with a connection still open for one that's held",
		async () => {
			// What Duvet's own pipe is as it's let go of, and Discord's as it quits: Bun 1.3.9 dies listening there.
			const path = testPaths().duvet;
			const accepted = new Set<Socket>();
			const server = Bun.listen({
				unix: path,
				socket: {
					open: (socket) => {
						accepted.add(socket);
					},
					close: (socket) => {
						accepted.delete(socket);
					},
					data() {},
				},
			});
			let clientClosed = false;
			await Bun.connect({
				unix: path,
				socket: {
					data() {},
					close: () => {
						clientClosed = true;
					},
				},
			});
			await until("the connection accepted", () => accepted.size === 1);
			server.stop();
			expect(await freeToListen(path, false)).toBe(false);
			for (const socket of accepted) socket.terminate();
			await until("the connection closed", () => accepted.size === 0 && clientClosed);
			expect(await freeToListen(path, false)).toBe(true);
		},
	);

	test("leaves a pipe something else holds, and takes it once it's free", async () => {
		const paths = testPaths();
		const other = Bun.listen({ unix: paths.duvet, socket: { data() {} } });
		const said: string[] = [];
		const pipe = holdPipe(paths, new Shown(), { retryMs: 20, log: (line) => said.push(line) });
		expect(await pipe.start()).toBe(false);
		expect(said).toEqual([`${paths.duvet} is taken (Discord, or another Duvet): trying again every 0.02 s`]);
		other.stop(true);
		await until("the pipe taken", () => pipe.listening);
		expect(said.at(-1)).toBe(`listening on ${paths.duvet}`);
	});

	test("takes nothing once turned off while it was looking", async () => {
		const paths = testPaths();
		const pipe = holdPipe(paths, new Shown());
		const started = pipe.start();
		pipe.stop();
		expect(await started).toBe(false);
		expect(pipe.listening).toBe(false);
		expect(await freeToListen(paths.duvet, socketFile)).toBe(true);
	});
});
