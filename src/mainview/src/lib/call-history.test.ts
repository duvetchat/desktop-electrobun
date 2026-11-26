import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { get } from "svelte/store";
import type { Conversation, ConversationMember, DirectMessage } from "$lib/api/conversations";
import {
	callBackAction,
	callHistory,
	callNoticeCame,
	callNoticeDeleted,
	callRow,
	callTime,
	conversationCallsGone,
	forgetCalls,
	loadCalls,
	withCall,
	withoutCalls,
	withPage,
	type LoadedCalls,
} from "$lib/call-history";
import { callNoticeSentence } from "$lib/call-notices";
import { MessageType } from "$lib/types";

const ME = "01920000-0000-7000-8000-00000000b0b0";
const ALICE = "01920000-0000-7000-8000-00000000a11c";
const BOB = "01920000-0000-7000-8000-000000000b0b";
const ALICE_AVATAR = "01930000-0000-7000-8000-0000000a7a7a";
const DM = "01a15f8c-0000-7000-8000-0000000000d1";
const GROUP = "01a15f8c-0000-7000-8000-0000000000a1";
// Call notices, in the order of their IDs: the higher, the newer.
const id = (n: number) => `01a15f8c-${String(n).padStart(4, "0")}-7000-8000-000000000000`;

/** A call's notice: Alice's call in the DM, which the user took part in, unless said otherwise. */
function notice(n: number, { conversation = DM, caller = ALICE, participants = [ALICE, ME] } = {}): DirectMessage {
	return {
		id: id(n),
		conversation_id: conversation,
		author_id: caller,
		content: null,
		type: MessageType.Call,
		created_at: "2026-11-01T12:05:00Z",
		updated_at: "2026-11-01T12:05:00Z",
		user: { id: caller, username: caller === ALICE ? "alice" : "bob", alias: null, avatar: null, banner: null },
		call: { participants, started_at: "2026-11-01T12:00:00Z", ended_at: "2026-11-01T12:05:00Z" },
	};
}
const text = (n: number): DirectMessage => ({ ...notice(n), type: MessageType.Text, content: "hi", call: undefined });
const ids = (list: LoadedCalls | null) => list?.calls.map((c) => c.id) ?? null;

describe("a loaded call history", () => {
	const list = (ns: number[], more = false): LoadedCalls => ({
		calls: ns.map((n) => notice(n)),
		before: ns.length ? id(ns.at(-1)!) : null,
		more,
	});

	test("takes a notice in its place by ID, the newest first, and one it has as it is", () => {
		expect(ids(withCall(list([5, 3]), notice(9)))).toEqual([id(9), id(5), id(3)]);
		expect(ids(withCall(list([5, 3]), notice(4)))).toEqual([id(5), id(4), id(3)]);
		expect(ids(withCall(list([5, 3]), notice(1)))).toEqual([id(5), id(3), id(1)]);
		const kept = list([5, 3]);
		expect(withCall(kept, notice(3, { conversation: GROUP }))).toBe(kept);
	});

	test("loses the notices it's told, and is the same list when it has none of them", () => {
		expect(ids(withoutCalls(list([5, 4, 3]), (c) => c.id === id(4)))).toEqual([id(5), id(3)]);
		const kept = list([5]);
		expect(withoutCalls(kept, (c) => c.id === id(4))).toBe(kept);
	});

	test("takes a page in, the next one before its last, and more only while they're full", () => {
		const empty: LoadedCalls = { calls: [], before: null, more: true };
		const first = withPage(empty, [notice(9), notice(8)], 2);
		expect(first).toMatchObject({ before: id(8), more: true });
		const last = withPage(first, [notice(7)], 2);
		expect(ids(last)).toEqual([id(9), id(8), id(7)]);
		expect(last).toMatchObject({ before: id(7), more: false });
		expect(withPage(first, [], 2)).toMatchObject({ before: id(8), more: false });
	});

	test("a full page that goes no further back ends the list: an API that ignored the cursor isn't asked forever", () => {
		const first = withPage({ calls: [], before: null, more: true }, [notice(9), notice(8)], 2);
		expect(withPage(first, [notice(9), notice(8)], 2)).toMatchObject({ before: id(8), more: false });
	});

	test("a page leaves out what went while it was on its way, and anything but a call notice", () => {
		const fromEvents: LoadedCalls = { calls: [notice(9)], before: null, more: true };
		const merged = withPage(
			fromEvents,
			[notice(9), notice(8), notice(7, { conversation: GROUP }), text(6), notice(5)],
			5,
			{ ids: new Set([id(5)]), conversations: new Set([GROUP]) },
		);
		expect(ids(merged)).toEqual([id(9), id(8)]);
		// The next page still starts before the last the API listed.
		expect(merged).toMatchObject({ before: id(5), more: true });
	});
});

