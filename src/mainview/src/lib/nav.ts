import type { Tab } from "$lib/types";

/** The spaces the user pinned to the top of the spaces column, by ID, in the order they pinned them. */
export const PINNED_SPACES_KEY = "duvet.nav.pinned.v1";
/** The folders of the old server rail, which the spaces column shows as groups of its own. */
export const SPACE_FOLDERS_KEY = "duvet.guildFolders.v1";

/** What the Now section at the column's foot has folded or opened, which stays so until the user changes it. */
export const NOW_PREFS_KEY = "duvet.nav.now.v1";

/** Its voice rooms and its online friends folded to their headings, and every voice room listed past the busiest. */
export type NowPrefs = { roomsFolded: boolean; friendsFolded: boolean; allRooms: boolean };

export const defaultNowPrefs: NowPrefs = { roomsFolded: false, friendsFolded: false, allRooms: false };

/** The Now section's prefs a saved value holds, each one it lacks (or holds something else in) at its default. */
export function parseNowPrefs(raw: string | null): NowPrefs {
	const prefs = { ...defaultNowPrefs };
	if (!raw) return prefs;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return prefs;
		if ("roomsFolded" in parsed && typeof parsed.roomsFolded === "boolean") prefs.roomsFolded = parsed.roomsFolded;
		if ("friendsFolded" in parsed && typeof parsed.friendsFolded === "boolean")
			prefs.friendsFolded = parsed.friendsFolded;
		if ("allRooms" in parsed && typeof parsed.allRooms === "boolean") prefs.allRooms = parsed.allRooms;
		return prefs;
	} catch {
		return prefs;
	}
}

export type SpaceFolder = {
	id: string;
	name: string;
	guildIds: string[];
	collapsed: boolean;
};

/** The pinned space IDs a saved value holds; anything else in it (or a value that isn't JSON) is dropped. */
export function parsePinned(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return [...new Set(parsed.filter((id): id is string => typeof id === "string"))];
	} catch {
		return [];
	}
}

/** The folders a saved value holds, as the server rail saved them. */
export function parseFolders(raw: string | null): SpaceFolder[] {
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.flatMap((f: unknown): SpaceFolder[] => {
			if (!f || typeof f !== "object" || !("id" in f) || typeof f.id !== "string") return [];
			const name = "name" in f && typeof f.name === "string" ? f.name : "Folder";
			const ids = "guildIds" in f && Array.isArray(f.guildIds) ? (f.guildIds as unknown[]) : [];
			const collapsed = "collapsed" in f && f.collapsed === true;
			return [{ id: f.id, name, guildIds: ids.filter((id): id is string => typeof id === "string"), collapsed }];
		});
	} catch {
		return [];
	}
}

export type SpaceGroups = {
	pinned: string[];
	folders: { folder: SpaceFolder; spaceIds: string[] }[];
	news: string[];
	quiet: string[];
};

/**
 * The spaces column's groups. A pinned space shows under Pinned, in the order it was pinned; one in a folder, under
 * that folder; any other one under With news while it has an unread room or a mention, and under Quiet otherwise.
 * Each space shows once, and the IDs of spaces the user is no longer in are left out.
 */
export function groupSpaces(
	spaceIds: string[],
	pinned: string[],
	folders: SpaceFolder[],
	hasNews: (spaceId: string) => boolean,
): SpaceGroups {
	const present = new Set(spaceIds);
	const pinnedIds = pinned.filter((id) => present.has(id));
	const placed = new Set(pinnedIds);
	const folderGroups = folders
		.map((folder) => {
			const ids = folder.guildIds.filter((id) => present.has(id) && !placed.has(id));
			for (const id of ids) placed.add(id);
			return { folder, spaceIds: ids };
		})
		.filter((g) => g.spaceIds.length > 0);
	const rest = spaceIds.filter((id) => !placed.has(id));
	return {
		pinned: pinnedIds,
		folders: folderGroups,
		news: rest.filter((id) => hasNews(id)),
		quiet: rest.filter((id) => !hasNews(id)),
	};
}

