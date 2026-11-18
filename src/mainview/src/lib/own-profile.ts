// The user's own profile, once Settings saved it: their new name and picture show everywhere at once, without a
// reload (the Spaces' member lists, their messages in rooms and in direct messages, the members of their
// conversations). Settings calls this where the app's stores are: in the page itself on the web, and in the main
// window for a save made in the Settings window (#357), which has none of them.
import { getAvatarURL } from "$lib/common/common";
import { channelMessages, conversations, currentUser, dmMessages, gatewaySpaces } from "$lib/stores.svelte";

/** The user as PATCH /api/users/@me answers. */
export interface SavedProfile {
	id: string;
	username: string;
	alias?: string | null;
	avatar?: string | null;
	banner?: string | null;
	custom?: string | null;
}

/** What crossed the windows as a saved profile, or null for anything else. */
export function parseSavedProfile(value: unknown): SavedProfile | null {
	if (typeof value !== "object" || value === null) return null;
	if (!("id" in value) || !("username" in value)) return null;
	const { id, username } = value;
	if (typeof id !== "string" || typeof username !== "string") return null;
	const fields: Record<string, unknown> = { ...value };
	const text = (key: "alias" | "avatar" | "banner" | "custom") => {
		const field = fields[key];
		return typeof field === "string" ? field : null;
	};
	return { id, username, alias: text("alias"), avatar: text("avatar"), banner: text("banner"), custom: text("custom") };
}

interface SpaceUser {
	id: string;
	username: string;
	alias: string | null;
	avatar: string | null;
	banner: string | null;
	custom?: string;
}

/** The user themselves, with what they saved. */
export function withProfile<User extends Omit<SpaceUser, "id">>(user: User, saved: SavedProfile): User {
	return {
		...user,
		username: saved.username,
		alias: saved.alias ?? null,
		avatar: saved.avatar ?? null,
		banner: saved.banner ?? null,
		custom: saved.custom ?? "",
	};
}

/** The Spaces with the user's new profile in each one's members; their picture there is its address. */
export function profileInSpaces<Space extends { users: SpaceUser[] }>(
	spaces: readonly Space[],
	saved: SavedProfile,
	avatarUrl: string | null,
): Space[] {
	return spaces.map((space) => ({
		...space,
		users: space.users.map((user) =>
			user.id === saved.id ? { ...withProfile(user, saved), avatar: avatarUrl } : user,
		),
	}));
}

interface RoomMessage {
	author_id: string;
	author_name?: string;
	author_avatar_url?: string | null;
}

/** The rooms' messages with the user's new name and picture on their own. */
export function profileInRoomMessages<Message extends RoomMessage>(
	rooms: Record<string, Message[]>,
	saved: SavedProfile,
	avatarUrl: string | null,
): Record<string, Message[]> {
	const name = saved.alias ?? saved.username;
	const result: Record<string, Message[]> = {};
	for (const [roomId, messages] of Object.entries(rooms)) {
		result[roomId] = messages.map((message) =>
			message.author_id === saved.id ? { ...message, author_name: name, author_avatar_url: avatarUrl } : message,
		);
	}
	return result;
}

interface DirectMessage {
	author_id: string;
	user?: { username: string; alias: string | null; avatar: string | null; banner: string | null } | null;
}

/** The conversations' messages with the user's new profile on their own. */
export function profileInDirectMessages<Message extends DirectMessage>(
	chats: Record<string, Message[]>,
	saved: SavedProfile,
	avatarUrl: string | null,
): Record<string, Message[]> {
	const result: Record<string, Message[]> = {};
	for (const [chatId, messages] of Object.entries(chats)) {
		result[chatId] = messages.map((message) => {
			if (message.author_id !== saved.id || !message.user) return message;
			return {
				...message,
				user: {
					...message.user,
					username: saved.username,
					alias: saved.alias ?? null,
					avatar: avatarUrl,
					banner: saved.banner ?? null,
				},
			};
		});
	}
	return result;
}

interface ChatMember {
	user_id: string;
	user: Omit<SpaceUser, "id">;
}

/** The conversations with the user's new profile among each one's members. */
export function profileInConversations<Chat extends { members: ChatMember[] }>(
	chats: readonly Chat[],
	saved: SavedProfile,
	avatarUrl: string | null,
): Chat[] {
	return chats.map((chat) => ({
		...chat,
		members: chat.members.map((member) =>
			member.user_id === saved.id
				? { ...member, user: { ...withProfile(member.user, saved), avatar: avatarUrl } }
				: member,
		),
	}));
}

/** Puts a saved profile in every store that shows the user. */
export function applyOwnProfile(saved: SavedProfile): void {
	currentUser.update((user) => (user ? withProfile(user, saved) : user));
	const avatarUrl = getAvatarURL(saved.id, saved.avatar);
	gatewaySpaces.update((spaces) => profileInSpaces(spaces, saved, avatarUrl));
	channelMessages.update((rooms) => profileInRoomMessages(rooms, saved, avatarUrl));
	dmMessages.update((chats) => profileInDirectMessages(chats, saved, avatarUrl));
	conversations.update((list) => profileInConversations(list, saved, avatarUrl));
}
