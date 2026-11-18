import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Permission } from "$lib/permissions";
import type { GatewayRole, GatewaySpace } from "$lib/types";

// The confirmation and the toasts are .svelte.ts modules, whose $state only Svelte's compiler knows: here it's the value
// itself, and a test reads what it holds as it is.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { kickFromSpace, moderationOf } = await import("$lib/moderation");
const { confirmStore } = await import("$lib/stores/confirm.svelte");
const { toastStore } = await import("$lib/stores/toast.svelte");

const SPACE = "01920000-0000-7000-8000-0000000005a0";
const OWNER = "01920000-0000-7000-8000-00000000000a";
const ME = "01920000-0000-7000-8000-00000000b0b0";
const CAROL = "01920000-0000-7000-8000-00000000ca01";
const CAROL_MEMBER = "01920000-0000-7000-8000-00000000c0c0";

const role = (id: string, permissions: number, position: number): GatewayRole => ({
	id,
	space_id: SPACE,
	name: id,
	color_from: null,
	color_via: null,
	color_to: null,
	flags: 0,
	permissions,
	created_at: "",
	updated_at: "",
	hoisted: false,
	position,
});
// The space as `me` has it, holding @everyone and `mine`; Carol holds @everyone alone.
const space = (mine: string[], me = ME): GatewaySpace => ({
	id: SPACE,
	name: "Alpha",
	description: null,
	banner: null,
	owner_id: OWNER,
	locale: null,
	member: { id: me, space_id: SPACE, user_id: me, alias: null, created_at: "", updated_at: "" },
	member_roles: { [me]: [SPACE, ...mine], [CAROL]: [SPACE] },
	room_overwrites: [],
	rooms: [],
	members: [],
	roles: [role(SPACE, 0, 0), role("helpers", Permission.KickMembers, 1), role("mods", Permission.BanMembers, 2)],
	users: [],
	created_at: "",
	updated_at: "",
});
const carol = { id: CAROL, member_id: CAROL_MEMBER, username: "Carol" };
const target = { spaceId: SPACE, spaceName: "Alpha", userId: CAROL, memberId: CAROL_MEMBER, name: "Carol" };

describe("what a member's menu offers", () => {
	test("Kick and Ban to whom the user may act on, with the member as a kick and a ban take them", () => {
		expect(moderationOf(space([], OWNER), carol)).toEqual({ target, kick: true, ban: true });
		expect(moderationOf(space(["helpers"]), carol)).toEqual({ target, kick: true, ban: false });
		expect(moderationOf(space(["mods"]), carol)).toEqual({ target, kick: false, ban: true });
	});

	test("nothing to whom they may not, outside a space, or without the member", () => {
		expect(moderationOf(space([]), carol)).toBeNull();
		expect(moderationOf(space([], OWNER), { ...carol, id: OWNER })).toBeNull();
		expect(moderationOf(null, carol)).toBeNull();
		expect(moderationOf(space([], OWNER), undefined)).toBeNull();
	});

	test("no Kick for a member whose member ID isn't known, which a kick goes by", () => {
		expect(moderationOf(space([], OWNER), { ...carol, member_id: "" })).toEqual({
			target: { ...target, memberId: "" },
			kick: false,
			ban: true,
		});
	});
});

describe("a kick", () => {
	const sent: string[] = [];
	let answer = () => new Response(null, { status: 204 });
	let fetched: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
	beforeEach(() => {
		sent.length = 0;
		toastStore.items = [];
		answer = () => new Response(null, { status: 204 });
		fetched = spyOn(globalThis, "fetch").mockImplementation((async (
			input: string | URL | Request,
			init?: RequestInit,
		) => {
			sent.push(`${init?.method} ${input instanceof Request ? input.url : input.toString()}`);
			return answer();
		}) as typeof fetch);
	});
	afterEach(() => fetched.mockRestore());

	test("asks first, and nothing goes until it's confirmed", () => {
		void kickFromSpace(target);
		expect(confirmStore.pending?.message).toBe("Kick Carol from Alpha? They can join again with an invite.");
		expect(confirmStore.pending?.confirmLabel).toBe("Kick");
		confirmStore.cancel();
		expect(sent).toEqual([]);
	});

	test("confirmed, deletes the member by their member ID, and says so", async () => {
		const done = kickFromSpace(target);
		await confirmStore.execute();
		await done;
		expect(sent).toEqual([`DELETE https://api.test/api/spaces/${SPACE}/members/${CAROL_MEMBER}`]);
		expect(toastStore.items.map((t) => [t.message, t.type])).toEqual([["Carol was kicked", "success"]]);
		expect(confirmStore.pending).toBeNull();
	});

	// The reason is the API's, as the app words what it knows (lib/api/error-wording.ts): a sentence, with its capital.
	test("refused, shows the API's reason in a toast", async () => {
		answer = () =>
			Response.json(
				{ error: "you can only kick or ban members whose highest role is below your highest role" },
				{ status: 403 },
			);
		const done = kickFromSpace(target);
		await confirmStore.execute();
		await done;
		expect(toastStore.items.map((t) => [t.message, t.type])).toEqual([
			["You can only kick or ban members whose highest role is below your highest role", "error"],
		]);
		expect(confirmStore.pending).toBeNull();
	});
});
