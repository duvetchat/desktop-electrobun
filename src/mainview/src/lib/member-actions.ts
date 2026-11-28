// What a member's menu does (#423, MemberMenu.svelte), apart from what its list does itself (a profile, a mention): the
// friendship, a direct conversation and its call, the user's display name. A refusal shows in a toast, or in the
// confirmation it asks first.

import { get, writable } from "svelte/store";
import { getApiError } from "$lib/api/api";
import { acceptFriendRequest, getSentRequests, sendFriendRequest, unfriend } from "$lib/api/friends";
import { updateUser } from "$lib/api/user";
import { t } from "$lib/i18n";
import { applyOwnProfile } from "$lib/own-profile";
import { currentUser, directChatRequest, friends, pendingFriendRequests, sentFriendRequests } from "$lib/stores.svelte";
import { confirmAction } from "$lib/stores/confirm.svelte";
import { promptDialog } from "$lib/stores/prompt.svelte";
import { toast } from "$lib/stores/toast.svelte";

/**
 * Whom the person shares a conversation's history with (Task 30): a member's menu sets it, and ShareHistoryDialog, one
 * for the app, takes it as it opens. Here, not in the dialog, as a menu's page (Space settings) never loads the engine.
 */
export const shareHistoryRequest = writable<{ conversationId: string; userId: string; name: string } | null>(null);

/** Sends them a friend request. */
export async function addFriend(userId: string): Promise<void> {
	try {
		await sendFriendRequest(userId);
		sentFriendRequests.set(await getSentRequests());
		toast(t("people_friend_request_sent"), "success");
	} catch (err) {
		toast(getApiError(err, t("people_friend_request_failed")), "error");
	}
}

/**
 * Accepts the friend request they sent, as the Friends view does: the API refuses one sent back while theirs waits. Their
 * status comes with the accept's event (FRIEND_REQUEST_ACCEPT, which reads the friends again): the gateway's connection
 * isn't this module's to load, as a window's page that shows a member's menu (Space settings) never loads it.
 */
export async function acceptFriend(userId: string): Promise<void> {
	const me = get(currentUser)?.id;
	const request = get(pendingFriendRequests).find((r) => r.sender_id === userId && r.recipient_id === me);
	if (!request) return;
	try {
		const friend = await acceptFriendRequest(request.id);
		pendingFriendRequests.update((list) => list.filter((r) => r.id !== request.id));
		friends.update((list) => (list.some((f) => f.id === friend.id) ? list : [...list, friend]));
	} catch (err) {
		toast(getApiError(err, t("people_friend_accept_failed")), "error");
	}
}

/** Asks first, as the Friends view does, then ends the friendship; a refusal shows in the confirmation. */
export function removeFriend(userId: string, name: string): Promise<void> {
	return confirmAction(
		t("people_friend_remove_confirm", { name }),
		t("people_remove_action"),
		async () => {
			await unfriend(userId);
			friends.update((list) => list.filter((f) => f.sender_id !== userId && f.recipient_id !== userId));
		},
		t("people_remove_busy"),
	);
}

/** Opens the user's direct conversation with them, and with `call` calls them there (the app's page does both). */
export function chatWith(userId: string, call = false): void {
	directChatRequest.set({ id: crypto.randomUUID(), userId, call });
}

/** Asks first, then takes them out of the group, for its owner; a refusal shows in the confirmation. */
export function removeFromGroup(name: string, remove: () => Promise<void>): Promise<void> {
	return confirmAction(
		t("people_group_remove_confirm", { name }),
		t("people_remove_action"),
		remove,
		t("people_remove_busy"),
	);
}

/**
 * The user's own display name, which every Space and chat shows (Settings → Profile's Display name): asked for, starting
 * from the one they have. An empty or unchanged name changes nothing; the name saved shows everywhere at once.
 */
export async function changeDisplayName(): Promise<void> {
	const me = get(currentUser);
	if (!me) return;
	const name = await promptDialog(() => t("people_display_name_prompt"), me.username, me.alias ?? "");
	if (name === null || name === me.alias) return;
	try {
		const saved = await updateUser({ alias: name });
		applyOwnProfile({
			id: saved.id,
			username: saved.username,
			alias: saved.alias ?? null,
			avatar: saved.avatar ?? null,
			banner: saved.banner ?? null,
			custom: saved.custom ?? "",
		});
	} catch (err) {
		toast(getApiError(err, t("people_display_name_failed")), "error");
	}
}