// The store, loaded from the API (a fetch of the test's), with the events in between.
describe("the call history store", () => {
	interface Answer {
		page?: DirectMessage[];
		status?: number;
		until?: Promise<void>;
	}
	let answers: Answer[] = [];
	const asked: string[] = [];
	let fetched: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
	beforeEach(() => {
		forgetCalls();
		answers = [];
		asked.length = 0;
		fetched = spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request) => {
			asked.push(input instanceof Request ? input.url : input.toString());
			const answer = answers.shift() ?? { page: [] };
			if (answer.until) await answer.until;
			if (answer.status) return Response.json({ error: "not found" }, { status: answer.status });
			return Response.json(answer.page ?? []);
		}) as typeof fetch);
	});
	afterEach(() => fetched.mockRestore());
	const gate = () => {
		let open = () => {};
		const until = new Promise<void>((resolve) => (open = resolve));
		return { until, open };
	};
	const page = (...ns: number[]): Answer => ({ page: ns.map((n) => notice(n)) });
	// A full page of 50, from n back.
	const fullPage = (n: number): Answer => page(...Array.from({ length: 50 }, (_, i) => n - i));

	test("loads its first page, then the next one before it", async () => {
		answers = [fullPage(100), page(50, 49)];
		await loadCalls();
		expect(get(callHistory)).toMatchObject({ before: id(51), more: true });
		await loadCalls();
		expect(ids(get(callHistory))).toEqual(Array.from({ length: 52 }, (_, i) => id(100 - i)));
		expect(get(callHistory)).toMatchObject({ before: id(49), more: false });
		expect(asked).toEqual([
			"https://api.test/api/users/@me/calls?limit=50",
			`https://api.test/api/users/@me/calls?before=${id(51)}&limit=50`,
		]);
	});

	test("asks for one page at a time", async () => {
		const { until, open } = gate();
		answers = [{ page: [notice(9)], until }];
		const first = loadCalls();
		const second = loadCalls();
		open();
		await Promise.all([first, second]);
		expect(asked).toHaveLength(1);
		expect(ids(get(callHistory))).toEqual([id(9)]);
	});

	test("takes the notices that come and go, while it's loaded only", async () => {
		callNoticeCame(notice(9));
		expect(get(callHistory)).toBeNull();
		answers = [page(5, 3)];
		await loadCalls();
		callNoticeCame(notice(9));
		callNoticeCame(text(10));
		expect(ids(get(callHistory))).toEqual([id(9), id(5), id(3)]);
		callNoticeDeleted(id(5));
		callNoticeDeleted(id(4));
		expect(ids(get(callHistory))).toEqual([id(9), id(3)]);
		callNoticeCame(notice(8, { conversation: GROUP, caller: BOB, participants: [BOB, ALICE] }));
		conversationCallsGone(DM);
		expect(ids(get(callHistory))).toEqual([id(8)]);
	});

	test("while its page is on its way, a notice that comes goes in, and what goes stays out of the page", async () => {
		const { until, open } = gate();
		answers = [{ page: [notice(9), notice(8), notice(7, { conversation: GROUP }), notice(6)], until }];
		const loading = loadCalls();
		callNoticeCame(notice(10));
		callNoticeDeleted(id(8));
		conversationCallsGone(GROUP);
		expect(ids(get(callHistory))).toEqual([id(10)]);
		open();
		await loading;
		expect(ids(get(callHistory))).toEqual([id(10), id(9), id(6)]);
	});

	test("a page on its way when the history is forgotten is dropped, and the next load starts anew", async () => {
		const { until, open } = gate();
		answers = [{ page: [notice(9)], until }, page(4)];
		const dropped = loadCalls();
		forgetCalls();
		expect(get(callHistory)).toBeNull();
		await loadCalls();
		open();
		await dropped;
		expect(ids(get(callHistory))).toEqual([id(4)]);
		expect(asked).toEqual([
			"https://api.test/api/users/@me/calls?limit=50",
			"https://api.test/api/users/@me/calls?limit=50",
		]);
	});

	test("a page that fails fails the load, and leaves the list as it was: an API without the route answers 404", async () => {
		answers = [{ status: 404 }];
		const failed = await loadCalls().catch((err) => err);
		expect(failed.response.status).toBe(404);
		expect(get(callHistory)).toEqual({ calls: [], before: null, more: true });
		answers = [fullPage(60), { status: 500 }, page(10)];
		await loadCalls();
		await loadCalls().catch(() => {});
		expect(get(callHistory)).toMatchObject({ before: id(11), more: true });
		await loadCalls();
		expect(get(callHistory)?.calls).toHaveLength(51);
	});
});

