import { describe, expect, test } from "bun:test";
import type { DirectMessage } from "$lib/api/conversations";
import { directMessageToMessage, gatewayMessageToMessage, MessageType, type GatewayMessage } from "$lib/types";

// An API from before reactions by ID groups a message's reactions by name, so one custom emoji under two names (renamed
// between two people's reactions) comes as two: every message the app takes from the API has one reaction per emoji, as
// its lists key them by it.
describe("a message from the API has one reaction per emoji", () => {
	const reactions = [
		{ emoji_name: "blob", emoji_id: "x", count: 1, users: ["ana"] },
		{ emoji_name: "blobby", emoji_id: "x", count: 1, users: ["bob"] },
	];
	const one = [{ emoji_name: "blob", emoji_id: "x", count: 2, users: ["ana", "bob"] }];
	const at = "2026-11-18T10:00:00Z";

	test("a room's", () => {
		const raw: GatewayMessage = {
			id: "m",
			room_id: "r",
			author_id: "ana",
			content: "hi",
			type: MessageType.Text,
			created_at: at,
			updated_at: at,
			reactions,
		};
		expect(gatewayMessageToMessage(raw, []).reactions).toEqual(one);
	});

	test("a conversation's", () => {
		const raw: DirectMessage = {
			id: "m",
			conversation_id: "c",
			author_id: "ana",
			content: "hi",
			type: MessageType.Text,
			created_at: at,
			updated_at: at,
			seq: 1,
			reactions,
		};
		expect(directMessageToMessage(raw, [])?.reactions).toEqual(one);
	});
});
