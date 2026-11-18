import { beforeEach, expect, mock, test } from "bun:test";
import { get } from "svelte/store";
import type { SpaceMemberWithUser } from "$lib/api/spaces";
import type { GatewayMember, GatewaySpace, GatewayUser } from "$lib/types";

// The pages the API hands out, in order, and what it was asked for each. A promise is a page still on its way.
let pages: (SpaceMemberWithUser[] | "fails" | Promise<SpaceMemberWithUser[]>)[] = [];
let asked: { spaceId: string; after: string | undefined }[] = [];
mock.module("$lib/api/spaces", () => ({
	MEMBERS_PAGE_SIZE: 2,
	getSpaceMembers: async (spaceId: string, cursor?: { id: string }) => {
		asked.push({ spaceId, after: cursor?.id });
		const page = pages.shift();
		if (!page || page === "fails") throw new Error("no page");
		return page;
	},
}));
// The store's .svelte.ts module uses $state, which only Svelte's compiler knows: here it's the value itself.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { gatewaySpaces } = await import("$lib/stores.svelte");
const {
	cursorAfter,
	ensureMembers,
	forgetMemberPages,
	loadMoreMembers,
	membersFailed,
	membersLoading,
	restartMembers,
	withMemberPage,
} = await import("$lib/stores/member-pages.svelte");

const user = (n: number): GatewayUser => ({
	id: `user-${n}`,
	username: `person${n}`,
	email_verified: true,
	alias: null,
	avatar: null,
	banner: null,
	custom: "",
	flags: 0,
	badges: 0,
	is_bot: false,
	created_at: "",
	updated_at: "",
});

const member = (id: string, n: number): GatewayMember => ({
	id,
	space_id: "harbour",
	user_id: `user-${n}`,
	alias: null,
	created_at: "",
	updated_at: "",
});

const row = (n: number, pos = 3): SpaceMemberWithUser => ({ ...member(`member-${n}`, n), user: user(n), max_pos: pos });

const space = (users: number[]): GatewaySpace => ({
	id: "harbour",
	name: "Harbour",
	description: null,
	banner: null,
	owner_id: "user-1",
	locale: null,
	member_roles: {},
	room_overwrites: [],
	rooms: [],
	roles: [],
	users: users.map(user),
	// The gateway's placeholder for a member: a row of its own making for their user.
	members: users.map((n) => member(`placeholder-${n}`, n)),
	created_at: "",
	updated_at: "",
});

const held = () => get(gatewaySpaces).find((s) => s.id === "harbour")!;

beforeEach(() => {
	pages = [];
	asked = [];
	forgetMemberPages();
	gatewaySpaces.set([space([1])]);
});

test("a page adds the users the Space didn't have and replaces the placeholders of those it had", () => {
	const merged = withMemberPage(space([1]), [row(1), row(2)]);
	expect(merged.users.map((u) => u.id)).toEqual(["user-1", "user-2"]);
	expect(merged.members.map((m) => m.id)).toEqual(["member-1", "member-2"]);
	// A member's row is the member alone: its user and its rank stay out of it.
	expect(merged.members[0]).not.toHaveProperty("user");
	expect(merged.members[0]).not.toHaveProperty("max_pos");
});

test("the next page starts after the last member of a full page, and a short page is the last", () => {
	expect(cursorAfter([row(1), row(2, 7)], 2)).toEqual({ id: "member-2", pos: 7 });
	// A member without a role ranks at -1, which the API takes as no position.
	expect(cursorAfter([row(1), row(2, -1)], 2)).toEqual({ id: "member-2", pos: null });
	expect(cursorAfter([row(1)], 2)).toBeNull();
	expect(cursorAfter([], 2)).toBeNull();
});

test("pages load one after the other into the Space, until a short one", async () => {
	pages = [[row(1), row(2)], [row(3)]];
	await loadMoreMembers("harbour");
	expect(held().members.map((m) => m.id)).toEqual(["member-1", "member-2"]);
	await loadMoreMembers("harbour");
	expect(held().members.map((m) => m.id)).toEqual(["member-1", "member-2", "member-3"]);
	// Nothing is left: no third request.
	await loadMoreMembers("harbour");
	expect(asked).toEqual([
		{ spaceId: "harbour", after: undefined },
		{ spaceId: "harbour", after: "member-2" },
	]);
});

test("two lists asking at once get one request, and the spinner shows meanwhile", async () => {
	pages = [[row(1), row(2)]];
	const first = loadMoreMembers("harbour");
	expect(membersLoading("harbour")).toBe(true);
	const second = loadMoreMembers("harbour");
	await Promise.all([first, second]);
	expect(asked).toHaveLength(1);
	expect(membersLoading("harbour")).toBe(false);
	expect(membersLoading(null)).toBe(false);
});

