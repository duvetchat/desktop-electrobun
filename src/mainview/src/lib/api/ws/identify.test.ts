import { beforeEach, describe, expect, test } from "bun:test";
import { duvetClient, keepDevice, keepUser } from "$lib/e2e/client";
import { clientPlatform, identifyData } from "./identify";

/** Runs f as in the packaged app's window, which Electrobun's preload marks with its window's ID. */
function inDesktopApp<T>(f: () => T): T {
	Object.assign(globalThis, { window: { __electrobunWindowId: 1 } });
	try {
		return f();
	} finally {
		Reflect.deleteProperty(globalThis, "window");
	}
}

/** What a browser's identify says the client is: the web, at the app's version. */
const WEB = `web/${VITE_APP_VERSION}`;

beforeEach(() => localStorage.clear());

// The platform tells others where the user is connected (their client status): the gateway shows a phone for someone
// only on mobile, and reads an identify without one as desktop (#82).
describe("the platform an identify sends", () => {
	test("is desktop in the packaged app, and web in a browser", () => {
		expect(inDesktopApp(clientPlatform)).toBe("desktop");
		expect(clientPlatform()).toBe("web");
		Object.assign(globalThis, { window: {} });
		try {
			expect(clientPlatform()).toBe("web");
		} finally {
			Reflect.deleteProperty(globalThis, "window");
		}
	});

	test("goes with every identify, a new session's and a resume's", () => {
		const desktop = inDesktopApp(duvetClient);
		expect(desktop).toStartWith("desktop-");
		expect(identifyData("access", null)).toEqual({ token: "access", platform: "web", client: WEB });
		expect(inDesktopApp(() => identifyData("access", null))).toEqual({
			token: "access",
			platform: "desktop",
			client: desktop,
		});
		expect(inDesktopApp(() => identifyData("access", { lastSeq: 42, sessionToken: "session" }))).toEqual({
			token: "access",
			platform: "desktop",
			client: desktop,
			last_seq: 42,
			session_token: "session",
		});
	});
});

test("an identify resumes with the last event it got, and the session's token once it has one", () => {
	expect(identifyData("access", { lastSeq: 7, sessionToken: null })).toEqual({
		token: "access",
		platform: "web",
		client: WEB,
		last_seq: 7,
	});
	expect(identifyData(null, null)).toEqual({ token: null, platform: "web", client: WEB });
});

// The gateway hands end-to-end encryption's events only to a client that has it, and a device's events only to the
// connections identified with that device (PLAN-E2E-API.md, its events): the app connects before its core opens, so the
// device comes from what the page kept (PLAN-E2E-CLIENTES.md, Task 10 and Ruling 30).
describe("the device and the client", () => {
	const ANA = "0193a4b2-0000-7000-8000-00000000a0a0";
	const BO = "0193a4b2-0000-7000-8000-00000000b0b0";
	const DEVICE = "0193a4b2-0000-7000-8000-0000000d0001";

	test("an identify carries its device and its client", () => {
		keepUser(ANA);
		keepDevice(ANA, DEVICE);
		expect(identifyData("access", null)).toEqual({ token: "access", platform: "web", client: WEB, device_id: DEVICE });
		expect(identifyData("access", { lastSeq: 7, sessionToken: "session" })).toEqual({
			token: "access",
			platform: "web",
			client: WEB,
			device_id: DEVICE,
			last_seq: 7,
			session_token: "session",
		});
	});

	test("an identify names no device before its user registered one, nor another user's", () => {
		expect(identifyData("access", null)).not.toHaveProperty("device_id");
		keepDevice(ANA, DEVICE);
		expect(identifyData("access", null)).not.toHaveProperty("device_id");
		keepUser(BO);
		expect(identifyData("access", null)).not.toHaveProperty("device_id");
		keepUser(ANA);
		expect(identifyData("access", null)).toHaveProperty("device_id", DEVICE);
	});
});
