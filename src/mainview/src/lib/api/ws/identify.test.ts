import { describe, expect, test } from "bun:test";
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
		expect(identifyData("access", null)).toEqual({ token: "access", platform: "web" });
		expect(inDesktopApp(() => identifyData("access", null))).toEqual({ token: "access", platform: "desktop" });
		expect(inDesktopApp(() => identifyData("access", { lastSeq: 42, sessionToken: "session" }))).toEqual({
			token: "access",
			platform: "desktop",
			last_seq: 42,
			session_token: "session",
		});
	});
});

test("an identify resumes with the last event it got, and the session's token once it has one", () => {
	expect(identifyData("access", { lastSeq: 7, sessionToken: null })).toEqual({
		token: "access",
		platform: "web",
		last_seq: 7,
	});
	expect(identifyData(null, null)).toEqual({ token: null, platform: "web" });
});
