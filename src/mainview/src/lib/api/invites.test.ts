import { describe, expect, mock, test } from "bun:test";

// The API client reads the session from the browser's storage, which tests don't have.
mock.module("$app/environment", () => ({ browser: false }));
Object.assign(globalThis, { VITE_API_URL: "https://api.test", VITE_WS_URL: "", VITE_DOMAIN_TARGET_ENV: "duvet" });
Object.assign(globalThis, { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
const { getInvite, joinInvite } = await import("$lib/api/invites");

// The requests the client sends, by URL; each answers as the API does for an invite it knows.
const sent: string[] = [];
globalThis.fetch = (async (input: string | URL | Request) => {
	sent.push(input instanceof Request ? input.url : input.toString());
	return new Response(JSON.stringify({ code: "x" }), { headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

describe("an invite's code", () => {
	test("goes into the path as one segment, whatever it holds", async () => {
		sent.length = 0;
		await getInvite("../users/@me?x=1#y");
		await joinInvite("..\\..\\spaces");
		expect(sent).toEqual([
			"https://api.test/api/invites/..%2Fusers%2F%40me%3Fx%3D1%23y",
			"https://api.test/api/invites/..%5C..%5Cspaces/join",
		]);
	});

	test("that can't be a segment is no invite: nothing is sent, and it reads as the API's answer", async () => {
		sent.length = 0;
		for (const code of [".", "..", ""]) {
			await expect(getInvite(code)).rejects.toThrow("invite link not found or has expired");
			await expect(joinInvite(code)).rejects.toThrow("invite link not found or has expired");
		}
		expect(sent).toEqual([]);
	});
});
