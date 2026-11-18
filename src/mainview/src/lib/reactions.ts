import type { MessageReaction } from "$lib/types";

/**
 * How a reaction's count rolls when it changes from `previous` to `next`: the vertical offsets, in percent of the
 * number's height (positive is down), that the new number enters from and the old one leaves to. A count going up
 * rolls up, the new number coming from below as the old one leaves upward; one going down rolls down.
 */
export function countRoll(previous: number, next: number): { enter: number; leave: number } {
	if (next === previous) return { enter: 0, leave: 0 };
	return next > previous ? { enter: 100, leave: -100 } : { enter: -100, leave: 100 };
}

/**
 * What a reaction is, among a message's: a custom emoji's ID, as two Spaces can each have an emoji of one name, or a
 * Unicode emoji's character. The list's {#each} keys, the toggle and the reaction events go by it.
 */
export function reactionKey(r: { emoji_name: string; emoji_id?: string | null }): string {
	return r.emoji_id ?? r.emoji_name;
}

/**
 * A message's reactions with one per reactionKey. An API from before reactions by ID groups them by name, so one custom
 * emoji under two names (renamed between two people's reactions) comes as two, whose one key a keyed {#each} can't take:
 * each_key_duplicate would stop the page updating. They become one, at the first's place and with its name, with both's
 * people. A list that has no two of one key is given back as it is.
 */
export function mergedByKey(reactions: MessageReaction[] | null | undefined): MessageReaction[] | null {
	if (!reactions) return null;
	const at = new Map<string, number>();
	const merged: MessageReaction[] = [];
	for (const reaction of reactions) {
		const key = reactionKey(reaction);
		const i = at.get(key);
		const first = i === undefined ? undefined : merged[i];
		if (i === undefined || !first) {
			at.set(key, merged.length);
			merged.push(reaction);
			continue;
		}
		const users = [...first.users, ...reaction.users.filter((u) => !first.users.includes(u))];
		merged[i] = { ...first, users, count: users.length };
	}
	return merged.length === reactions.length ? reactions : merged;
}

/** One user's reaction added to a message or taken back, as the gateway tells it (REACTION_ADD, REACTION_REMOVE and
 * their DM_ ones). */
export interface ReactionChange {
	message_id: string;
	user_id: string;
	emoji_name: string;
	emoji_id?: string | null;
	added: boolean;
}

/**
 * A message's reactions with a change applied: an added one joins its emoji's reaction, last, or starts a new one at the
 * end; one taken back leaves it, and a reaction nobody has any more goes. Each reaction's users stay in the order they
 * reacted, oldest first, and its count is how many they are.
 */
export function withReaction(
	reactions: readonly MessageReaction[] | null | undefined,
	change: ReactionChange,
): MessageReaction[] {
	const list = [...(reactions ?? [])];
	const at = list.findIndex((r) => reactionKey(r) === reactionKey(change));
	const current = list[at];
	if (change.added) {
		if (!current) {
			list.push({
				emoji_name: change.emoji_name,
				emoji_id: change.emoji_id ?? null,
				count: 1,
				users: [change.user_id],
			});
		} else if (!current.users.includes(change.user_id)) {
			const users = [...current.users, change.user_id];
			list[at] = { ...current, users, count: users.length };
		}
		return list;
	}
	if (!current) return list;
	const users = current.users.filter((u) => u !== change.user_id);
	if (users.length === 0) return list.filter((_, i) => i !== at);
	list[at] = { ...current, users, count: users.length };
	return list;
}

const listeners = new Set<(change: ReactionChange) => void>();

/**
 * Hears every reaction change the gateway tells, for whatever shows a message the stores don't keep (a pin, a search
 * result, a thread's message, who reacted): the stores' lists follow them by themselves. Returns what stops hearing them.
 */
export function onReactionChange(listener: (change: ReactionChange) => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Tells everything that hears reaction changes (onReactionChange) of one. */
export function reactionChanged(change: ReactionChange) {
	for (const listener of listeners) listener(change);
}
