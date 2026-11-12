import { describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import { chatsOnScreen, showChat } from "./on-screen";

// Two panes can show one chat: it stays on screen until the last of them lets it go.
describe("the chats on screen", () => {
	test("a chat two panes show stays on screen until both let it go", () => {
		const first = showChat("a");
		const second = showChat("a");
		first();
		expect(get(chatsOnScreen).has("a")).toBe(true);
		second();
		expect(get(chatsOnScreen).has("a")).toBe(false);
	});

	test("letting go twice counts once", () => {
		const hide = showChat("b");
		const other = showChat("b");
		hide();
		hide();
		expect(get(chatsOnScreen).has("b")).toBe(true);
		other();
		expect(get(chatsOnScreen).has("b")).toBe(false);
	});
});
