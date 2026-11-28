import { describe, expect, test } from "bun:test";
import type { DirectMessage } from "$lib/api/conversations";
import {
	authorLabel,
	directMessageToMessage,
	gatewayMessageToMessage,
	MessageType,
	type GatewayMessage,
} from "$lib/types";

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

// #464: a message keeps no words of the app's, which would stay in the language it was loaded in. An author the client
// doesn't know is drawn as Unknown where it's drawn, in the language of the moment.
describe("an author the client doesn't know", () => {
	const at = "2026-11-18T10:00:00Z";
	const raw: GatewayMessage = {
		id: "m",
		room_id: "r",
		author_id: "ana",
		content: "hi",
		type: MessageType.Text,
		created_at: at,
		updated_at: at,
	};

	test("is kept as no name, and drawn as Unknown", () => {
		const message = gatewayMessageToMessage(raw, []);
		expect(message.author_name).toBe("");
		expect(authorLabel(message)).toBe("Unknown");
	});

	test("one the client knows is drawn by their name", () => {
		const user = {
			id: "ana",
			username: "ana",
			email_verified: true,
			alias: null,
			avatar: null,
			banner: null,
			custom: "",
			flags: 0,
			badges: 0,
			is_bot: false,
			created_at: at,
			updated_at: at,
		};
		const message = gatewayMessageToMessage({ ...raw, user }, []);
		expect(authorLabel(message)).toBe("ana");
	});
});
