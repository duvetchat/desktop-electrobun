import { describe, expect, test } from "bun:test";
import type { Component, Embed } from "$lib/types";
import { duvetLinksIn } from "$lib/markdown";
import {
	cardLink,
	frameSandbox,
	isUuid,
	localUrl,
	parseDuvetLink,
	pathSegment,
	playerFrame,
	signInUrl,
	webEmbed,
	webUrl,
} from "$lib/urls";

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

	// A link's card, as the API reads it from the page: a container with a gallery, a section whose accessory is a
	// link button, and a thumbnail.
	const card: Component[] = [
		{
			type: 17,
			accent_color: 8490232,
			components: [
				{ type: 12, items: [{ media: { url: "https://a.example/i.png" }, description: "alt" }] },
				{
					type: 9,
					components: [{ type: 10, content: "# Title" }],
					accessory: { type: 2, style: 5, label: "Open", url: "https://a.example/post" },
				},
				{
					type: 9,
					components: [{ type: 10, content: "x" }],
					accessory: { type: 11, media: { url: "http://a.example/t.png" } },
				},
				{ type: 1, components: [{ type: 2, style: 5, label: "Docs", url: "https://docs.a.example" }] },
			],
		},
	];

	test("keeps a card whose links and media are all http(s)", () => {
		expect(webEmbed({ title: "t", components: card }).components).toEqual(card);
	});

	test("drops a card with any other link or media URL, or a gallery item without media: it's drawn whole or not at all", () => {
		const evil = "javascript:alert(1)";
		const variants: unknown[] = [
			[{ type: 17, components: [{ type: 1, components: [{ type: 2, style: 5, label: "Go", url: evil }] }] }],
			[
				{
					type: 17,
					components: [
						{
							type: 12,
							items: [{ media: { url: "https://a.example/i.png" } }, { media: { url: "data:image/png;base64,AAAA" } }],
						},
					],
				},
			],
			[
				{
					type: 17,
					components: [
						{
							type: 9,
							components: [{ type: 10, content: "x" }],
							accessory: { type: 11, media: { url: "/attachments/x" } },
						},
					],
				},
			],
			[{ type: 17, components: [{ type: 13, file: { url: "attachment://a.pdf" } }] }],
			[{ type: 17, components: [{ type: 12, items: [{}] }] }],
			[{ type: 17, components: [{ type: 2, style: 5, label: "Go", url: ["https://a.example"] }] }],
			"not a list",
		];
		for (const components of variants) {
			const embed: Embed = { title: "t" };
			Object.assign(embed, { components });
			expect(webEmbed(embed)).toEqual({ title: "t" });
		}
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

// The player URLs the API writes (embeds/youtube.go, embeds/tiktok.go).
const PLAYER_URLS = [
	"https://www.youtube.com/embed/dQw4w9WgXcQ",
	"https://www.tiktok.com/player/v1/7234567890123456789?music_info=0&description=0&rel=0&autoplay=0",
];

// URLs of the players' sites, or like theirs, that aren't one: a page on a subdomain, another page of the site (it
// could redirect the frame anywhere), a player URL with something more on it, or the same one written another way.
const NOT_PLAYERS = [
	"https://evil.youtube.com/embed/dQw4w9WgXcQ",
	"https://m.youtube.com/embed/dQw4w9WgXcQ",
	"https://youtube.com/embed/dQw4w9WgXcQ",
	"https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
	"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
	"https://www.youtube.com/redirect?q=https://evil.example",
	"https://www.youtube.com/embed/../redirect?q=https://evil.example",
	"https://www.youtube.com/embed/%2e%2e/redirect?q=https://evil.example",
	"https://www.youtube.com/embed/dQw4w9WgXcQ/../../redirect",
	"https://www.youtube.com/embed/dQw4w9WgXcQ?list=x",
	"https://www.youtube.com/embed/dQw4w9WgXcQ#x",
	"https://www.youtube.com./embed/dQw4w9WgXcQ",
	"https://www.youtube.com:443/embed/dQw4w9WgXcQ",
	"https://user@www.youtube.com/embed/dQw4w9WgXcQ",
	"https://WWW.YOUTUBE.COM/embed/dQw4w9WgXcQ",
	"http://www.youtube.com/embed/dQw4w9WgXcQ",
	"https://www.youtube.com.evil.example/embed/dQw4w9WgXcQ",
	"https://creator.tiktok.com/player/v1/7234567890123456789?music_info=0&description=0&rel=0&autoplay=0",
	"https://vm.tiktok.com/player/v1/7234567890123456789?music_info=0&description=0&rel=0&autoplay=0",
	"https://www.tiktok.com/@someone/video/7234567890123456789",
	"https://www.tiktok.com/player/v1/7234567890123456789",
	"https://www.tiktok.com/player/v1/7234567890123456789?music_info=0&description=0&rel=0&autoplay=1",
	"https://www.tiktok.com/player/v1/7234567890123456789?music_info=0&description=0&rel=0&autoplay=0&x=1",
	"https://www.tiktok.com/player/v1/abc?music_info=0&description=0&rel=0&autoplay=0",
	"https://www.tiktok.com.evil.example/player/v1/7234567890123456789?music_info=0&description=0&rel=0&autoplay=0",
];

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
		for (const url of PLAYER_URLS) {
			expect(frameSandbox(url, own)).toBe("allow-scripts allow-same-origin");
		}
		for (const url of [
			"https://player.example/v/1",
			"https://youtube.com.evil.example/embed",
			"https://eviltiktok.com/player",
			"https://duvet.chat.evil.example/",
		]) {
			expect(frameSandbox(url, own)).toBe("allow-scripts");
		}
	});

	test("only the exact player URLs keep their origin: not another page of their sites, nor one like them", () => {
		for (const url of NOT_PLAYERS) {
			expect(frameSandbox(url, own)).toBe("allow-scripts");
		}
	});

	test("no framed page may open windows (never allow-popups)", () => {
		for (const url of [...PLAYER_URLS, "https://player.example/v/1"]) {
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
			expect(path.split("/")).toEqual(["", "api", "invites", path.split("/")[3]!, "join"]);
		}
	});
});