describe("a call's row", () => {
	const member = (conversationId: string, userId: string, username: string, avatar: string | null = null) =>
		({
			id: `${userId.slice(0, -4)}0000`,
			conversation_id: conversationId,
			user_id: userId,
			created_at: "",
			updated_at: "",
			user: { id: userId, username, alias: null, avatar, banner: null },
		}) satisfies ConversationMember;
	const conversation = (type: 1 | 2, members: ConversationMember[], name: string | null = null): Conversation => ({
		id: type === 1 ? DM : GROUP,
		type,
		name,
		owner_id: ME,
		created_at: "",
		updated_at: "",
		deleted_at: null,
		members,
	});
	const dm = conversation(1, [member(DM, ME, "me"), member(DM, ALICE, "alice", ALICE_AVATAR)]);
	const group = conversation(
		2,
		[member(GROUP, ME, "me"), member(GROUP, ALICE, "alice"), member(GROUP, BOB, "bob")],
		"Band",
	);

	test("a DM's is the other person, with their avatar, and its notice's sentence", () => {
		expect(callRow(notice(9), dm, ME)).toEqual({
			id: id(9),
			conversationId: DM,
			title: "alice",
			group: false,
			avatar: `https://api.test/attachments/${ALICE_AVATAR}`,
			line: {
				missed: false,
				key: "chat_call_notice_started",
				values: { name: "alice", duration: "5 minutes" },
			},
			at: "2026-11-01T12:00:00Z",
		});
		expect(callNoticeSentence(callRow(notice(9), dm, ME)!.line)).toBe("alice started a call that lasted 5 minutes.");
		// The user's own call nobody answered.
		const own = callRow(notice(9, { caller: ME, participants: [ME] }), dm, ME)!.line;
		expect(own).toMatchObject({ missed: false, key: "chat_call_notice_you_unanswered" });
		expect(callNoticeSentence(own)).toBe("You started a call. No one answered.");
	});

	// #376: with no avatar, a row drew a face made from its title, as for a person without a picture.
	test("a group's is its name, with the group's mark, and a call the user wasn't in is missed", () => {
		const row = callRow(notice(9, { conversation: GROUP, caller: BOB, participants: [BOB, ALICE] }), group, ME);
		expect(row).toMatchObject({ title: "Band", group: true, avatar: null });
		expect(row?.line).toEqual({
			missed: true,
			key: "chat_call_notice_missed",
			values: { name: "bob", duration: "5 minutes" },
		});
		expect(callNoticeSentence(row!.line)).toBe("You missed a call from bob that lasted 5 minutes.");
	});

	test("a conversation this client doesn't know is named as one, and anything but a call notice has none", () => {
		// Nobody's face either: its tab draws the group's mark for it too.
		expect(callRow(notice(9), undefined, ME)).toMatchObject({ title: "Chat", group: true, avatar: null });
		expect(callRow(text(9), dm, ME)).toBeNull();
	});

	// The user's membership of the group is newer than notice 9's call and older than notice 11's: they were added
	// between the two (#261).
	test("a group's call from before the user joined it doesn't say they missed it", () => {
		const joinedLate = {
			...group,
			members: group.members.map((m) => (m.user_id === ME ? { ...m, id: id(10) } : m)),
		};
		const before = (participants: string[]) =>
			callRow(notice(9, { conversation: GROUP, caller: BOB, participants }), joinedLate, ME)?.line;
		expect(before([BOB, ALICE])).toMatchObject({ missed: false, key: "chat_call_notice_started" });
		expect(callNoticeSentence(before([BOB, ALICE])!)).toBe("bob started a call that lasted 5 minutes.");
		expect(before([BOB])).toMatchObject({ missed: false, key: "chat_call_notice_unanswered" });
		expect(callNoticeSentence(before([BOB])!)).toBe("bob started a call. No one answered.");
		const after = callRow(notice(11, { conversation: GROUP, caller: BOB, participants: [BOB, ALICE] }), joinedLate, ME);
		expect(after?.line.missed).toBe(true);
	});
});

