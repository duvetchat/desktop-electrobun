import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Conversation, DirectMessage } from "$lib/api/conversations";
import type { MessageSearch } from "$lib/api/messages";
import type { DeviceSearch } from "$lib/e2e/engine/search";
import { CoreError } from "$lib/e2e/errors";
import { NOTICES } from "$lib/e2e/notices";
import { MessageType, type GatewayMessage, type GatewaySpace } from "$lib/types";

// What each search was asked, and what it answers: by Space or conversation ID, its messages' minutes past 10:00 and its
// total, or a failure, once `holding` lets it.
let asked: string[] = [];
let answers: Record<string, { minutes: number[]; total: number } | "fails"> = {};
let holding: Promise<void> = Promise.resolve();
const at = (minute: number) => `2026-11-09T10:${String(minute).padStart(2, "0")}:00Z`;
const answer = async (where: string, search: MessageSearch) => {
	asked.push(`${where} ${search.query ?? ""}`);
	await holding;
	const it = answers[where];
	if (!it || it === "fails") throw new Error(`${where} failed`);
	return { total: it.total, minutes: it.minutes };
};
/** What a promise rejects with: it must. */
const rejection = (promise: Promise<unknown>) =>
	promise.then(
		() => {
			throw new Error("it didn't reject");
		},
		(error: unknown) => error,
	);
mock.module("$lib/api/messages", () => ({
	searchSpaceMessages: async (spaceId: string, search: MessageSearch) => {
		const { total, minutes } = await answer(spaceId, search);
		return {
			total_results: total,
			messages: minutes.map(
				(minute): GatewayMessage => ({
					id: `${spaceId}-${minute}`,
					room_id: `${spaceId}-room`,
					author_id: "ana",
					content: "hi",
					type: MessageType.Text,
					created_at: at(minute),
					updated_at: at(minute),
				}),
			),
		};
	},
}));
mock.module("$lib/api/conversations", () => ({
	searchConversationMessages: async (conversationId: string, search: MessageSearch) => {
		const { total, minutes } = await answer(conversationId, search);
		return {
			total_results: total,
			messages: minutes.map(
				(minute): DirectMessage => ({
					id: `${conversationId}-${minute}`,
					conversation_id: conversationId,
					author_id: "ana",
					content: "hi",
					type: 0,
					created_at: at(minute),
					updated_at: at(minute),
				}),
			),
		};
	},
}));
const { EVERYWHERE_RESULTS, searchConversation, searchEverywhere, useDeviceSearch } = await import("$lib/search");

// What this device holds of each conversation, by its messages' minutes past 10:00, which its one search finds a page
// at a time, as the core's does; or what its search fails with.
let held: Record<string, number[]> = {};
let deviceFails: Error | null = null;
const onDevice = {
	search: async (request: DeviceSearch) => {
		asked.push(`device ${request.text ?? ""}`);
		if (deviceFails) throw deviceFails;
		const messages = Object.entries(held)
			.flatMap(([conversationId, minutes]) =>
				minutes.map((minute) => ({
					...{ conversation_id: conversationId, message_id: `${conversationId}-${minute}`, seq: minute },
					...{ user_id: "ana", device_id: "d", sent_at: Date.parse(at(0)) + minute * 60_000, edited_at: null },
					...{ status: "ok" as const, text: "hi", attachments: [], shared_by: null, reply_to: null },
				})),
			)
			.sort((a, b) => b.sent_at - a.sent_at);
		const from = request.offset ?? 0;
		return { total: messages.length, messages: messages.slice(from, from + request.limit) };
	},
	read: async () => ({ rows: [] }),
	loaded: () => undefined,
};

const space = (id: string): GatewaySpace => ({
	id,
	name: id,
	description: null,
	banner: null,
	owner_id: "ana",
	locale: null,
	member_roles: {},
	room_overwrites: [],
	rooms: [],
	members: [],
	roles: [],
	users: [],
	created_at: "",
	updated_at: "",
});
const conversation = (id: string): Conversation => ({
	id,
	type: 1,
	name: null,
	owner_id: "ana",
	created_at: "",
	updated_at: "",
	deleted_at: null,
	members: [],
});
const SPACES = [space("alpha"), space("beta")];
const CONVERSATIONS = ["c1", "c2", "c3", "c4", "c5", "c6"].map(conversation);

beforeEach(() => {
	asked = [];
	answers = {};
	holding = Promise.resolve();
	held = {};
	deviceFails = null;
	useDeviceSearch(onDevice);
});

