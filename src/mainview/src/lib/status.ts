import type { CallState } from "$lib/stores.svelte";
import type { ChosenStatus, GatewayUserStatusUpdate, MemberOnSidebar, UserStatus } from "$lib/types";

/** The statuses a user can choose (PUT /api/users/@me/status), as the user panel's menu lists them. Others see the
 * one chosen while the user is connected. */
export const STATUS_CHOICES: { status: ChosenStatus; label: string; description?: string }[] = [
	{ status: 1, label: "Online", description: "Sounds and calls as usual" },
	{ status: 2, label: "Do Not Disturb", description: "No sounds, and calls don't ring" },
];

/** The status a user chose, from what their READY or /users/@me says: do not disturb, or else online (a gateway from
 * before there were statuses to choose says nothing). */
export function chosenStatus(status: number | undefined): ChosenStatus {
	return status === 2 ? 2 : 1;
}

/** The background of the dot that shows a status on an avatar. */
export function statusDotClass(status: MemberOnSidebar["status"]): string {
	switch (status) {
		case "online":
			// Ice, alive (app.css).
			return "bg-[var(--status-online,var(--color-stone-300))]";
		case "idle":
			return "bg-amber-500";
		case "dnd":
			return "bg-red-500";
		default:
			return "bg-zinc-500";
	}
}

/** Whether a mention plays the notification sound: not while its room or conversation is on screen, and never in do
 * not disturb. */
export function mentionSound(status: ChosenStatus | undefined, onScreen: boolean): boolean {
	return !onScreen && status !== 2;
}

/** Whether a call plays its sound: a call coming in rings unless the user is in do not disturb, where it shows
 * without a sound; the one the user places always rings back. */
export function callRings(state: CallState, status: ChosenStatus | undefined): boolean {
	return state === "calling" || (state === "ringing" && status !== 2);
}

/** Where a member's status in one space is kept among others' statuses (userStatusCache), beside each user's global
 * status under their ID. */
export function spaceStatusKey(userId: string, spaceId: string): string {
	return `${userId}:${spaceId}`;
}

/** Keeps a member's status as a space gives it (SPACE_CREATE's member_statuses, SPACE_MEMBER_ADD), for a bot or a
 * person alike: as their status in that space, which is a bot's there, and as their global status, which is a
 * person's (a bot connected in one space is connected). */
export function noteMemberStatus(
	statuses: Map<string, UserStatus>,
	userId: string,
	spaceId: string,
	status: UserStatus,
) {
	statuses.set(userId, status);
	statuses.set(spaceStatusKey(userId, spaceId), status);
}

/** Applies a USER_STATUS_UPDATE. One with a space_id is a bot's status in that space, its shard's there: only that
 * space's entry takes it. One without is the user's global status. Offline removes the entry. */
export function applyStatusUpdate(statuses: Map<string, UserStatus>, update: GatewayUserStatusUpdate) {
	const key = update.space_id ? spaceStatusKey(update.user_id, update.space_id) : update.user_id;
	if (update.status_id === 0) statuses.delete(key);
	else statuses.set(key, update.status_id);
}

/** A member's status as a space shows it. A bot's is its status in that space alone, so it's offline there while the
 * shard that holds the space is down, whatever its other shards do; anyone else's is their global status. */
export function memberStatus(
	statuses: ReadonlyMap<string, UserStatus>,
	user: { id: string; is_bot?: boolean },
	spaceId: string,
): UserStatus {
	return statuses.get(user.is_bot ? spaceStatusKey(user.id, spaceId) : user.id) ?? 0;
}
