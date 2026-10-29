import type { Conversation } from "$lib/api/conversations";

/** The voice rooms "In voice now" lists while the user isn't in voice. */
export const NOW_ROOMS = 3;
/** The faces a voice room's row shows; the rest are a "+N". */
export const NOW_ROOM_FACES = 4;
/** The places in the online friends' row while nobody is in voice: their faces, the last one a "+N" when they're more. */
export const NOW_FRIENDS = 8;

/** A face in a stack: a person, round, dimmed when they're away, ringed while they speak. */
export type Face = { id: string; src: string | null; name: string; dim?: boolean; speaking?: boolean };

export type NowKind = "voice" | "rooms" | "friends";

/**
 * What the spaces column's Now section shows: the voice the user is in, else the voice rooms of their spaces with
 * people in them, else their online friends. Nothing when there's none of those.
 */
export function nowKind(inVoice: boolean, liveRooms: number, onlineFriends: number): NowKind | null {
	if (inVoice) return "voice";
	if (liveRooms > 0) return "rooms";
	if (onlineFriends > 0) return "friends";
	return null;
}

/** The rooms with people in them, the busiest first, at most `max`; rooms as busy keep their order. */
export function busiestRooms<R>(rooms: readonly R[], peopleIn: (room: R) => number, max = NOW_ROOMS): R[] {
	return rooms
		.map((room, index) => ({ room, index, people: peopleIn(room) }))
		.filter((r) => r.people > 0)
		.sort((a, b) => b.people - a.people || a.index - b.index)
		.slice(0, max)
		.map((r) => r.room);
}

/** The first `max` faces of a list, and how many more there are. */
export function capFaces<T>(items: readonly T[], max: number): { faces: T[]; more: number } {
	const faces = items.slice(0, Math.max(0, max));
	return { faces, more: items.length - faces.length };
}

/** The faces that fit in `slots` places: all of them when they fit, else one place fewer, for the "+N" of the rest. */
export function fitFaces<T>(items: readonly T[], slots: number): { faces: T[]; more: number } {
	return capFaces(items, items.length <= slots ? slots : slots - 1);
}

/** Who a voice room or call has in it: the gateway's list, and the user, whom it may not list yet having just joined. */
export function withSelf<P extends { id: string }>(people: readonly P[], me: P | null): P[] {
	if (!me || people.some((p) => p.id === me.id)) return [...people];
	return [...people, me];
}

export function peopleCount(n: number): string {
	return n === 1 ? "1 person" : `${n} people`;
}

/** A voice room's row's name for a screen reader, which can't count its faces. */
export function voiceRoomLabel(room: string, space: string, people: number): string {
	return `Open ${room} in ${space}, ${peopleCount(people)}`;
}

/** The name a call goes by: a group's, or the other person's in a direct message. */
export function callName(conv: Pick<Conversation, "type" | "name" | "members"> | undefined, me?: string): string {
	if (!conv) return "Call";
	if (conv.type === 2) return conv.name ?? "Group call";
	const other = conv.members.find((m) => m.user_id !== me);
	return other?.user?.alias ?? other?.user?.username ?? "Call";
}

/** What the voice dock says of its connection while it isn't up; nothing once it is. */
export function connectionNote(state: RTCPeerConnectionState): string | null {
	switch (state) {
		case "connected":
			return null;
		case "disconnected":
			return "Reconnecting…";
		case "failed":
			return "Connection failed";
		case "closed":
			return "Disconnected";
		default:
			return "Connecting…";
	}
}
