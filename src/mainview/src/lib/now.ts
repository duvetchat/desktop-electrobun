import type { Conversation } from "$lib/api/conversations";

/** The busiest voice rooms "In voice now" lists before the user opens the rest. */
export const NOW_ROOMS = 3;
/** The faces the voice dock's one row has room for, the user's own voice; the rest are a "+N". */
export const NOW_DOCK_FACES = 3;
/** The faces a voice room's row shows; the rest are a "+N". */
export const NOW_ROOM_FACES = 4;
/** The places in the online friends' row: their faces, the last one a "+N" when they're more. */
export const NOW_FRIENDS = 8;
/** The online friends with a row of what they're doing; the others doing something are faces with the rest. */
export const NOW_FRIEND_ROWS = 3;

/** A face in a stack: a person, round, dimmed when they're away, ringed while they speak. */
export type Face = { id: string; src: string | null; name: string; dim?: boolean; speaking?: boolean };

/**
 * The calls going on in the user's conversations that the column offers to join: not the one this client shows
 * already (the voice dock has it connected, and the call dialog has it ringing or being placed), nor one in the
 * conversation the focused pane shows, whose banner has Join.
 */
export function joinableCalls(
	withCalls: ReadonlySet<string>,
	shown: { conversationId: string } | null,
	openConversationId: string | null,
): string[] {
	return [...withCalls].filter((id) => id !== shown?.conversationId && id !== openConversationId);
}

/** What a voice room shows live: someone's screen, else someone's camera. */
export function liveIn(people: readonly { screen_sharing?: boolean; camera?: boolean }[]): "screen" | "camera" | null {
	if (people.some((p) => p.screen_sharing)) return "screen";
	if (people.some((p) => p.camera)) return "camera";
	return null;
}

/** Online friends split for the column: the first `rows` doing something get a row with it, the rest a face. */
export function friendsNow<F, A>(
	online: readonly F[],
	activityOf: (friend: F) => A | null,
	rows = NOW_FRIEND_ROWS,
): { busy: { friend: F; activity: A }[]; rest: F[] } {
	const busy: { friend: F; activity: A }[] = [];
	const rest: F[] = [];
	for (const friend of online) {
		const activity = busy.length < rows ? activityOf(friend) : null;
		if (activity) busy.push({ friend, activity });
		else rest.push(friend);
	}
	return { busy, rest };
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
