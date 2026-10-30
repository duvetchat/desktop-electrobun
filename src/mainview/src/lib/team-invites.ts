import { acceptTeamInvite, declineTeamInvite } from "$lib/api/developer";
import { pendingTeamInvites } from "$lib/stores.svelte";

/** Accepts or declines an invite to a developer team: it goes from the pending ones. Throws when the API refuses it,
 * leaving it there. */
export async function answerTeamInvite(inviteId: string, accept: boolean) {
	await (accept ? acceptTeamInvite(inviteId) : declineTeamInvite(inviteId));
	pendingTeamInvites.update((list) => list.filter((i) => i.id !== inviteId));
}
