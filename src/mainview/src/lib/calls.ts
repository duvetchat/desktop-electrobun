import type { ActiveCallInfo, CallVoiceState } from "$lib/stores.svelte";
import type { Conversation, ConversationMember } from "$lib/api/conversations";
import { conversationTitle, otherMember } from "$lib/pane";
import type {
	CallAcceptedEvent,
	CallDeclinedEvent,
	CallIncomingEvent,
	CallOngoingEvent,
	GatewayCallVoiceState,
	GatewayReadyActiveCall,
	VoiceSessionReplacedEvent,
	VoiceStateUpdateEvent,
} from "$lib/types";
import { REJOIN_WINDOW_MS, sendAgain, type AwaitedSend } from "$lib/resend";

/** The call this client shows: ringing, being placed, or connected. */
type ShownCall = Pick<ActiveCallInfo, "conversationId" | "state">;

/**
 * What this client does when a call is accepted (CALL_ACCEPTED), which the gateway tells every member of the call, on
 * each of their sessions. The call this client placed and is waiting on was answered: its voice joins ("join"). A
 * call ringing here that the user answered on another device goes ("dismiss"), since that device has it. Anything
 * else leaves the user where they are: in their voice room, in the call already, or with a call ringing that someone
 * else answered (a group's, which they can still answer).
 */
export function callAcceptedAction(
	call: ShownCall | null,
	accepted: CallAcceptedEvent,
	me: string | undefined,
): "join" | "dismiss" | null {
	if (!call || call.conversationId !== accepted.conversation_id) return null;
	if (call.state === "calling") return "join";
	if (call.state === "ringing" && accepted.user_id === me) return "dismiss";
	return null;
}

/**
 * What this client does when a call is declined (CALL_DECLINED), which the gateway tells the caller and every session
 * of whoever declined it. A call ringing here that the user declined on another device goes ("dismiss"). Anything else
 * stays: the caller's call rings on for the others, and ends once everyone declined it (CALL_ENDED).
 */
export function callDeclinedAction(
	call: ShownCall | null,
	declined: CallDeclinedEvent,
	me: string | undefined,
): "dismiss" | null {
	if (!call || call.conversationId !== declined.conversation_id) return null;
	return call.state === "ringing" && declined.user_id === me ? "dismiss" : null;
}

/**
 * What a CALL_DECLINED tells the user: someone turned down the call this client is placing. Only there: their other
 * devices get the event too, and so do those of whoever declined, where their own decline stops the ringing and says
 * nothing. Others in a group hear nothing of it, and once someone has answered, the call goes on whoever declines. Someone
 * whose connection ends while it rings them counts as declining it, and the event doesn't tell the two apart.
 */
export function callDeclinedNotice(
	call: ShownCall | null,
	declined: CallDeclinedEvent,
	me: string | undefined,
	members: Pick<ConversationMember, "user_id" | "user">[] = [],
): string | null {
	if (call?.conversationId !== declined.conversation_id || call.state !== "calling" || declined.user_id === me) {
		return null;
	}
	const user = members.find((m) => m.user_id === declined.user_id)?.user;
	return `${user?.alias ?? user?.username ?? "They"} declined`;
}

/**
 * What a CALL_INCOMING that doesn't ring here tells the user: it came during another call, and this client shows one at a
 * time. Not with no call shown, as it rings then. Nor for the call this client shows: two calls that crossed are one, and
 * an event held for READY can repeat the call READY rang for.
 */
export function missedCallNotice(call: ShownCall | null, incoming: CallIncomingEvent): string | null {
	if (!call || call.conversationId === incoming.conversation_id) return null;
	return `Missed a call from ${incoming.initiator_name}`;
}

/** What the user is told when they can't be in the voice room they're in any more: they lost access to it, or it was
 * deleted or hidden from them, or its space was deleted (#213). */
export const VOICE_ROOM_LOST = "You can't be in this voice room anymore";

/**
 * What the user is told when the gateway ends the voice this client is in (VOICE_SESSION_REPLACED). "permissions" means
 * they can't be in that room any more: they lost ViewChannels or JoinVoice there, left its space, or it went. Without a
 * reason, a newer join of theirs, from another session, took it.
 */
export function voiceEndedNotice(ended: VoiceSessionReplacedEvent): string {
	return ended.reason === "permissions" ? VOICE_ROOM_LOST : "Your voice moved to another device";
}