describe("playerFrame", () => {
	const own = ["localhost", "api.duvet.chat"];

	test("the players the API frames itself wait for a click too, then keep their origin and start at once", () => {
		const [youtube, tiktok] = PLAYER_URLS;
		expect(playerFrame(youtube!, own)).toEqual({
			sandbox: "allow-scripts allow-same-origin",
			player: true,
			src: `${youtube}?autoplay=1`,
		});
		expect(playerFrame(tiktok!, own)).toEqual({
			sandbox: "allow-scripts allow-same-origin",
			player: true,
			src: tiktok!.replace(/autoplay=0$/, "autoplay=1"),
		});
		for (const url of PLAYER_URLS) {
			// The same player of the same video, told to start.
			const { src } = playerFrame(url, own)!;
			expect(new URL(src).origin + new URL(src).pathname).toBe(new URL(url).origin + new URL(url).pathname);
			expect(new URL(src).searchParams.get("autoplay")).toBe("1");
		}
	});

	test("any other page waits for a click on its card, and is framed as it is, without its origin", () => {
		for (const url of [
			"https://player.example/v/1",
			"https://player.example/v/1?autoplay=0",
			"http://vimeo.com/123",
			"https://youtube.com.evil.example/embed",
			"https://eviltiktok.com/player",
			...NOT_PLAYERS,
		]) {
			expect(playerFrame(url, own)).toEqual({ sandbox: "allow-scripts", player: false, src: url });
		}
	});

	test("a page frameSandbox refuses isn't framed, click or not", () => {
		for (const url of ["https://duvet.chat/app", "http://localhost:5173/app", "javascript:alert(1)", "not a url"]) {
			expect(playerFrame(url, own)).toBeUndefined();
		}
	});
});