test("a page that fails leaves the list as it was, and the next try asks for the same page", async () => {
	const logged = console.error;
	console.error = () => {};
	try {
		pages = ["fails", [row(1), row(2)]];
		await loadMoreMembers("harbour");
		expect(held().members.map((m) => m.id)).toEqual(["placeholder-1"]);
		expect(membersLoading("harbour")).toBe(false);
		await loadMoreMembers("harbour");
		expect(asked.map((a) => a.after)).toEqual([undefined, undefined]);
	} finally {
		console.error = logged;
	}
});

test("the first page is asked for once, however many panes show the Space", async () => {
	pages = [[row(1), row(2)]];
	await ensureMembers("harbour", 1);
	await ensureMembers("harbour", held().users.length);
	await ensureMembers("harbour", held().users.length);
	expect(asked).toHaveLength(1);
});

test("a Space loaded anew, without its pages, starts over from the first", async () => {
	pages = [
		[row(1), row(2)],
		[row(3), row(4)],
		[row(1), row(2)],
	];
	await ensureMembers("harbour", 1);
	await loadMoreMembers("harbour");
	expect(held().users).toHaveLength(4);
	// A new gateway session: the Space comes back with the one user it sends.
	gatewaySpaces.set([space([1])]);
	await ensureMembers("harbour", 1);
	expect(asked.map((a) => a.after)).toEqual([undefined, "member-2", undefined]);
	expect(held().members.map((m) => m.id)).toEqual(["member-1", "member-2"]);
});

test("starting over drops the page on its way", async () => {
	pages = [
		[row(5), row(6)],
		[row(1), row(2)],
	];
	const stale = loadMoreMembers("harbour");
	const fresh = restartMembers("harbour");
	await Promise.all([stale, fresh]);
	expect(held().members.map((m) => m.id)).toEqual(["member-1", "member-2"]);
});

// Runs a test whose pages fail without their errors' lines in its output.
async function quietly(run: () => Promise<void>) {
	const logged = console.error;
	console.error = () => {};
	try {
		await run();
	} finally {
		console.error = logged;
	}
}

// #388: a page that failed was only logged. The spinner went and the list stayed as it was, with nothing to say so, and
// nothing asked for it again but a scroll to the list's end, which a list of a few members can't have: a Space whose
// first page failed showed its user alone until the app closed.
test("a page that fails says so, and is asked for again when it's tried again, not before", async () => {
	await quietly(async () => {
		pages = ["fails", [row(1), row(2)]];
		await ensureMembers("harbour", 1);
		expect(membersFailed("harbour")).toBe(true);
		expect(membersLoading("harbour")).toBe(false);
		// The faces in a pane's bar ask as the Space changes, and the list as it shows: neither asks again by itself, which
		// would ask in a loop while the API refuses.
		await ensureMembers("harbour", held().users.length);
		expect(asked).toHaveLength(1);
		// Try again: the same page, which clears the failure as it comes.
		await loadMoreMembers("harbour");
		expect(membersFailed("harbour")).toBe(false);
		expect(asked.map((a) => a.after)).toEqual([undefined, undefined]);
		expect(held().members.map((m) => m.id)).toEqual(["member-1", "member-2"]);
		expect(membersFailed(null)).toBe(false);
	});
});

test("a new session starts the members over, those of a Space whose page failed too", async () => {
	await quietly(async () => {
		pages = ["fails", [row(1), row(2)]];
		await ensureMembers("harbour", 1);
		expect(membersFailed("harbour")).toBe(true);
		// READY: the Spaces come back without their pages.
		forgetMemberPages();
		expect(membersFailed("harbour")).toBe(false);
		await ensureMembers("harbour", 1);
		expect(asked).toHaveLength(2);
		expect(held().members.map((m) => m.id)).toEqual(["member-1", "member-2"]);
	});
});

// #388 also had a Space switch race the page on its way: since #357 each Space has its own pages, which this keeps.
test("two Spaces' pages on their way at once land each in its own Space, each ending only its own spinner", async () => {
	gatewaySpaces.set([space([1]), { ...space([1]), id: "cove", name: "Cove" }]);
	let harbourPage!: (page: SpaceMemberWithUser[]) => void;
	let covePage!: (page: SpaceMemberWithUser[]) => void;
	pages = [new Promise((resolve) => (harbourPage = resolve)), new Promise((resolve) => (covePage = resolve))];
	const harbour = loadMoreMembers("harbour");
	const cove = loadMoreMembers("cove");
	covePage([row(7)]);
	await cove;
	expect(membersLoading("cove")).toBe(false);
	expect(membersLoading("harbour")).toBe(true);
	harbourPage([row(1), row(2)]);
	await harbour;
	expect(membersLoading("harbour")).toBe(false);
	const of = (id: string) =>
		get(gatewaySpaces)
			.find((s) => s.id === id)!
			.members.map((m) => m.id);
	expect(of("harbour")).toEqual(["member-1", "member-2"]);
	expect(of("cove")).toEqual(["placeholder-1", "member-7"]);
});
