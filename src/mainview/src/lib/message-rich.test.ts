import { expect, test } from "bun:test";
import { richTextHtml } from "./message-rich";

const lookups = {
	mentionText: (id: string) => (id === "ana" ? "@Ana" : "@<unknown>"),
	roomText: (id: string) => `#${id === "general" ? "general" : "deleted room"}`,
	customEmoji: (id: string) => (id === "party" ? { name: "party", url: "https://host/attachments/party" } : null),
};

test("mentions and rooms become the chips the composer draws", () => {
	const html = richTextHtml("<@ana> <#general>", lookups);
	expect(html).toContain('contenteditable="false"');
	expect(html).toContain('data-mention="ana"');
	expect(html).toContain(">@Ana</span>");
	expect(html).toContain('data-room="general"');
	expect(html).toContain(">#general</span>");
});

test("a Space's custom emoji becomes its picture, and an unknown one stays its raw form", () => {
	const html = richTextHtml("<:party:> <:gone:>", lookups);
	expect(html).toContain('data-cemoji="party"');
	expect(html).toContain('src="https://host/attachments/party"');
	expect(html).toContain('alt=":party:"');
	expect(html).toContain("&lt;:gone:&gt;");
});

test("Unicode emoji, line breaks and names are drawn safely", () => {
	const html = richTextHtml("Hi 😀\n<@ana>", lookups);
	expect(html).toContain('class="emoji-img"');
	expect(html).toContain(">😀</span>");
	expect(html).toContain("<br>");
	expect(richTextHtml("<@ana>", { ...lookups, mentionText: () => "@<b>" })).toContain("&lt;b&gt;");
});
