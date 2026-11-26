import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { getInvite, joinInvite } from "$lib/api/invites";

// The requests the client sends, by URL; each answers as the API does for an invite it knows. Only while a test of this
// file runs: the next test, and the preload's check once the file is done, find the real fetch (#166).
const sent: string[] = [];
let fetched: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
beforeEach(() => {
	fetched = spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request) => {
		sent.push(input instanceof Request ? input.url : input.toString());
		return new Response(JSON.stringify({ code: "x" }), { headers: { "Content-Type": "application/json" } });
	}) as typeof fetch);
});
afterEach(() => fetched.mockRestore());

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
			await expect(getInvite(code)).rejects.toThrow("This invite link doesn't exist or has expired");
			await expect(joinInvite(code)).rejects.toThrow("This invite link doesn't exist or has expired");
		}
		expect(sent).toEqual([]);
	});
});
