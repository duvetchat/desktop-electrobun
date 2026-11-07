import { get } from "svelte/store";
import type { Conversation } from "$lib/api/conversations";
import { acceptCall, sendEventMessage } from "$lib/api/ws/connection";
import { withoutCallVoiceOf } from "$lib/calls";
import {
	activeCall,
	activeVoiceRoomId,
	callVoiceStates,
	currentUser,
	incomingVideo,
	isCameraOn,
	isDeafened,
	isMuted,
	isScreenSharing,
} from "$lib/stores.svelte";

/** Sends this client's whole voice state in a room (the active one by default) as VOICE_SYNC. The gateway
 * replaces its state with each one, so a sender that left a field out would turn it off: every VOICE_SYNC
 * goes through here, reading it all from the stores. */
export function sendVoiceSync(roomId: string | null = get(activeVoiceRoomId)) {
	if (!roomId) return;
	sendEventMessage("VOICE_SYNC", {
		room_id: roomId,
		muted: get(isMuted),
		deafened: get(isDeafened),
		screen_sharing: get(isScreenSharing),
		camera: get(isCameraOn),
		video_off: !get(incomingVideo),
	});
}

/** Mutes the mic, or unmutes it, which also undeafens: someone who asks to talk hears too. Without SpeakInVoice in the
 * room it stays muted: the caller doesn't offer it then. */
export function toggleMute() {
	const unmuting = get(isMuted);
	isMuted.set(!unmuting);
	if (unmuting) isDeafened.set(false);
	sendVoiceSync();
}

/** Deafens, which mutes the mic too, or undeafens, leaving the mic as it is. */
export function toggleDeafen() {
	isDeafened.update((d) => !d);
	if (get(isDeafened)) isMuted.set(true);
	sendVoiceSync();
}

/** Joins the call going on in a conversation, from its banner or the spaces column. The gateway takes CALL_INITIATE
 * for a call it has as a no-op, and needs it before the VOICE_JOIN that VoiceChat sends once the room is set. */
export function joinConversationCall(conversation: Pick<Conversation, "id" | "members">) {
	const user = get(currentUser);
	if (!user) return;
	const memberIds = conversation.members.map((m) => m.user_id);
	sendEventMessage("CALL_INITIATE", { conversation_id: conversation.id, member_ids: memberIds });
	acceptCall(conversation.id);
	activeCall.set({
		conversationId: conversation.id,
		initiatorId: user.id,
		initiatorName: user.alias ?? user.username ?? "You",
		initiatorAvatar: user.avatar ?? null,
		state: "connected",
		memberIds,
	});
	setTimeout(() => activeVoiceRoomId.set(conversation.id), 50);
}

/** Leaves the voice room or the call the user is in. A call's others stay in it, as its conversation's banner shows. */
export function disconnectVoice() {
	const call = get(activeCall);
	if (call?.state === "connected" && get(activeVoiceRoomId) === call.conversationId) {
		sendEventMessage("CALL_LEAVE", { conversation_id: call.conversationId });
		activeCall.set(null);
		callVoiceStates.update((states) => withoutCallVoiceOf(states, call.conversationId, get(currentUser)?.id));
	}
	activeVoiceRoomId.set(null);
}
