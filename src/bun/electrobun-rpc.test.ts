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
