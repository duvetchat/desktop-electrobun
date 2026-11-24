import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import api, { FetchError, NetworkError } from "$lib/api/api";
import { logIn, logout, resetPassword, signIn, verifyEmail } from "$lib/api/auth";

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
		// A request that failed on the network.
		posted.mockRejectedValue(new NetworkError(new TypeError("Load failed")));
		expect(await message(logIn({ email: "a@b.c", password: "p" }))).toBe("Couldn't sign you in. Try again.");
		expect(await message(verifyEmail("t"))).toBe("Verification failed");
		expect(await message(signIn({ username: "u", alias: null, password: "p", email: "e@x.test" }))).toBe(
			"Couldn't create your account: Failed to fetch",
		);
		posted.mockRejectedValue(refused("internal server error", 500));
		expect(await message(logIn({ email: "a@b.c", password: "p" }))).toBe("Couldn't sign you in. Try again.");
	});
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
});
