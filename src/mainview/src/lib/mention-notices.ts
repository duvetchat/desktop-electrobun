import { get, writable } from "svelte/store";
import type { Conversation, DirectMessage } from "$lib/api/conversations";
import { getAvatarURL } from "$lib/common/common";
import { mentionNamesIn, type CustomEmojiMap } from "$lib/markdown";
import { conversationTitle } from "$lib/pane";
import { messageText, type Message } from "$lib/types";
import type { MessageLink } from "$lib/urls";

/**
 * A notice at the top of the window that someone mentioned the user in a room or a conversation that isn't on screen:
 * who, where, and what they wrote, which opens the message when clicked. It shows when the mention's sound plays
 * (mentionSound, lib/status.ts): not for the chat on screen, and not in do not disturb.
 */
export interface MentionNotice {
	/** The message's ID. */
	id: string;
	link: MessageLink;
	authorName: string;
	authorAvatar: string | null;
	/** Where, as the notice says it after the author: "in #room · Space", "in Group", "in a direct message". */
	where: string;
	/** The message's text, which shows on a line or two as a reply's quote does (renderMarkdownLine); "" for none. */
	text: string;
	/** The names of the people its text mentions, and its space's custom emojis, as renderMarkdownLine takes them. */
	mentionMap: Record<string, string>;
	customEmojiMap: CustomEmojiMap;
}

/** Where a mention is: the link that opens its message, and what the notice says. */
export interface MentionPlace {
	link: MessageLink;
	where: string;
}

/** Where a mention in a room is, by the spaces the user is in; null for a room none of them has. */
export function roomPlace(
	spaces: readonly { id: string; name: string; rooms: readonly { id: string; name: string }[] }[],
	roomId: string,
	messageId: string,
): MentionPlace | null {
	const space = spaces.find((s) => s.rooms.some((r) => r.id === roomId));
	const room = space?.rooms.find((r) => r.id === roomId);
	if (!space || !room) return null;
	return { link: { spaceId: space.id, roomId, messageId }, where: `in #${room.name} · ${space.name}` };
}

/** Where a mention in a conversation is: a group by its name, a DM as a direct message, whose author says who. */
export function conversationPlace(
	conversation: Pick<Conversation, "type" | "name" | "members" | "id"> | undefined,
	conversationId: string,
	messageId: string,
	me: string | undefined,
): MentionPlace {
	const link = { spaceId: "", roomId: "", messageId, conversationId };
	if (conversation?.type !== 2) return { link, where: "in a direct message" };
	return { link, where: `in ${conversationTitle(conversation, me)}` };
}

/** A conversation's message as a notice names its author: as the message has them, else as the conversation does. */
export function directMessageAuthor(
	message: Pick<DirectMessage, "author_id" | "user">,
	conversation: Pick<Conversation, "members"> | undefined,
): { name: string; avatar: string | null } {
	const user = message.user ?? conversation?.members.find((m) => m.user_id === message.author_id)?.user;
	return {
		name: user?.alias ?? user?.username ?? message.author_id.slice(0, 8),
		avatar: getAvatarURL(message.author_id, user?.avatar),
	};
}

/**
 * The notice of a mention: its message's author and text (messageText: its content, or its text displays), at place.
 * The people its text names show by the names the app knows (people), as a bio's do.
 */
export function mentionNoticeOf(
	message: Pick<Message, "id" | "author_name" | "author_avatar_url" | "content" | "flags" | "components">,
	place: MentionPlace,
	people: { id: string; username: string; alias?: string | null }[],
	customEmojiMap: CustomEmojiMap,
): MentionNotice {
	const text = messageText(message);
	return {
		id: message.id,
		link: place.link,
		authorName: message.author_name,
		authorAvatar: message.author_avatar_url,
		where: place.where,
		text,
		mentionMap: text.includes("<@") ? mentionNamesIn(text, people) : {},
		customEmojiMap,
	};
}

/** How long a notice shows, and how many show at once: a new one goes on top, and the oldest goes past them. */
export const NOTICE_TIME = 6000;
export const NOTICES_SHOWN = 3;

/** The notices showing, the newest first. */
export const mentionNotices = writable<MentionNotice[]>([]);

// The messages whose notice showed, or never will (deleted): each shows once. The gateway sends one mention per message
// (an edit mentions nobody again) and a resume replays only what came after it, so this is only a guard. The newest
// few hundred are kept.
const settled: string[] = [];
const SETTLED_KEPT = 500;

function settle(messageId: string) {
	settled.push(messageId);
	if (settled.length > SETTLED_KEPT) settled.shift();
}

/** Shows a mention's notice, unless its message has had one, or was deleted. Returns whether it shows. */
export function showMentionNotice(notice: MentionNotice): boolean {
	if (settled.includes(notice.id)) return false;
	settle(notice.id);
	mentionNotices.update((shown) => [notice, ...shown].slice(0, NOTICES_SHOWN));
	setTimeout(() => dismissMentionNotice(notice.id), NOTICE_TIME);
	return true;
}

/** Takes a message's notice away: its time is up, or it was clicked or closed. */
export function dismissMentionNotice(messageId: string) {
	if (get(mentionNotices).some((n) => n.id === messageId)) {
		mentionNotices.update((shown) => shown.filter((n) => n.id !== messageId));
	}
}

/** A message was deleted: its notice goes, and one still on its way (its message being fetched) never shows. */
export function dropMentionNotice(messageId: string) {
	settle(messageId);
	dismissMentionNotice(messageId);
}
