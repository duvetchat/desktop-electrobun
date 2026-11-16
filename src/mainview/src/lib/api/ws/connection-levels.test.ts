import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { get } from "svelte/store";
import { openGateway, type TestGateway } from "$lib/api/ws/test-gateway";

// The user's notification levels as a session starts. They came one round trip after READY, so until they did the app
// showed a muted place's unread marks, and a mention there played its sound.
class FakeAudio {
	// Each sound played, counted.
	static plays = 0;
	volume = 1;
	currentTime = 0;
	play() {
		FakeAudio.plays++;
		return Promise.resolve();
	}
}
Object.assign(globalThis, { Audio: FakeAudio });

const stores = await import("$lib/stores.svelte");
const { notificationLevels } = await import("$lib/notification-levels");

const ME = "01920000-0000-7000-8000-00000000b0b0";
const ANA = "01920000-0000-7000-8000-00000000a11c";
const MUTED = "01920000-0000-7000-8000-0000000005a1";
const LOUD = "01920000-0000-7000-8000-0000000005a2";
const LEVELS = "/api/users/@me/notification-settings";
const message = (n: number) => `01a15f8c-${String(n).padStart(4, "0")}-7000-8000-000000000000`;

// The levels' answer, which waits until a test gives it.
let answerLevels: (response: Response) => void = () => {};
const fetchSpy = spyOn(globalThis, "fetch");
let gateway: TestGateway;

beforeAll(async () => {
	fetchSpy.mockImplementation((async (input: string | URL | Request) => {
		const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
		if (path === LEVELS) return new Promise<Response>((resolve) => (answerLevels = resolve));
		return Response.json([]);
	}) as typeof fetch);
	localStorage.setItem("duvet_session_token", "access");
	gateway = await openGateway();
	stores.pageVisible.set(true);
});

afterAll(() => {
	gateway.close();
	fetchSpy.mockRestore();
});

const ready = () =>
	gateway.receive("READY", { user: { id: ME, username: "me", status: 1 }, sessionToken: "session", guild_ids: [] });
const mention = (n: number, roomId: string) =>
	gateway.receive("MENTION_CREATE", { message_id: message(n), room_id: roomId, author_id: ANA });

async function eventually(check: () => boolean) {
	for (let i = 0; i < 200 && !check(); i++) await Bun.sleep(5);
	return check();
}

describe("the notification levels as a session starts", () => {
	test("are in before the app shows, and a mention that comes first waits for them", async () => {
		ready();
		mention(1, MUTED);
		mention(2, LOUD);
		await Bun.sleep(30);
		expect(get(stores.friendsReady)).toBe(false);
		expect(FakeAudio.plays).toBe(0);

		answerLevels(Response.json([{ target_id: MUTED, target_type: 1, level: 2 }]));
		expect(await eventually(() => get(stores.friendsReady))).toBe(true);
		expect(get(notificationLevels)).toEqual({ [MUTED]: 2 });
		expect(await eventually(() => FakeAudio.plays === 1)).toBe(true);
		await Bun.sleep(30);
		expect(FakeAudio.plays).toBe(1);
	});

	test("a later session goes by the levels it had meanwhile: a mention plays, or not, at once", async () => {
		ready();
		const before = FakeAudio.plays;
		mention(3, MUTED);
		mention(4, LOUD);
		expect(FakeAudio.plays - before).toBe(1);
		answerLevels(Response.json([{ target_id: MUTED, target_type: 1, level: 2 }]));
		expect(await eventually(() => get(stores.friendsReady))).toBe(true);
	});

	test("an answer that fails shows the app all the same, with the levels it had", async () => {
		ready();
		answerLevels(new Response("down", { status: 500 }));
		expect(await eventually(() => get(stores.friendsReady))).toBe(true);
		expect(get(notificationLevels)).toEqual({ [MUTED]: 2 });
	});
});
