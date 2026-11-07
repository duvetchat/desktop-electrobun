import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { get } from "svelte/store";
import { openGateway, type TestGateway } from "$lib/api/ws/test-gateway";
import type { Conversation } from "$lib/api/conversations";

const { conversationLeft } = await import("$lib/api/ws/connection");
const {
	activeCall,
	activeVoiceRoomId,
	callVoiceStates,
	conversations,
	conversationsWithCalls,
	currentUser,
	unreadConversations,
} = await import("$lib/stores.svelte");
const { toastStore } = await import("$lib/stores/toast.svelte");

const ME = "01920000-0000-7000-8000-00000000b0b0";
const ANA = "01920000-0000-7000-8000-00000000a11c";
const GROUP = "01920000-0000-7000-8000-0000000000c1";
const DM = "01920000-0000-7000-8000-0000000000c2";

const conversation = (id: string, type: 1 | 2, members: string[]): Conversation => ({
	id,
	type,
	name: type === 2 ? "A group" : null,
	owner_id: ME,
	created_at: "",
	updated_at: "",
	deleted_at: null,
	members: members.map((user_id) => ({
		id: `${id}-${user_id}`,
		conversation_id: id,
		user_id,
		created_at: "",
		updated_at: "",
		user: {
			id: user_id,
			username: user_id === ANA ? "ana" : "me",
			alias: user_id === ANA ? "Ana" : null,
			avatar: null,
			banner: null,
		},
	})),
});
const shownCall = (conversationId: string, state: "ringing" | "calling" | "connected") => ({
	conversationId,
	state,
	initiatorId: ME,
	initiatorName: "me",
	initiatorAvatar: null,
	memberIds: [ME, ANA],
});

let gateway: TestGateway;

beforeEach(async () => {
	currentUser.set({
		id: ME,
		username: "me",
		email_verified: true,
		alias: null,
		avatar: null,
		banner: null,
		custom: "",
		flags: 0,
		badges: 0,
		is_bot: false,
		created_at: "",
		updated_at: "",
	});
	conversations.set([conversation(GROUP, 2, [ME, ANA]), conversation(DM, 1, [ME, ANA])]);
	unreadConversations.set(new Set());
	activeCall.set(null);
	activeVoiceRoomId.set(null);
	conversationsWithCalls.set(new Set());
	callVoiceStates.set([]);
	gateway = await openGateway();
});

afterEach(() => gateway.close());

const listed = () => get(conversations).map((c) => c.id);

describe("a group the user left, or was removed from", () => {
	const inGroupCall = () => {
		activeCall.set(shownCall(GROUP, "connected"));
		activeVoiceRoomId.set(GROUP);
		conversationsWithCalls.set(new Set([GROUP]));
		callVoiceStates.set([
			{ room_id: GROUP, user_id: ANA, muted: false, deafened: false, screen_sharing: false, camera: false },
		]);
	};
	const callIsOver = () => {
		expect(get(activeCall)).toBeNull();
		expect(get(activeVoiceRoomId)).toBeNull();
		expect(get(conversationsWithCalls).has(GROUP)).toBe(false);
		expect(get(callVoiceStates)).toEqual([]);
	};

	test("its CONVERSATION_MEMBER_REMOVE takes it from the list, with its unread dot", () => {
		unreadConversations.set(new Set([GROUP, DM]));
		gateway.receive("CONVERSATION_MEMBER_REMOVE", { conversation_id: GROUP, user_id: ME });
		expect(listed()).toEqual([DM]);
		expect([...get(unreadConversations)]).toEqual([DM]);
	});

	test("and ends the call shown there, without waiting for the gateway's CALL_ENDED", () => {
		inGroupCall();
		gateway.receive("CONVERSATION_MEMBER_REMOVE", { conversation_id: GROUP, user_id: ME });
		callIsOver();
		// Which changes nothing when it comes.
		gateway.receive("CALL_ENDED", { conversation_id: GROUP });
		callIsOver();
	});

	test("a call that comes to an end first is over as well, and the removal that follows finds nothing to end", () => {
		inGroupCall();
		gateway.receive("CALL_ENDED", { conversation_id: GROUP });
		callIsOver();
		gateway.receive("CONVERSATION_MEMBER_REMOVE", { conversation_id: GROUP, user_id: ME });
		callIsOver();
		expect(listed()).toEqual([DM]);
	});

	test("a call ringing there stops", () => {
		activeCall.set(shownCall(GROUP, "ringing"));
		gateway.receive("CONVERSATION_MEMBER_REMOVE", { conversation_id: GROUP, user_id: ME });
		expect(get(activeCall)).toBeNull();
	});

	test("a call or a voice room elsewhere goes on", () => {
		activeCall.set(shownCall(DM, "connected"));
		activeVoiceRoomId.set(DM);
		gateway.receive("CONVERSATION_MEMBER_REMOVE", { conversation_id: GROUP, user_id: ME });
		expect(get(activeCall)?.conversationId).toBe(DM);
		expect(get(activeVoiceRoomId)).toBe(DM);
	});

	test("the API's answer does the same, with no event from the gateway at all", () => {
		inGroupCall();
		unreadConversations.set(new Set([GROUP]));
		conversationLeft(GROUP);
		expect(listed()).toEqual([DM]);
		expect(get(unreadConversations).size).toBe(0);
		callIsOver();
	});

	test("someone else leaving only takes them from its members", () => {
		inGroupCall();
		gateway.receive("CONVERSATION_MEMBER_REMOVE", { conversation_id: GROUP, user_id: ANA });
		expect(listed()).toEqual([GROUP, DM]);
		expect(get(conversations)[0].members.map((m) => m.user_id)).toEqual([ME]);
		expect(get(activeCall)?.conversationId).toBe(GROUP);
	});
});

