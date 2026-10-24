import type { CallState } from "$lib/stores.svelte";
import type { ChosenStatus, MemberOnSidebar } from "$lib/types";

/** The statuses a user can choose (PUT /api/users/@me/status), as the user panel's menu lists them. Others see the
 * one chosen while the user is connected. */
export const STATUS_CHOICES: { status: ChosenStatus; label: string; description?: string }[] = [
	{ status: 1, label: "Online" },
	{ status: 2, label: "Do Not Disturb", description: "No notification sounds, and incoming calls don't ring" },
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
			return "bg-stone-300";
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