/**
 * What this client does when a call goes on without ringing the user (CALL_ONGOING): one ringing here stops, since
 * its ring window ended ("dismiss"), and shows as a call going on. One this client places or is in stays: the gateway
 * lets the user into a call they call or join when it didn't know them in it, and their answer follows.
 */
export function callOngoingAction(call: ShownCall | null, ongoing: CallOngoingEvent): "dismiss" | null {
	if (!call || call.conversationId !== ongoing.conversation_id) return null;
	return call.state === "ringing" ? "dismiss" : null;
}

/** What READY needs to know of this client, besides the calls it lists. */
export interface ReadyContext {
	/** How long the gateway had been silent before this READY. */
	silentMs: number;
	/** This client's CALL_INITIATE or CALL_ACCEPT for the call it shows went out on READY's own connection, after its
	 * identify: READY was built before the gateway got it. */
	sentOnThisConnection: boolean;
}

/**
 * What a new gateway session's READY means for the call this client shows.
 * - One it doesn't list is over ("end"): the gateway keeps calls in memory, so its restart ends them, and the call may
 *   have ended while this client was away. Not when this client placed or answered it on READY's own connection:
 *   READY was built before the gateway got that, so the call stays ("keep"), and its events follow.
 * - One ringing here that READY says no longer rings the user goes ("dismiss"): they answered or declined it on another
 *   device meanwhile, or its ring window ended.
 * - One this client places that READY says someone answered, whose CALL_ACCEPTED it missed, joins ("join"), as on
 *   CALL_ACCEPTED, but only when the gateway was silent for less than the rejoin window, as voice rejoins. After a
 *   longer silence (a sleep, say) it stops calling instead ("dismiss"), and shows as a call going on, with Join. Not
 *   one placed on READY's own connection, whose CALL_ACCEPTED follows.
 * It takes a `ringing` false or an `answered` true to say so: a gateway from before calls followed users across their
 * devices sends neither, and the call rings, or calls, on, as it did then.
 */
export function callOnReady(
	call: ShownCall | null,
	listed: GatewayReadyActiveCall[],
	context: ReadyContext,
): "end" | "keep" | "dismiss" | "join" | null {
	if (!call) return null;
	const same = listed.find((c) => c.conversation_id === call.conversationId);
	if (!same) return context.sentOnThisConnection ? "keep" : "end";
	if (call.state === "ringing" && same.ringing === false) return "dismiss";
	if (call.state === "calling" && same.answered === true && !context.sentOnThisConnection) {
		return context.silentMs > REJOIN_WINDOW_MS ? "dismiss" : "join";
	}
	return null;
}

/**
 * The call to ring for at READY, when this client shows none: the first that READY says still rings the user, which
 * carries its caller's name and avatar. Not their own call, nor one they answered or declined on any device, nor one
 * whose ring window passed. A gateway from before calls followed users across their devices says none does, and
 * nothing rings at READY, as then.
 */
export function callToRingOnReady(listed: GatewayReadyActiveCall[]): GatewayReadyActiveCall | null {
	return listed.find((c) => c.ringing === true) ?? null;
}

/**
 * Whether the user's own call in a conversation, still ringing the others (ownCallsRinging), is being placed on another
 * device: the conversation then shows "Calling from another device", without Join or the call button. Not on a
 * device that shows that call: the one placing it, which the gateway tells too (CALL_OUTGOING) and which shows its
 * calling screen, or one in it.
 */
export function callingFromAnotherDevice(
	conversationId: string,
	ownRinging: ReadonlySet<string>,
	call: ShownCall | null,
): boolean {
	return ownRinging.has(conversationId) && call?.conversationId !== conversationId;
}

/**
 * The conversations whose call READY lists as the user's own, still ringing the others because nobody has answered it
 * (ownCallsRinging). A gateway from before calls followed users across their devices doesn't say, and none is.
 */
export function ownCallsRingingOnReady(listed: GatewayReadyActiveCall[], me: string): Set<string> {
	return new Set(listed.filter((c) => c.initiator_id === me && c.answered === false).map((c) => c.conversation_id));
}

