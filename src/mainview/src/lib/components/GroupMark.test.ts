import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tags, type Tag } from "./server-render";
import type { Conversation, ConversationMember, DirectMessage } from "$lib/api/conversations";

// UserAvatar draws with facehash-sv, whose package names its entry for the "svelte" condition alone, which Bun doesn't read.
const facehash = await import(join(import.meta.dir, "../../../node_modules/facehash-sv/dist/index.js"));
mock.module("facehash-sv", () => facehash);
// The stores' .svelte.ts modules use $state, which only Svelte's compiler knows: here it's the value itself.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { activeCall, conversations, currentUser } = await import("$lib/stores.svelte");
const { callHistory } = await import("$lib/call-history");
const { MessageType } = await import("$lib/types");
const { default: CallCard } = await import("./CallCard.svelte");
const { default: CallHistory } = await import("./CallHistory.svelte");
const { default: DMSidebar } = await import("./DMSidebar.svelte");
const { default: EmptyPane } = await import("./EmptyPane.svelte");
const { default: TabIcon } = await import("./TabIcon.svelte");

const ME = "01920000-0000-7000-8000-00000000b0b0";
const ANA = "01920000-0000-7000-8000-00000000a11c";
const LEO = "01920000-0000-7000-8000-00000000b0b1";
const DM = "01920000-0000-7000-8000-0000000000c1";
const GROUP = "01920000-0000-7000-8000-0000000000c2";

const member = (conversationId: string, user_id: string, alias: string): ConversationMember => ({
	id: `${user_id.slice(0, -4)}0000`,
	conversation_id: conversationId,
	user_id,
	created_at: "",
	updated_at: "",
	user: { id: user_id, username: alias.toLowerCase(), alias, avatar: null, banner: null },
});
const conversation = (id: string, type: 1 | 2, name: string | null, members: ConversationMember[]): Conversation => ({
	id,
	type,
	name,
	owner_id: ME,
	created_at: "",
	updated_at: "",
	deleted_at: null,
	members,
});
const group = conversation(GROUP, 2, "Squad", [
	member(GROUP, ME, "Me"),
	member(GROUP, ANA, "Ana"),
	member(GROUP, LEO, "Leo"),
]);
const dm = conversation(DM, 1, null, [member(DM, ME, "Me"), member(DM, ANA, "Ana")]);
currentUser.set({
	id: ME,
	username: "me",
	email_verified: true,
	alias: "Me",
	avatar: null,
	banner: null,
	custom: "",
	flags: 0,
	badges: 0,
	is_bot: false,
	created_at: "",
	updated_at: "",
});

// A face drawn for someone without a picture (facehash-sv's Facehash), and the group's mark (lucide's users-round).
const faces = (all: Tag[]) => all.filter((t) => "data-facehash" in t.attributes);
const marks = (all: Tag[]) =>
	all.filter((t) => t.name === "svg" && /\blucide-users-round\b/.test(t.attributes.class ?? ""));

const callNotice = (conversationId: string): DirectMessage => ({
	id: "01a15f8c-0009-7000-8000-000000000000",
	conversation_id: conversationId,
	author_id: ANA,
	content: null,
	type: MessageType.Call,
	created_at: "2026-11-01T12:05:00Z",
	updated_at: "2026-11-01T12:05:00Z",
	user: { id: ANA, username: "ana", alias: "Ana", avatar: null, banner: null },
	call: { participants: [ANA, ME], started_at: "2026-11-01T12:00:00Z", ended_at: "2026-11-01T12:05:00Z" },
});

const tab = (channelId: string) => ({
	channelId,
	channelName: "",
	channelType: "conversation",
	spaceId: "",
	kind: "conversation" as const,
});

// #376: faces are for people. A group has no picture, and where it shows by itself it drew a face made from its name,
// as a person without one gets, but on its tab, which drew a group's mark. It has that mark everywhere now; a DM still
// shows the other person.
describe("a group without a picture", () => {
	const shows = async (draw: () => Promise<Tag[]>) => {
		const all = await draw();
		expect(marks(all)).toHaveLength(1);
		expect(faces(all)).toEqual([]);
	};

	test("has its mark in the chat list", async () => {
		conversations.set([group]);
		await shows(() => tags(DMSidebar, { onSelect: () => {} }));
	});

	test("in the call history", async () => {
		conversations.set([group]);
		callHistory.set({ calls: [callNotice(GROUP)], before: null, more: false });
		await shows(() => tags(CallHistory, {}));
	});

	test("on the card of a call placed to it", async () => {
		conversations.set([group]);
		activeCall.set({
			conversationId: GROUP,
			initiatorId: ME,
			initiatorName: "Me",
			initiatorAvatar: null,
			state: "calling",
			memberIds: [],
		});
		await shows(() => tags(CallCard, { onOpen: () => {} }));
		activeCall.set(null);
	});

	test("among an empty pane's latest chats", async () => {
		conversations.set([group]);
		await shows(() => tags(EmptyPane, { onOpen: () => {} }));
	});

	// Its dialog draws nothing outside a browser (bits-ui's portal): what it draws for a chat is read from its source.
	test("in the quick switcher", () => {
		const switcher = readFileSync(join(import.meta.dir, "QuickSwitcher.svelte"), "utf8");
		expect(switcher).toContain("group: conv.type === 2 || !other,");
		expect(switcher).toMatch(
			/\{:else if item\.kind === "conversation" && item\.group\}\s*<GroupMark size=\{24\} \/>\s*\{:else\}\s*<UserAvatar src=\{item\.avatar\}/,
		);
	});

	test("and on its tab, as before", async () => {
		conversations.set([group]);
		await shows(() => tags(TabIcon, { tab: tab(GROUP), size: 14 }));
	});
});

describe("a DM", () => {
	test("still shows the other person, wherever it shows", async () => {
		conversations.set([dm]);
		for (const all of [
			await tags(DMSidebar, { onSelect: () => {} }),
			await tags(EmptyPane, { onOpen: () => {} }),
			await tags(TabIcon, { tab: tab(DM), size: 14 }),
		]) {
			expect(marks(all)).toEqual([]);
			expect(faces(all)).toHaveLength(1);
		}
	});
});