// #61: the desktop searched one Space or one conversation at a time; the mobile app also searches them all at once.
// Conversations are searched on the device (decision 42), with one search of them all.
describe("the search everywhere", () => {
	test("searches each Space, and the conversations once on this device, with the same search", async () => {
		for (const { id } of [...SPACES, ...CONVERSATIONS]) answers[id] = { minutes: [], total: 0 };
		await searchEverywhere({ query: "hi" }, SPACES, CONVERSATIONS);
		expect(asked.sort()).toEqual(["alpha hi", "beta hi", "device hi"]);
	});

	test("asks the 5 newest conversations' API search for what only it knows, never with words", async () => {
		for (const { id } of [...SPACES, ...CONVERSATIONS]) answers[id] = { minutes: [], total: 0 };
		await searchEverywhere({ query: "", pinned: true }, SPACES, CONVERSATIONS);
		expect(asked.sort()).toEqual(["alpha ", "beta ", "c1 ", "c2 ", "c3 ", "c4 ", "c5 "]);
		asked = [];
		await searchEverywhere({ query: "hi", has: ["sticker"] }, SPACES, CONVERSATIONS);
		expect(asked.sort()).toEqual(["alpha hi", "beta hi"]);
	});

	test("shows the newest messages found, newest first, saying where each is, and their total together", async () => {
		answers = {
			alpha: { minutes: [5, 1], total: 2 },
			beta: { minutes: [7], total: 9 },
		};
		held = { c2: [6] };
		const { found, total } = await searchEverywhere({ query: "hi" }, SPACES, CONVERSATIONS);
		expect(found.map((f) => f.message.id)).toEqual(["beta-7", "c2-6", "alpha-5", "alpha-1"]);
		expect(found[0]).toMatchObject({ roomId: "beta-room", spaceId: "beta" });
		expect(found[1]).toMatchObject({ roomId: null, conversationId: "c2", message: { content: "hi" } });
		expect(total).toBe(12);
		// A conversation the app no longer lists (one the user left) shows nothing, though the device still holds it.
		held = { c2: [6], gone: [8] };
		const shown = await searchEverywhere({ query: "hi" }, SPACES, CONVERSATIONS);
		expect(shown.found.map((f) => f.message.id)).not.toContain("gone-8");
	});

	test(`stops at the ${EVERYWHERE_RESULTS} newest`, async () => {
		answers = {
			alpha: { minutes: Array.from({ length: 15 }, (_, i) => i * 2), total: 15 },
			beta: { minutes: Array.from({ length: 15 }, (_, i) => i * 2 + 1), total: 15 },
		};
		const { found } = await searchEverywhere({ query: "hi" }, SPACES, []);
		expect(found).toHaveLength(EVERYWHERE_RESULTS);
		expect(found[0]!.message.id).toBe("beta-29");
		expect(found.at(-1)?.message.id).toBe("alpha-10");
	});

	test("leaves out what fails, and fails only when everything does", async () => {
		answers = { alpha: "fails", beta: { minutes: [3], total: 1 } };
		expect((await searchEverywhere({ query: "hi" }, SPACES, [])).found.map((f) => f.message.id)).toEqual(["beta-3"]);
		answers = { alpha: "fails", beta: "fails" };
		expect(searchEverywhere({ query: "hi" }, SPACES, [])).rejects.toThrow("failed");
		expect(await searchEverywhere({ query: "hi" }, [], [])).toEqual({ found: [], total: 0 });
	});

	// Task 20's review, M3: the core searches every conversation it holds, a group the person left among them.
	test("a group the person left doesn't push the listed conversations out of the device's results", async () => {
		held = { gone: Array.from({ length: 150 }, (_, i) => 100 + i), c2: [6] };
		const { found } = await searchEverywhere({ query: "hi" }, [], CONVERSATIONS);
		expect(found.map((f) => f.message.id)).toEqual(["c2-6"]);
	});

	// Task 20's review, I2: the device's search can't be called off, so a search replaced while it runs ends in its abort,
	// and nothing it found reaches the panel, not even under the line of the search that replaced it.
	test("a search replaced while its Space is held ends in its abort, with what the device found dropped", async () => {
		answers = { alpha: { minutes: [5], total: 1 }, c1: { minutes: [4], total: 1 } };
		held = { c2: [6] };
		let release = () => {};
		holding = new Promise<void>((resolve) => (release = resolve));
		const replaced = new AbortController();
		const searches = [
			searchEverywhere({ query: "hi" }, [space("alpha")], CONVERSATIONS, replaced.signal),
			searchConversation(conversation("c2"), { query: "hi" }, undefined, replaced.signal),
			searchConversation(conversation("c1"), { query: "", pinned: true }, undefined, replaced.signal),
		];
		replaced.abort();
		release();
		for (const search of searches) expect(await rejection(search)).toMatchObject({ name: "AbortError" });
	});
});

// Task 20's review, M7: what the panel says when this device can't search, in the notices' words.
describe("a conversation's search on a device that can't run it", () => {
	test("says encrypted conversations aren't ready, before the engine and while it can't search", async () => {
		const search = () => searchConversation(conversation("c1"), { query: "hi" });
		deviceFails = new Error("encrypted conversations aren't ready on this device");
		expect(await rejection(search())).toMatchObject({ message: NOTICES.not_ready });
		deviceFails = new CoreError("internal", "this tab left the core's tabs");
		expect(await rejection(search())).toMatchObject({ message: NOTICES.not_ready });
		useDeviceSearch(null);
		expect(await rejection(search())).toMatchObject({ message: NOTICES.not_ready });
	});

	test("says what the core refuses of the search itself", async () => {
		deviceFails = new CoreError("bad_command", "a search takes 10 authors at most", { field: "from" });
		expect(await rejection(searchConversation(conversation("c1"), { query: "hi" }))).toBe(deviceFails);
	});
});