/**
 * How well a query matches a name, higher being better, or null when it doesn't: the name starting with it beats a
 * word of it starting with it, which beats the query anywhere in it, which beats its letters in order with gaps.
 * Case and accents don't count. An empty query matches everything equally.
 */
export function fuzzyScore(query: string, text: string): number | null {
	const q = fold(query.trim());
	if (!q) return 0;
	const t = fold(text);
	if (t === q) return 1000;
	if (t.startsWith(q)) return 800 - t.length;
	const at = t.indexOf(q);
	if (at > 0 && /[\s\-_./#@]/.test(t[at - 1])) return 600 - at;
	if (at > 0) return 400 - at;
	// Its letters in order: fewer gaps between them score higher.
	let ti = 0;
	let gaps = 0;
	for (const ch of q) {
		const found = t.indexOf(ch, ti);
		if (found === -1) return null;
		if (found !== ti) gaps++;
		ti = found + 1;
	}
	return 200 - gaps * 10 - t.length;
}

function fold(s: string): string {
	return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** The items that match a query, best first; ties keep their order. */
export function rankByQuery<T>(items: T[], query: string, textOf: (item: T) => string): T[] {
	return items
		.map((item, index) => ({ item, index, score: fuzzyScore(query, textOf(item)) }))
		.filter((r): r is { item: T; index: number; score: number } => r.score !== null)
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.map((r) => r.item);
}

type RoomLike = { id: string; type: string; voiceUsers?: unknown[] };

export type SpaceNews = {
	/** The mentions of the user waiting in its rooms. */
	mentions: number;
	/** Whether any of its text rooms has messages the user hasn't read. */
	unread: boolean;
	/** The people in its voice rooms. */
	inVoice: number;
};

/** What a space's row shows about its rooms, the ones the user can see. */
export function spaceNews(
	rooms: RoomLike[],
	unreadRooms: Set<string>,
	mentionCounts: Record<string, number>,
): SpaceNews {
	let mentions = 0;
	let unread = false;
	let inVoice = 0;
	for (const room of rooms) {
		if (room.type === "text") {
			mentions += mentionCounts[room.id] ?? 0;
			if (unreadRooms.has(room.id) || mentionCounts[room.id]) unread = true;
		} else if (room.type === "voice") {
			inVoice += room.voiceUsers?.length ?? 0;
		}
	}
	return { mentions, unread, inVoice };
}

/** The rooms' unread marks, mentions and read positions once a space's are all read (spaceReadAll), and the acks that
 * tell the API so. */
export type SpaceRead = {
	acks: { roomId: string; messageId: string }[];
	unread: Set<string>;
	mentions: Record<string, number>;
	lastRead: Record<string, string>;
};

/**
 * A space's Mark all as read, as the mobile app's: each of its text rooms its row counts as news (spaceNews: unread, or
 * with mentions) loses its unread mark and its mentions, and is acked at the newest message known there (`newest`, ""
 * when none is), which becomes its read position, so its unread divider doesn't come back when it opens. One whose newest
 * message isn't known only loses its marks.
 */
export function spaceReadAll(
	rooms: RoomLike[],
	read: { unread: Set<string>; mentions: Record<string, number>; lastRead: Record<string, string> },
	newest: (roomId: string) => string,
): SpaceRead {
	const unread = new Set(read.unread);
	const mentions = { ...read.mentions };
	const lastRead = { ...read.lastRead };
	const acks: SpaceRead["acks"] = [];
	for (const room of rooms) {
		if (room.type !== "text" || (!unread.has(room.id) && !mentions[room.id])) continue;
		unread.delete(room.id);
		delete mentions[room.id];
		const messageId = newest(room.id);
		if (!messageId) continue;
		acks.push({ roomId: room.id, messageId });
		if (messageId > (lastRead[room.id] ?? "")) lastRead[room.id] = messageId;
	}
	return { acks, unread, mentions, lastRead };
}

/** The focused pane's tabs, which the spaces column lists on top when the open chats are a vertical list. */
export type OpenChats = {
	tabs: Tab[];
	activeChannelId: string | null;
	onActivate: (channelId: string) => void;
	onClose: (channelId: string) => void;
	onReorder: (tabs: OpenChats["tabs"]) => void;
};
