import { describe, expect, test } from "bun:test";
import type { Friend, FriendRequest } from "$lib/api/friends";
import type { GatewayUser, MemberOnSidebar, UserUpdateEvent } from "$lib/types";

// The API's host comes from constants Vite defines at build time.
Object.assign(globalThis, { VITE_API_URL: "https://api.test", VITE_WS_URL: "", VITE_DOMAIN_TARGET_ENV: "duvet" });
const { friendMember, friendUser, withUserUpdate } = await import("./friends");

const me = "me";
const ANA_AVATAR = "0190a3b2-0000-7000-8000-00000000a001";
const ANA_BANNER = "0190a3b2-0000-7000-8000-00000000a002";

/** A user as the API gives any user. */
function user(id: string, fields: Partial<GatewayUser> = {}): GatewayUser {
	return {
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
		created_at: "2026-10-27T00:00:00Z",
		updated_at: "2026-10-27T00:00:00Z",
		deleted_at: null,
		...fields,
	};
}

const ana = user("ana", { alias: "Ana", avatar: ANA_AVATAR, banner: ANA_BANNER, custom: "Hi", badges: 1 });
const bob = user("bob", { avatar: "bob-avatar" });

/** The other user as the API gives it: user, and the user_* fields that repeat it. */
function other(u: GatewayUser) {
	return { user_username: u.username, user_alias: u.alias, user_avatar: u.avatar, user_banner: u.banner, user: u };
}

/** The other user as an API from before user and user_banner gives it. */
function otherBefore(u: GatewayUser) {
	return { user_username: u.username, user_alias: u.alias, user_avatar: u.avatar };
}

function friendship(sender: string, recipient: string, otherUser: Partial<Friend>): Friend {
	return {
		id: `friend-${sender}-${recipient}`,
		request_id: `request-${sender}-${recipient}`,
		sender_id: sender,
		recipient_id: recipient,
		user_username: "",
		user_alias: null,
		user_avatar: null,
		status_id: 1,
		...otherUser,
	};
}

function request(sender: string, recipient: string, otherUser: Partial<FriendRequest>): FriendRequest {
	return {
		id: `request-${sender}-${recipient}`,
		sender_id: sender,
		recipient_id: recipient,
		created_at: "2026-10-27T00:00:00Z",
		updated_at: "2026-10-27T00:00:00Z",
		user_username: "",
		user_alias: null,
		user_avatar: null,
		...otherUser,
	};
}

/** ana's profile as a USER_UPDATE gives it, with her changes. */
function anaUpdate(fields: Partial<UserUpdateEvent> = {}): UserUpdateEvent {
	return {
		id: "ana",
		username: "ana2",
		alias: "Ana B.",
		avatar: "ana-avatar-2",
		banner: "ana-banner-2",
		custom: "Hello",
		flags: 4,
		badges: 3,
		...fields,
	};
}

describe("friendUser", () => {
	test("is the other user's public profile, from user", () => {
		expect(friendUser(friendship(me, "ana", other(ana)), me)).toEqual(ana);
		expect(friendUser(request("ana", me, other(ana)), me)).toEqual(ana);
		expect(friendUser(request(me, "ana", other(ana)), me)).toEqual(ana);
	});

	test("takes user over the user_* fields, which only repeat it for the clients from before it", () => {
		const stale = { ...other(ana), user_username: "old", user_alias: "Old", user_avatar: "old-avatar" };
		expect(friendUser(friendship(me, "ana", stale), me)).toEqual(ana);
	});

	test("from an API from before user: the user_* fields, as the side that isn't the user", () => {
		const shown = { id: "ana", username: "ana", alias: "Ana", avatar: ANA_AVATAR, banner: null };
		// Whoever sent the request that made them friends.
		expect(friendUser(friendship(me, "ana", otherBefore(ana)), me)).toEqual(shown);
		expect(friendUser(friendship("ana", me, otherBefore(ana)), me)).toEqual(shown);
		// A request received is the sender's, one sent the recipient's.
		expect(friendUser(request("ana", me, otherBefore(ana)), me)).toEqual(shown);
		expect(friendUser(request(me, "ana", otherBefore(ana)), me)).toEqual(shown);
		// One with user_banner but not user yet.
		const withBanner = { ...otherBefore(ana), user_banner: ANA_BANNER };
		expect(friendUser(friendship(me, "ana", withBanner), me)).toEqual({ ...shown, banner: ANA_BANNER });
	});
});

