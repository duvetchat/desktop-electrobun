import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRawSnippet } from "svelte";
import { render } from "svelte/server";
import { tags } from "./server-render";
import type { Message } from "$lib/types";

// UserAvatar draws with facehash-sv, whose package names its entry for the "svelte" condition alone, which Bun doesn't read.
const facehash = await import(join(import.meta.dir, "../../../node_modules/facehash-sv/dist/index.js"));
mock.module("facehash-sv", () => facehash);
// The stores' .svelte.ts modules the list imports use $state, which only Svelte's compiler knows: the value itself here.
// And the page a message's Duvet links are read against (window.location).
Object.assign(globalThis, {
	$state: <T>(value: T) => value,
	window: globalThis,
	location: new URL("http://localhost:5173/app"),
});
const { default: MessageList } = await import("./MessageList.svelte");

const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");
const intro = createRawSnippet(() => ({ render: () => "<p>The start of #general.</p>" }));
const message: Message = {
	id: "0190a3b2-0000-7000-8000-00000000aaaa",
	content: "Welcome to Alpha.",
	type: 0,
	author_id: "0190a3b2-0000-7000-8000-000000000002",
	author_name: "Ana",
	author_avatar_url: null,
	author_is_bot: false,
	created_at: "2026-11-01T10:00:00Z",
	updated_at: "2026-11-01T10:00:00Z",
};
const retry = () => {};
type Props = { messages?: Message[]; isInitialLoading?: boolean; retryFirstPage?: (() => void) | null };
const props = (p: Props) => ({ messages: [], channelId: "room", intro, ...p });
const shown = (p: Props) => render(MessageList, { props: props(p) }).body;
const FAILED = "Couldn't load messages";

// A room's or a conversation's first page that failed (an error, or no answer in 20 s) left an empty list, which showed
// the chat's start as if it had no messages, until its next visit.
describe("a chat whose first page failed", () => {
	test("says so in its empty list, with Try again, rather than showing the chat's start", async () => {
		const html = shown({ retryFirstPage: retry });
		expect(html).toContain(FAILED);
		expect(html).not.toContain("The start of #general.");
		const buttons = (await tags(MessageList, props({ retryFirstPage: retry }))).filter((t) => t.name === "button");
		expect(buttons).toHaveLength(1);
		expect(html).toMatch(/<button[^>]*>\s*Try again\s*<\/button>/);
	});

	test("shows the skeleton again while Try again asks for the page", () => {
		const html = shown({ retryFirstPage: retry, isInitialLoading: true });
		expect(html).not.toContain(FAILED);
		expect(html).toContain("animate-pulse");
	});

	test("shows what came meanwhile (a message sent, or one that arrived) rather than the failure", () => {
		const html = shown({ retryFirstPage: retry, messages: [message] });
		expect(html).not.toContain(FAILED);
		expect(html).toContain("Welcome to Alpha.");
	});

	test("a first page that came back empty shows the chat's start, as before", () => {
		const html = shown({});
		expect(html).toContain("The start of #general.");
		expect(html).not.toContain(FAILED);
	});

	test("a room and a conversation mark it as their first page fails, and Try again asks for that page again", () => {
		const pane = source("PaneView.svelte");
		expect(pane).toMatch(
			/loadedChannels\.delete\(channelId\);\s*channelLoadFailed\[channelId\] = true;\s*channelInitialLoading\[channelId\] = false;/,
		);
		expect(pane).toContain(
			"retryFirstPage={node.activeChannelId && channelLoadFailed[node.activeChannelId] ? retryActiveRoom : null}",
		);
		expect(pane).toMatch(/function retryActiveRoom\(\) \{[^}]*loadFirstPage\(node\.activeChannelId\);/);
		const conversation = source("ConversationView.svelte");
		expect(conversation).toMatch(
			/loadMessages\(\)\.then\(\(loaded\) => \{\s*if \(gone\) return;\s*loadFailed = !loaded;/,
		);
		expect(conversation).toContain("retryFirstPage={loadFailed ? loadFirstPage : null}");
		expect(source("Chat.svelte")).toMatch(/<MessageList\b[\s\S]*?\{retryFirstPage\}[^/]*\/>/);
	});
});
