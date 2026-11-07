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
	const at = list.findIndex((r) => r.emoji_name === change.emoji_name);
	if (change.added) {
		if (at < 0) {
			list.push({
				emoji_name: change.emoji_name,
				emoji_id: change.emoji_id ?? null,
				count: 1,
				users: [change.user_id],
			});
		} else if (!list[at].users.includes(change.user_id)) {
			const users = [...list[at].users, change.user_id];
			list[at] = { ...list[at], users, count: users.length };
		}
		return list;
	}
	if (at < 0) return list;
	const users = list[at].users.filter((u) => u !== change.user_id);
	if (users.length === 0) return list.filter((_, i) => i !== at);
	list[at] = { ...list[at], users, count: users.length };
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
