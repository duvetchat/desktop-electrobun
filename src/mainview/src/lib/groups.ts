import type { Conversation } from "$lib/api/conversations";

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

/** What the new group dialog does with the friends picked and the name typed. */
export type NewConversation =
	| { kind: "dm"; userId: string }
	| { kind: "group"; name: string; userIds: string[] }
	| { kind: "refused"; why: string };

/**
 * One friend picked is the DM with them, which the API opens if they have one, whatever name was typed: a group is two
 * friends or more, and its name is the one thing it asks for.
 */
export function newConversation(picked: Iterable<string>, typedName: string): NewConversation {
	const userIds = [...picked];
	if (userIds.length === 0) return { kind: "refused", why: "Add at least one friend to the group" };
	if (userIds.length === 1) return { kind: "dm", userId: userIds[0] };
	const name = typedName.trim();
	if (!name) return { kind: "refused", why: "Enter a group name" };
	return { kind: "group", name, userIds };
}
