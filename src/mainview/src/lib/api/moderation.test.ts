import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { banUser, getSpaceBans, kickMember, unbanUser } from "$lib/api/moderation";
import type { SpaceBan } from "$lib/types";

const SPACE = "01920000-0000-7000-8000-0000000005a0";
const MEMBER = "01920000-0000-7000-8000-00000000e7e0";
const USER = "01920000-0000-7000-8000-00000000ca01";

const ban = (reason: string | null): SpaceBan => ({
	space_id: SPACE,
	user_id: USER,
	user: {
		id: USER,
		username: "carol",
		email_verified: true,
		alias: null,
		avatar: null,
		banner: null,
		custom: "",
		flags: 0,
		badges: 0,
		is_bot: false,
		created_at: "2026-11-01T00:00:00Z",
		updated_at: "2026-11-01T00:00:00Z",
	},
	reason,
	banned_by: MEMBER,
	created_at: "2026-11-09T00:00:00Z",
});

// What the client sends: each request's method, URL, body and Content-Type. Each answers as the API does (`answer`).
// Only while a test of this file runs (#166).
interface Sent {
	method: string;
	url: string;
	body: string | null;
	type: string | null;
}
const sent: Sent[] = [];
let answer = () => new Response(null, { status: 204 });
let fetched: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
beforeEach(() => {
	sent.length = 0;
	answer = () => new Response(null, { status: 204 });
	fetched = spyOn(globalThis, "fetch").mockImplementation((async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		const headers = new Headers(init?.headers);
		sent.push({
			method: init?.method ?? "GET",
			url: input instanceof Request ? input.url : input.toString(),
			body: typeof init?.body === "string" ? init.body : null,
			type: headers.get("Content-Type"),
		});
		return answer();
	}) as typeof fetch);
});
afterEach(() => fetched.mockRestore());

describe("kicking", () => {
	test("is a DELETE of the member, by their member ID, with no body", async () => {
		await kickMember(SPACE, MEMBER);
		expect(sent).toEqual([
			{ method: "DELETE", url: `https://api.test/api/spaces/${SPACE}/members/${MEMBER}`, body: null, type: null },
		]);
	});

	test("refused, fails with the API's answer", async () => {
		answer = () => Response.json({ error: "you don't have permission to kick members" }, { status: 403 });
		const refused = await kickMember(SPACE, MEMBER).catch((err) => err);
		expect(refused.response.status).toBe(403);
		expect(refused.response.data).toEqual({ error: "you don't have permission to kick members" });
	});
});

describe("banning", () => {
	test("is a PUT of the user's ban, with the reason as JSON", async () => {
		answer = () => Response.json(ban("spamming"), { status: 201 });
		expect(await banUser(SPACE, USER, "spamming")).toEqual(ban("spamming"));
		expect(sent).toEqual([
			{
				method: "PUT",
				url: `https://api.test/api/spaces/${SPACE}/bans/${USER}`,
				body: JSON.stringify({ reason: "spamming" }),
				type: "application/json",
			},
		]);
	});

	test("without a reason, sends no body, which the API reads as none", async () => {
		answer = () => Response.json(ban(null), { status: 201 });
		await banUser(SPACE, USER);
		await banUser(SPACE, USER, "");
		expect(sent.map(({ method, body, type }) => ({ method, body, type }))).toEqual([
			{ method: "PUT", body: null, type: null },
			{ method: "PUT", body: null, type: null },
		]);
	});

	test("gives the ban the API answers, a 200's (the user was banned already) as a 201's", async () => {
		answer = () => Response.json(ban("the first reason"), { status: 200 });
		expect(await banUser(SPACE, USER, "another reason")).toEqual(ban("the first reason"));
	});
});

describe("unbanning", () => {
	test("is a DELETE of the user's ban", async () => {
		await unbanUser(SPACE, USER);
		expect(sent).toEqual([
			{ method: "DELETE", url: `https://api.test/api/spaces/${SPACE}/bans/${USER}`, body: null, type: null },
		]);
	});
});

describe("listing the bans", () => {
	test("asks for a page of 50 from the first, then from after the user ID it's given", async () => {
		answer = () => Response.json([ban(null)]);
		expect(await getSpaceBans(SPACE, null)).toEqual([ban(null)]);
		await getSpaceBans(SPACE, USER);
		await getSpaceBans(SPACE, USER, 100);
		expect(sent.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
			{ method: "GET", url: `https://api.test/api/spaces/${SPACE}/bans?count=50`, body: null },
			{ method: "GET", url: `https://api.test/api/spaces/${SPACE}/bans?after=${USER}&count=50`, body: null },
			{ method: "GET", url: `https://api.test/api/spaces/${SPACE}/bans?after=${USER}&count=100`, body: null },
		]);
	});
});