/** Who is in a call's voice, from READY or CALL_ONGOING, as this client keeps them (callVoiceStates). */
export function callVoiceStatesOf(conversationId: string, states: GatewayCallVoiceState[] | null): CallVoiceState[] {
	return (states ?? []).map((vs) => ({
		room_id: conversationId,
		user_id: vs.user_id,
		muted: vs.muted,
		deafened: vs.deafened,
		screen_sharing: vs.screen_sharing,
		camera: vs.camera,
		watching: vs.watching ?? [],
	}));
}

/** The calls' voice states after a VOICE_STATE_UPDATE: who joined is added, or updated, and who left goes. */
export function withCallVoiceState(states: CallVoiceState[], update: VoiceStateUpdateEvent): CallVoiceState[] {
	const idx = states.findIndex((s) => s.room_id === update.room_id && s.user_id === update.user_id);
	if (!update.joined) return idx === -1 ? states : states.filter((_, i) => i !== idx);
	const state: CallVoiceState = {
		room_id: update.room_id,
		user_id: update.user_id,
		muted: update.muted,
		deafened: update.deafened,
		screen_sharing: update.screen_sharing,
		camera: update.camera,
		watching: update.watching ?? [],
	};
	return idx === -1 ? [...states, state] : states.map((s, i) => (i === idx ? state : s));
}

/** The calls' voice states without the user's in one call: they hung up there. */
export function withoutCallVoiceOf(
	states: CallVoiceState[],
	conversationId: string,
	userId: string | undefined,
): CallVoiceState[] {
	return states.filter((s) => !(s.room_id === conversationId && s.user_id === userId));
}

/** The CALL_INITIATE of the call this client places, and whom it rings, until the gateway shows it has the call. */
export interface PlacedCall extends AwaitedSend {
	conversationId: string;
	memberIds: string[];
}

/**
 * What a resumed session does with the CALL_INITIATE of the call this client places. While this client still places
 * that call, it goes again ("again") when sendAgain says so: it went out on an earlier connection, and nothing has
 * shown that the gateway got it (its CALL_OUTGOING, a decline, an answer). Once this client no longer places that
 * call (it was answered, cancelled or ended), it's forgotten ("drop").
 */
export function placeAgain(
	placed: PlacedCall | null,
	call: ShownCall | null,
	connection: number,
): "again" | "drop" | null {
	if (!placed) return null;
	if (call?.conversationId !== placed.conversationId || call.state !== "calling") return "drop";
	return sendAgain(placed, connection) ? "again" : null;
}

/** A conversation as the call card reads it. */
export type CallCardConversation = Pick<Conversation, "id" | "type" | "name" | "members">;

/** Who the call card shows: whose photo it is (null for a group, or a conversation this client doesn't know, which it
 * draws with the group's mark), the photo, the name, and the group a call comes in from, after "Incoming call" (null in
 * a DM). */
export interface CallCardFace {
	userId: string | null;
	avatar: string | null;
	name: string;
	place: string | null;
}

/**
 * What the call card (CallCard.svelte) shows of a call. One ringing here shows who calls, with the group it comes from.
 * One the user places shows whom they call: a DM's other member, or a group by its name, with its mark as the DM list
 * draws it. One of a conversation this client doesn't know is "Chat", as in the call history.
 */
export function callCardFace(
	call: Pick<ActiveCallInfo, "state" | "initiatorId" | "initiatorName" | "initiatorAvatar">,
	conversation: CallCardConversation | undefined,
	meId: string | undefined,
): CallCardFace {
	if (call.state === "ringing") {
		const place = conversation?.type === 2 ? conversationTitle(conversation, meId) : null;
		return { userId: call.initiatorId, avatar: call.initiatorAvatar, name: call.initiatorName, place };
	}
	if (!conversation) return { userId: null, avatar: null, name: "Chat", place: null };
	const other = otherMember(conversation, meId);
	return {
		userId: other?.user_id ?? null,
		avatar: other?.user?.avatar ?? null,
		name: conversationTitle(conversation, meId),
		place: null,
	};
}

/**
 * Whether a conversation's view offers to join the call going on there (its banner's Join). Not for the call this
 * client shows: once it's in it, nor while the call card has it, ringing here or placed from here, where Accept and
 * Cancel answer it. Joining a call one placed and that still rings would show it connected, and join its voice, before
 * anyone answered. The column's calls to join leave it out too (joinableCalls).
 */
export function offersJoin(conversationId: string, ongoing: boolean, call: ShownCall | null): boolean {
	return ongoing && call?.conversationId !== conversationId;
}
