import { derived, type Readable } from "svelte/store";
import type { Conversation } from "$lib/api/conversations";
import { getAvatarURL } from "$lib/common/common";
import { callName } from "$lib/now";
import {
	activeCall,
	activeVoiceRoomId,
	callVoiceStates,
	conversations,
	currentUser,
	gatewaySpaces,
	type ActiveCallInfo,
	type CallVoiceState,
} from "$lib/stores.svelte";
import type { GatewaySpace } from "$lib/types";

/** Someone in the voice the user is in, as its people show: their name and avatar. */
export interface VoicePerson {
	id: string;
	name: string;
	src: string | null;
}

/** A voice state of the place, a room's or a call's alike. */
export interface PlaceVoiceState {
	user_id: string;
	muted: boolean;
	screen_sharing: boolean;
	camera: boolean;
	/** Whose screen share they're watching there (gateway#152). */
	watching: string[];
}

/** The voice the user is in: a Space's voice room, or a call. */
export interface VoicePlace {
	kind: "room" | "call";
	/** activeVoiceRoomId: the room's ID, or the conversation's. */
	id: string;
	/** The room's Space; null for a call. */
	spaceId: string | null;
	name: string;
	/** Where it is: the Space's name, "Group call" or "Call". */
	place: string;
	states: PlaceVoiceState[];
	/** Someone's name and avatar there; "Unknown", or the start of their ID in a call, when it doesn't know them. */
	person: (userId: string) => VoicePerson;
}

/** The voice the user is in (id, activeVoiceRoomId): the room of a Space that has it, else the call shown connected. */
export function voicePlace(
	id: string | null,
	spaces: GatewaySpace[],
	call: ActiveCallInfo | null,
	conversationList: Conversation[],
	callStates: CallVoiceState[],
	meId: string | undefined,
): VoicePlace | null {
	if (!id) return null;
	const space = spaces.find((s) => s.rooms.some((r) => r.id === id));
	const room = space?.rooms.find((r) => r.id === id);
	if (space && room) {
		return {
			kind: "room",
			id,
			spaceId: space.id,
			name: room.name,
			place: space.name,
			states: (space.voice_states ?? [])
				.filter((vs) => vs.room_id === id)
				.map((vs) => ({
					user_id: vs.user_id,
					muted: vs.muted,
					screen_sharing: vs.screen_sharing,
					camera: vs.camera ?? false,
					watching: vs.watching ?? [],
				})),
			person: (userId) => {
				const user = space.users.find((u) => u.id === userId);
				return {
					id: userId,
					name: user?.alias ?? user?.username ?? "Unknown",
					src: user ? getAvatarURL(user.id, user.avatar) : null,
				};
			},
		};
	}
	if (call?.state !== "connected" || call.conversationId !== id) return null;
	const conv = conversationList.find((c) => c.id === id);
	return {
		kind: "call",
		id,
		spaceId: null,
		name: callName(conv, meId),
		place: conv?.type === 2 ? "Group call" : "Call",
		states: callStates
			.filter((vs) => vs.room_id === id)
			.map((vs) => ({
				user_id: vs.user_id,
				muted: vs.muted ?? false,
				screen_sharing: vs.screen_sharing ?? false,
				camera: vs.camera ?? false,
				watching: vs.watching ?? [],
			})),
		person: (userId) => {
			const member = conv?.members.find((m) => m.user_id === userId);
			return {
				id: userId,
				name: member?.user?.alias ?? member?.user?.username ?? userId.slice(0, 8),
				src: getAvatarURL(userId, member?.user?.avatar),
			};
		},
	};
}

/** The voice the user is in, as the stores have it now. */
export const currentVoicePlace: Readable<VoicePlace | null> = derived(
	[activeVoiceRoomId, gatewaySpaces, activeCall, conversations, callVoiceStates, currentUser],
	([$id, $spaces, $call, $conversations, $callStates, $me]) =>
		voicePlace($id, $spaces, $call, $conversations, $callStates, $me?.id),
);