describe("what voice and calls tell the user", () => {
	const OTHER_GROUP = "01920000-0000-7000-8000-0000000000c3";
	const notices = () => toastStore.items.map((t) => [t.message, t.type]);

	beforeEach(() => {
		toastStore.items = [];
	});

	describe("VOICE_SESSION_REPLACED", () => {
		test("voice taken over by another session says so, and leaves", () => {
			activeVoiceRoomId.set(GROUP);
			gateway.receive("VOICE_SESSION_REPLACED", { room_id: GROUP });
			expect(notices()).toEqual([["Your voice moved to another device", "info"]]);
			expect(get(activeVoiceRoomId)).toBeNull();
		});

		test("a call's voice takes the call with it", () => {
			activeVoiceRoomId.set(GROUP);
			activeCall.set(shownCall(GROUP, "connected"));
			gateway.receive("VOICE_SESSION_REPLACED", { room_id: GROUP });
			expect(notices()).toEqual([["Your voice moved to another device", "info"]]);
			expect(get(activeCall)).toBeNull();
		});

		test("access lost isn't told as another device", () => {
			activeVoiceRoomId.set(GROUP);
			gateway.receive("VOICE_SESSION_REPLACED", { room_id: GROUP, reason: "permissions" });
			expect(notices()).toEqual([["You can't be in this voice room anymore", "error"]]);
			expect(get(activeVoiceRoomId)).toBeNull();
		});

		// The gateway tells all the user's sessions when the one that joined is gone: only one in that room acts on it.
		test("one that isn't in that room says nothing, and stays where it is", () => {
			activeVoiceRoomId.set(DM);
			gateway.receive("VOICE_SESSION_REPLACED", { room_id: GROUP, reason: "permissions" });
			expect(notices()).toEqual([]);
			expect(get(activeVoiceRoomId)).toBe(DM);
		});
	});

	describe("CALL_DECLINED", () => {
		test("the device placing the call hears who turned it down, and goes on calling the others", () => {
			activeCall.set(shownCall(GROUP, "calling"));
			gateway.receive("CALL_DECLINED", { conversation_id: GROUP, user_id: ANA });
			expect(notices()).toEqual([["Ana declined", "info"]]);
			expect(get(activeCall)?.state).toBe("calling");
		});

		test("the user's own decline only stops it ringing", () => {
			activeCall.set(shownCall(GROUP, "ringing"));
			gateway.receive("CALL_DECLINED", { conversation_id: GROUP, user_id: ME });
			expect(notices()).toEqual([]);
			expect(get(activeCall)).toBeNull();
		});

		test("the caller's other devices say nothing", () => {
			gateway.receive("CALL_DECLINED", { conversation_id: GROUP, user_id: ANA });
			expect(notices()).toEqual([]);
		});
	});

	describe("CALL_INCOMING", () => {
		const incoming = (conversation_id: string) => ({
			conversation_id,
			initiator_id: ANA,
			initiator_name: "Ana",
			initiator_avatar: null,
		});

		test("during another call it's missed, and that call goes on", () => {
			activeCall.set(shownCall(DM, "connected"));
			gateway.receive("CALL_INCOMING", incoming(GROUP));
			expect(notices()).toEqual([["Missed a call from Ana", "info"]]);
			expect(get(activeCall)?.conversationId).toBe(DM);
			// Its conversation offers to join it.
			expect(get(conversationsWithCalls).has(GROUP)).toBe(true);
		});

		test("with no call it rings, and says nothing", () => {
			gateway.receive("CALL_INCOMING", incoming(GROUP));
			expect(notices()).toEqual([]);
			expect(get(activeCall)?.state).toBe("ringing");
		});

		test("the call this client is placing, crossed with theirs, isn't missed", () => {
			activeCall.set(shownCall(GROUP, "calling"));
			gateway.receive("CALL_INCOMING", incoming(GROUP));
			expect(notices()).toEqual([]);
			expect(get(activeCall)?.state).toBe("calling");
		});

		test("a READY during a call says nothing of the calls it lists, on this READY or the next", async () => {
			activeCall.set(shownCall(DM, "calling"));
			const api = spyOn(globalThis, "fetch").mockImplementation((async (_input: string | URL | Request) =>
				Response.json([])) as typeof fetch);
			try {
				const ready = {
					user: get(currentUser),
					sessionToken: "gateway-session",
					guild_ids: [],
					active_calls: [
						{ conversation_id: DM, initiator_id: ME, ringing: false, voice_states: null },
						{
							conversation_id: OTHER_GROUP,
							initiator_id: ANA,
							initiator_name: "Ana",
							ringing: true,
							voice_states: null,
						},
					],
				};
				gateway.receive("READY", ready);
				gateway.receive("READY", ready);
				await Bun.sleep(0);
			} finally {
				api.mockRestore();
			}
			expect(notices()).toEqual([]);
			expect(get(activeCall)?.conversationId).toBe(DM);
		});
	});
});
