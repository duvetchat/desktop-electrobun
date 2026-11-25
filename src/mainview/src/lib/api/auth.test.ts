import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import api, { FetchError } from "$lib/api/api";
import { logIn, logout, onSignOut, resetPassword, signIn, signOutLimits, verifyEmail } from "$lib/api/auth";
import { identifyData } from "$lib/api/ws/identify";
import { keepDevice, keepUser, lastUser } from "$lib/e2e/client";

// Where the page goes: there's no window outside a browser.
const location = { href: "views://mainview/app.html" };
let posted: ReturnType<typeof spyOn<typeof api, "post">>;

beforeEach(() => {
	location.href = "views://mainview/app.html";
	Object.defineProperty(globalThis, "window", { value: { location }, configurable: true });
	localStorage.setItem("duvet_session_token", "access");
	localStorage.setItem("duvet_refresh_token", "session");
	posted = spyOn(api, "post").mockResolvedValue({ data: null, status: 204, statusText: "", headers: new Headers() });
});

afterEach(() => {
	posted.mockRestore();
	Reflect.deleteProperty(globalThis, "window");
});

// What the sign-in pages show is these errors' messages, as they come.
describe("a refusal", () => {
	const refused = (error: string, status = 400) =>
		new FetchError(
			`Request failed with status ${status}`,
			{},
			{ data: { error }, status, statusText: "", headers: new Headers() },
		);
	const message = (call: Promise<unknown>) =>
		call.then(
			() => "no error",
			(err: unknown) => (err instanceof Error ? err.message : String(err)),
		);

	test("says the API's reason in the app's words, never its validator's", async () => {
		posted.mockRejectedValue(
			refused(
				"Key: 'AuthLogInPayload.Email' Error:Field validation for 'Email' failed on the 'required' tag\n" +
					"Key: 'AuthLogInPayload.Password' Error:Field validation for 'Password' failed on the 'required' tag",
			),
		);
		expect(await message(logIn({ email: "", password: "" }))).toBe("Enter your email and password");
		posted.mockRejectedValue(refused("invalid email or password", 401));
		expect(await message(logIn({ email: "a@b.c", password: "wrong" }))).toBe("Wrong email or password");
		posted.mockRejectedValue(refused("that username is taken", 409));
		expect(await message(signIn({ username: "u", alias: null, password: "p", email: "e@x.test" }))).toBe(
			"That username is taken",
		);
		posted.mockRejectedValue(refused("invalid or expired token"));
		expect(await message(verifyEmail("t"))).toBe("This link is invalid or has expired");
		expect(await message(resetPassword("t", "12345678"))).toBe("This link is invalid or has expired");
	});

	test("says what the page was doing when the API gave no reason", async () => {
		posted.mockRejectedValue(new Error("Failed to fetch"));
		expect(await message(logIn({ email: "a@b.c", password: "p" }))).toBe("Couldn't sign you in. Try again.");
		expect(await message(verifyEmail("t"))).toBe("Verification failed");
		expect(await message(signIn({ username: "u", alias: null, password: "p", email: "e@x.test" }))).toBe(
			"Couldn't create your account: Failed to fetch",
		);
		posted.mockRejectedValue(refused("internal server error", 500));
		expect(await message(logIn({ email: "a@b.c", password: "p" }))).toBe("Couldn't sign you in. Try again.");
	});
});

// An identify names the device of the user the page last connected as, until READY says whose session it is
// (lib/e2e/client.ts): a sign-in may be another account's, so the identify after it names no device of the one before.
test("a sign-in forgets whose session the page had, so the identify after it names none of their devices", async () => {
	const other = "0193a4b2-0000-7000-8000-00000000b0b0";
	keepUser(other);
	keepDevice(other, "0193a4b2-0000-7000-8000-0000000d0001");
	posted.mockResolvedValue({
		data: { token: "access-2", session_token: "session-2", device_challenge: "Y2hhbGxlbmdl" },
		status: 200,
		statusText: "",
		headers: new Headers(),
	});
	await logIn({ email: "a@b.c", password: "p" });
	expect(lastUser()).toBeNull();
	expect(identifyData("access-2", null)).not.toHaveProperty("device_id");
});

describe("logout", () => {
	// On Windows Electrobun has no file for views://mainview/ ("/"): the window stays on the app until the gateway's minute
	// sweep closes the connection.
	test("goes to the sign-in page, a page the packaged app has", async () => {
		await logout();
		expect(posted).toHaveBeenCalledWith("/api/auth/logout");
		expect(location.href).toBe("/sign-in.html");
		expect(localStorage.getItem("duvet_session_token")).toBeNull();
		expect(localStorage.getItem("duvet_refresh_token")).toBeNull();
	});

	test("goes there too when the API doesn't answer", async () => {
		posted.mockRejectedValue(new Error("no answer"));
		await logout();
		expect(location.href).toBe("/sign-in.html");
		expect(localStorage.getItem("duvet_session_token")).toBeNull();
	});

	// Decision 13: signing out only ends the session. The encryption engine closes its core, whose database stays.
	test("closes the encryption engine's core first, and goes even when it can't", async () => {
		const steps: string[] = [];
		const stop = onSignOut(async () => {
			steps.push(`closed at ${location.href}`);
			throw new Error("the core didn't answer");
		});
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			await logout();
		} finally {
			stop();
			logged.mockRestore();
		}
		expect(steps).toEqual(["closed at views://mainview/app.html"]);
		expect(location.href).toBe("/sign-in.html");
		// Once taken off, nothing closes at the next sign-out.
		await logout();
		expect(steps).toHaveLength(1);
	});

	// A core call that never answers mustn't keep anyone signed in.
	test("waits a few seconds at most for the engine's core to close", async () => {
		expect(signOutLimits.closeMs).toBe(3_000);
		const { closeMs } = signOutLimits;
		signOutLimits.closeMs = 20;
		const stop = onSignOut(() => new Promise<void>(() => {}));
		try {
			await logout();
		} finally {
			stop();
			signOutLimits.closeMs = closeMs;
		}
		expect(location.href).toBe("/sign-in.html");
		expect(localStorage.getItem("duvet_session_token")).toBeNull();
	});
});
