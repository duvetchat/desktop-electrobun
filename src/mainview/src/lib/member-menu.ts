// A member's menu (#423): one for every list of people (the members column and its popover, a group's members, Space
// settings → Members, a voice room's people in the sidebar, a message's author), drawn by MemberMenu.svelte. What it
// offers is worked out here, as the API allows it; an item the user can't use isn't there, rather than greyed out.

import type { Conversation } from "$lib/api/conversations";
import type { Friend, FriendRequest } from "$lib/api/friends";
import { moderationOf } from "$lib/moderation";
import { canManageRoleAt, hasSpacePermission, Permission } from "$lib/permissions";
import type { GatewayRole, GatewaySpace, MemberOnSidebar } from "$lib/types";

/** Whom a member's menu is about, as its list knows them. */
export interface MenuPerson {
	/** Their user's ID. */
	id: string;
	/** Their member ID in the Space, which a role given or taken and a kick go by; "" where the list doesn't know it. */
	memberId: string;
	/** Their name as the list shows it. */
	name: string;
	isBot: boolean;
	/** Their flags and badges, where the list has their user (a Space's); null where it doesn't. */
	flags: { flags: number; badges: number } | null;
}

/** Where the user stands with them. */
export interface Ties {
	friend: boolean;
	/** They sent the user a friend request, which waits. */
	askedMe: boolean;
	/** The user sent them one, which waits. */
	askedThem: boolean;
	/** The user has a direct conversation with them. */
	dm: boolean;
}

export interface MemberMenuInput {
	/** The user, and whether they're Duvet staff. */
	me: { id: string; staff: boolean } | null;
	person: MenuPerson;
	/** The Space the list is of; null for a conversation's. */
	space: GatewaySpace | null;
	ties: Ties;
	/** The user is in a call, places one, or one rings them: no other one starts (startConversationCall). */
	busy: boolean;
	/** What the list does with a member: opens their profile beside them, mentions them in its chat's box, takes them out
	 * of its group (for the group's owner). */
	can: { profile: boolean; mention: boolean; removeFromGroup: boolean };
}

export interface MemberMenuItems {
	profile: boolean;
	mention: boolean;
	/** Their direct conversation, which a DM opens. */
	message: boolean;
	/** A call in their direct conversation. */
	call: boolean;
	friend: "add" | "accept" | "remove" | null;
	/** The roles the user may give them or take from them, the highest first, and whether they hold each. */
	roles: { role: GatewayRole; held: boolean }[];
	/** The user's own display name, on their own row. */
	displayName: boolean;
	/** Kick and Ban, as today (moderationOf). */
	moderation: ReturnType<typeof moderationOf>;
	removeFromGroup: boolean;
	/** Duvet staff's flags and badges editor. */
	staff: boolean;
}

/**
 * Whether the user (`me`) can open a direct conversation with someone: someone else, a person and not a bot, with whom
 * they have one already or can start one, which takes a friendship (the API's rule). A member's menu offers Message
 * and Call by it, and their profile Send direct message.
 */
export function canChatWith(
	me: string | null | undefined,
	person: Pick<MenuPerson, "id" | "isBot">,
	ties: Pick<Ties, "friend" | "dm">,
): boolean {
	return !!me && me !== person.id && !person.isBot && (ties.dm || ties.friend);
}

/**
 * What a member's menu offers, besides Copy user ID, which it always has:
 * - Profile and Mention where its list does them;
 * - for someone else: Message and Call in a direct conversation the user has with them, or can start, which takes a
 *   friendship (the API's rule), Call while no call is the user's; Add friend, Accept friend request or Remove friend;
 *   none of these for a bot, which takes no friend request (the friend routes are a person's) and no call;
 * - in a Space, the roles the user may give or take (Manage Roles, a role below their highest, any for the owner: the
 *   API's checkRoleHierarchy), for a member whose member ID the list knows, and Kick and Ban, as the API allows them;
 * - Remove from group, for the group's owner, on anyone else;
 * - the user's display name, on their own row;
 * - Duvet staff's editor, for someone whose flags the list has.
 */
export function memberMenuItems({ me, person, space, ties, busy, can }: MemberMenuInput): MemberMenuItems {
	const self = me?.id === person.id;
	const other = !!me && !self;
	// Someone else who is a person, not a bot.
	const human = other && !person.isBot;
	const chats = canChatWith(me?.id, person, ties);
	const managesRoles = !!space && !!person.memberId && hasSpacePermission(space, Permission.ManageRoles);
	const held = new Set(space?.member_roles[person.id] ?? []);
	return {
		profile: can.profile,
		mention: can.mention,
		message: chats,
		call: chats && !busy,
		friend: !human ? null : ties.friend ? "remove" : ties.askedMe ? "accept" : ties.askedThem ? null : "add",
		roles: managesRoles
			? space.roles
					.filter((role) => role.id !== space.id && canManageRoleAt(space, role.position))
					.sort((a, b) => b.position - a.position)
					.map((role) => ({ role, held: held.has(role.id) }))
			: [],
		displayName: self,
		moderation: other
			? moderationOf(space, { id: person.id, member_id: person.memberId, username: person.name })
			: null,
		removeFromGroup: can.removeFromGroup && other,
		staff: !!me?.staff && person.flags !== null,
	};
}

/**
 * A member of a list as its menu takes them: a Space's, with their member ID and their flags from the Space's user; a
 * conversation's (no Space), whose member ID isn't a Space's. The gateway's own row for the user carries their user ID
 * as its member ID until a page of the Space's members brings theirs: no member ID, then.
 */
export function personOf(
	member: Pick<MemberOnSidebar, "id" | "member_id" | "username" | "is_bot">,
	space: GatewaySpace | null,
): MenuPerson {
	const user = space?.users.find((u) => u.id === member.id);
	return {
		id: member.id,
		memberId: space && member.member_id !== member.id ? member.member_id : "",
		name: member.username,
		isBot: member.is_bot,
		flags: user ? { flags: user.flags ?? 0, badges: user.badges ?? 0 } : null,
	};
}

type Between = Pick<Friend | FriendRequest, "sender_id" | "recipient_id">;

/** Where the user (`me`) stands with `userId`, from the friends, the requests each way and the conversations. */
export function tiesOf(
	userId: string,
	me: string,
	lists: {
		friends: Between[];
		received: Between[];
		sent: Between[];
		conversations: { type: Conversation["type"]; members: { user_id: string }[] }[];
	},
): Ties {
	return {
		friend: lists.friends.some(
			(f) => (f.sender_id === me && f.recipient_id === userId) || (f.sender_id === userId && f.recipient_id === me),
		),
		askedMe: lists.received.some((r) => r.sender_id === userId),
		askedThem: lists.sent.some((r) => r.recipient_id === userId),
		dm: lists.conversations.some((c) => c.type === 1 && c.members.some((m) => m.user_id === userId)),
	};
}
