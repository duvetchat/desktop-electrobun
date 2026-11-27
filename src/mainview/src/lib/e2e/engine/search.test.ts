import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { sessionApi } from "$lib/api/api";
import { e2eApi } from "$lib/api/e2e";
import type { MessageSearch } from "$lib/api/messages";
import { bytesBase64 } from "$lib/staged-images";
import type { GatewaySpace } from "$lib/types";
import en from "../../../../messages/en.json";
import { decryptedFiles } from "../decrypted-files.svelte";
import { toEngine, type EngineEvent } from "../events";
import { notice, NOTICES } from "../notices";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import { firstDevice, rejection, testHost, until, type TestDevice } from "../testing/engines";
import { uuidv7 } from "../uuid";
import { apiTakes, deviceSearchOf } from "./search";

// The page's engine and the stores it reaches are .svelte.ts modules whose $state only Svelte's compiler knows: here
// it's the value itself, set before they load.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const page = await import("../engine.svelte");
const { CONVERSATION_RESULTS, searchConversation, searchEverywhere } = await import("$lib/search");
const { pinConversationMessage } = await import("$lib/api/conversations");
const { conversations: drawnConversations, dmMessages } = await import("$lib/stores.svelte");

/** The page draws the session's conversations, as READY's list leaves them in its store (#574: what founds a group). */
const drawnOnPage = async (token: string) =>
	drawnConversations.set(await e2eApi(sessionApi({ token, sessionToken: null })).conversations());

// A conversation's search runs on the device (PLAN-E2E-CLIENTES.md, task 20; decision 42): its words, from:, mentions:,
// dates and has: through the core's search, its results drawn from the device's database. pinned: and has:sticker, which
// the API keeps in the clear, go to its search without words, and their text comes from the device. Search everywhere
// mixes the Spaces', which the API searches, with one search on the device over every conversation. Ana's device is the
// page's own engine, on a host of the test's; Bo's and Cy's are devices of their own.
const SLOW = 180_000;
const SPACE = "0193a4b2-0000-7000-8000-0000000005a0";
const ROOM = "0193a4b2-0000-7000-8000-0000000005a1";

// A test that failed midway leaves no engine for the next: the page's starts once until it stops.
afterEach(() => page.stopEngine());

/** The start of a local day, `days` from today, as the search's dates are written. */
const dayFrom = (days: number) => {
	const today = new Date();
	return new Date(today.getFullYear(), today.getMonth(), today.getDate() + days).toISOString();
};

interface Talk {
	fake: FakeApi;
	/** Every request the page and the devices made: its method, path and query. */
	requests: string[];
	ana: string;
	bo: string;
	b: TestDevice;
	conversation: string;
	/** Ana's core. */
	host: ReturnType<typeof testHost>;
	end(): Promise<void>;
}

/**
 * Ana and Bo in a DM, both set up, its group made: Ana's device is the page's engine, which hears its gateway events as
 * the app's do. `answer` takes a request before the fake does, as a Space's search, which the fake has none of.
 */
async function talking(answer: (request: Request) => Response | null = () => null): Promise<Talk> {
	const fake = new FakeApi();
	const requests: string[] = [];
	spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init);
		const url = new URL(request.url);
		requests.push(`${request.method} ${url.pathname}${url.search}`);
		return answer(request) ?? fake.fetch(request);
	}) as typeof fetch);
	const [ana, bo] = [fake.addUser(), fake.addUser()];
	const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
	const token = fake.signIn(ana).token;
	localStorage.setItem("duvet_session_token", token);
	const host = testHost();
	await page.startEngine(ana, {
		...{ desktop: true, desktopHost: async () => host, webHost: () => Promise.reject(new Error("no web")) },
		...{ missing: () => [], persist: () => undefined },
	});
	await page.makeIdentity();
	await page.keySaved();
	const { device_id } = await host.handle<{ device_id: string }>({ cmd: "status" });
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fake's events are the API's, as the gateway hands them on
	const hear = fake.connect(token, device_id, (event) => toEngine(event as EngineEvent));
	const b = await firstDevice(fake, bo);
	await drawnOnPage(token);
	await page.openConversation(conversation);
	await until(async () => !!(await b.host.handle({ cmd: "group", conversation_id: conversation }).catch(() => null)));
	const end = async () => {
		await page.stopEngine();
		hear();
		await b.engine.stop();
	};
	return { fake, requests, ana, bo, b, conversation, host, end };
}

