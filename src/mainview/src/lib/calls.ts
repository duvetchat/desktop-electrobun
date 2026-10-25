import type { ActiveCallInfo } from "$lib/stores.svelte";
import type { CallAcceptedEvent, CallDeclinedEvent, CallOngoingEvent, GatewayReadyActiveCall } from "$lib/types";

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
 * What this client does when a call goes on without ringing the user (CALL_ONGOING): one ringing here stops, since
 * its ring window ended ("dismiss"), and shows as a call going on. One this client places or is in stays: the gateway
 * lets the user into a call they call or join when it didn't know them in it, and their answer follows.
 */
export function callOngoingAction(call: ShownCall | null, ongoing: CallOngoingEvent): "dismiss" | null {
	if (!call || call.conversationId !== ongoing.conversation_id) return null;
	return call.state === "ringing" ? "dismiss" : null;
}

/**
 * What a new gateway session's READY means for the call this client shows. One it doesn't list is over ("end"): the
 * gateway keeps calls in memory, so its restart ends them, and the call may have ended while this client was away. One
 * ringing here that READY says no longer rings the user goes ("dismiss"): they answered or declined it on another
 * device meanwhile, or its ring window ended. It takes a `ringing` false to say so: a gateway from before calls
 * followed users across their devices sends no `ringing`, and the call rings on, as it did then.
 */
export function callOnReady(call: ShownCall | null, listed: GatewayReadyActiveCall[]): "end" | "dismiss" | null {
	if (!call) return null;
	const same = listed.find((c) => c.conversation_id === call.conversationId);
	if (!same) return "end";
	return call.state === "ringing" && same.ringing === false ? "dismiss" : null;
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
 * The conversations whose call READY lists as the user's own, still ringing the others because nobody has answered it
 * (ownCallsRinging). A gateway from before calls followed users across their devices doesn't say, and none is.
 */
export function ownCallsRingingOnReady(listed: GatewayReadyActiveCall[], me: string): Set<string> {
	return new Set(listed.filter((c) => c.initiator_id === me && c.answered === false).map((c) => c.conversation_id));
}
