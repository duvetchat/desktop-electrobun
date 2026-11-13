import { get } from "svelte/store";
import type { Conversation } from "$lib/api/conversations";
import { acceptCall, placeCall, sendEventMessage } from "$lib/api/ws/connection";
import { callingFromAnotherDevice, withoutCallVoiceOf } from "$lib/calls";
import { toast } from "$lib/stores/toast.svelte";
import {
	activeCall,
	activeVoiceRoomId,
	callVoiceStates,
	conversationsWithCalls,
	currentUser,
	incomingVideo,
	isCameraOn,
	isDeafened,
	isMuted,
	isScreenSharing,
	ownCallsRinging,
	screenShareRequested,
	watchingNow,
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
		watching: get(watchingNow),
	});
}

/** Stops this client's screen share in a room or call, as the Stream menu's Stop does. The request toggles the share
 * (VoiceChat's toggleScreenShare), so with nothing shared it asks for nothing: it would open the screen picker. */
export function stopScreenShare(roomId: string) {
	if (get(isScreenSharing)) screenShareRequested.set({ roomId, withAudio: false });
}

// How the voice room or call this client is in asks for a microphone it doesn't have (the browser refused it): VoiceChat
// sets it while it has none, and an unmute asks first. Resolves whether one is open.
let askForMic: (() => Promise<boolean>) | null = null;
let asking: Promise<void> | null = null;

/** VoiceChat's way of asking for the microphone again, while it has none; null once it has one, or it's gone. */
export function askForMicWith(ask: (() => Promise<boolean>) | null) {
	askForMic = ask;
}

/** Mutes the mic, or unmutes it, which also undeafens: someone who asks to talk hears too. Without SpeakInVoice in the
 * room it stays muted: the caller doesn't offer it then. Without a microphone (the browser refused it) the unmute asks
 * for it again first, and the user stays muted until it's open, as on the mobile app (#207). */
export function toggleMute() {
	const unmuting = get(isMuted);
	if (unmuting && askForMic) {
		asking ??= unmuteWithMic(askForMic).finally(() => (asking = null));
		return;
	}
	isMuted.set(!unmuting);
	if (unmuting) isDeafened.set(false);
	sendVoiceSync();
}

async function unmuteWithMic(ask: () => Promise<boolean>) {
	const room = get(activeVoiceRoomId);
	const open = await ask();
	// Voice left meanwhile: nothing to unmute, and nothing to say.
	if (get(activeVoiceRoomId) !== room || !get(isMuted)) return;
	if (!open) {
		toast("Allow Duvet to use the microphone to talk", "error");
		return;
	}
	isMuted.set(false);
	isDeafened.set(false);
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

/** Calls a conversation, from its view or a row of the call history: CALL_INITIATE, and "Calling…" until someone answers.
 * Nothing while the user is in a call, places one or one rings them, nor while their own call there still rings the
 * others from another device, which has nothing to join until someone answers it. */
export function startConversationCall(conversation: Pick<Conversation, "id" | "members">) {
	const user = get(currentUser);
	const call = get(activeCall);
	if (!user || call || callingFromAnotherDevice(conversation.id, get(ownCallsRinging), call)) return;
	const memberIds = conversation.members.map((m) => m.user_id);
	placeCall(conversation.id, memberIds);
	activeCall.set({
		conversationId: conversation.id,
		initiatorId: user.id,
		initiatorName: user.alias ?? user.username ?? "You",
		initiatorAvatar: user.avatar ?? null,
		state: "calling",
		memberIds,
	});
	conversationsWithCalls.update((s) => {
		s.add(conversation.id);
		return new Set(s);
	});
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
