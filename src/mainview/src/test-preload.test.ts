import { describe, expect, spyOn, test } from "bun:test";

// What src/test-preload.ts gives every test file, the same alone or in the full run: each file runs in a global object
// and a module registry of its own (`bun test --isolate`), so none sees what another left behind (#176).
describe("a test file's environment", () => {
	test("has the constants Vite defines, with the API at an address that never resolves", () => {
		expect([VITE_API_URL, VITE_WS_URL, VITE_DOMAIN_TARGET_ENV]).toEqual(["https://api.test", "", "duvet"]);
	});

	test("has SvelteKit's environment, outside a browser", async () => {
		expect((await import("$app/environment")).browser).toBe(false);
	});

	test("has the webview's storage, empty", () => {
		expect(localStorage.length).toBe(0);
		localStorage.setItem("duvet.test", "kept");
		expect(localStorage.getItem("duvet.test")).toBe("kept");
		localStorage.removeItem("duvet.test");
		expect(localStorage.getItem("duvet.test")).toBeNull();
	});

	test("lets the API client send a request, with no session", async () => {
		const fetched = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({}));
		try {
			const { default: api } = await import("$lib/api/api");
			await api.get("/api/users/@me");
			const [url, init] = fetched.mock.calls[0]!;
			expect(url).toBe("https://api.test/api/users/@me");
			expect(new Headers(init?.headers).has("Authorization")).toBe(false);
		} finally {
			fetched.mockRestore();
		}
	});
});
