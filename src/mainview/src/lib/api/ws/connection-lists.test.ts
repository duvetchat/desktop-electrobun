import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { get } from "svelte/store";
import { openGateway, type TestGateway } from "$lib/api/ws/test-gateway";

// The lists a new session shows (friends, friend requests, conversations, the notification levels), and the team
// invites and buckets: READY asked for them only once it came, two round trips after it, and showed the app only once all
// six answered (#282).
const stores = await import("$lib/stores.svelte");
const { userStatusCache } = await import("$lib/api/ws/connection");

const ME = "01920000-0000-7000-8000-00000000b0b0";
const FRIEND = "01920000-0000-7000-8000-00000000f00d";
const LISTS = [
	"/api/users/@me/friends/requests",
	"/api/users/@me/friends/requests/sent",
	"/api/users/@me/friends",
	"/api/users/@me/conversations",
	"/api/users/@me/notification-settings",
	"/api/users/@me/team-invites",
	"/api/users/@me/buckets",
];
const friend = (id: string) => ({
	id,
	request_id: id,
	sender_id: ME,
	recipient_id: FRIEND,
	username: "friend",
	status_id: 1,
});

// Each route's answer, by its path: an empty list unless a test gives one, or holds it back (never answers).
const answers = new Map<string, () => Promise<Response>>();
const asked: string[] = [];
const fetchSpy = spyOn(globalThis, "fetch");
let gateway: TestGateway;

beforeAll(async () => {
	fetchSpy.mockImplementation((async (input: string | URL | Request) => {
		const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
		asked.push(path);
		return (answers.get(path) ?? (async () => Response.json([])))();
	}) as typeof fetch);
	answers.set("/api/users/@me/friends", async () => Response.json([friend("first")]));
	localStorage.setItem("duvet_session_token", "access");
	gateway = await openGateway();
});

afterAll(() => {
	gateway.close();
	fetchSpy.mockRestore();
});

function ready() {
	gateway.receive("READY", { user: { id: ME, username: "me" }, sessionToken: "session", guild_ids: [] });
}

async function eventually(check: () => boolean) {
	for (let i = 0; i < 200 && !check(); i++) await Bun.sleep(5);
	return check();
}

describe("a new session's lists", () => {
	test("are asked for as it identifies, before READY", () => {
		expect(LISTS.filter((path) => !asked.includes(path))).toEqual([]);
	});

	test("that answered before READY are stored after it, so READY's own clearing doesn't drop what they tell", async () => {
		ready();
		expect(await eventually(() => get(stores.friendsReady))).toBe(true);
		expect(get(stores.friends).map((f) => f.id)).toEqual(["first"]);
		expect(userStatusCache.get(FRIEND)?.status_id).toBe(1);
	});

	test("show the app once friends, requests and conversations are in, while team invites and buckets wait", async () => {
		const never = () => new Promise<Response>(() => {});
		answers.set("/api/users/@me/team-invites", never);
		answers.set("/api/users/@me/buckets", never);
		answers.set("/api/users/@me/friends", async () => Response.json([friend("second")]));
		ready();
		expect(await eventually(() => get(stores.friendsReady))).toBe(true);
		expect(get(stores.friends).map((f) => f.id)).toEqual(["second"]);
	});

	test("are each stored when they come, one that fails keeping none of the others from it", async () => {
		answers.set("/api/users/@me/buckets", async () => new Response("down", { status: 500 }));
		answers.set("/api/users/@me/team-invites", async () => Response.json([]));
		answers.set("/api/users/@me/friends", async () => Response.json([friend("third")]));
		ready();
		expect(await eventually(() => get(stores.friendsReady))).toBe(true);
		expect(await eventually(() => get(stores.friends)[0]?.id === "third")).toBe(true);
	});
});
