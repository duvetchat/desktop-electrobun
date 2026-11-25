import { afterEach, beforeEach, expect, jest, spyOn, test } from "bun:test";
import { openGateway } from "$lib/api/ws/test-gateway";
import { keepDevice, keepUser } from "$lib/e2e/client";

// The device a connection names in its identify (PLAN-E2E-CLIENTES.md, Task 10 and Ruling 30): the gateway hands a
// device's events only to the connections that identified with it, and a resumed session keeps the device of its first
// identify. So a session that went without the device the page now has for its user starts again, once, as a new one.
// Each case starts from empty storage with the session's token, and from a session of its own.

/** test-gateway.ts's socket, as the connection opens each. */
interface Socket {
	readyState: number;
	sent: string[];
	onopen: (() => void) | null;
	onmessage: ((event: { data: string }) => void) | null;
	onclose: (() => void) | null;
}
const OPEN = 1;
const CLOSED = 3;
const current = (): Socket => Reflect.get(globalThis.WebSocket, "last");
const identifies = (socket: Socket) =>
	socket.sent.map((raw) => JSON.parse(raw)).flatMap((frame) => (frame.type === "identify" ? [frame.data] : []));
let seq = 0;
function receive(socket: Socket, type: string, data: unknown) {
	socket.onmessage?.({ data: JSON.stringify({ event: "payload", op: 1, d: { type, data }, s: ++seq }) });
}

const ME = "0193a4b2-0000-7000-8000-00000000a0a0";
const OTHER = "0193a4b2-0000-7000-8000-00000000b0b0";
const DEVICE = "0193a4b2-0000-7000-8000-0000000d0001";
const CLIENT = `web/${VITE_APP_VERSION}`;
/** A new session's identify, with the device it names or none. */
const fresh = (device?: string) => ({
	token: "access",
	platform: "web",
	client: CLIENT,
	...(device ? { device_id: device } : {}),
});
const ready = (socket: Socket) =>
	receive(socket, "READY", { user: { id: ME, username: "me" }, sessionToken: "session", guild_ids: [] });

let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
beforeEach(() => {
	localStorage.clear();
	localStorage.setItem("duvet_session_token", "access");
	fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (_input: string | URL | Request) =>
		Response.json([])) as typeof fetch);
});
afterEach(() => fetchSpy.mockRestore());

/** The closed socket's end reaches the connection, which makes its next socket once its wait is over; the test opens it. */
function reconnect(closed: Socket): Socket {
	closed.onclose?.();
	jest.advanceTimersByTime(3000);
	const next = current();
	expect(next).not.toBe(closed);
	next.onopen?.();
	return next;
}

test("a device's first registration opens the connection once more, with a new session that names it", async () => {
	const { deviceRegistered } = await import("$lib/api/ws/connection");
	const gateway = await openGateway();
	jest.useFakeTimers();
	try {
		const first = current();
		expect(identifies(first)).toEqual([fresh()]);
		ready(first);
		expect(first.readyState).toBe(OPEN);

		deviceRegistered(ME, DEVICE);
		expect(first.readyState).toBe(CLOSED);
		// A new session, not a resume of the one without the device, whose device the gateway would keep.
		const second = reconnect(first);
		expect(identifies(second)).toEqual([fresh(DEVICE)]);
		ready(second);
		expect(second.readyState).toBe(OPEN);

		// Once: the session names the device now, and binding a session to it again changes nothing.
		deviceRegistered(ME, DEVICE);
		expect(second.readyState).toBe(OPEN);
	} finally {
		jest.useRealTimers();
		gateway.close();
	}
});

// Another account signed in on this installation before: the page's first identify names the device of the user it
// last connected as, and READY says whose session it is.
test("a session READY says is another user's, who has a device here, starts again as theirs, once", async () => {
	keepUser(OTHER);
	keepDevice(ME, DEVICE);
	const gateway = await openGateway();
	jest.useFakeTimers();
	try {
		const first = current();
		expect(identifies(first)).toEqual([fresh()]);
		ready(first);
		expect(first.readyState).toBe(CLOSED);
		const second = reconnect(first);
		expect(identifies(second)).toEqual([fresh(DEVICE)]);
		ready(second);
		expect(second.readyState).toBe(OPEN);
	} finally {
		jest.useRealTimers();
		gateway.close();
	}
});

// The page couldn't keep whose session it was (storage refused it): the next identify would name the same device, so
// opening again would only open again, without end, though READY's user has a device here.
test("a session never starts again for a device its next identify wouldn't name", async () => {
	keepUser(OTHER);
	keepDevice(ME, DEVICE);
	const write = localStorage.setItem.bind(localStorage);
	const setItem = spyOn(localStorage, "setItem").mockImplementation((key: string, value: string) => {
		if (key === "duvet.e2e.user") throw new Error("QuotaExceededError");
		write(key, value);
	});
	const logged = spyOn(console, "error").mockImplementation(() => {});
	const gateway = await openGateway();
	try {
		const first = current();
		ready(first);
		expect(first.readyState).toBe(OPEN);
		expect(logged).toHaveBeenCalled();
	} finally {
		setItem.mockRestore();
		logged.mockRestore();
		gateway.close();
	}
});

// The same installation signed in again: its identify names the device the page kept, and the engine binding the new
// session to it, before READY or after, opens nothing again. A session without the device comes first, so the one that
// names it follows a session that didn't.
test("binding a session to the device its identify named opens nothing again", async () => {
	keepUser(ME);
	const before = await openGateway();
	ready(current());
	before.close();

	keepDevice(ME, DEVICE);
	const { deviceRegistered } = await import("$lib/api/ws/connection");
	const gateway = await openGateway();
	try {
		const first = current();
		expect(identifies(first)).toEqual([fresh(DEVICE)]);
		deviceRegistered(ME, DEVICE);
		expect(first.readyState).toBe(OPEN);
		ready(first);
		deviceRegistered(ME, DEVICE);
		expect(first.readyState).toBe(OPEN);
	} finally {
		gateway.close();
	}
});

// The web's tabs share storage: the lead registers the device, and another tab's session, without it, resumes naming it.
// The gateway keeps a resumed session's device, so that tab's engine, once it leads, starts a new session that names it.
test("a resume that names the device leaves its session without it, and the device's registration starts a new one", async () => {
	const { deviceRegistered } = await import("$lib/api/ws/connection");
	const gateway = await openGateway();
	jest.useFakeTimers();
	try {
		const first = current();
		expect(identifies(first)).toEqual([fresh()]);
		ready(first);
		receive(first, "KEY_PACKAGES_LOW", { device_id: DEVICE, remaining: 3 });

		// The other tab registers the device; this one's socket drops and resumes, its identify naming it.
		keepDevice(ME, DEVICE);
		const second = reconnect(first);
		expect(identifies(second)).toEqual([{ ...fresh(DEVICE), last_seq: seq, session_token: "session" }]);
		second.onmessage?.({ data: JSON.stringify({ event: "heartbeat_ack" }) });

		deviceRegistered(ME, DEVICE);
		expect(second.readyState).toBe(CLOSED);
		const third = reconnect(second);
		expect(identifies(third)).toEqual([fresh(DEVICE)]);
		ready(third);
		expect(third.readyState).toBe(OPEN);
	} finally {
		jest.useRealTimers();
		gateway.close();
	}
});