describe("friendMember", () => {
	// Ana's profile card: her name and avatar, and the banner, bio and badges only user gives.
	const card: MemberOnSidebar = {
		id: "ana",
		member_id: "",
		username: "Ana",
		raw_username: "ana",
		avatar_url: `https://api.test/attachments/${ANA_AVATAR}`,
		banner_url: `https://api.test/attachments/${ANA_BANNER}`,
		status: "online",
		badges: 1,
		is_bot: false,
		is_owner: false,
		roles: [],
		bio: "Hi",
	};

	test("is a friend's profile card, from user, with the status they show", () => {
		expect(friendMember(friendship(me, "ana", other(ana)), me, "online")).toEqual(card);
		expect(friendMember(friendship("ana", me, other(ana)), me, "dnd")).toEqual({ ...card, status: "dnd" });
	});

	test("is the profile card of whoever sent a request received", () => {
		expect(friendMember(request("ana", me, other(ana)), me, "online")).toEqual(card);
	});

	test("from an API from before user: the name, avatar and banner the user_* fields give, no bio, no badges", () => {
		const before = { ...card, badges: 0, bio: "" };
		const withBanner = { ...otherBefore(ana), user_banner: ANA_BANNER };
		expect(friendMember(friendship(me, "ana", withBanner), me, "online")).toEqual(before);
		expect(friendMember(request("ana", me, otherBefore(ana)), me, "online")).toEqual({ ...before, banner_url: null });
	});
});

describe("withUserUpdate", () => {
	test("gives the friend whose profile changed the new one, in user and in the user_* fields", () => {
		const withAna = friendship(me, "ana", other(ana));
		const withBob = friendship("bob", me, other(bob));
		const [updated, untouched] = withUserUpdate([withAna, withBob], anaUpdate(), me);
		const profile = { username: "ana2", alias: "Ana B.", avatar: "ana-avatar-2", banner: "ana-banner-2" };
		expect(updated.user).toEqual({ ...ana, ...profile, custom: "Hello", flags: 4, badges: 3 });
		expect(updated).toMatchObject({
			id: withAna.id,
			user_username: "ana2",
			user_alias: "Ana B.",
			user_avatar: "ana-avatar-2",
			user_banner: "ana-banner-2",
		});
		expect(friendUser(updated, me)).toMatchObject(profile);
		expect(untouched).toBe(withBob);
	});

	test("updates the requests received and sent alike", () => {
		const received = request("ana", me, other(ana));
		const sent = request(me, "ana", other(ana));
		for (const req of withUserUpdate([received, sent], anaUpdate(), me)) {
			expect(friendUser(req, me)).toMatchObject({ username: "ana2", alias: "Ana B.", avatar: "ana-avatar-2" });
			expect(req.user_banner).toBe("ana-banner-2");
		}
	});

	test("keeps the bio when the update has none, as an API from before bios sends it", () => {
		const [updated] = withUserUpdate([friendship(me, "ana", other(ana))], anaUpdate({ custom: undefined }), me);
		expect(updated.user?.custom).toBe("Hi");
		expect(updated.user?.alias).toBe("Ana B.");
	});

	test("from an API from before user: updates the user_* fields of the side that isn't the user", () => {
		const [updated] = withUserUpdate([friendship("ana", me, otherBefore(ana))], anaUpdate(), me);
		expect(updated.user).toBeUndefined();
		expect(friendUser(updated, me)).toEqual({
			id: "ana",
			username: "ana2",
			alias: "Ana B.",
			avatar: "ana-avatar-2",
			banner: "ana-banner-2",
		});
	});

	test("leaves everyone alone when the user's own profile changed", () => {
		const list = [friendship(me, "ana", other(ana)), friendship("ana", me, otherBefore(ana))];
		const updated = withUserUpdate(list, anaUpdate({ id: me }), me);
		expect(updated[0]).toBe(list[0]);
		expect(updated[1]).toBe(list[1]);
	});
});
