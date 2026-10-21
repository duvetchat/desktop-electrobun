import { describe, expect, test } from "bun:test";
import { webEmbed, webUrl } from "$lib/urls";

describe("webEmbed", () => {
	test("keeps an embed's http(s) URLs", () => {
		const embed = {
			title: "t",
			url: "https://a.example",
			image: { url: "https://a.example/i.png" },
			video: { url: "https://a.example/v.mp4", content_type: "video/mp4" },
			author: { name: "A", url: "https://a.example/u", icon_url: "https://a.example/a.png" },
			footer: { text: "F", icon_url: "https://a.example/f.png" },
		};
		expect(webEmbed(embed)).toEqual(embed);
	});

	test("drops every other URL: a link loses its href, an image or a video goes", () => {
		const evil = "javascript:alert(1)";
		expect(
			webEmbed({
				title: "t",
				url: evil,
				image: { url: evil },
				thumbnail: { url: "data:image/png;base64,AAAA" },
				video: { url: evil },
				author: { name: "A", url: evil, icon_url: evil },
				footer: { text: "F", icon_url: evil },
			}),
		).toEqual({ title: "t", author: { name: "A" }, footer: { text: "F" } });
	});
});

describe("webUrl", () => {
	test("takes http(s) URLs as they are", () => {
		expect(webUrl("https://duvet.chat/a?b=1")).toBe("https://duvet.chat/a?b=1");
		expect(webUrl("HTTP://example.com")).toBe("HTTP://example.com");
	});

	test("refuses every other scheme, and anything that isn't a URL", () => {
		for (const url of [
			"javascript:alert(1)",
			"JaVaScRiPt:alert(1)",
			" javascript:alert(1)",
			"data:text/html,<script>alert(1)</script>",
			"vbscript:msgbox(1)",
			"//evil.example/x",
			"/attachments/x",
			"",
			null,
			undefined,
		]) {
			expect(webUrl(url)).toBeUndefined();
		}
	});
});
