import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getHostURL, getWSHostURL } from "$lib/common/common";

// The page's head script (app.html) starts the gateway's socket as the page loads, and the connection takes it on,
// rather than opening it once the app's JavaScript has run (#291).
// The test gateway's stand-in WebSocket keeps what it's sent and the last one made.
await import("$lib/api/ws/test-gateway");
const { createWebSocketConnection, getStreamURL } = await import("$lib/api/ws/connection");

function earlySocket(url: string, readyState: number = WebSocket.OPEN): WebSocket {
	const socket = new WebSocket(url);
	Object.assign(socket, { url, readyState });
	Reflect.set(globalThis, "__duvetEarlySocket", socket);
	return socket;
}
const lastMade = (): unknown => Reflect.get(WebSocket, "last");
// The types of the messages a stand-in was sent, oldest first.
function types(socket: WebSocket): string[] {
	const sent: unknown = Reflect.get(socket, "sent");
	if (!Array.isArray(sent)) return [];
	return sent.map((raw) => {
		const message: unknown = JSON.parse(String(raw));
		return typeof message === "object" && message !== null && "type" in message ? String(message.type) : "";
	});
}

let connection: ReturnType<typeof createWebSocketConnection> | null = null;

beforeEach(() => localStorage.setItem("duvet_session_token", "access"));
afterEach(() => {
	connection?.destroy();
	connection = null;
	localStorage.clear();
	Reflect.deleteProperty(globalThis, "__duvetEarlySocket");
});

describe("the socket the page's head script started", () => {
	test("is taken on when it's open, for the same address: no other is opened, and the identify goes on it", () => {
		const early = earlySocket(getStreamURL());
		connection = createWebSocketConnection();
		expect(lastMade()).toBe(early);
		expect(types(early)).toEqual(["identify"]);
		expect(Reflect.get(globalThis, "__duvetEarlySocket")).toBeUndefined();
	});

	test("is taken on while it's opening, and identifies once it opens", () => {
		const early = earlySocket(getStreamURL(), WebSocket.CONNECTING);
		connection = createWebSocketConnection();
		expect(lastMade()).toBe(early);
		expect(types(early)).toEqual([]);
		early.onopen?.call(early, new Event("open"));
		expect(types(early)).toEqual(["identify"]);
	});

	test("is closed when it's for another address, and the connection opens its own", () => {
		const early = earlySocket("wss://elsewhere.example/gateway?token=access");
		connection = createWebSocketConnection();
		expect(early.readyState).toBe(WebSocket.CLOSED);
		expect(lastMade()).not.toBe(early);
	});
});

test("the connection notes the addresses the next start's head script opens", () => {
	connection = createWebSocketConnection();
	expect(JSON.parse(localStorage.getItem("duvet.start.v1") ?? "null")).toEqual({
		gateway: `${getWSHostURL()}/gateway`,
		api: getHostURL(),
	});
});
