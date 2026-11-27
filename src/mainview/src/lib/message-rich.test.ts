import { expect, test } from "bun:test";
import { richTextHtml } from "./message-rich";

const lookups = {
	mentionText: (id: string) => (id === "abc" ? "@Ana" : "@<unknown>"),
	roomText: (id: string) => `#${id === "def" ? "general" : "deleted room"}`,
	customEmoji: (id: string) => (id === "cafe" ? { name: "party", url: "https://host/attachments/party" } : null),
};

test("mentions and rooms become the chips the composer draws", () => {
	const html = richTextHtml("<@abc> <#def>", lookups);
	expect(html).toContain('contenteditable="false"');
	expect(html).toContain('data-mention="abc"');
	expect(html).toContain(">@Ana</span>");
	expect(html).toContain('data-room="def"');
	expect(html).toContain(">#general</span>");
});

test("a Space's custom emoji becomes its picture, and an unknown one stays its raw form", () => {
	const html = richTextHtml("<:cafe:> <:dead:>", lookups);
	expect(html).toContain('data-cemoji="cafe"');
	expect(html).toContain('src="https://host/attachments/party"');
	expect(html).toContain('alt=":party:"');
	expect(html).toContain("&lt;:dead:&gt;");
});

test("Unicode emoji, line breaks and names are drawn safely", () => {
	const html = richTextHtml("Hi 😀\n<@abc>", lookups);
	expect(html).toContain('class="emoji-img"');
	expect(html).toContain(">😀</span>");
	expect(html).toContain("<br>");
	expect(richTextHtml("<@abc>", { ...lookups, mentionText: () => "@<b>" })).toContain("&lt;b&gt;");
});
