import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";

// What Electrobun 1.15.1 hands a webview's documents of the main window's RPC, as patches/electrobun@1.15.1.patch has
// it: a player's frame (EmbedPlayer.svelte) gets the trusted preload too, as WebView2 runs it in every frame, and with
// the RPC's port and key it could ask what the page asks, the end-to-end encryption's boundary included (#556).

/** Electrobun's Bun API, as the app imports it. */
const bunApi = dirname(Bun.resolveSync("electrobun/bun", import.meta.dir));

/** The preload native.ts writes before Electrobun's own in a trusted webview, for a webview of the test's. */
function trustedPreload(): string {
	const source = readFileSync(join(bunApi, "proc/native.ts"), "utf8");
	const written = [...source.matchAll(/dynamicPreload = `([^`]*)`;/g)].map((match) => match[1] ?? "");
	const trusted = written.filter((preload) => preload.includes("__electrobunBunBridge"));
	expect(trusted).toHaveLength(1);
	const values: Record<string, string> = { id: "7", windowId: "1", rpcPort: "50123", secretKey: "1,2,3" };
	const preload = (trusted[0] ?? "").replace(/\$\{(\w+)\}/g, (_, name: string) => values[name] ?? "");
	expect(preload).not.toContain("${");
	return preload;
}

/** What the preload leaves on a window, the top one or a frame in it. */
function windowAfter(preload: string, top: boolean): Record<string, unknown> {
	const window: Record<string, unknown> = {};
	window.top = top ? window : {};
	runInNewContext(preload, { window });
	return window;
}

test("the RPC's port and key reach the top window alone, never a frame in it", () => {
	const preload = trustedPreload();
	const top = windowAfter(preload, true);
	expect(top.__electrobunRpcSocketPort).toBe(50123);
	expect(top.__electrobunSecretKeyBytes).toEqual([1, 2, 3]);

	const frame = windowAfter(preload, false);
	expect(frame).not.toHaveProperty("__electrobunRpcSocketPort");
	expect(frame).not.toHaveProperty("__electrobunSecretKeyBytes");
	// What Electrobun's events need of a frame stays.
	expect(frame.__electrobunWebviewId).toBe(7);
});

// #559: Electrobun's RPC server, its socket.ts as the app runs it, in a Bun of its own with a webview of the test's
// (BrowserView, which would need the native library, stands in) and on 127.0.0.1 alone, as the test listens nowhere
// else. A client that doesn't have the window's key connects after the page.
test("only a socket that proved the window's key gets Bun's messages for it", () => {
	const script = `
		import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
		Bun.plugin({
			setup(build) {
				build.onLoad({ filter: /[\\\\/]core[\\\\/]BrowserView\\.ts$/ }, () => ({
					loader: "js",
					contents: "export const BrowserView = { getById: (id) => globalThis.views[id] };",
				}));
			},
		});
		const serve = Bun.serve;
		Bun.serve = (options) => serve({ ...options, hostname: "127.0.0.1" });
		const key = new Uint8Array(randomBytes(32));
		const handled = [];
		globalThis.views = { 1: { secretKey: key, rpcHandler: (message) => handled.push(message) } };
		const { rpcPort, sendMessageToWebviewViaSocket } = await import(${JSON.stringify(join(bunApi, "core/Socket.ts"))});
		const seal = (value) => {
			const iv = randomBytes(12);
			const cipher = createCipheriv("aes-256-gcm", key, iv);
			const sealed = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
			const tag = cipher.getAuthTag();
			return JSON.stringify({ encryptedData: sealed.toString("base64"), iv: iv.toString("base64"), tag: tag.toString("base64") });
		};
		const open = (text) => {
			const packet = JSON.parse(text);
			const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(packet.iv, "base64"));
			decipher.setAuthTag(Buffer.from(packet.tag, "base64"));
			return JSON.parse(Buffer.concat([decipher.update(Buffer.from(packet.encryptedData, "base64")), decipher.final()]).toString());
		};
		const client = async () => {
			const got = [];
			const socket = new WebSocket("ws://127.0.0.1:" + rpcPort + "/socket?webviewId=1");
			socket.addEventListener("message", (event) => got.push(String(event.data)));
			await new Promise((opened) => socket.addEventListener("open", opened, { once: true }));
			return { socket, got };
		};
		const page = await client();
		page.socket.send(seal({ from: "the page" }));
		for (let n = 0; n < 100 && handled.length === 0; n++) await Bun.sleep(10);
		const other = await client();
		other.socket.send("nothing the key opens");
		await Bun.sleep(50);
		const first = sendMessageToWebviewViaSocket(1, { to: "the page" });
		await Bun.sleep(100);
		other.socket.close();
		await Bun.sleep(50);
		const after = sendMessageToWebviewViaSocket(1, { to: "the page, the other gone" });
		await Bun.sleep(100);
		console.log(JSON.stringify({ handled, first, after, page: page.got.map(open), other: other.got.length }));
		process.exit(0);
	`;
	const run = Bun.spawnSync([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe", timeout: 30_000 });
	const result = JSON.parse(run.stdout.toString().trim().split("\n").at(-1) ?? "null");
	expect(result).toEqual({
		handled: [{ from: "the page" }],
		first: true,
		// Its close leaves the page's socket the window's.
		after: true,
		page: [{ to: "the page" }, { to: "the page, the other gone" }],
		other: 0,
	});
});
