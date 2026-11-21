import { beforeEach, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "svelte/server";
import { tags } from "./server-render";

// How the API answers the next page of a Space's members.
let answer: () => Promise<unknown[]> = async () => [];
mock.module("$lib/api/spaces", () => ({
	MEMBERS_PAGE_SIZE: 50,
	getSpaceMembers: () => answer(),
}));
// The pages' store is a .svelte.ts module, whose $state only Svelte's compiler knows: here it's the value itself.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { forgetMemberPages, loadMoreMembers } = await import("$lib/stores/member-pages.svelte");
const { default: MemberPagesStatus } = await import("./MemberPagesStatus.svelte");

// What it draws, without the comments Svelte marks its blocks with.
const drawn = (spaceId: string | null) =>
	render(MemberPagesStatus, { props: { spaceId } }).body.replace(/<!--[^]*?-->/g, "");

beforeEach(() => forgetMemberPages());

// #388: the members popover's spinner went when a page failed, and the list stayed short with nothing to say why, nor
// anything to ask again. The popover, the members column and the Members section of a Space's settings show this under
// their lists.
test("a page on its way shows the spinner, and one that failed says so with Try again", async () => {
	let fail!: (reason: unknown) => void;
	answer = () => new Promise((_, reject) => (fail = reject));
	const loading = loadMoreMembers("harbour");
	expect(drawn("harbour")).toContain('aria-label="Loading more members"');

	const logged = console.error;
	console.error = () => {};
	try {
		fail(new TypeError("No answer from the server in time"));
		await loading;
	} finally {
		console.error = logged;
	}
	const failed = drawn("harbour");
	expect(failed).toContain("Couldn't load the members");
	expect(failed).toMatch(/<button[^>]*>\s*Try again\s*<\/button>/);
	expect(failed).not.toContain("Loading more members");
	// A button, which takes the keyboard as a click does.
	const buttons = (await tags(MemberPagesStatus, { spaceId: "harbour" })).filter((tag) => tag.name === "button");
	expect(buttons.map((button) => button.attributes.type)).toEqual(["button"]);
});

test("says nothing once the page came, nor under a list that isn't paged (a group's)", async () => {
	answer = async () => [];
	await loadMoreMembers("harbour");
	expect(drawn("harbour")).not.toMatch(/Loading more members|Couldn't load/);
	expect(drawn(null)).not.toMatch(/Loading more members|Couldn't load/);
});

// Its effects run in a webview only: what the members popover and the members column do with a failed page, as the list
// they share (MembersPanel, mounted as the popover opens and as the column does) has it.
test("the members' list shows it under its rows, and asks for a failed page again as it opens, not as it scrolls", () => {
	const panel = readFileSync(join(import.meta.dir, "MembersPanel.svelte"), "utf8");
	expect(panel).toMatch(/<MemberList [^]*\/>\s*<MemberPagesStatus \{spaceId\} \/>/);
	expect(panel).toMatch(
		/const id = spaceId;\s*if \(!id\) return;\s*untrack\(\(\) => \{\s*if \(membersFailed\(id\)\) void loadMoreMembers\(id\);/,
	);
	expect(panel).toContain("spaceId && !membersFailed(spaceId) && el.scrollHeight");
});
