import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { get } from "svelte/store";
import { openGateway, type TestGateway } from "$lib/api/ws/test-gateway";
import { MessageType } from "$lib/types";

const stores = await import("$lib/stores.svelte");

const ME = "01920000-0000-7000-8000-00000000b0b0";
const ALICE = "01920000-0000-7000-8000-00000000a11c";
const message = (n: number) => `01a15f8c-${String(n).padStart(4, "0")}-7000-8000-000000000000`;
const conversation = (n: number) => `01a15f8c-0000-7000-8000-${String(n).padStart(12, "0")}`;

let gateway: TestGateway;

function deliver(type: string, data: unknown) {
	gateway.receive(type, data);
}

function ready(fields: Record<string, unknown>) {
	deliver("READY", { user: { id: ME, username: "me" }, sessionToken: "session", guild_ids: [], ...fields });
}

/** A call's notice in a conversation, of a call the user was in: its ID is minted as the call ends. */
function callNotice(id: string, conversationId: string) {
	deliver("DM_MESSAGE_CREATE", {
		id,
		conversation_id: conversationId,
		author_id: ALICE,
		content: "",
		type: 3,
		call: {
			participants: [ALICE, ME],
			started_at: "2026-11-01T12:00:00Z",
			ended_at: "2026-11-01T12:05:00Z",
		},
		created_at: "2026-11-01T12:05:00Z",
		updated_at: "2026-11-01T12:05:00Z",
	});
}

const fetchSpy = spyOn(globalThis, "fetch");

beforeAll(async () => {
	fetchSpy.mockImplementation((async (_input: string | URL | Request) => Response.json([])) as typeof fetch);
	localStorage.setItem("duvet_session_token", "access");
	gateway = await openGateway();
});

afterAll(() => {
	gateway.close();
	fetchSpy.mockRestore();
});

describe("a seen call's notice that comes late", () => {
	test("leaves a conversation unread for a newer message READY names, which never loaded", () => {
		const conv = conversation(1);
		ready({ unread_convs: [conv], last_read_convs: { [conv]: message(10) }, last_msg_convs: { [conv]: message(30) } });
		expect(get(stores.dmMessages)[conv]).toBeUndefined();
		callNotice(message(20), conv);
		expect(get(stores.unreadConversations).has(conv)).toBe(true);
		expect(get(stores.lastReadConvs)?.[conv]).toBe(message(20));
	});

	test("leaves it read when READY names the notice itself", () => {
		const conv = conversation(2);
		ready({ unread_convs: [conv], last_read_convs: { [conv]: message(10) }, last_msg_convs: { [conv]: message(20) } });
		callNotice(message(20), conv);
		expect(get(stores.unreadConversations).has(conv)).toBe(false);
	});

	test("goes by the loaded messages without an entry: an older gateway's READY, or a key past its 90 days", () => {
		const conv = conversation(3);
		ready({ unread_convs: [conv], last_read_convs: { [conv]: message(10) } });
		callNotice(message(20), conv);
		expect(get(stores.unreadConversations).has(conv)).toBe(false);

		const loaded = conversation(4);
		ready({ unread_convs: [loaded], last_read_convs: { [loaded]: message(10) } });
		stores.dmMessages.update((all) => ({
			...all,
			[loaded]: [
				{
					id: message(30),
					conversation_id: loaded,
					author_id: ALICE,
					content: "newer",
					type: MessageType.Text,
					created_at: "",
					updated_at: "",
				},
			],
		}));
		callNotice(message(20), loaded);
		expect(get(stores.unreadConversations).has(loaded)).toBe(true);
	});
});
