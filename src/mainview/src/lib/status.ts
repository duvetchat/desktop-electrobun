import type { Friend } from "$lib/api/friends";
import type { CallState } from "$lib/stores.svelte";
import type {
	ChosenStatus,
	ClientStatus,
	GatewayUserStatusUpdate,
	MemberOnSidebar,
	Presence,
	UserStatus,
} from "$lib/types";

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

/** Whether a client status says its user is connected only from the mobile app, whose status then shows as a phone
 * rather than a dot: mobile is its one platform, as duvet_client's ClientStatus.isMobileOnly reads it. */
export function isMobileOnly(clientStatus: ClientStatus | undefined): boolean {
	const platforms = Object.keys(clientStatus ?? {});
	return platforms.length === 1 && platforms[0] === "mobile";
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

/** Where a member's presence in one space is kept among others' (userStatusCache), beside each user's global presence
 * under their ID. */
export function spaceStatusKey(userId: string, spaceId: string): string {
	return `${userId}:${spaceId}`;
}

/** A presence as the status cache keeps it, out of the event or the list that gives it: the status, and the client
 * status beside it, which an offline user has none of. */
function keptPresence({ status_id, client_status }: Presence): Presence {
	return status_id !== 0 && client_status ? { status_id, client_status } : { status_id };
}

/** Keeps a member's presence as a space gives it (SPACE_CREATE's member_statuses and member_client_status,
 * SPACE_MEMBER_ADD): their status, with their client status. A bot's is its presence in that space alone, so it goes
 * to that space's entry only; a person's is their global presence. Where the space doesn't say who is a bot (`isBot`
 * unknown, as in member_statuses), it goes to both: a space shows a bot by its entry there and a person by their
 * global one (memberStatus), so neither reads the other's. */
export function noteMemberStatus(
	statuses: Map<string, Presence>,
	userId: string,
	spaceId: string,
	presence: Presence,
	isBot?: boolean,
) {
	const kept = keptPresence(presence);
	if (isBot !== true) statuses.set(userId, kept);
	if (isBot !== false) statuses.set(spaceStatusKey(userId, spaceId), kept);
}

/** Forgets a member's presence in a space they left (SPACE_MEMBER_REMOVE). Their global presence stays: a person's
 * shows in their conversations and among friends. */
export function forgetMemberStatus(statuses: Map<string, Presence>, userId: string, spaceId: string) {
	statuses.delete(spaceStatusKey(userId, spaceId));
}

/** Forgets every member's presence in a space the user is no longer in (SPACE_DELETE), so a bot's there can't outlive
 * the space: a SPACE_CREATE of it later leaves out a bot whose shard is down, and sets nothing for it. */
export function forgetSpaceStatuses(statuses: Map<string, Presence>, spaceId: string) {
	const suffix = spaceStatusKey("", spaceId);
	for (const key of statuses.keys()) {
		if (key.endsWith(suffix)) statuses.delete(key);
	}
}

/** Applies a USER_STATUS_UPDATE: the status and the client status it carries. One with a space_id is a bot's presence
 * in that space, its shard's there: only that space's entry takes it. One without is the user's global presence.
 * Offline removes the entry. */
export function applyStatusUpdate(statuses: Map<string, Presence>, update: GatewayUserStatusUpdate) {
	const key = update.space_id ? spaceStatusKey(update.user_id, update.space_id) : update.user_id;
	if (update.status_id === 0) statuses.delete(key);
	else statuses.set(key, keptPresence(update));
}

/** Takes the presences a friends list gives (each friend's status, with their client status) for the friends the
 * gateway hasn't told us about yet: what it says comes live, so it's newer. Friends hear each other's changes from then
 * on, also with no space in common. Returns whose it took. */
export function rememberFriendPresences(
	statuses: Map<string, Presence>,
	list: Friend[],
	me: string | undefined,
): Set<string> {
	const learned = new Set<string>();
	for (const f of list) {
		const other = f.sender_id === me ? f.recipient_id : f.sender_id;
		if (f.status_id && !statuses.has(other)) {
			statuses.set(other, keptPresence(f));
			learned.add(other);
		}
	}
	return learned;
}

/** A member's status as a space shows it. A bot's is its status in that space alone, so it's offline there while the
 * shard that holds the space is down, whatever its other shards do; anyone else's is their global status. */
export function memberStatus(
	statuses: ReadonlyMap<string, Presence>,
	user: { id: string; is_bot?: boolean },
	spaceId: string,
): UserStatus {
	return statuses.get(user.is_bot ? spaceStatusKey(user.id, spaceId) : user.id)?.status_id ?? 0;
}

/** Whether a member shows as connected only from the mobile app: by their global presence, as a person's status in a
 * space is their global one. Never a bot: its status in a space is its shards', and its connections all count as
 * desktop. */
export function memberMobileOnly(
	statuses: ReadonlyMap<string, Presence>,
	user: { id: string; is_bot?: boolean },
): boolean {
	return !user.is_bot && isMobileOnly(statuses.get(user.id)?.client_status);
}
