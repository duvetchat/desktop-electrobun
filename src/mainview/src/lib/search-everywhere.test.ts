import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Conversation, DirectMessage } from "$lib/api/conversations";
import type { MessageSearch } from "$lib/api/messages";
import { MessageType, type GatewayMessage, type GatewaySpace } from "$lib/types";

// What each search was asked, and what it answers: by Space or conversation ID, its messages' minutes past 10:00 and its
// total, or a failure.
let asked: string[] = [];
let answers: Record<string, { minutes: number[]; total: number } | "fails"> = {};
const at = (minute: number) => `2026-11-09T10:${String(minute).padStart(2, "0")}:00Z`;
const answer = (where: string, search: MessageSearch) => {
	asked.push(`${where} ${search.query ?? ""}`);
	const it = answers[where];
	if (!it || it === "fails") return Promise.reject(new Error(`${where} failed`));
	return Promise.resolve({ total: it.total, minutes: it.minutes });
};
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
const { EVERYWHERE_RESULTS, searchEverywhere, useDeviceSearch } = await import("$lib/search");

// What this device holds of each conversation, by its messages' minutes past 10:00, which its one search finds.
let held: Record<string, number[]> = {};
useDeviceSearch({
	search: async (request) => {
		asked.push(`device ${request.text ?? ""}`);
		const messages = Object.entries(held)
			.flatMap(([conversationId, minutes]) =>
				minutes.map((minute) => ({
					...{ conversation_id: conversationId, message_id: `${conversationId}-${minute}`, seq: minute },
					...{ user_id: "ana", device_id: "d", sent_at: Date.parse(at(minute)), edited_at: null },
					...{ status: "ok" as const, text: "hi", attachments: [], shared_by: null, reply_to: null },
				})),
			)
			.sort((a, b) => b.sent_at - a.sent_at);
		return { total: messages.length, messages: messages.slice(0, request.limit) };
	},
	read: async () => ({ rows: [] }),
});

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
	held = {};
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
});
