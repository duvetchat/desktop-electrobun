import { acceptFriendRequest, rejectFriendRequest, type FriendRequest } from "$lib/api/friends";
import { rememberFriendStatuses } from "$lib/api/ws/connection";
import { friends, pendingFriendRequests } from "$lib/stores.svelte";

/** Accepts a friend request the user got: the request goes, and its sender joins their friends. Throws when the API
 * refuses it, leaving the request there. */
export async function acceptRequest(request: Pick<FriendRequest, "id">) {
	const friend = await acceptFriendRequest(request.id);
	pendingFriendRequests.update((reqs) => reqs.filter((r) => r.id !== request.id));
	rememberFriendStatuses([friend]);
	friends.update((list) => (list.some((f) => f.id === friend.id) ? list : [...list, friend]));
}

/** Declines a friend request the user got. Throws when the API refuses it, leaving the request there. */
export async function declineRequest(request: Pick<FriendRequest, "id">) {
	await rejectFriendRequest(request.id);
	pendingFriendRequests.update((reqs) => reqs.filter((r) => r.id !== request.id));
}