describe("a row's call button", () => {
	const none = new Set<string>();

	test("calls the conversation, or joins its call going on", () => {
		expect(callBackAction(DM, none, none, null)).toBe("call");
		expect(callBackAction(DM, new Set([DM]), none, null)).toBe("join");
	});

	test("does nothing while the user is in a call, places one or one rings them", () => {
		for (const state of ["connected", "calling", "ringing"] as const) {
			expect(callBackAction(DM, none, none, { conversationId: GROUP, state })).toBeNull();
			expect(callBackAction(DM, new Set([DM]), none, { conversationId: DM, state })).toBeNull();
		}
	});

	test("waits while the user's own call there still rings the others from another device", () => {
		expect(callBackAction(DM, new Set([DM]), new Set([DM]), null)).toBeNull();
		expect(callBackAction(GROUP, none, new Set([DM]), null)).toBe("call");
	});
});

describe("when a call rang", () => {
	const now = new Date(2026, 10, 9, 18, 0);
	const at = (...args: [number, number, number, number?, number?]) =>
		new Date(args[0], args[1], args[2], args[3] ?? 12, args[4] ?? 0).toISOString();
	// The system's languages, which lib/i18n/format.ts writes dates in when the first of the app's language is there.
	const systemIn = (...languages: string[]) =>
		Object.defineProperty(navigator, "languages", { value: languages, configurable: true });
	afterEach(() => Reflect.deleteProperty(navigator, "languages"));

	test("says the time today, Yesterday, the day within a week, and the date before", () => {
		systemIn("en-GB");
		expect(callTime(at(2026, 10, 9, 15, 42), now)).toBe("15:42");
		expect(callTime(at(2026, 10, 9, 0, 5), now)).toBe("00:05");
		expect(callTime(at(2026, 10, 8, 23, 59), now)).toBe("Yesterday");
		expect(callTime(at(2026, 10, 4), now)).toBe("Wed");
		expect(callTime(at(2026, 10, 3), now)).toBe("Tue");
		expect(callTime(at(2026, 10, 2), now)).toBe("02/11");
		expect(callTime(at(2025, 10, 9), now)).toBe("09/11/25");
	});

	test("says the day's name in the app's language whatever the system's, and nothing for a date it can't read", () => {
		systemIn("es-ES");
		expect(callTime(at(2026, 10, 4), now)).toBe("Wed");
		expect(callTime("not a date", now)).toBe("");
	});

	// The time keeps the system's clock, as a message's does (message-groups.ts), as it did before #464. A date is
	// written in the app's language: on a system in another one, as the app's language writes it (#464's dates).
	test("keeps the system's clock on a system in another language than the app's, and writes its dates in the app's", () => {
		systemIn("de-DE");
		expect(callTime(at(2026, 10, 9, 15, 42), now)).toBe("15:42");
		expect(callTime(at(2026, 10, 2), now)).toBe("11/2");
		systemIn("en-US");
		expect(callTime(at(2026, 10, 9, 15, 42), now)).toBe("03:42 PM");
	});
});
