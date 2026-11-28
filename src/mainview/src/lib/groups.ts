import type { Conversation } from "$lib/api/conversations";
import { MAX_MEMBERS } from "$lib/e2e/engine/members";
import type { MessageKey } from "$lib/i18n";

/**
 * What the user can do to a conversation, as the API has it: any member of a group leaves it, and its owner renames it.
 * A DM offers neither: the API refuses both there.
 */
export function groupActions(
	conv: Pick<Conversation, "type" | "owner_id">,
	me: string | undefined,
): { rename: boolean; leave: boolean } {
	const group = conv.type === 2;
	return { rename: group && conv.owner_id === me, leave: group };
}

/**
 * What the new group dialog does with the friends picked and the name typed. A refusal says why as a key, for the dialog
 * to draw in the app's language of the moment.
 */
export type NewConversation =
	| { kind: "dm"; userId: string }
	| { kind: "group"; name: string; userIds: string[] }
	| { kind: "refused"; why: MessageKey };

/**
 * One friend picked is the DM with them, which the API opens if they have one, whatever name was typed: a group is two
 * friends or more, 20 members at most with its owner (decision 17), and its name is the one thing it asks for.
 */
export function newConversation(picked: Iterable<string>, typedName: string): NewConversation {
	const userIds = [...picked];
	if (userIds.length === 0) return { kind: "refused", why: "people_new_group_pick_friend" };
	if (userIds.length === 1) return { kind: "dm", userId: userIds[0]! };
	if (userIds.length + 1 > MAX_MEMBERS) return { kind: "refused", why: "e2e_group_full" };
	const name = typedName.trim();
	if (!name) return { kind: "refused", why: "people_new_group_name_missing" };
	return { kind: "group", name, userIds };
}
