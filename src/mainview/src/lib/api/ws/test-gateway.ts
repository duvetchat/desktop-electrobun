// For tests of what the app does with the gateway's events: the real connection and stores, on a socket of the test's.
// The stores' .svelte.ts modules use $state, which only Svelte's compiler knows: here it's the value itself, and a test
// reads what it holds as it is. Once this module has run, a test can import them (await import(), as a static import
// would load them before).

class FakeSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;
	static last: FakeSocket;

	readyState = FakeSocket.OPEN;
	sent: string[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;

	constructor() {
		FakeSocket.last = this;
	}

	send(raw: string) {
		this.sent.push(raw);
	}

	close() {
		this.readyState = FakeSocket.CLOSED;
	}
}

Object.assign(globalThis, { $state: <T>(value: T) => value, WebSocket: FakeSocket });

export interface TestGateway {
	/** The gateway sends an event, numbered as it numbers them. */
	receive(type: string, data: unknown): void;
	/** What the client has sent of a type, oldest first. */
	sent(type: string): unknown[];
	/** Ends the connection, for the next test's. */
	close(): void;
}

/** Opens the app's connection to the gateway. Its identify has gone out, and its READY hasn't come. */
export async function openGateway(): Promise<TestGateway> {
	const { createWebSocketConnection } = await import("$lib/api/ws/connection");
	const connection = createWebSocketConnection();
	const socket = FakeSocket.last;
	socket.onopen?.();
	let seq = 0;
	return {
		receive(type, data) {
			const frame = { event: "payload", op: 1, d: { type, data }, s: ++seq };
			socket.onmessage?.({ data: JSON.stringify(frame) });
		},
		sent(type) {
			return socket.sent.map((raw) => JSON.parse(raw)).flatMap((f) => (f.type === type ? [f.data] : []));
		},
		close() {
			connection.destroy();
		},
	};
}
