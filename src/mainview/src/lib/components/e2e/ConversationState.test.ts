import { describe, expect, test } from "bun:test";
import { render } from "svelte/server";
import type { ConversationState as State } from "$lib/e2e/engine/engine";
import { notice, NOTICES } from "$lib/e2e/notices";
import en from "../../../../messages/en.json";
import { tags } from "../server-render";

// What a conversation says over its message box of its encrypted group (PLAN-E2E-CLIENTES.md, «Avisos»): nothing while
// the group goes on; else why it can't, in the notices' words, and what the person can do about it.
const { default: ConversationState } = await import("./ConversationState.svelte");

const NAMES: Record<string, string> = { bo: "Bo", cy: "Cy" };
const props = (state: State | null) => ({
	conversationState: state,
	ownerName: "Ana",
	memberNames: ["Ana", "Bo", "Cy"],
	memberName: (userId: string) => NAMES[userId] ?? userId,
	onRestart: async () => {},
	onAccept: async () => {},
});
const drawn = (state: State | null) =>
	render(ConversationState, { props: props(state) })
		.body.replace(/<!--[^]*?-->/g, "")
		.replaceAll("&#39;", "'");
const buttons = async (state: State | null) =>
	(await tags(ConversationState, props(state))).filter((tag) => tag.name === "button");

describe("a conversation's state", () => {
	test("says nothing while its group goes on", () => {
		expect(drawn(null).trim()).toBe("");
	});

	test("a blocked group: its restart for whoever may, the wait for the others, and nothing past a key of another", async () => {
		const mine = drawn({ name: "blocked", restart: "mine", owner: "ana" });
		expect(mine).toContain(NOTICES.blocked);
		expect(mine).toMatch(/<button [^>]*>\s*Restart encryption\s*<\/button>/);
		const theirs = drawn({ name: "blocked", restart: "owner", owner: "ana" });
		expect(theirs).toContain(NOTICES.blocked);
		expect(theirs).toContain(notice("blocked_wait", { owner: "Ana" }));
		expect(await buttons({ name: "blocked", restart: "owner", owner: "ana" })).toEqual([]);
		const never = drawn({ name: "blocked", restart: "none", owner: null });
		expect(never).toContain(NOTICES.blocked);
		expect(never).not.toContain("Waiting for");
		expect(await buttons({ name: "blocked", restart: "none", owner: null })).toEqual([]);
	});

	test("waiting for the owner, or for another member to let this device back in", () => {
		expect(drawn({ name: "wait_owner", owner: "ana" })).toContain(notice("wait_owner", { owner: "Ana" }));
		expect(drawn({ name: "wait_rejoin" })).toContain(NOTICES.wait_rejoin);
	});

	test("members that changed since the device last saw them, who they are now, and the person's yes", () => {
		const changed = drawn({ name: "members_changed" });
		expect(changed).toContain(NOTICES.members_changed);
		expect(changed).toContain(notice("members_now", { names: "Ana, Bo, and Cy" }));
		expect(changed).toMatch(/<button [^>]*>\s*Open with these members\s*<\/button>/);
	});

	test("the members who can't receive what's sent yet, named, with nothing to tap", async () => {
		const state: State = { name: "no_device", users: ["bo", "cy"] };
		expect(drawn(state)).toContain(notice("no_device", { name: "Bo and Cy" }));
		expect(await buttons(state)).toEqual([]);
	});

	test("says it in the notices' words", () => {
		expect(en.e2e_blocked).toBe(NOTICES.blocked);
		expect(en.e2e_blocked_restart).toBe(NOTICES.blocked_owner);
		expect(en.e2e_blocked_wait).toBe(NOTICES.blocked_wait);
		expect(en.e2e_wait_owner).toBe(NOTICES.wait_owner);
		expect(en.e2e_wait_rejoin).toBe(NOTICES.wait_rejoin);
		expect(en.e2e_members_changed).toBe(NOTICES.members_changed);
		expect(en.e2e_members_accept).toBe(NOTICES.members_accept);
		expect(en.e2e_members_now).toBe(NOTICES.members_now);
		expect(en.e2e_no_device).toBe(NOTICES.no_device);
	});
});
