import { afterAll, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { openGateway, type TestGateway } from "$lib/api/ws/test-gateway";

// What the gateway's events do to the pages of a Space's members (lib/stores/member-pages.svelte.ts), which the members
// popover of a pane's bar and the Members section of a Space's settings share.
const { ensureMembers, forgetMemberPages, membersFailed, moreMembers } =
	await import("$lib/stores/member-pages.svelte");

const ME = "01920000-0000-7000-8000-00000000b0b0";
const SPACE = "01920000-0000-7000-8000-0000000000a1";
const MEMBERS = `/api/spaces/${SPACE}/members`;

// How the API answers a page of the Space's members, and how many were asked for.
let answer: () => Promise<Response> = async () => Response.json([]);
let asked = 0;
const fetchSpy = spyOn(globalThis, "fetch");
let gateway: TestGateway;

beforeAll(async () => {
	fetchSpy.mockImplementation((async (input: string | URL | Request) => {
		const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
		if (path !== MEMBERS) return Response.json([]);
		asked++;
		return answer();
	}) as typeof fetch);
	localStorage.setItem("duvet_session_token", "access");
	gateway = await openGateway();
});

afterAll(() => {
	gateway.close();
	fetchSpy.mockRestore();
});

beforeEach(() => {
	forgetMemberPages();
	asked = 0;
});

// #388: a Space whose page failed kept its failure into the next session, whose Spaces come back without their pages,
// and its members never loaded again by themselves.
test("a new session asks again for the members of a Space whose page failed", async () => {
	const logged = console.error;
	console.error = () => {};
	try {
		answer = async () => Response.json({ error: "internal server error" }, { status: 500 });
		await ensureMembers(SPACE, 1);
		expect(membersFailed(SPACE)).toBe(true);
		gateway.receive("READY", { user: { id: ME, username: "me" }, sessionToken: "session", guild_ids: [] });
		expect(membersFailed(SPACE)).toBe(false);
		answer = async () => Response.json([]);
		await ensureMembers(SPACE, 1);
		expect(asked).toBe(2);
	} finally {
		console.error = logged;
	}
});

// #380: the Members section of a Space's settings lists every member. One who joined after its last page came was
// never asked for, as the pages had ended.
test("someone joining a Space whose pages all came leaves more to load, from after the last full page", async () => {
	answer = async () => Response.json([]);
	await ensureMembers(SPACE, 1);
	expect(moreMembers(SPACE)).toBe(false);
	gateway.receive("SPACE_MEMBER_ADD", {
		space_id: SPACE,
		user_id: "01920000-0000-7000-8000-00000000a11c",
		member_id: "01920000-0000-7000-8000-0000000000e1",
		status_id: 1,
	});
	expect(moreMembers(SPACE)).toBe(true);
});