describe("cardLink", () => {
	test("reads a link as the mobile app and the API do: up to a space or a bracket or quote, without its end's .,;:!?", () => {
		const bot = `https://duvet.chat/invite?bot=${ID1}`;
		expect(cardLink(`${bot}.`)).toBe(bot);
		expect(cardLink(`${bot}),`)).toBe(bot);
		expect(cardLink(`${bot}?!`)).toBe(bot);
		expect(cardLink("https://duvet.chat/invite/abc)def")).toBe("https://duvet.chat/invite/abc");
		expect(cardLink(`https://duvet.chat/channels/${ID1}/${ID2}/${ID3}"`)).toBe(
			`https://duvet.chat/channels/${ID1}/${ID2}/${ID3}`,
		);
		expect(cardLink("https://duvet.chat/invite/abc>")).toBe("https://duvet.chat/invite/abc");
		expect(cardLink("https://duvet.chat/invite/abc]")).toBe("https://duvet.chat/invite/abc");
		expect(cardLink("https://duvet.chat/invite/abc'")).toBe("https://duvet.chat/invite/abc");
		// The . in a link's middle stays.
		expect(cardLink("https://duvet.chat/invite.html?bot=x")).toBe("https://duvet.chat/invite.html?bot=x");
	});
});

describe("parseDuvetLink", () => {
	const own = "http://localhost:5173";
	const read = (url: string) => parseDuvetLink(url, own);
	const message = { message: { spaceId: ID1, roomId: ID2, messageId: ID3 } };

	test("reads a link to a room's message and to a conversation's", () => {
		expect(read(`https://duvet.chat/channels/${ID1}/${ID2}/${ID3}`)).toEqual(message);
		expect(read(`https://duvet.chat/conversations/${ID1}/${ID3}`)).toEqual({
			message: { spaceId: "", roomId: "", messageId: ID3, conversationId: ID1 },
		});
	});

	test("reads a space's invite from /invite?code= and /invite/<code>, and a bot's from /invite?bot= and /invite.html?bot=", () => {
		expect(read("https://duvet.chat/invite?code=abc")).toEqual({ code: "abc" });
		expect(read("https://duvet.chat/invite/abc")).toEqual({ code: "abc" });
		expect(read("https://duvet.chat/invite/a%20b")).toEqual({ code: "a b" });
		expect(read(`https://duvet.chat/invite?bot=${ID1}`)).toEqual({ bot: ID1 });
		expect(read(`https://duvet.chat/invite.html?bot=${ID1}`)).toEqual({ bot: ID1 });
		expect(read(`https://duvet.chat/invite.html?bot=${ID1.toUpperCase()}`)).toEqual({ bot: ID1.toUpperCase() });
	});

	test("reads a bot's invite from a link that names a space's code too, as the invite page and the mobile app do", () => {
		expect(read(`https://duvet.chat/invite?code=abc&bot=${ID1}`)).toEqual({ bot: ID1 });
		expect(read(`https://duvet.chat/invite?bot=${ID1}&code=abc`)).toEqual({ bot: ID1 });
		// A bot's ID that isn't a UUID names no bot: the code's card, as on mobile.
		expect(read("https://duvet.chat/invite?code=abc&bot=x")).toEqual({ code: "abc" });
	});

	test("reads them on the app's own pages too, when it's a web page", () => {
		expect(read(`${own}/invite?code=abc`)).toEqual({ code: "abc" });
		expect(read(`${own}/invite/abc`)).toEqual({ code: "abc" });
		expect(read(`${own}/invite.html?bot=${ID1}`)).toEqual({ bot: ID1 });
		expect(read(`${own}/channels/${ID1}/${ID2}/${ID3}`)).toEqual(message);
		// The packaged app's views:// is no web page: only duvet.chat's links are Duvet's own there.
		expect(parseDuvetLink("https://mainview/invite/abc", "views://mainview")).toBeNull();
		expect(parseDuvetLink("https://duvet.chat/invite/abc", "views://mainview")).toEqual({ code: "abc" });
	});

	test("reads what the card names after a sentence's end, once read as cardLink reads it", () => {
		expect(read(cardLink(`https://duvet.chat/invite?bot=${ID1}.`))).toEqual({ bot: ID1 });
		expect(read(cardLink("https://duvet.chat/invite/abc),"))).toEqual({ code: "abc" });
	});

	// desktop#154: the forms the API leaves without a preview, which drew no card here.
	test("reads them as the API does: http or https, any case and port, the path's slashes trimmed, no query or fragment", () => {
		for (const url of [
			`https://duvet.chat/channels/${ID1}/${ID2}/${ID3}/`,
			`https://duvet.chat/channels/${ID1}/${ID2}/${ID3}?x=1`,
			`https://duvet.chat/channels/${ID1}/${ID2}/${ID3}#m`,
			`https://Duvet.chat/channels/${ID1}/${ID2}/${ID3}`,
			`https://DUVET.CHAT/channels/${ID1}/${ID2}/${ID3}`,
			`https://duvet.chat:443/channels/${ID1}/${ID2}/${ID3}`,
			`https://duvet.chat:8443/channels/${ID1}/${ID2}/${ID3}`,
			`http://duvet.chat/channels/${ID1}/${ID2}/${ID3}`,
			`https://duvet.chat//channels/${ID1}/${ID2}/${ID3}//`,
			// The path decoded, as the API's url.Parse decodes it.
			`https://duvet.chat/channels/${ID1}%2F${ID2}/${ID3}`,
		]) {
			expect({ url, card: read(url) }).toEqual({ url, card: message });
		}
		for (const url of [
			"http://duvet.chat/invite/abc",
			"http://duvet.chat:8080/invite/abc?x=1#y",
			"https://Duvet.Chat/invite/abc/",
			"https://duvet.chat/invite?code=abc#x",
		]) {
			expect({ url, card: read(url) }).toEqual({ url, card: { code: "abc" } });
		}
	});

	test("refuses other sites, other pages, other schemes, and IDs that aren't UUIDs: a card fetches by them", () => {
		for (const url of [
			`https://duvet.chat/channels/${ID1}/..\\users\\@me?/x`,
			`https://duvet.chat/channels/${ID1}/../${ID3}`,
			`https://duvet.chat/channels/${ID1}/${ID2}/%2e%2e`,
			`https://duvet.chat/channels/${ID1}/${ID2}`,
			`https://duvet.chat/conversations/..\\..\\..\\spaces\\${ID1}\\invites?/${ID3}`,
			`https://duvet.chat/conversations/@me/${ID3}`,
			`https://duvet.chat/conversations/${ID1}/${ID3}/thread`,
			`https://evil.example/channels/${ID1}/${ID2}/${ID3}`,
			`https://duvet.chat.evil.example/channels/${ID1}/${ID2}/${ID3}`,
			`duvet://channels/${ID1}/${ID2}/${ID3}`,
			// The API takes a link only from its http:// or https:// as written (mobileLink).
			`HTTPS://duvet.chat/channels/${ID1}/${ID2}/${ID3}`,
			`https:/duvet.chat/channels/${ID1}/${ID2}/${ID3}`,
			"ftp://duvet.chat/invite/abc",
			"https://discord.com/invite/abc",
			"https://duvet.chat.evil.example/invite/abc",
			"https://www.duvet.chat/invite/abc",
			"https://duvet.chat/invite",
			"https://duvet.chat/invite/",
			"https://duvet.chat/invite?code=",
			"https://duvet.chat/invite.html?code=abc",
			"https://duvet.chat/invite/abc/def",
			"https://duvet.chat/invite//abc",
			"https://duvet.chat/invites/abc",
			"https://duvet.chat/Invite/abc",
			"https://duvet.chat/invite/a%2Fb",
			"https://duvet.chat/invite/%E0%A4%A",
			"https://duvet.chat/invite?bot=../users/@me",
			"https://duvet.chat/invite/?bot=x",
			`https://duvet.chat/invite.html/x?bot=${ID1}`,
			"not a url",
		]) {
			expect({ url, card: read(url) }).toEqual({ url, card: null });
		}
	});

	// A code comes from a link anyone writes, and goes into the API's path as one segment (pathSegment, api/invites.ts).
	test("never reads a code that takes the API's path anywhere else, as fetch resolves it or as the API routes it", () => {
		for (const url of [
			"https://duvet.chat/invite?code=a/b",
			"https://duvet.chat/invite?code=a%2Fb",
			"https://duvet.chat/invite?code=..%2F..%2Fusers%2F%40me",
			"https://duvet.chat/invite?code=x%3Fy",
			"https://duvet.chat/invite?code=x%23y",
			"https://duvet.chat/invite?code=x%5Cy",
			"https://duvet.chat/invite?code=..",
			"https://duvet.chat/invite?code=.",
			"https://duvet.chat/invite?code=%2e%2e",
			"https://duvet.chat/invite?code=%252F",
			"https://duvet.chat/invite/..",
			"https://duvet.chat/invite/%2e%2e",
			"https://duvet.chat/invite/a%2Fb",
			"https://duvet.chat/invite/a%3Fb",
			"https://duvet.chat/invite/a%23b",
			"https://duvet.chat/invite/a%5Cb",
			"https://duvet.chat/invite/a%2F..%2F..",
		]) {
			const card = read(url);
			if (!card || !("code" in card)) continue;
			let segment: string;
			try {
				segment = pathSegment(card.code);
			} catch {
				continue; // refused before any request
			}
			// The API routes on its path decoded (gin), so a / there would be one more segment.
			const path = decodeURIComponent(new URL(`https://api.test/api/invites/${segment}/join`).pathname);
			expect({ url, path: path.split("/") }).toEqual({ url, path: ["", "api", "invites", card.code, "join"] });
		}
	});
});

