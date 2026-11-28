import { getAvatarURL, isUuid } from "$lib/common/common";
import { t } from "$lib/i18n";
import type { MemberOnSidebar } from "$lib/types";

/** Someone who reacted, as the dialog of who reacted shows them. */
export interface Reactor {
	id: string;
	name: string;
	/** Their username, which shows under their name; null while it isn't known. */
	username: string | null;
	avatar: string | null;
}

/** A user as GET /api/users/{id} gives them, as far as the dialog shows them. */
export interface ReactorProfile {
	id: string;
	username: string;
	alias: string | null;
	avatar: string | null;
}

type Member = Pick<MemberOnSidebar, "id" | "username" | "raw_username" | "avatar_url">;

/**
 * Who a reaction's user is: one of the members the view knows (the room's space's, or the conversation's), else as the
 * API gave them (asked: their profile, or null when it couldn't say, a deleted user). Until then, and when it can't say,
 * they're "Someone", without a username rather than a made-up one, as the mobile app shows them.
 */
export function reactorOf(
	userId: string,
	members: readonly Member[],
	asked: ReadonlyMap<string, ReactorProfile | null>,
): Reactor {
	const member = members.find((m) => m.id === userId);
	if (member) return { id: userId, name: member.username, username: member.raw_username, avatar: member.avatar_url };
	const profile = asked.get(userId);
	if (profile) {
		return {
			id: userId,
			name: profile.alias ?? profile.username,
			username: profile.username,
			avatar: getAvatarURL(userId, profile.avatar),
		};
	}
	return { id: userId, name: t("media_reactor_unknown"), username: null, avatar: null };
}

/**
 * Whom of a reaction's users the API is to be asked about: those no member is, not asked already, in their order, each
 * once. Only IDs: they go into the request's path.
 */
export function reactorsToAsk(
	userIds: readonly string[],
	members: readonly Member[],
	asked: ReadonlySet<string>,
): string[] {
	const known = new Set(members.map((m) => m.id));
	return [...new Set(userIds)].filter((id) => !known.has(id) && !asked.has(id) && isUuid(id));
}
