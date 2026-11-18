import { get, writable } from "svelte/store";
import { BANS_PAGE_SIZE, getSpaceBans } from "$lib/api/moderation";
import { getAvatarURL } from "$lib/common/common";
import type { GatewaySpace, SpaceBan, SpaceBanRemoveEvent } from "$lib/types";

/** A space's bans as far as they're loaded, in the order of the banned users' IDs, as the API lists them. */
export interface LoadedBans {
	bans: SpaceBan[];
	/** The banned user ID the next page starts after: the last of the last page loaded (null: none loaded yet). */
	after: string | null;
	/** Whether the last page loaded was full, so another may follow. */
	more: boolean;
}

/**
 * The bans of each space whose list is loaded, by space ID, as the Bans section of its settings shows them: the pages
 * loaded so far, kept current by SPACE_BAN_ADD and SPACE_BAN_REMOVE. A space whose list isn't loaded has none, and its
 * events change nothing: opening the section loads its list anew, from its first page.
 */
export const spaceBans = writable<Record<string, LoadedBans>>({});

const EMPTY: LoadedBans = { bans: [], after: null, more: true };

/** A list with a ban in it, in its place by the banned user's ID. One the list has already stays as it is: a ban isn't
 * edited, and banning someone banned keeps their ban. */
export function withBan(list: LoadedBans, ban: SpaceBan): LoadedBans {
	if (list.bans.some((b) => b.user_id === ban.user_id)) return list;
	const at = list.bans.findIndex((b) => b.user_id > ban.user_id);
	const bans = [...list.bans];
	bans.splice(at === -1 ? bans.length : at, 0, ban);
	return { ...list, bans };
}

/** A list without a user's ban. */
export function withoutBan(list: LoadedBans, userId: string): LoadedBans {
	if (!list.bans.some((b) => b.user_id === userId)) return list;
	return { ...list, bans: list.bans.filter((b) => b.user_id !== userId) };
}

/**
 * A list with a page of bans in it (to no list: its first page), each in its place, but those whose ban was lifted while
 * the page was on its way (`lifted`). The next page starts after this one's last ban, and there's one only when this one
 * was full (`count`, what it asked for).
 */
export function withPage(
	list: LoadedBans | undefined,
	page: readonly SpaceBan[],
	count: number,
	lifted: ReadonlySet<string> = new Set(),
): LoadedBans {
	let next = list ?? EMPTY;
	for (const ban of page) if (!lifted.has(ban.user_id)) next = withBan(next, ban);
	return { ...next, after: page.at(-1)?.user_id ?? next.after, more: page.length >= count };
}

// Each space's loads: one that started before the list was forgotten or loaded anew is dropped as it lands.
const epochs = new Map<string, number>();
const epochOf = (spaceId: string) => epochs.get(spaceId) ?? 0;
// The pages on their way, each with the users whose ban was lifted since it was asked for.
const onTheWay = new Set<{ spaceId: string; lifted: Set<string> }>();

/**
 * Loads a page of a space's bans into its list: the next one, or with `fresh` the first one into a list anew (what the
 * list had goes: it may have missed events while it wasn't shown). The list is there from the start, so events that come
 * while the page is on its way change it, and the page then leaves out a ban lifted meanwhile. Fails as the request does.
 */
export async function loadBans(spaceId: string, fresh = false): Promise<void> {
	if (fresh) {
		epochs.set(spaceId, epochOf(spaceId) + 1);
		spaceBans.update((all) => ({ ...all, [spaceId]: EMPTY }));
	}
	const list = get(spaceBans)[spaceId];
	if (!list) return;
	const epoch = epochOf(spaceId);
	const waiting = { spaceId, lifted: new Set<string>() };
	onTheWay.add(waiting);
	try {
		const page = await getSpaceBans(spaceId, list.after, BANS_PAGE_SIZE);
		if (epochOf(spaceId) !== epoch) return;
		spaceBans.update((all) =>
			all[spaceId] ? { ...all, [spaceId]: withPage(all[spaceId], page, BANS_PAGE_SIZE, waiting.lifted) } : all,
		);
	} finally {
		onTheWay.delete(waiting);
	}
}

/** A user banned from a space (SPACE_BAN_ADD, or the answer to the user's own ban): its list has them, if it's loaded. */
export function banAdded(ban: SpaceBan) {
	spaceBans.update((all) => {
		const list = all[ban.space_id];
		const next = list && withBan(list, ban);
		return next && next !== list ? { ...all, [ban.space_id]: next } : all;
	});
}

/** A user's ban lifted (SPACE_BAN_REMOVE, or the user's own unban): its list loses it, if it's loaded, and so do the pages
 * of it on their way. */
export function banLifted({ space_id, user_id }: SpaceBanRemoveEvent) {
	for (const waiting of onTheWay) if (waiting.spaceId === space_id) waiting.lifted.add(user_id);
	spaceBans.update((all) => {
		const list = all[space_id];
		const next = list && withoutBan(list, user_id);
		return next && next !== list ? { ...all, [space_id]: next } : all;
	});
}

/** Forgets the bans loaded of a space (deleted, or the user is out of it), or of every space (a new gateway session:
 * the events of the time away never came). Pages on their way to them are dropped. */
export function forgetBans(spaceId?: string) {
	const spaces = spaceId ? [spaceId] : [...new Set([...Object.keys(get(spaceBans)), ...epochs.keys()])];
	for (const id of spaces) epochs.set(id, epochOf(id) + 1);
	spaceBans.update((all) => {
		if (!spaceId) return {};
		if (!(spaceId in all)) return all;
		const rest = { ...all };
		delete rest[spaceId];
		return rest;
	});
}

/** The people a Space has loaded, as the bans list names who banned someone: by the name the Space shows them under
 * (their nickname there, else their display name, else their username), with their username and picture. */
export function banModerators(
	space: Pick<GatewaySpace, "members" | "users">,
): { id: string; username: string; raw_username: string; avatar_url: string | null }[] {
	const users = new Map(space.users.map((user) => [user.id, user]));
	return space.members.flatMap((member) => {
		const user = users.get(member.user_id);
		if (!user) return [];
		return [
			{
				id: user.id,
				username: member.alias ?? user.alias ?? user.username,
				raw_username: user.username,
				avatar_url: getAvatarURL(user.id, user.avatar),
			},
		];
	});
}