/** A message of the device's with a picture in it, made and sent by hand: sending files is the attachments' task. */
async function withPicture(device: TestDevice, conversation: string, text: string) {
	const nonce = crypto.randomUUID();
	const random = () => bytesBase64(crypto.getRandomValues(new Uint8Array(32)));
	const picture = { id: uuidv7(), key: random(), sha256: random(), name: "apples.png", type: "image/png", size: 2048 };
	const { ciphertext } = await device.host.handle<{ ciphertext: string }>({
		...{ cmd: "encrypt", conversation_id: conversation, nonce, envelope: { text, attachments: [picture] } },
	});
	const sent = await device.api.sendMessage(conversation, { ciphertext, nonce });
	await device.host.handle({ cmd: "sent", conversation_id: conversation, nonce, message_id: sent.id, seq: sent.seq });
	return sent;
}

/** Waits until Ana's core holds these messages of the conversation, opened. */
const heldByAna = (talk: Talk, conversation: string, ids: string[]) =>
	until(async () => {
		const { messages } = await talk.host.handle<{ messages: { status: string }[] }>({
			...{ cmd: "messages", conversation_id: conversation, ids },
		});
		return messages.length === ids.length && messages.every((m) => m.status === "ok");
	});

/** The conversation as Ana's app lists it. */
const listed = async (conversation: string) => (await e2eApi().conversations()).find((c) => c.id === conversation)!;

/** What a search's results say, newest first. */
const texts = (found: { message: { content: string | null } }[]) => found.map((f) => f.message.content);

/** The requests made to the API's search of a conversation. */
const conversationSearches = (talk: Talk) =>
	talk.requests.filter((r) => r.includes("/conversations/") && r.includes("/messages/search"));

