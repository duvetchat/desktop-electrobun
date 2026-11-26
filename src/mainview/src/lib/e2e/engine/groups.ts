// Making and joining a conversation's group (PLAN-E2E-CLIENTES.md, «Entrar a un grupo»), and restarting a blocked one:
// who may make or restart it, and the first commit each way in gives, as its request goes up (`Commit`). The key packages
// of every member's devices are claimed for it, this user's other devices' too; the core takes the members in the
// API's order (by their membership's ID), and holds a conversation from before the cutover to this device's record of it.
import type { Conversation } from "$lib/api/conversations";
import type { Commit } from "$lib/api/e2e";
import type { EngineParts } from "./engine";
import { withIdentities } from "./identity";
import type { LegacyRecord } from "./legacy";

/**
 * Whether the user may make the conversation's group: any member of one from before the cutover, either member of a DM,
 * a group's owner (the API's validator holds the same rule).
 */
export const mayMake = (conv: Conversation, user: string) =>
	conv.legacy === true || conv.type === 1 || conv.owner_id === user;

/** Whether the user may restart its blocked group: either member of a DM, a group's owner. */
export const mayRestart = (conv: Conversation, user: string) => conv.type === 1 || conv.owner_id === user;

/** What create_group and reset_group make: the generation's first commit, with epoch 0's group info and its welcome. */
interface Founding {
	generation: number;
	commit: string;
	group_info: string;
	initial_group_info: string;
	welcome?: string | null;
}

/** Every member's key packages, by user: one for each of their listed devices that has one to give. */
async function keyPackagesOf({ api }: EngineParts, conv: Conversation): Promise<Record<string, string[]>> {
	const packages: Record<string, string[]> = {};
	for (const { user_id } of conv.members) {
		const { key_packages } = await api.claimKeyPackages(user_id);
		packages[user_id] = key_packages.map((kp) => kp.data);
	}
	return packages;
}

const founding = ({ generation, commit, group_info, initial_group_info, welcome }: Founding): Commit => ({
	...{ generation, epoch: 0, commit, group_info, initial_group_info },
	...(welcome ? { welcome } : {}),
});

/** The conversation's group from nothing (create_group), under the API's external sender as pinned (Ruling 32). */
export async function makeGroup(
	parts: EngineParts,
	conv: Conversation,
	externalSender: string,
	expected: LegacyRecord | null,
): Promise<Commit> {
	const key_packages = await keyPackagesOf(parts, conv);
	const made = await withIdentities(parts, () =>
		parts.host.handle<Founding>({
			...{ cmd: "create_group", conversation_id: conv.id, kind: conv.type === 1 ? "dm" : "group" },
			...(conv.type === 2 ? { owner: conv.owner_id } : {}),
			members: conv.members.map((member) => member.user_id),
			...{ key_packages, external_sender: externalSender, legacy: conv.legacy === true },
			...(expected ? { expected } : {}),
		}),
	);
	return founding(made);
}

/**
 * The blocked group's next generation (reset_group), with the members and the owner the API has, in its order, as a
 * creation takes them, and every device's key packages: the core takes them only as a restart may found its group
 * (#46), else a rule_violation.
 */
export async function restartGroup(parts: EngineParts, conv: Conversation): Promise<Commit> {
	const key_packages = await keyPackagesOf(parts, conv);
	const made = await withIdentities(parts, () =>
		parts.host.handle<Founding>({
			...{ cmd: "reset_group", conversation_id: conv.id },
			...(conv.type === 2 ? { owner: conv.owner_id } : {}),
			...{ members: conv.members.map((member) => member.user_id), key_packages },
		}),
	);
	return founding(made);
}

/**
 * The external commit that brings this device into the group as the API serves it (join_external), on the group info
 * of its latest epoch: held to the record of a conversation from before the cutover, and to the pinned external sender.
 */
export async function joinGroup(
	parts: EngineParts,
	conv: Conversation,
	externalSender: string,
	expected: LegacyRecord | null,
): Promise<Commit> {
	const { generation, epoch, group_info } = await parts.api.groupInfo(conv.id);
	const made = await parts.host.handle<{ commit: string; group_info: string }>({
		...{ cmd: "join_external", conversation_id: conv.id, generation, group_info, external_sender: externalSender },
		...(expected ? { expected } : {}),
	});
	return { generation, epoch, ...made };
}
