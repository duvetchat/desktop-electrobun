import { beforeEach, expect, mock, test } from "bun:test";
// @ts-expect-error: Svelte ships no types for its internals, and this needs the one `$state` compiles to.
import { proxy } from "svelte/internal/client";
import { get } from "svelte/store";
import type { SpaceMemberWithUser } from "$lib/api/spaces";
import type { GatewayMember, GatewaySpace, GatewayUser } from "$lib/types";

// The pages' store as the app runs it: Svelte's compiler makes `$state(value)` a proxy of value, which keeps each
// property in a signal of its own, read from the object it was made from the first time it's read, and never again.
// member-pages.test.ts takes $state for the value itself, where an object written past its proxy reads as written.
Object.assign(globalThis, { $state: proxy });

// How the API answers the next page of members, and how many it was asked for.
let answer: () => Promise<SpaceMemberWithUser[]> = async () => [];
let asked = 0;
mock.module("$lib/api/spaces", () => ({
	MEMBERS_PAGE_SIZE: 2,
	getSpaceMembers: () => {
		asked++;
		return answer();
	},
}));
const { gatewaySpaces } = await import("$lib/stores.svelte");
const {
	ensureMembers,
	forgetMemberPages,
	loadEveryMember,
	loadMoreMembers,
	memberJoined,
	membersLoading,
	moreMembers,
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
const member = (n: number): GatewayMember => ({
	id: `member-${n}`,
	space_id: "harbour",
	user_id: `user-${n}`,
	alias: null,
	created_at: "",
	updated_at: "",
});
const row = (n: number): SpaceMemberWithUser => ({ ...member(n), user: user(n), max_pos: -1 });
const space: GatewaySpace = {
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
	users: [user(1)],
	members: [member(1)],
	created_at: "",
	updated_at: "",
};

beforeEach(() => {
	forgetMemberPages();
	asked = 0;
	gatewaySpaces.set([space]);
});

// #388: the pager of a Space's first page was the object its store's proxy was made from (`??=` gives the value
// assigned), so what the page wrote as it ended never reached the proxy: the members popover, which reads the pager
// while the page is on its way, kept its spinner for good, and asked for no page after it.
test("a Space's first page ends its spinner as it lands, and the page after it can be asked for", async () => {
	let land!: (page: SpaceMemberWithUser[]) => void;
	answer = () => new Promise((resolve) => (land = resolve));
	const first = ensureMembers("harbour");
	expect(membersLoading("harbour")).toBe(true);
	land([row(1), row(2)]);
	await first;
	expect(membersLoading("harbour")).toBe(false);

	answer = async () => [row(3)];
	await loadMoreMembers("harbour");
	expect(asked).toBe(2);
	expect(membersLoading("harbour")).toBe(false);
});

// #380: the Members section of a Space's settings asks for the next page each time one lands, as its effect reads the
// pager: through the proxy, it gets them all, and someone who joins after them.
test("a list of every member gets the Space's pages one after another, and one who joins after them", async () => {
	const pages = [[row(1), row(2)], [row(3), row(4)], [row(5)], [row(5), row(6)]];
	answer = async () => pages.shift() ?? [];
	const held = () => get(gatewaySpaces).find((s) => s.id === "harbour")!.users.length;
	for (let i = 0; i < 6; i++) await loadEveryMember("harbour", held(), 100);
	expect(asked).toBe(3);
	expect(held()).toBe(5);
	expect(moreMembers("harbour")).toBe(false);
	memberJoined("harbour");
	await loadEveryMember("harbour", held(), 100);
	expect(held()).toBe(6);
	expect(membersLoading("harbour")).toBe(false);
});
