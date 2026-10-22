import { describe, expect, test } from "bun:test";
import type { Embed } from "$lib/types";
import { frameSandbox, localUrl, webEmbed, webUrl } from "$lib/urls";

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

	test("takes only strings: an array or an object a bot sent as a URL goes", () => {
		expect(webUrl(["https://a.example"])).toBeUndefined();
		expect(webUrl({ toString: () => "https://a.example" })).toBeUndefined();
		// A video as a string and an image as an array, as a bot's JSON can have them.
		const fromBot: Embed = { title: "t" };
		Object.assign(fromBot, { video: "https://a.example/v.mp4", image: ["https://a.example/i.png"] });
		expect(webEmbed(fromBot)).toEqual({ title: "t" });
	});
});

describe("frameSandbox", () => {
	const own = ["localhost", "api.duvet.chat"];

	test("never frames Duvet's own hosts: duvet.chat and its subdomains, the app's and the API's", () => {
		for (const url of [
			"https://duvet.chat/sign-in?redirect=/app",
			"https://docs.duvet.chat/",
			"https://api.duvet.chat/attachments/x?stream=1",
			"http://localhost:5173/app",
			"http://localhost:9876/attachments/x",
			"https://duvet.chat./sign-in",
			"https://API.duvet.chat./x",
			"not a url",
			"javascript:alert(1)",
			"data:text/html,<script>alert(1)</script>",
		]) {
			expect(frameSandbox(url, own)).toBeUndefined();
		}
	});

	test("the players the API frames keep their own origin; any other page is framed without it", () => {
		expect(frameSandbox("https://www.youtube.com/embed/abc", own)).toBe("allow-scripts allow-same-origin allow-popups");
		expect(frameSandbox("https://www.youtube-nocookie.com/embed/abc", own)).toBe(
			"allow-scripts allow-same-origin allow-popups",
		);
		expect(frameSandbox("https://www.tiktok.com/player/v1/123", own)).toBe(
			"allow-scripts allow-same-origin allow-popups",
		);
		for (const url of [
			"https://player.example/v/1",
			"https://youtube.com.evil.example/embed",
			"https://eviltiktok.com/player",
			"https://duvet.chat.evil.example/",
		]) {
			expect(frameSandbox(url, own)).toBe("allow-scripts allow-popups");
		}
	});
});

describe("localUrl", () => {
	test("takes a path of this app, with its query and hash", () => {
		expect(localUrl("/invite.html?code=a%20b#x", "https://duvet.chat/sign-in")).toBe(
			"https://duvet.chat/invite.html?code=a%20b#x",
		);
		expect(localUrl("/app.html", "views://mainview/sign-in.html")).toBe("views://mainview/app.html");
	});

	test("a path that names another site once resolved stays on the app", () => {
		for (const redirect of [
			"/.//evil.example/x",
			"/..//evil.example/x",
			"/%2e//evil.example/x",
			"/a/..//evil.example/x",
		]) {
			const url = localUrl(redirect, "https://duvet.chat/sign-in");
			expect(url && new URL(url, "https://duvet.chat/sign-in").origin).toBe("https://duvet.chat");
		}
	});

	test("refuses anything that leaves the app or runs in it", () => {
		for (const redirect of [
			"javascript:alert(1)",
			"https://evil.example/",
			"//evil.example/x",
			"/\\evil.example/x",
			"/\t/evil.example/x",
			" /app",
			"app",
			"",
			null,
		]) {
			expect(localUrl(redirect, "https://duvet.chat/sign-in")).toBeUndefined();
		}
	});
});
