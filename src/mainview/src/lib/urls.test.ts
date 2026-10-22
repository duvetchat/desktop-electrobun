import { describe, expect, test } from "bun:test";
import type { Embed } from "$lib/types";
import { frameSandbox, isUuid, localUrl, parseMessageLink, pathSegment, signInUrl, webEmbed, webUrl } from "$lib/urls";

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
		expect(frameSandbox("https://www.youtube.com/embed/abc", own)).toBe("allow-scripts allow-same-origin");
		expect(frameSandbox("https://www.youtube-nocookie.com/embed/abc", own)).toBe("allow-scripts allow-same-origin");
		expect(frameSandbox("https://www.tiktok.com/player/v1/123", own)).toBe("allow-scripts allow-same-origin");
		for (const url of [
			"https://player.example/v/1",
			"https://youtube.com.evil.example/embed",
			"https://eviltiktok.com/player",
			"https://duvet.chat.evil.example/",
		]) {
			expect(frameSandbox(url, own)).toBe("allow-scripts");
		}
	});

	test("no framed page may open windows (never allow-popups)", () => {
		for (const url of [
			"https://www.youtube.com/embed/abc",
			"https://www.tiktok.com/player/v1/1",
			"https://player.example/v/1",
		]) {
			expect(frameSandbox(url, own)).not.toContain("allow-popups");
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

describe("signInUrl", () => {
	test("the sign-in page reads the redirect back as the same page of the app", () => {
		for (const redirect of [
			"/invite.html?code=0190a3b2-0000-7000-8000-000000000001",
			"/invite.html?bot=0190a3b2-0000-7000-8000-000000000002",
			"/invite?code=a%20b&x=1#y",
		]) {
			const url = new URL(signInUrl(redirect), "https://duvet.chat");
			expect(url.pathname).toBe("/sign-in.html");
			expect(localUrl(url.searchParams.get("redirect"), url.href)).toBe(`https://duvet.chat${redirect}`);
		}
	});
});

// IDs as Duvet's are: UUIDs (v7 nowadays; any version reads).
const ID1 = "0190a3b2-0000-7000-8000-000000000001";
const ID2 = "0190a3b2-0000-7000-8000-000000000002";
const ID3 = "0190a3b2-0000-7000-8000-000000000003";

describe("isUuid", () => {
	test("takes a UUID, in either case", () => {
		expect(isUuid(ID1)).toBe(true);
		expect(isUuid(ID1.toUpperCase())).toBe(true);
		expect(isUuid("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(true);
	});

	test("refuses anything else, above all what would point a request at another endpoint", () => {
		for (const value of [
			"",
			".",
			"..",
			"@me",
			"../users/@me",
			"..\\users\\@me",
			`${ID1}/..`,
			`${ID1}?x=1`,
			`${ID1}#x`,
			` ${ID1}`,
			`${ID1}\n`,
			ID1.replaceAll("-", ""),
			`${ID1}0`,
			"0190a3b2-0000-7000-8000-00000000000g",
			null,
			undefined,
			42,
			[ID1],
			{ toString: () => ID1 },
		]) {
			expect(isUuid(value)).toBe(false);
		}
	});
});

describe("pathSegment", () => {
	test("encodes what would end the segment or start a query or a hash", () => {
		expect(pathSegment("a/b?c#d\\e f")).toBe("a%2Fb%3Fc%23d%5Ce%20f");
		expect(pathSegment("🔥")).toBe(encodeURIComponent("🔥"));
		expect(pathSegment("%2e%2e")).toBe("%252e%252e");
		expect(pathSegment("...")).toBe("...");
		expect(pathSegment(ID1)).toBe(ID1);
	});

	test('refuses "." and "..", which a URL resolves away however they are written, and nothing at all', () => {
		for (const value of [".", "..", ""]) {
			expect(() => pathSegment(value)).toThrow();
		}
	});

	test("whatever the value, the request stays on its endpoint", () => {
		for (const value of [
			"../users/@me",
			"..\\..\\users",
			"x?y=/z",
			"x#y",
			"%2e%2e",
			".%2e",
			"a/../../b",
			"...",
			"🔥",
		]) {
			// Resolved as fetch resolves it.
			const path = new URL(`https://api.test/api/invites/${pathSegment(value)}/join`).pathname;
			expect(path.split("/")).toEqual(["", "api", "invites", path.split("/")[3], "join"]);
		}
	});
});

describe("parseMessageLink", () => {
	test("reads a link to a room's message and to a conversation's", () => {
		expect(parseMessageLink(`https://duvet.chat/channels/${ID1}/${ID2}/${ID3}`)).toEqual({
			spaceId: ID1,
			roomId: ID2,
			messageId: ID3,
		});
		expect(parseMessageLink(`https://duvet.chat/conversations/${ID1}/${ID3}`)).toEqual({
			spaceId: "",
			roomId: "",
			messageId: ID3,
			conversationId: ID1,
		});
	});

	test("refuses a link whose IDs aren't UUIDs: its preview fetches the message by them", () => {
		for (const url of [
			`https://duvet.chat/channels/${ID1}/..\\users\\@me?/x`,
			`https://duvet.chat/channels/${ID1}/../${ID3}`,
			`https://duvet.chat/channels/${ID1}/${ID2}/%2e%2e`,
			`https://duvet.chat/channels/${ID1}/${ID2}/${ID3}?x=1`,
			`https://duvet.chat/channels/${ID1}/${ID2}/${ID3}#x`,
			`https://duvet.chat/channels/${ID1}/${ID2}/${ID3}/`,
			`https://duvet.chat/channels/${ID1}/${ID2}`,
			`https://duvet.chat/conversations/..\\..\\..\\spaces\\${ID1}\\invites?/${ID3}`,
			`https://duvet.chat/conversations/@me/${ID3}`,
			`https://duvet.chat/conversations/${ID1}/${ID3}/thread`,
		]) {
			expect(parseMessageLink(url)).toBeNull();
		}
	});

	test("refuses links to other sites", () => {
		for (const url of [
			`https://evil.example/channels/${ID1}/${ID2}/${ID3}`,
			`https://duvet.chat.evil.example/channels/${ID1}/${ID2}/${ID3}`,
			`http://duvet.chat/channels/${ID1}/${ID2}/${ID3}`,
			`duvet://channels/${ID1}/${ID2}/${ID3}`,
		]) {
			expect(parseMessageLink(url)).toBeNull();
		}
	});
});
