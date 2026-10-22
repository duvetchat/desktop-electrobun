import { get } from "svelte/store";
import { sendEventMessage } from "$lib/api/ws/connection";
import { activeVoiceRoomId, incomingVideo, isCameraOn, isDeafened, isMuted, isScreenSharing } from "$lib/stores.svelte";

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