// The cases of duvet-api's internal/adapters/embeds/opengraph_test.go (dev 8ebb96f), against the desktop's reading of
// a message's text (duvetLinksIn, as MessageList reads it): a link the API leaves without a preview has its card here,
// and one the API previews has none (desktop#154).
describe("Duvet's own links, as the API's tests read them", () => {
	const [id1, id2, id3] = [1, 2, 3].map((n) => `0a0a0a0a-0000-4000-8000-00000000000${n}`);
	const cards = (content: string, own: string) => ({ content, cards: duvetLinksIn(content, own).length });
	// The packaged app: no web page of its own, so Duvet's links are duvet.chat's, production's FRONTEND_URL.
	const app = "views://mainview";

	test("TestExtractURLsLeavesTheClientsCards", () => {
		for (const card of [
			"https://duvet.chat/invite?code=abc123",
			"https://duvet.chat/invite/abc123",
			`https://duvet.chat/invite?bot=${id1}`,
			`https://duvet.chat/channels/${id1}/${id2}/${id3}`,
			`https://duvet.chat/conversations/${id1}/${id3}`,
		]) {
			const content = `look ${card} here`;
			expect(cards(content, app)).toEqual({ content, cards: 1 });
		}
		for (const previewed of [
			"https://duvet.chat/",
			"https://duvet.chat/invite",
			"https://duvet.chat/invite.html?code=abc123",
			"https://duvet.chat/invite?bot=not-a-uuid",
			`https://duvet.chat/channels/${id1}/${id2}`,
			`https://duvet.chat/channels/general/${id2}/${id3}`,
			`https://duvet.chat/channels/${id1}/${id2}/${id3}x`,
			`https://duvet.chat/conversations/general/${id3}`,
			"https://example.com/post",
		]) {
			const content = `look ${previewed} here`;
			expect(cards(content, app)).toEqual({ content, cards: 0 });
		}
	});

	test("TestExtractURLsLeavesOnlyTheFrontendsCards", () => {
		// FRONTEND_URL https://Chat.Duvet.test:8443/app: the web build served there.
		const own = "https://chat.duvet.test:8443";
		const paths = [
			"/invite?code=abc123",
			`/invite?bot=${id1}`,
			"/invite/abc123",
			`/invite.html?bot=${id1}`,
			`/channels/${id1}/${id1}/${id1}`,
			`/conversations/${id1}/${id1}`,
		];
		for (const path of paths) {
			for (const host of ["https://chat.duvet.test", "https://CHAT.duvet.test", "http://chat.duvet.test:8443"]) {
				expect(cards(`look ${host}${path} here`, own)).toEqual({ content: `look ${host}${path} here`, cards: 1 });
			}
			for (const other of [
				"https://discord.com",
				"https://xchat.duvet.test",
				"https://chat.duvet.test.example.com",
				"https://example.com",
			]) {
				expect(cards(`look ${other}${path} here`, own)).toEqual({ content: `look ${other}${path} here`, cards: 0 });
			}
			// Where the API previews them: duvet.chat's links are Duvet's own here whatever the app's origin (#145), and
			// the packaged app, with no web page of its own, as an API without FRONTEND_URL, takes no other host's.
			expect(cards(`look https://duvet.chat${path} here`, own).cards).toBe(1);
			expect(cards(`look https://chat.duvet.test${path} here`, app).cards).toBe(0);
		}
		expect(cards("look https://discord.com/invite/abc123 here", own).cards).toBe(0);
		expect(cards("look https://chat.duvet.test/invite.html?code=abc123 here", own).cards).toBe(0);
	});

	test("TestExtractURLsReadsTheCardsAsTheMobileAppDoes", () => {
		const [a, b, c] = [id1, id2, id3];
		const nbsp = String.fromCharCode(0xa0);
		for (const content of [
			`see https://duvet.chat/channels/${a}/${b}/${c}.`,
			`(https://duvet.chat/channels/${a}/${b}/${c})`,
			`add it: https://duvet.chat/invite?bot=${a}.`,
			`here https://duvet.chat/conversations/${a}/${c}, ok`,
			`'https://duvet.chat/channels/${a}/${b}/${c}'`,
			`is it https://duvet.chat/invite.html?bot=${a}?!`,
			`https://duvet.chat/conversations/${a}/${c}${nbsp}and more`,
			`https://duvet.chat/channels/${a}/${b}/${c}/`,
			`https://duvet.chat/channels/${a}/${b}/${c}?x=1`,
			"https://duvet.chat/invite/abc123/",
		]) {
			expect(cards(content, app)).toEqual({ content, cards: 1 });
		}
		for (const content of [
			`(https://duvet.chat/channels/general/${b}/${c})`,
			"see https://duvet.chat/invite.html?code=abc123.",
			`https://example.com/invite?bot=${a}.`,
		]) {
			expect(cards(content, app)).toEqual({ content, cards: 0 });
		}
	});
});

