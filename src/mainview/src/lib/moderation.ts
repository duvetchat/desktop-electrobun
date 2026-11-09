import { writable } from "svelte/store";
import { getApiError } from "$lib/api/api";
import { kickMember } from "$lib/api/moderation";
import { canModerate, Permission } from "$lib/permissions";
import { confirmAction } from "$lib/stores/confirm.svelte";
import { toast } from "$lib/stores/toast.svelte";
import type { GatewaySpace, MemberOnSidebar } from "$lib/types";

/** A member of a space, as a kick or a ban takes them. */
export interface ModerationTarget {
	spaceId: string;
	spaceName: string;
	userId: string;
	/** Their member ID, which a kick goes by. */
	memberId: string;
	/** Their name as the space shows it. */
	name: string;
}

/**
 * What the user may do to a member of a space from a menu (canModerate): kick them, ban them, both or neither (null). A
 * kick needs the member's ID, which a member the space has loaded has.
 */
export function moderationOf(
	space: GatewaySpace | null | undefined,
	member: Pick<MemberOnSidebar, "id" | "member_id" | "username"> | null | undefined,
): { target: ModerationTarget; kick: boolean; ban: boolean } | null {
	if (!space || !member) return null;
	const kick = !!member.member_id && canModerate(space, member.id, Permission.KickMembers);
	const ban = canModerate(space, member.id, Permission.BanMembers);
	if (!kick && !ban) return null;
	const target = {
		spaceId: space.id,
		spaceName: space.name,
		userId: member.id,
		memberId: member.member_id,
		name: member.username,
	};
	return { target, kick, ban };
}

/** Asks whether to kick them, then does: the space's events take them out of its lists, and a refusal shows the API's
 * reason in a toast. */
export function kickFromSpace(target: ModerationTarget): Promise<void> {
	return confirmAction(
		`Kick ${target.name} from ${target.spaceName}? They can join again with an invite.`,
		"Kick",
		async () => {
			try {
				await kickMember(target.spaceId, target.memberId);
				toast(`${target.name} was kicked`, "success");
			} catch (err) {
				toast(getApiError(err, "Couldn't kick them"), "error");
			}
		},
	);
}

/** Who the ban dialog asks about (BanDialog): a menu's Ban sets it, and the dialog takes it as it opens. */
export const banRequest = writable<ModerationTarget | null>(null);
