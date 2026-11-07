import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import api from "$lib/api/api";
import { logout } from "$lib/api/auth";

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
