import { expect, mock, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "svelte/server";
import { tags, type Tag } from "./server-render";
import type { Conversation, ConversationMember } from "$lib/api/conversations";

// UserAvatar draws with facehash-sv, whose package names its entry for the "svelte" condition alone, which Bun doesn't read.
const facehash = await import(join(import.meta.dir, "../../../node_modules/facehash-sv/dist/index.js"));
mock.module("facehash-sv", () => facehash);
// The stores' .svelte.ts modules use $state, which only Svelte's compiler knows: here it's the value itself.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { activeCall, conversations, currentUser } = await import("$lib/stores.svelte");
const { default: CallCard } = await import("./CallCard.svelte");

const ME = "01920000-0000-7000-8000-00000000b0b0";
const THEM = "01920000-0000-7000-8000-00000000a11c";
const OTHER = "01920000-0000-7000-8000-00000000b0b1";
const DM = "01920000-0000-7000-8000-0000000000c1";
const GROUP = "01920000-0000-7000-8000-0000000000c2";

const member = (user_id: string, alias: string): ConversationMember => ({
	id: `m-${user_id}`,
	conversation_id: "c",
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
conversations.set([
	conversation(DM, 1, null, [member(ME, "Me Myself"), member(THEM, "Ana Torres")]),
	conversation(GROUP, 2, "Squad", [member(ME, "Me Myself"), member(THEM, "Ana Torres"), member(OTHER, "Leo")]),
]);
currentUser.set({
	id: ME,
	username: "me",
	email_verified: true,
	alias: "Me Myself",
	avatar: null,
	banner: null,
	custom: "",
	flags: 0,
	badges: 0,
	is_bot: false,
	created_at: "",
	updated_at: "",
});

const callIn = (conversationId: string, state: "ringing" | "calling" | "connected") =>
	activeCall.set(
		state === "ringing"
			? { conversationId, initiatorId: THEM, initiatorName: "Ana Torres", initiatorAvatar: null, state, memberIds: [] }
			: // As startConversationCall fills a call the user places: with the user as its initiator.
				{ conversationId, initiatorId: ME, initiatorName: "Me Myself", initiatorAvatar: null, state, memberIds: [] },
	);

const onOpen = () => {};
const shown = () => tags(CallCard, { onOpen });
const text = () => render(CallCard, { props: { onOpen } }).body;
const labels = (all: Tag[]) =>
	all.filter((t) => t.name === "button" && t.attributes["aria-label"]).map((t) => t.attributes["aria-label"]);

test("a call ringing here is a card in the corner, with nothing over the rest of the app", async () => {
	callIn(DM, "ringing");
	const all = await shown();
	const card = all.find((t) => t.name === "section");
	expect(card?.attributes.class?.split(/\s+/)).toEqual(expect.arrayContaining(["fixed", "right-4", "w-80", "h-18"]));
	expect(card?.attributes.style).toContain("bottom: 16px");
	expect(all.some((t) => /\binset-0\b|backdrop-blur|bg-black\//.test(t.attributes.class ?? ""))).toBe(false);
	// It takes no focus: the user goes on typing where they were.
	expect(all.some((t) => "autofocus" in t.attributes)).toBe(false);
});

test("it says who calls and, in a group, from where, with Accept and Decline", async () => {
	callIn(GROUP, "ringing");
	// As it reads, without its tags.
	const words = text().replace(/<[^>]*>/g, "");
	expect(words).toContain("Ana Torres");
	expect(words).toContain("Incoming call · Squad");
	const all = await shown();
	expect(labels(all)).toEqual(["Accept call", "Decline call"]);
	expect(all.find((t) => t.attributes.role === "alert")).toBeDefined();
});

test("a call placed from here says whom it calls, with Cancel alone", async () => {
	callIn(DM, "calling");
	expect(text()).toContain("Calling…");
	expect(text()).toContain("Ana Torres");
	expect(text()).not.toContain("Me Myself");
	const all = await shown();
	expect(labels(all)).toEqual(["Cancel call"]);
	expect(all.find((t) => t.attributes.role === "alert")).toBeUndefined();
});

test("an answered call draws no card", async () => {
	callIn(DM, "connected");
	expect((await shown()).find((t) => t.name === "section")).toBeUndefined();
});

// The layers the components' dialogs take, read from their overlays' and contents' classes.
const dialogLayers = () =>
	readdirSync(import.meta.dir)
		.filter((file) => file.endsWith(".svelte"))
		.flatMap((file) => readFileSync(join(import.meta.dir, file), "utf8").split("\n"))
		.filter((line) => /(Alert)?Dialog\.(Overlay|Content)/.test(line))
		.map((line) => Number(/\bz-\[?(\d+)\]?/.exec(line)?.[1] ?? 0));

test("no open dialog covers a ringing call: the card sits above every dialog's layer, and takes clicks", async () => {
	callIn(DM, "ringing");
	const card = (await shown()).find((t) => t.name === "section");
	const layer = Number(/\bz-(\d+)\b/.exec(card?.attributes.class ?? "")?.[1] ?? 0);
	expect(layer).toBeGreaterThan(Math.max(...dialogLayers()));
	// A modal dialog turns pointer events off on the body, so the card turns them back on, as a toast does.
	expect(card?.attributes.class?.split(/\s+/)).toContain("pointer-events-auto");
});