// The app's pages are views://, which sends no Referer, and YouTube answers that with error 153: in the app its player is
// framed through the relay Bun serves on loopback (src/bun/player-relay.ts).
describe("the YouTube relay", () => {
	const own = ["localhost", "api.duvet.chat"];
	const youtube = "https://www.youtube.com/embed/dQw4w9WgXcQ";
	const relay = "http://127.0.0.1:49152";

	test("in the app a YouTube player is framed through it, and TikTok's is not", () => {
		expect(playerFrame(youtube, own, relay)).toEqual({
			sandbox: "allow-scripts allow-same-origin",
			player: true,
			src: `${relay}/youtube?v=dQw4w9WgXcQ`,
		});
		// Without it (the web build, or it didn't start) the player is framed as it was.
		for (const none of [undefined, null]) expect(playerFrame(youtube, own, none)?.src).toBe(`${youtube}?autoplay=1`);
		const tiktok = PLAYER_URLS[1]!;
		expect(playerFrame(tiktok, own, relay)?.src).toBe(tiktok.replace(/autoplay=0$/, "autoplay=1"));
	});

	test("only a loopback origin is a relay, and only its one page with a video id may be framed", () => {
		expect(frameSandbox(`${relay}/youtube?v=dQw4w9WgXcQ`, own, relay)).toBe("allow-scripts allow-same-origin");
		for (const url of [
			`${relay}/`,
			`${relay}/youtube`,
			`${relay}/youtube?v=`,
			`${relay}/youtube?v=a&b=c`,
			`${relay}/youtube?v=a#x`,
			`${relay}/youtube.js`,
			`${relay}/youtube/../x?v=a`,
			`${relay}/youtube?v=${"a".repeat(33)}`,
			"http://127.0.0.1:49153/youtube?v=a",
			"http://127.0.0.1.evil.example:49152/youtube?v=a",
			"http://localhost:49152/youtube?v=a",
			"https://127.0.0.1:49152/youtube?v=a",
		]) {
			expect([url, frameSandbox(url, own, relay)?.includes("allow-same-origin") ?? false]).toEqual([url, false]);
		}
		// Whatever Bun said, a relay that isn't loopback is not taken.
		for (const bad of [
			"https://duvet.chat",
			"http://evil.example:80",
			"http://127.0.0.1",
			"http://127.0.0.1:80/x",
			"",
		]) {
			expect(frameSandbox(`${bad}/youtube?v=a`, own, bad)?.includes("allow-same-origin") ?? false).toBe(false);
			expect(playerFrame(youtube, own, bad)?.src).toBe(`${youtube}?autoplay=1`);
		}
	});
});
