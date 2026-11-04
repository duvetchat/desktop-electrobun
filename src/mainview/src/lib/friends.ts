import type { Friend, FriendRequest } from "$lib/api/friends";
import type { GatewayUser, UserUpdateEvent } from "$lib/types";

/** What the app shows of a friend, or of a friend request's other user. */
export type FriendUser = Pick<GatewayUser, "id" | "username" | "alias" | "avatar">;

/**
 * The other user of a friendship or a friend request (the sender of a request received, the recipient of one sent):
 * `user`, their public profile. An API from before it gives only the user_* fields, which repeat part of it, and the
 * other user is then whichever side isn't `me`.
 */
export function friendUser(f: Friend | FriendRequest, me: string | undefined): FriendUser {
	if (f.user) return f.user;
	return {
		id: f.sender_id === me ? f.recipient_id : f.sender_id,
		username: f.user_username,
		alias: f.user_alias,
		avatar: f.user_avatar,
	};
}

/**
 * The friends or the requests with the profile a USER_UPDATE gives, on those whose other user it is: in `user`, and in
 * the user_* fields that repeat it. An API from before bios sends no custom, and the bio stays.
 */
export function withUserUpdate<T extends Friend | FriendRequest>(
	list: T[],
	update: UserUpdateEvent,
	me: string | undefined,
): T[] {
	const bio = update.custom === undefined ? {} : { custom: update.custom };
	return list.map((f) => {
		if (friendUser(f, me).id !== update.id) return f;
		return {
			...f,
			user_username: update.username,
			user_alias: update.alias,
			user_avatar: update.avatar,
			user_banner: update.banner,
			user: f.user && {
				...f.user,
				username: update.username,
				alias: update.alias,
				avatar: update.avatar,
				banner: update.banner,
				flags: update.flags,
				badges: update.badges,
				...bio,
			},
		};
	});
}
