import { describe, expect, test } from "bun:test";
import {
	readySpacesArrived,
	withSpaceCreate,
	type GatewayMember,
	type GatewayRoom,
	type GatewaySpace,
	type GatewayUser,
} from "$lib/types";

// The gateway can send a SPACE_CREATE after READY's of a space the user joined while their connection was identifying,
// before one READY lists or as a second of one (gateway#94, #96): neither may count for a space still to come, and the
// last of a space is the one the gateway keeps the client up to date from (#128).
describe("readySpacesArrived", () => {
	test("waits for every space READY listed, and for those alone", () => {
		const listed = new Set(["A", "B"]);
		const arrived = new Set<string>();
		// One READY didn't list.
		arrived.add("C");
		expect(readySpacesArrived(listed, arrived)).toBe(false);
		arrived.add("A");
		expect(readySpacesArrived(listed, arrived)).toBe(false);
		// The same space again.
		arrived.add("A");
		expect(readySpacesArrived(listed, arrived)).toBe(false);
		arrived.add("B");
		expect(readySpacesArrived(listed, arrived)).toBe(true);
	});

	test("a READY without spaces has them all", () => {
		expect(readySpacesArrived(new Set(), new Set())).toBe(true);
	});
});

describe("withSpaceCreate", () => {
	const room = (id: string): GatewayRoom => ({
		id,
		space_id: "A",
		parent_id: null,
		type: 1,
		name: id,
		description: null,
		position: 0,
		nsfw: false,
		created_at: "",
		updated_at: "",
	});
	const space = (id: string, rooms: string[], extra: Partial<GatewaySpace> = {}): GatewaySpace => ({
		id,
		name: id,
		description: null,
		banner: null,
		owner_id: "me",
		locale: null,
		member_roles: {},
		room_overwrites: [],
		rooms: rooms.map(room),
		members: [],
		roles: [],
		users: [],
		voice_states: [],
		created_at: "",
		updated_at: "",
		...extra,
	});
	const member = (userId: string): GatewayMember => ({
		id: `member-${userId}`,
		space_id: "A",
		user_id: userId,
		alias: null,
		created_at: "",
		updated_at: "",
	});
	const user = (id: string): GatewayUser => ({
		id,
		username: id,
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

	test("adds a space it doesn't have at the end", () => {
		expect(withSpaceCreate([space("A", [])], space("B", [])).map((s) => s.id)).toEqual(["A", "B"]);
	});

	test("a later SPACE_CREATE of a space takes the earlier one's place: a room only the earlier one had goes", () => {
		const earlier = space("A", ["general", "gone"], { name: "Old" });
		const later = space("A", ["general"], { name: "New", member_roles: { ana: ["mods"] } });
		const spaces = withSpaceCreate([earlier, space("B", [])], later);
		expect(spaces.map((s) => s.id)).toEqual(["A", "B"]);
		expect(spaces[0].rooms.map((r) => r.id)).toEqual(["general"]);
		expect(spaces[0].name).toBe("New");
		expect(spaces[0].member_roles).toEqual({ ana: ["mods"] });
	});

	test("keeps what the client loaded that a SPACE_CREATE doesn't carry: the members, their users, the user's member", () => {
		const loaded = space("A", ["general"], {
			member: member("me"),
			members: [member("me"), member("ana")],
			users: [user("me"), user("ana")],
		});
		const later = space("A", ["general"], { member: member("me"), members: [member("me")], users: [user("me")] });
		const [replaced] = withSpaceCreate([loaded], later);
		expect(replaced.members).toBe(loaded.members);
		expect(replaced.users).toBe(loaded.users);
		expect(replaced.member).toBe(loaded.member);
	});
});
