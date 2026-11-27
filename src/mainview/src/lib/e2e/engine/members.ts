// Who is in a conversation (PLAN-E2E-CLIENTES.md, «Qué se manda», its members' rows; decisions 16 and 17): the owner of
// a group adds and removes one user a request, each a commit of exactly that user, and a member leaves with a statement
// their device signs, whose removal a member's commit makes once the API proposes it. A group has 20 members at most,
// its owner among them: the cap holds before anything is asked. And who a blocked group's restart leaves out, which its
// person confirms first; and whether the members of a newer generation are the ones this device holds.
import type { Conversation, ConversationMember } from "$lib/api/conversations";
import type { Commit } from "$lib/api/e2e";
import { CoreError } from "../errors";
import type { EngineParts } from "./engine";
import { withIdentities } from "./identity";

/** A group's members at most, its owner among them (decision 17). */
export const MAX_MEMBERS = 20;

/** The group as the core holds it (its `group`): its generation and epoch, who's in it by their order, its kind and owner. */
export interface HeldMembers {
	generation: number;
	epoch: number;
	kind: "dm" | "group";
	owner: string | null;
	members: { user_id: string }[];
}

/** A group of `count` members, its owner among them, past the cap is refused here, before anything is asked of the API. */
export function checkRoom(count: number) {
	if (count > MAX_MEMBERS) {
		throw new CoreError("too_many_members", `a group can have ${MAX_MEMBERS} members at most`, { limit: MAX_MEMBERS });
	}
}

/**
 * Whether the user may add `user` to the conversation, as the API holds it: a group's owner adding someone else, while
 * it has room. A refusal is thrown, before anything is asked of the API.
 */
export function checkAddition(conv: Conversation, owner: string, user: string) {
	if (conv.type !== 2) throw new CoreError("bad_command", "a DM's members don't change", { field: "conversation_id" });
	if (conv.owner_id !== owner) throw new CoreError("bad_command", "only the group's owner adds members");
	if (user === owner) throw new CoreError("bad_command", "the owner is in the group already", { field: "user_id" });
	checkRoom(conv.members.length + 1);
}

/** The commit that adds `user`, with a key package of each of their devices: none for a user without one, who joins later. */
export async function addition(parts: EngineParts, conv: Conversation, user: string, at: HeldMembers): Promise<Commit> {
	const { key_packages } = await parts.api.claimKeyPackages(user);
	const made = await withIdentities(parts, () =>
		parts.host.handle<{ commit: string; group_info: string; welcome?: string | null }>({
			...{ cmd: "add_members", conversation_id: conv.id },
			users: [{ user_id: user, key_packages: key_packages.map((kp) => kp.data) }],
		}),
	);
	const { commit, group_info, welcome } = made;
	return { generation: at.generation, epoch: at.epoch, commit, group_info, ...(welcome ? { welcome } : {}) };
}

/** The commit that takes `user` out, every device of theirs with them. */
export async function removal(parts: EngineParts, conv: Conversation, user: string, at: HeldMembers): Promise<Commit> {
	const made = await withIdentities(parts, () =>
		parts.host.handle<{ commit: string; group_info: string }>({
			...{ cmd: "remove_members", conversation_id: conv.id, users: [user] },
		}),
	);
	return { generation: at.generation, epoch: at.epoch, ...made };
}

/** A conversation's people as a page draws them (#574): its kind, a group's owner, its members' users. */
export type Drawn = Pick<Conversation, "type" | "owner_id"> & { members: Pick<ConversationMember, "user_id">[] };

/** The users the core's group holds that the API's conversation no longer lists: whom a restart leaves out. */
export const leftOut = (held: HeldMembers, conv: Drawn) =>
	held.members.map((member) => member.user_id).filter((user) => !conv.members.some((m) => m.user_id === user));

/**
 * Whether the core's group holds a user, a kind or an owner the conversation as drawn doesn't (#574): whom what's sent
 * there reaches that the conversation doesn't show. Those it lists that the group doesn't hold yet (an addition the
 * queue hasn't brought) aren't, but for a DM, which is exactly `user` and the one its view shows (N-I1): drawn with any
 * other count of people, its title names one, and whom else it holds isn't shown.
 */
export const heldBeyond = (held: HeldMembers, conv: Drawn, user: string) =>
	held.kind !== (conv.type === 1 ? "dm" : "group") ||
	(held.kind === "group" && held.owner !== conv.owner_id) ||
	(conv.type === 1 && !twoPeople(conv, user)) ||
	leftOut(held, conv).length > 0;

/** A DM as drawn: two members, `user` and another. */
function twoPeople(conv: Drawn, user: string): boolean {
	const users = new Set(conv.members.map((member) => member.user_id));
	return conv.members.length === 2 && users.size === 2 && users.has(user);
}

/** Two lists of users, the same whatever their order. */
export const sameUsers = (a: readonly string[], b: readonly string[]) =>
	a.length === b.length && a.every((user) => b.includes(user));

/** The conversation's members as the API has them, and a group's owner: what the person said yes to (accept). */
export const membersKey = (conv: Conversation) =>
	[conv.type === 2 ? conv.owner_id : "", ...conv.members.map((member) => member.user_id).sort()].join(",");

/**
 * Whether the API's conversation has the members, and a group the owner, that the core's group holds: only then does
 * this device join a newer generation it has no welcome for on its own (sync.ts' #join).
 */
export const sameMembers = (held: HeldMembers, conv: Conversation) =>
	sameUsers(
		held.members.map((member) => member.user_id),
		conv.members.map((member) => member.user_id),
	) &&
	(conv.type !== 2 || held.owner === conv.owner_id);
