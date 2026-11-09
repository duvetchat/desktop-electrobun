import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { get } from "svelte/store";
import { banAdded, banLifted, forgetBans, loadBans, spaceBans, withBan, withoutBan, withPage } from "$lib/bans";
import type { SpaceBan } from "$lib/types";

const SPACE = "01920000-0000-7000-8000-0000000005a0";
const OTHER_SPACE = "01920000-0000-7000-8000-0000000005b0";
const MOD = "01920000-0000-7000-8000-00000000a0d0";
// Banned users, in the order of their IDs.
const user = (n: number) => `01930000-0000-7000-8000-${String(n).padStart(12, "0")}`;

const ban = (n: number, reason: string | null = null, spaceId = SPACE): SpaceBan => ({
	space_id: spaceId,
	user_id: user(n),
	user: {
		id: user(n),
		username: `banned${n}`,
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
	banned_by: MOD,
	created_at: "2026-11-09T00:00:00Z",
});
const ids = (spaceId = SPACE) => get(spaceBans)[spaceId]?.bans.map((b) => b.user_id) ?? null;

describe("a list of bans", () => {
	const list = (ns: number[], more = false) => ({ bans: ns.map((n) => ban(n)), after: user(ns.at(-1) ?? 0), more });

	test("takes a new ban in its place by the user's ID", () => {
		expect(withBan(list([1, 3]), ban(2)).bans.map((b) => b.user_id)).toEqual([user(1), user(2), user(3)]);
		expect(withBan(list([1, 3]), ban(4)).bans.map((b) => b.user_id)).toEqual([user(1), user(3), user(4)]);
		expect(withBan(list([]), ban(4)).bans.map((b) => b.user_id)).toEqual([user(4)]);
	});

	test("keeps a ban it has as it is: a ban isn't edited", () => {
		const kept = list([1, 2]);
		expect(withBan(kept, ban(2, "another reason"))).toBe(kept);
	});

	test("loses a lifted ban, and is the same list when it didn't have it", () => {
		expect(withoutBan(list([1, 2, 3]), user(2)).bans.map((b) => b.user_id)).toEqual([user(1), user(3)]);
		const kept = list([1]);
		expect(withoutBan(kept, user(2))).toBe(kept);
	});

	test("takes a page in, the next one after its last, and more only when it was full", () => {
		const first = withPage(undefined, [ban(1), ban(2)], 2);
		expect(first).toEqual({ bans: [ban(1), ban(2)], after: user(2), more: true });
		const last = withPage(first, [ban(3)], 2);
		expect(last).toEqual({ bans: [ban(1), ban(2), ban(3)], after: user(3), more: false });
		expect(withPage(last, [], 2)).toEqual({ ...last, more: false });
	});

	test("a page leaves out the bans lifted while it was on its way, and those the list has from events", () => {
		const fromEvents = { bans: [ban(2, "from the event")], after: null, more: true };
		const merged = withPage(fromEvents, [ban(1), ban(2, "from the page"), ban(3)], 3, new Set([user(3)]));
		expect(merged.bans).toEqual([ban(1), ban(2, "from the event")]);
		// The next page still starts after the last the API listed.
		expect(merged.after).toBe(user(3));
	});
});

// The store, loaded from the API (a fetch of the test's), with the events in between.
describe("the bans store", () => {
	// The pages the API answers, in order, each given as soon as it's asked for or once its gate opens; and the URLs it
	// was asked.
	interface Answer {
		page: SpaceBan[];
		until?: Promise<void>;
	}
	let answers: Answer[] = [];
	const asked: string[] = [];
	let fetched: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
	beforeEach(() => {
		forgetBans();
		answers = [];
		asked.length = 0;
		fetched = spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request) => {
			asked.push(input instanceof Request ? input.url : input.toString());
			const answer = answers.shift() ?? { page: [] };
			if (answer.until) await answer.until;
			return Response.json(answer.page);
		}) as typeof fetch);
	});
	afterEach(() => fetched.mockRestore());
	const gate = () => {
		let open = () => {};
		const until = new Promise<void>((resolve) => (open = resolve));
		return { until, open };
	};
	const page = (...bans: SpaceBan[]): Answer => ({ page: bans });
	const fullPage = (from: number) => page(...Array.from({ length: 50 }, (_, i) => ban(from + i)));

	test("loads the first page anew, then the next one after it", async () => {
		answers = [fullPage(1), page(ban(51), ban(52))];
		await loadBans(SPACE, true);
		expect(get(spaceBans)[SPACE]).toMatchObject({ after: user(50), more: true });
		await loadBans(SPACE);
		expect(ids()).toEqual(Array.from({ length: 52 }, (_, i) => user(i + 1)));
		expect(get(spaceBans)[SPACE]).toMatchObject({ after: user(52), more: false });
		expect(asked).toEqual([
			`https://api.test/api/spaces/${SPACE}/bans?count=50`,
			`https://api.test/api/spaces/${SPACE}/bans?after=${user(50)}&count=50`,
		]);
	});

	test("anew, drops what the list had", async () => {
		answers = [page(ban(1), ban(2)), page(ban(3))];
		await loadBans(SPACE, true);
		await loadBans(SPACE, true);
		expect(ids()).toEqual([user(3)]);
	});

	test("SPACE_BAN_ADD and SPACE_BAN_REMOVE change a loaded list, and only that space's", async () => {
		answers = [page(ban(1), ban(3))];
		await loadBans(SPACE, true);
		banAdded(ban(2));
		banAdded(ban(9, null, OTHER_SPACE));
		expect(ids()).toEqual([user(1), user(2), user(3)]);
		banLifted({ space_id: SPACE, user_id: user(1) });
		banLifted({ space_id: OTHER_SPACE, user_id: user(3) });
		expect(ids()).toEqual([user(2), user(3)]);
		// A space whose list isn't loaded keeps none: opening it loads it anew.
		expect(ids(OTHER_SPACE)).toBeNull();
	});

	test("while a page is on its way, events change the list, and a ban lifted meanwhile stays out of it", async () => {
		const { until, open } = gate();
		answers = [{ page: [ban(1), ban(2), ban(3)], until }];
		const loading = loadBans(SPACE, true);
		banAdded(ban(4, "while loading"));
		banLifted({ space_id: SPACE, user_id: user(2) });
		expect(ids()).toEqual([user(4)]);
		open();
		await loading;
		expect(ids()).toEqual([user(1), user(3), user(4)]);
	});

	test("a page asked for before the list was loaded anew, or forgotten, is dropped", async () => {
		const first = gate();
		answers = [page(ban(1)), { page: [ban(7), ban(8)], until: first.until }, page(ban(2))];
		await loadBans(SPACE, true);
		const older = loadBans(SPACE);
		await loadBans(SPACE, true);
		first.open();
		await older;
		expect(ids()).toEqual([user(2)]);

		const second = gate();
		answers = [{ page: [ban(5)], until: second.until }];
		const forgotten = loadBans(SPACE, true);
		forgetBans(SPACE);
		second.open();
		await forgotten;
		expect(ids()).toBeNull();
	});

	test("forgetting one space keeps the others'; forgetting them all keeps none", async () => {
		answers = [page(ban(1)), page(ban(2, null, OTHER_SPACE))];
		await loadBans(SPACE, true);
		await loadBans(OTHER_SPACE, true);
		forgetBans(SPACE);
		expect(ids()).toBeNull();
		expect(ids(OTHER_SPACE)).toEqual([user(2)]);
		forgetBans();
		expect(get(spaceBans)).toEqual({});
	});

	test("a failed page fails the load and leaves the list as it was", async () => {
		answers = [page(ban(1))];
		await loadBans(SPACE, true);
		fetched.mockImplementation((async (_input: string | URL | Request) =>
			Response.json({ error: "you don't have permission to ban members" }, { status: 403 })) as typeof fetch);
		const failed = await loadBans(SPACE).catch((err) => err);
		expect(failed.response.data.error).toBe("you don't have permission to ban members");
		expect(get(spaceBans)[SPACE]).toMatchObject({ after: user(1), more: false });
		expect(ids()).toEqual([user(1)]);
	});
});