describe.skipIf(!coreLibrary)("a conversation's search", () => {
	test(
		"a conversation's search runs on the device, with from, mentions, dates and has",
		async () => {
			const talk = await talking();
			const { conversation, ana, bo, b } = talk;
			const mine = await page.sendEncrypted({
				conversation_id: conversation,
				nonce: crypto.randomUUID(),
				text: "Àpples and pears",
			});
			await Bun.sleep(5);
			const told = await b.engine.sendMessage({
				...{ conversation_id: conversation, nonce: crypto.randomUUID() },
				text: `apples for <@${ana}>`,
			});
			await Bun.sleep(5);
			const picture = await withPicture(b, conversation, "a photo of the apples");
			await Bun.sleep(5);
			const plums = await b.engine.sendMessage({
				conversation_id: conversation,
				nonce: crypto.randomUUID(),
				text: "plums",
			});
			await heldByAna(talk, conversation, [told!.id, picture.id, plums!.id]);
			const conv = await listed(conversation);
			const search = async (filters: MessageSearch) => (await searchConversation(conv, filters)).found;

			// Words, each the start of one of the message's words, its case and accents aside: newest first.
			const found = await searchConversation(conv, { query: "APPLES" });
			expect([texts(found.found), found.total, found.next]).toEqual([
				["a photo of the apples", `apples for <@${ana}>`, "Àpples and pears"],
				3,
				null,
			]);
			expect(found.found.map((f) => [f.message.id, f.conversationId, f.roomId])).toEqual([
				[picture.id, conversation, null],
				[told!.id, conversation, null],
				[mine!.id, conversation, null],
			]);
			expect(found.found[0]?.message).toMatchObject({ author_id: bo, waiting: false, loading: false });
			// from:, mentions:, the dates and has:, alone and with the words.
			expect(texts(await search({ query: "apples", authorIds: [bo] }))).toEqual([
				"a photo of the apples",
				`apples for <@${ana}>`,
			]);
			expect(texts(await search({ mentions: [ana] }))).toEqual([`apples for <@${ana}>`]);
			expect(texts(await search({ query: "apples", after: dayFrom(0), before: dayFrom(1) }))).toHaveLength(3);
			expect(texts(await search({ query: "apples", before: dayFrom(0) }))).toEqual([]);
			expect(texts(await search({ after: dayFrom(1) }))).toEqual([]);
			expect(texts(await search({ has: ["image"] }))).toEqual(["a photo of the apples"]);
			expect(texts(await search({ has: ["file"], query: "photo" }))).toEqual(["a photo of the apples"]);
			expect(texts(await search({ has: ["sound"] }))).toEqual([]);
			expect(texts(await search({ has: ["video", "image"], authorIds: [ana] }))).toEqual([]);
			// Punctuation alone is nothing to search for (the review's M4): the API answers as it does for a Space's, and the
			// device lists nothing.
			expect(await rejection(searchConversation(conv, { query: "?!" }))).toMatchObject({
				response: { data: { error: "a search needs some text or a filter" } },
			});

			// A page at a time, the next from where the last ended.
			for (let n = 0; n <= CONVERSATION_RESULTS; n++) {
				await b.engine.sendMessage({ conversation_id: conversation, nonce: crypto.randomUUID(), text: `fig ${n}` });
			}
			await until(async () => (await searchConversation(conv, { query: "fig" })).total === CONVERSATION_RESULTS + 1);
			const first = await searchConversation(conv, { query: "fig" });
			expect(first.found).toHaveLength(CONVERSATION_RESULTS);
			expect(first.next).toEqual({ offset: CONVERSATION_RESULTS });
			const second = await searchConversation(conv, { query: "fig" }, first.next ?? undefined);
			expect([texts(second.found), second.next]).toEqual([["fig 0"], null]);
			// None of it went to the API's search, but the punctuation alone, without it.
			expect(conversationSearches(talk)).toEqual([`GET /api/users/@me/conversations/${conversation}/messages/search`]);
			await talk.end();
		},
		SLOW,
	);

	test(
		"a search with words never asks the server about a conversation",
		async () => {
			const talk = await talking((request) =>
				new URL(request.url).pathname === `/api/spaces/${SPACE}/messages/search`
					? Response.json({ total_results: 0, messages: [] })
					: null,
			);
			const { conversation, b } = talk;
			// With a picture: what draws a result names its file to no one either (task 18's re-review, N6).
			const sent = await withPicture(b, conversation, "kiwi");
			await heldByAna(talk, conversation, [sent.id]);
			const conv = await listed(conversation);
			const words: MessageSearch[] = [
				{ query: "kiwi" },
				{ query: "kiwi", authorIds: [talk.bo], has: ["image", "file"] },
				{ query: "kiwi", mentions: [talk.ana], after: dayFrom(-1) },
			];
			const searching = talk.requests.length;
			for (const search of words) await searchConversation(conv, search);
			expect(texts((await searchConversation(conv, { query: "kiwi" })).found)).toEqual(["kiwi"]);
			for (const search of words) await searchEverywhere(search, [space()], [conv]);
			expect(texts((await searchEverywhere({ query: "kiwi" }, [space()], [conv])).found)).toEqual(["kiwi"]);
			// Nor does anything follow from what they found (the review's M8): no request names the conversation's messages,
			// or the one found, which would tell the API what the words found.
			const found = (await searchConversation(conv, { query: "kiwi" })).found;
			const shown = found.flatMap(({ message }) => (message.attachments ?? []).flatMap((att) => att.sealed ?? []));
			expect(shown.map((file) => file.name)).toEqual(["apples.png"]);
			for (const file of shown) await decryptedFiles.open(file, sent.id, { auto: true });
			const named = (r: string) =>
				r.includes(`/conversations/${conversation}/messages`) ||
				r.includes(sent.id) ||
				shown.some((file) => r.includes(file.id));
			expect(talk.requests.slice(searching).filter(named)).toEqual([]);
			// Words with what only the API knows can't go anywhere: they're refused, asking nobody.
			const before = talk.requests.length;
			for (const search of [
				{ query: "kiwi", pinned: true },
				{ query: "kiwi", has: ["sticker"] },
			]) {
				expect(await rejection(searchConversation(conv, search))).toMatchObject({ message: notice("search_split") });
			}
			expect(talk.requests.length).toBe(before);
			expect(conversationSearches(talk)).toEqual([]);
			// Search everywhere still asked the Spaces, words and all.
			const spaces = talk.requests.filter((r) => r.includes(`/spaces/${SPACE}/messages/search`));
			expect(spaces).toHaveLength(words.length + 1);
			expect(spaces.every((r) => new URLSearchParams(r.split("?")[1]).get("query") === "kiwi")).toBe(true);
			await talk.end();
		},
		SLOW,
	);

	test(
		"search everywhere mixes the Spaces' results with the device's own",
		async () => {
			const around = { older: "", newer: "" };
			const talk = await talking((request) => {
				if (new URL(request.url).pathname !== `/api/spaces/${SPACE}/messages/search`) return null;
				const room = (id: string, at: string, content: string) => ({
					...{ id, room_id: ROOM, author_id: SPACE, content, type: 0, created_at: at, updated_at: at },
				});
				return Response.json({
					total_results: 2,
					messages: [
						room("0193a4b2-0000-7000-8000-0000000000f2", around.newer, "melons in the room, later"),
						room("0193a4b2-0000-7000-8000-0000000000f1", around.older, "melons in the room, before"),
					],
				});
			});
			const { fake, conversation, ana, b } = talk;
			// A second conversation, with Cy, whose group Ana's device makes.
			const cy = fake.addUser();
			const other = fake.addConversation({ type: "dm", members: [ana, cy] });
			const c = await firstDevice(fake, cy);
			await drawnOnPage(localStorage.getItem("duvet_session_token")!);
			await page.openConversation(other);
			await until(async () => !!(await c.host.handle({ cmd: "group", conversation_id: other }).catch(() => null)));

			around.older = new Date(Date.now() - 60_000).toISOString();
			const fromBo = await b.engine.sendMessage({
				...{ conversation_id: conversation, nonce: crypto.randomUUID() },
				text: "melons from Bo",
			});
			await Bun.sleep(5);
			const fromCy = await c.engine.sendMessage({
				conversation_id: other,
				nonce: crypto.randomUUID(),
				text: "melons from Cy",
			});
			await Bun.sleep(5);
			await page.sendEncrypted({ conversation_id: other, nonce: crypto.randomUUID(), text: "no fruit here" });
			await heldByAna(talk, conversation, [fromBo!.id]);
			await heldByAna(talk, other, [fromCy!.id]);
			around.newer = new Date(Date.now() + 60_000).toISOString();
			const conversations = await e2eApi().conversations();

			const { found, total } = await searchEverywhere({ query: "melons" }, [space()], conversations);
			expect(texts(found)).toEqual([
				"melons in the room, later",
				"melons from Cy",
				"melons from Bo",
				"melons in the room, before",
			]);
			expect(found.map((f) => f.conversationId ?? f.spaceId)).toEqual([SPACE, other, conversation, SPACE]);
			expect(total).toBe(4);
			// A conversation the app doesn't list (one the user left) isn't among them, though the device still holds it.
			const left = await searchEverywhere(
				{ query: "melons" },
				[space()],
				conversations.filter((conv) => conv.id !== other),
			);
			expect(texts(left.found)).not.toContain("melons from Cy");
			// One search on the device, over every conversation: the API's conversations' search had nothing asked.
			expect(conversationSearches(talk)).toEqual([]);
			await c.engine.stop();
			await talk.end();
		},
		SLOW,
	);

	test(
		"pinned and sticker filters ask the server, and draw from the device",
		async () => {
			const talk = await talking();
			const { conversation, bo, b } = talk;
			const pinned = await b.engine.sendMessage({
				conversation_id: conversation,
				nonce: crypto.randomUUID(),
				text: "pin me",
			});
			const sticker = crypto.randomUUID();
			const stuck = await b.engine.sendMessage({
				...{ conversation_id: conversation, nonce: crypto.randomUUID() },
				sticker_attachment_id: sticker,
			});
			await b.engine.sendMessage({ conversation_id: conversation, nonce: crypto.randomUUID(), text: "leave me" });
			await heldByAna(talk, conversation, [pinned!.id, stuck!.id]);
			await pinConversationMessage(conversation, pinned!.id);
			const conv = await listed(conversation);

			// Pinned: the API's search finds it, and its text is the device's: the API's row has none.
			const pins = await searchConversation(conv, { pinned: true });
			expect([texts(pins.found), pins.total]).toEqual([["pin me"], 1]);
			expect(pins.found[0]?.message).toMatchObject({ id: pinned!.id, author_id: bo, pinned_at: expect.any(String) });
			expect(texts((await searchConversation(conv, { pinned: true, authorIds: [talk.ana] })).found)).toEqual([]);
			// A sticker: in the clear on the API's row, beside the device's empty envelope.
			const stickers = await searchConversation(conv, { has: ["sticker"] });
			expect(stickers.found.map((f) => [f.message.id, f.message.sticker_attachment_id])).toEqual([
				[stuck!.id, sticker],
			]);
			expect(texts(stickers.found)).toEqual([null]);
			// Each went to the API's search without words; a search of the device's alone didn't.
			await searchConversation(conv, { query: "pin" });
			const asked = conversationSearches(talk).map((r) => new URLSearchParams(r.split("?")[1]));
			expect(asked.map((query) => [query.get("pinned"), query.getAll("has"), query.has("query")])).toEqual([
				["true", [], false],
				["true", [], false],
				[null, ["sticker"], false],
			]);
			// What needs both the API and the device can't go to either: refused, asking nobody.
			const before = talk.requests.length;
			for (const search of [{ pinned: true, has: ["image"] }, { has: ["sticker", "sound"] }]) {
				expect(await rejection(searchConversation(conv, search))).toMatchObject({ message: notice("search_split") });
			}
			expect(talk.requests.length).toBe(before);
			expect(en.e2e_search_split).toBe(NOTICES.search_split);
			expect(en.e2e_not_ready).toBe(NOTICES.not_ready);
			await talk.end();
		},
		SLOW,
	);

	// The review's M5: a sticker's envelope is empty on the device, and only the API's row says which sticker it is.
	test(
		"a sticker's message found on the device shows as its sticker, never as an empty card",
		async () => {
			const talk = await talking();
			const { conversation, bo, b } = talk;
			const sticker = crypto.randomUUID();
			const stuck = (await b.engine.sendMessage({
				...{ conversation_id: conversation, nonce: crypto.randomUUID() },
				sticker_attachment_id: sticker,
			}))!;
			await Bun.sleep(5);
			const said = (await b.engine.sendMessage({
				conversation_id: conversation,
				nonce: crypto.randomUUID(),
				text: "a word",
			}))!;
			await heldByAna(talk, conversation, [stuck.id, said.id]);
			const conv = await listed(conversation);
			const shown = async (search: MessageSearch) =>
				(await searchConversation(conv, search)).found.map((f) => [f.message.id, f.message.sticker_attachment_id]);
			const before = talk.requests.length;
			// The chat holds the API's row, which has the sticker: from: and a date find it drawn as that sticker.
			dmMessages.set({ [conversation]: [stuck, said] });
			expect(await shown({ authorIds: [bo] })).toEqual([
				[said.id, null],
				[stuck.id, sticker],
			]);
			expect(await shown({ after: dayFrom(0) })).toEqual([
				[said.id, null],
				[stuck.id, sticker],
			]);
			// Without that row, the device has nothing to draw for it, and the API isn't asked: it's left out.
			dmMessages.set({});
			expect(await shown({ authorIds: [bo] })).toEqual([[said.id, null]]);
			expect(talk.requests.slice(before).filter((r) => r.includes("/messages"))).toEqual([]);
			await talk.end();
		},
		SLOW,
	);
});

