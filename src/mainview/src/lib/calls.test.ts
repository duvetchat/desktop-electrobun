import { describe, expect, test } from "bun:test";
import { callAcceptedAction } from "$lib/calls";
import type { CallState } from "$lib/stores.svelte";

const ME = "01920000-0000-7000-8000-00000000b0b0";
const THEM = "01920000-0000-7000-8000-00000000a11c";
const CONV = "01920000-0000-7000-8000-0000000000c1";
const OTHER_CONV = "01920000-0000-7000-8000-0000000000c2";
// The call this client shows, and a CALL_ACCEPTED: who answered which conversation's call.
const call = (state: CallState, conversationId = CONV) => ({ conversationId, state });
const acceptedBy = (user_id: string, conversation_id = CONV) => ({ conversation_id, user_id });

describe("callAcceptedAction", () => {
	test("the call this client placed joins once someone answers it", () => {
		expect(callAcceptedAction(call("calling"), acceptedBy(THEM), ME)).toBe("join");
	});

	test("a call ringing here goes when the user answered it on another device", () => {
		expect(callAcceptedAction(call("ringing"), acceptedBy(ME), ME)).toBe("dismiss");
	});

	test("someone else answering a call that rings here leaves it ringing", () => {
		expect(callAcceptedAction(call("ringing"), acceptedBy(THEM), ME)).toBeNull();
	});

	test("a call this client is in already stays as it is", () => {
		expect(callAcceptedAction(call("connected"), acceptedBy(THEM), ME)).toBeNull();
		expect(callAcceptedAction(call("connected"), acceptedBy(ME), ME)).toBeNull();
	});

	test("without a call here, or with another one, the user stays where they are", () => {
		expect(callAcceptedAction(null, acceptedBy(THEM), ME)).toBeNull();
		expect(callAcceptedAction(null, acceptedBy(ME), ME)).toBeNull();
		expect(callAcceptedAction(call("calling", OTHER_CONV), acceptedBy(THEM), ME)).toBeNull();
		expect(callAcceptedAction(call("ringing", OTHER_CONV), acceptedBy(ME), ME)).toBeNull();
	});
});