describe("what a search takes to the device", () => {
	test("is its words, authors, mentions, dates and the kinds of files the core tells apart", () => {
		expect(
			deviceSearchOf({
				query: "apples",
				authorIds: ["a"],
				mentions: ["b"],
				has: ["image", "sound", "file", "video"],
				after: "2026-11-24T00:00:00.000Z",
				before: "2026-11-25T00:00:00.000Z",
			}),
		).toEqual({
			text: "apples",
			from: ["a"],
			mentions: ["b"],
			has: ["image", "audio", "file", "video"],
			after: Date.parse("2026-11-24T00:00:00.000Z"),
			before: Date.parse("2026-11-25T00:00:00.000Z"),
		});
	});

	test("is nothing when it needs what only the API knows, a kind of file the device can't tell, or nothing", () => {
		expect(deviceSearchOf({ pinned: true })).toBeNull();
		expect(deviceSearchOf({ pinned: false, query: "x" })).toBeNull();
		expect(deviceSearchOf({ has: ["sticker"] })).toBeNull();
		expect(deviceSearchOf({ has: ["image", "sticker"] })).toBeNull();
		// A link or an embed: an encrypted message has no preview, and its links aren't searched.
		expect(deviceSearchOf({ has: ["link"] })).toBeNull();
		expect(deviceSearchOf({ has: ["link", "image"] })).toEqual({ has: ["image"] });
		// Nothing to search for ("has:" and Enter), or punctuation alone: the API refuses it, as it refuses a Space's.
		expect(deviceSearchOf({ query: "" })).toBeNull();
		expect(deviceSearchOf({ query: "?! ..." })).toBeNull();
		expect(deviceSearchOf({ query: "¿qué?" })).toEqual({ text: "¿qué?" });
	});

	test("the API's search takes no words, punctuation alone being none, and of has: only file and sticker", () => {
		expect(apiTakes({ query: "?", pinned: true })).toBe(true);
		expect(apiTakes({ query: "a?", pinned: true })).toBe(false);
		expect(apiTakes({ has: ["file", "sticker"] })).toBe(true);
		expect(apiTakes({ has: ["image"] })).toBe(false);
	});
});

/** The Space Ana's search everywhere searches, which the test's `answer` stands in for. */
function space(): GatewaySpace {
	return {
		...{ id: SPACE, name: "Orchard", description: null, banner: null, owner_id: SPACE, locale: null },
		...{ member_roles: {}, room_overwrites: [], members: [], roles: [], users: [], rooms: [] },
		...{ created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z" },
	};
}
