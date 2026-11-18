import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getHostURL, isUuid } from "$lib/common/common";
import { renderEmoji, toTwemojiUrl } from "$lib/emoji";
import {
	clickedMention,
	duvetLinksIn,
	emojiImageUrl,
	mentionNamesIn,
	parseTextSegments,
	renderMarkdown,
	renderMarkdownLine,
	sameNames,
} from "$lib/markdown";
import { cardLink, parseDuvetLink } from "$lib/urls";

// The tag markdown wraps text in for each marker of its emphasis.
const EMPHASIS_TAGS: Record<string, string> = { "~~": "del", "**": "strong", __: "u", "*": "em", _: "em" };

// The value of the first href in html: what's between its quotes.
const hrefOf = (html: string) => /href="([^"]*)"/.exec(html)?.[1];

// A bare link as renderMarkdown draws one, given links to draw.
const LINK = (url: string) =>
	`<a href="${url}" target="_blank" rel="noopener noreferrer" class="msg-bare-link text-duvet-ink hover:underline">${url}</a>`;

describe("text stays text", () => {
	test("a quote in a text is escaped", () => {
		expect(renderEmoji('say "hi"')).toBe("say &quot;hi&quot;");
	});

	test("a quote in a link's URL can't end its href", () => {
		const html = renderMarkdown('[x](https://a.example/"onmouseover="location=1)');
		expect(hrefOf(html)).toBe("https://a.example/&quot;onmouseover=&quot;location=1");
		expect(html).not.toContain('"onmouseover');
	});

	test("a URL with code in it isn't a link: the code is taken out first", () => {
		expect(renderMarkdown("[x](https://a.example/`code`)")).not.toContain("href=");
	});

	test("a plain link keeps its URL", () => {
		expect(hrefOf(renderMarkdown("[docs](https://duvet.chat/a?b=1&c=2)"))).toBe("https://duvet.chat/a?b=1&amp;c=2");
	});
});

describe("a link's URL is kept as written", () => {
	// What the inline rules would turn into HTML: emphasis, strikethrough, spoilers, mentions, emojis, tags.
	const CASES: [string, string][] = [
		["https://a.example/a*b*c", "https://a.example/a*b*c"],
		["https://a.example/**b**", "https://a.example/**b**"],
		["https://a.example/***b***", "https://a.example/***b***"],
		["https://a.example/_x_", "https://a.example/_x_"],
		["https://a.example/__x__", "https://a.example/__x__"],
		["https://a.example/~~x~~", "https://a.example/~~x~~"],
		["https://a.example/||x||", "https://a.example/||x||"],
		["https://a.example/a<b>c", "https://a.example/a&lt;b&gt;c"],
		["https://a.example/&lt;", "https://a.example/&amp;lt;"],
		[
			"https://a.example/<@0190a3b2-0000-7000-8000-000000000001>",
			"https://a.example/&lt;@0190a3b2-0000-7000-8000-000000000001&gt;",
		],
		[
			"https://a.example/<:0190a3b2-0000-7000-8000-000000000002:>",
			"https://a.example/&lt;:0190a3b2-0000-7000-8000-000000000002:&gt;",
		],
		["https://a.example/😀", "https://a.example/😀"],
	];

	test("the inline rules leave the URL alone, and the text is the link's", () => {
		for (const [url, href] of CASES) {
			const html = renderMarkdown(`see [the page](${url}) now`);
			expect(hrefOf(html)).toBe(href);
			expect(html).toContain(`class="msg-link">the page</a> now`);
		}
	});

	test("the same in a reply's one-line quote, a list, a quote, a heading and a table", () => {
		for (const [url, href] of CASES) {
			expect(hrefOf(renderMarkdownLine(`[x](${url})`))).toBe(href);
			for (const text of [`- [x](${url})`, `> [x](${url})`, `## [x](${url})`, `| a |\n|---|\n| [x](${url}) |`]) {
				expect(hrefOf(renderMarkdown(text))).toBe(href);
			}
		}
	});

	test("the text still takes formatting, and formatting around the link wraps it", () => {
		expect(renderMarkdown("[**bold** _it_](https://a.example/_x_)")).toBe(
			'<a href="https://a.example/_x_" target="_blank" rel="noopener noreferrer" class="msg-link"><strong>bold</strong> <em>it</em></a>',
		);
		expect(renderMarkdown("**[x](https://a.example/a*b)** ||[y](https://a.example/||)||")).toBe(
			'<strong><a href="https://a.example/a*b" target="_blank" rel="noopener noreferrer" class="msg-link">x</a></strong> ' +
				'<span class="msg-spoiler"><a href="https://a.example/||" target="_blank" rel="noopener noreferrer" class="msg-link">y</a></span>',
		);
	});

	test("code in the text stays code, and the URL's quotes still can't end its href", () => {
		expect(renderMarkdown("[`a*b*`](https://a.example/_x_)")).toBe(
			'<a href="https://a.example/_x_" target="_blank" rel="noopener noreferrer" class="msg-link"><code class="msg-inline-code">a*b*</code></a>',
		);
		const html = renderMarkdown('[x](https://a.example/*"onmouseover="alert(1)*)');
		expect(hrefOf(html)).toBe("https://a.example/*&quot;onmouseover=&quot;alert(1");
		expect(html).not.toContain('"onmouseover');
	});
});

describe("a message's own \\x00 can't pass for a placeholder", () => {
	test("a reply's quote of it doesn't throw", () => {
		expect(renderMarkdownLine("\x00P9\x00")).toBe("P9");
	});

	test("it brings in no code's HTML, nor undefined", () => {
		expect(renderMarkdown("`a` \x00I0\x00")).toBe('<code class="msg-inline-code">a</code> I0');
		expect(renderMarkdown("\x00B9\x00 \x00I9\x00")).toBe("B9 I9");
		expect(renderMarkdown("`a` \x00I0\x01 \x01")).toBe('<code class="msg-inline-code">a</code> I0 ');
	});

	test("text between two placeholders doesn't read as a third", () => {
		const code = (c: string) => `<code class="msg-inline-code">${c}</code>`;
		for (const between of ["B0", "E0", "E5", "I0", "I5", "L0", "L5", "P0"]) {
			expect(renderMarkdown(`\`a\`${between}\`b\``)).toBe(`${code("a")}${between}${code("b")}`);
			expect(renderMarkdownLine(`\`a\`${between}\`b\``)).toBe(`${code("a")}${between}${code("b")}`);
			expect(renderMarkdownLine(`\`\`\` a\`\`\`${between}\`b\``)).toBe(`${code("a")}${between}${code("b")}`);
		}
		const link = '<a href="https://a.example/" target="_blank" rel="noopener noreferrer" class="msg-link">x</a>';
		expect(renderMarkdown("[x](https://a.example/)I0`b`")).toBe(`${link}I0${code("b")}`);
	});

	test("inline code doesn't take a code block in: the block comes back where it was", () => {
		for (const html of [renderMarkdown("`x``` b```y`"), renderMarkdownLine("`x``` b```y`")]) {
			expect(html).not.toMatch(/[\x00\x01]/);
			expect(html.startsWith("`x")).toBe(true);
			expect(html.endsWith("y`")).toBe(true);
		}
		expect(renderMarkdownLine("`x``` b```y`")).toBe('`x<code class="msg-inline-code">b</code>y`');
	});
});

// The texts as typed: in String.raw, each \ is one backslash.
describe("a backslash before punctuation makes it text", () => {
	test("an escaped marker opens and closes nothing, and the backslash goes", () => {
		expect(renderMarkdown(String.raw`\*xd*`)).toBe("*xd*");
		expect(renderMarkdown(String.raw`\*\*bold\*\*`)).toBe("**bold**");
		expect(renderMarkdown(String.raw`\_x_`)).toBe("_x_");
		expect(renderMarkdown(String.raw`\_\_init\_\_`)).toBe("__init__");
		expect(renderMarkdown(String.raw`\~~struck~~`)).toBe("~~struck~~");
		expect(renderMarkdown(String.raw`\|\|shown\|\|`)).toBe("||shown||");
	});

	test("inside emphasis, it's the emphasis's text", () => {
		expect(renderMarkdown(String.raw`*a\*b*`)).toBe("<em>a*b</em>");
		expect(renderMarkdown(String.raw`**2\*3**`)).toBe("<strong>2*3</strong>");
	});

	test("an escaped backslash is one, and what follows it reads as written", () => {
		expect(renderMarkdown(String.raw`\\*xd*`)).toBe(String.raw`\<em>xd</em>`);
	});

	test("a line's own marker starts no block", () => {
		expect(renderMarkdown(String.raw`\# not a heading`)).toBe("# not a heading");
		expect(renderMarkdown(String.raw`\> not a quote`)).toBe("&gt; not a quote");
		expect(renderMarkdown(String.raw`\- not a list`)).toBe("- not a list");
		expect(renderMarkdown(String.raw`1\. not a list`)).toBe("1. not a list");
		expect(renderMarkdown(String.raw`\-# not subtext`)).toBe("-# not subtext");
	});

	test("an escaped ` opens no code, and in code a backslash is the code's", () => {
		expect(renderMarkdown("\\`not code\\`")).toBe("`not code`");
		expect(renderMarkdown("\\`\\`\\`not a block\\`\\`\\`")).toBe("```not a block```");
		expect(renderMarkdown("\\\\`code`")).toBe('\\<code class="msg-inline-code">code</code>');
		expect(renderMarkdown("`\\*x*`")).toBe('<code class="msg-inline-code">\\*x*</code>');
		expect(renderMarkdown("```\n\\*x*\n```")).toContain("\\*x*");
	});

	test("an escaped [ starts no link, and a link's text takes escapes", () => {
		expect(renderMarkdown(String.raw`\[x](https://a.example)`)).toBe("[x](https://a.example)");
		expect(renderMarkdown(String.raw`[a\*b*](https://a.example)`)).toBe(
			'<a href="https://a.example" target="_blank" rel="noopener noreferrer" class="msg-link">a*b*</a>',
		);
	});

	test("an escaped | is a table cell's text, not its edge", () => {
		expect(renderMarkdown("a | b \\| c\n--|--\nd | e")).toContain("<th>b | c</th>");
	});

	test("a backslash before anything else stays, as in a path", () => {
		expect(renderMarkdown(String.raw`C:\Users\Admin`)).toBe(String.raw`C:\Users\Admin`);
		expect(renderMarkdown("ends with \\")).toBe("ends with \\");
	});

	// The API reads <@id> after a backslash as a mention, and notifies them: the text shows it as one.
	test("a mention after a backslash is still one", () => {
		const id = "0190a3b2-0000-7000-8000-000000000001";
		expect(renderMarkdown(`\\<@${id}>`, false, { [id]: "ana" })).toBe(
			`\\<span class="msg-mention" data-user-id="${id}">@ana</span>`,
		);
	});

	test("a reply's one-line quote reads them too", () => {
		expect(renderMarkdownLine(String.raw`\*xd*`)).toBe("*xd*");
		expect(renderMarkdownLine(String.raw`\# not a heading`)).toBe("# not a heading");
		expect(renderMarkdownLine("\\`\\`\\`a\\`\\`\\`")).toBe("```a```");
	});

	// The escaped * opens nothing, so the link's own * stays its own, as drawn and as its card reads it.
	test("an escaped marker before a bare link opens nothing the link would end before", () => {
		const text = String.raw`\*https://a.example/x*`;
		expect(renderMarkdown(text, false, undefined, undefined, undefined, {})).toBe(`*${LINK("https://a.example/x*")}`);
		expect(parseTextSegments(text)).toEqual([
			{ type: "text", content: String.raw`\*` },
			{ type: "link", content: "https://a.example/x*" },
		]);
	});
});

describe("room mentions", () => {
	const ROOM = "0190a3b2-0000-7000-8000-0000000000c1";
	const EMOJI = "0190a3b2-0000-7000-8000-0000000000e1";
	const names = { [ROOM]: "general" };

	test("a room the reader can view reads #name, with its ID to open it", () => {
		expect(renderMarkdown(`see <#${ROOM}>`, false, undefined, undefined, names)).toBe(
			`see <span class="msg-room-mention" data-room-id="${ROOM}">#general</span>`,
		);
	});

	test("any other room, or one that's gone, reads #unknown, with no ID", () => {
		const html = renderMarkdown(`<#${ROOM}>`);
		expect(html).toBe(`<span class="msg-room-mention msg-room-unknown">#unknown</span>`);
		expect(renderMarkdown(`<#${ROOM}>`, false, undefined, undefined, {})).toBe(html);
	});

	test("in code, it stays as written", () => {
		const html = renderMarkdown(`\`<#${ROOM}>\``, false, undefined, undefined, names);
		expect(html).toBe(`<code class="msg-inline-code">&lt;#${ROOM}&gt;</code>`);
	});

	test("a room's name is text: escaped, and neither markdown nor an emoji", () => {
		const html = renderMarkdown(`<#${ROOM}>`, false, undefined, undefined, {
			[ROOM]: `**x** <:${EMOJI}:> <b>"`,
		});
		expect(html).toBe(
			`<span class="msg-room-mention" data-room-id="${ROOM}">#**x** &lt;:${EMOJI}:&gt; &lt;b&gt;&quot;</span>`,
		);
	});

	test("a reply's one-line quote reads it too", () => {
		expect(renderMarkdownLine(`# <#${ROOM}>`, undefined, undefined, names)).toBe(
			`<span class="msg-room-mention" data-room-id="${ROOM}">#general</span>`,
		);
	});
});

describe("user mentions", () => {
	const ANA = "0190a3b2-0000-7000-8000-0000000000a1";
	const names = { [ANA]: "Ana" };

	test("one of someone the map knows reads @name, with their ID to open their profile", () => {
		expect(renderMarkdown(`hi <@${ANA}>`, false, names)).toBe(
			`hi <span class="msg-mention" data-user-id="${ANA}">@Ana</span>`,
		);
	});

	test("anyone else's, who left or isn't loaded, reads the start of the ID, with no ID to open", () => {
		const html = `<span class="msg-mention">@0190a3b2</span>`;
		expect(renderMarkdown(`<@${ANA}>`)).toBe(html);
		expect(renderMarkdown(`<@${ANA}>`, false, {})).toBe(html);
	});

	test("what isn't an ID opens nothing, whatever the map says", () => {
		expect(renderMarkdown("<@abc>", false, { abc: "Abc" })).toBe(`<span class="msg-mention">@Abc</span>`);
		expect(renderMarkdown("<@abc>")).toBe(`<span class="msg-mention">@abc</span>`);
		const short = `<@${ANA.slice(0, -1)}>`;
		expect(renderMarkdown(short, false, { [ANA.slice(0, -1)]: "Ana" })).toBe(`<span class="msg-mention">@Ana</span>`);
	});

	test("in code, it stays as written", () => {
		expect(renderMarkdown(`\`<@${ANA}>\``, false, names)).toBe(`<code class="msg-inline-code">&lt;@${ANA}&gt;</code>`);
	});

	test("a name is text: escaped, whatever it holds", () => {
		const html = renderMarkdown(`<@${ANA}>`, false, { [ANA]: `"><img src=x onerror=alert(1)>` });
		expect(html).toBe(
			`<span class="msg-mention" data-user-id="${ANA}">@&quot;&gt;&lt;img src=x onerror=alert(1)&gt;</span>`,
		);
	});

	test("a reply's one-line quote reads it too", () => {
		expect(renderMarkdownLine(`# <@${ANA}>`, names)).toBe(
			`<span class="msg-mention" data-user-id="${ANA}">@Ana</span>`,
		);
	});
});

// The text holds only a custom emoji's ID. One the map doesn't have (of a Space the reader isn't in, or gone) shows its
// image all the same, from the API's /emojis/{id}, which anyone may load: with no name to show, it reads :emoji:. One
// that's gone is a 404 there, and the image's retry (lib/emoji-retry.ts) then shows its title, :emoji:.
describe("a custom emoji the map doesn't have", () => {
	const GONE = "0190a3b2-0000-7000-8000-0000000000e2";
	const image = (large: boolean) =>
		`<img class="emoji-img ${large ? "emoji-large " : ""}custom-emoji" src="${getHostURL()}/emojis/${GONE}" alt=":emoji:" title=":emoji:" draggable="false" loading="lazy">`;

	test("draws its image from /emojis, named :emoji:", () => {
		expect(renderMarkdown(`Before <:${GONE}:> after`)).toBe(`Before ${image(false)} after`);
	});

	test("alone, large", () => {
		expect(renderMarkdown(`<:${GONE}:>`, true)).toBe(image(true));
	});

	test("renderMarkdownLine the same", () => {
		expect(renderMarkdownLine(`Before <:${GONE}:> after`)).toBe(`Before ${image(false)} after`);
	});

	test("an ID that isn't a UUID reads :emoji:, with no request", () => {
		expect(renderMarkdown("Before <:abc-123:> after")).toBe("Before :emoji: after");
		expect(emojiImageUrl("abc")).toBeNull();
		expect(emojiImageUrl(GONE)).toBe(`${getHostURL()}/emojis/${GONE}`);
	});

	test("a live one beside it is still its own image", () => {
		const emojis = { "0190a3b2-0000-7000-8000-0000000000e3": { name: "party", attachment_id: "file" } };
		const html = renderMarkdown(`<:${GONE}:> <:0190a3b2-0000-7000-8000-0000000000e3:>`, false, undefined, emojis);
		expect(html).toStartWith(`${image(false)} <img `);
		expect(html).toContain(`src="${getHostURL()}/attachments/file"`);
		expect(html).toContain('alt="party"');
	});
});

// A member, an emoji or a room can be named as one of the others is written. Read in turn, the rules read each other's
// output: a chip held a room's chip, whose click did both, and a room's chip inside an emoji's alt broke its image.
describe("a name that holds a mention, an emoji or a room", () => {
	const USER = "0190a3b2-0000-7000-8000-0000000000a1";
	const EMOJI = "0190a3b2-0000-7000-8000-0000000000e1";
	const ROOM = "0190a3b2-0000-7000-8000-0000000000c1";
	const ATTACHMENT = "0190a3b2-0000-7000-8000-0000000000aa";
	const forms = `<@${USER}> <:${EMOJI}:> <#${ROOM}>`;
	const asText = `&lt;@${USER}&gt; &lt;:${EMOJI}:&gt; &lt;#${ROOM}&gt;`;
	const members = { [USER]: forms };
	const emojis = { [EMOJI]: { name: forms, attachment_id: ATTACHMENT } };
	const rooms = { [ROOM]: forms };
	const member = `<span class="msg-mention" data-user-id="${USER}">@${asText}</span>`;
	const room = `<span class="msg-room-mention" data-room-id="${ROOM}">#${asText}</span>`;
	const emoji = `<img class="emoji-img custom-emoji" src="https://api.test/attachments/${ATTACHMENT}" alt="${asText}" title=":${asText}:" draggable="false" loading="lazy">`;

	test("a member's stays text in their chip", () => {
		expect(renderMarkdown(`<@${USER}>`, false, members, emojis, rooms)).toBe(member);
	});

	test("a room's stays text in its chip", () => {
		expect(renderMarkdown(`<#${ROOM}>`, false, members, emojis, rooms)).toBe(room);
	});

	test("an emoji's stays text in its alt and title", () => {
		expect(renderMarkdown(`<:${EMOJI}:>`, false, members, emojis, rooms)).toBe(emoji);
	});

	test("the three in one text are read once each, in a reply's quote too", () => {
		const text = `<@${USER}> <:${EMOJI}:> <#${ROOM}>`;
		expect(renderMarkdown(text, false, members, emojis, rooms)).toBe(`${member} ${emoji} ${room}`);
		expect(renderMarkdownLine(text, members, emojis, rooms)).toBe(`${member} ${emoji} ${room}`);
	});

	test("what's written around them is still read", () => {
		expect(renderMarkdown(`**<@${USER}>** \`<#${ROOM}>\``, false, members, emojis, rooms)).toBe(
			`<strong>${member}</strong> <code class="msg-inline-code">&lt;#${ROOM}&gt;</code>`,
		);
	});
});

describe("clickedMention", () => {
	const ANA = "0190a3b2-0000-7000-8000-0000000000a1";
	// Bun has no DOM: what a click lands on, as clickedMention reads it, inside a mention's chip or not.
	class FakeElement extends EventTarget {
		dataset: { userId?: string } = {};
		constructor(
			private chip: FakeElement | null,
			private link: FakeElement | null = null,
		) {
			super();
		}
		closest(selector: string) {
			if (selector === ".msg-mention[data-user-id]") return this.chip;
			if (selector === "a") return this.link;
			return null;
		}
	}
	Object.assign(globalThis, { Element: FakeElement });
	const chipOf = (userId: string | undefined, link: FakeElement | null = null) => {
		const chip = new FakeElement(null, link);
		chip.dataset.userId = userId;
		return chip;
	};

	test("a click on a mention's chip, or inside it, finds the chip and who it names", () => {
		const chip = chipOf(ANA);
		const found = clickedMention(new FakeElement(chip));
		expect(found?.userId).toBe(ANA);
		expect(Object.is(found?.chip, chip)).toBe(true);
	});

	test("any other click finds nothing", () => {
		expect(clickedMention(new FakeElement(null))).toBeNull();
		expect(clickedMention(null)).toBeNull();
		expect(clickedMention(new EventTarget())).toBeNull();
	});

	test("one in a link's text is the link's", () => {
		expect(clickedMention(new FakeElement(chipOf(ANA, new FakeElement(null))))).toBeNull();
	});

	test("one without an ID opens nothing", () => {
		expect(clickedMention(new FakeElement(chipOf(undefined)))).toBeNull();
		expect(clickedMention(new FakeElement(chipOf("")))).toBeNull();
	});
});

describe("mentionNamesIn", () => {
	const ANA = "0190a3b2-0000-7000-8000-000000000001";
	const BOB = "0190a3b2-0000-7000-8000-000000000002";
	const people = [
		{ id: ANA, username: "ana", alias: "Ana" },
		{ id: BOB, username: "bob", alias: null },
		{ id: ANA, username: "ana", alias: "Another name" },
	];

	test("names those the text mentions, by alias or else username, the first of them with an ID", () => {
		expect(mentionNamesIn(`<@${ANA}> and <@${BOB}>`, people)).toEqual({ [ANA]: "Ana", [BOB]: "bob" });
	});

	test("and nobody else", () => {
		expect(mentionNamesIn(`<@${ANA}>`, people)).toEqual({ [ANA]: "Ana" });
		expect(mentionNamesIn(`${ANA} @${BOB}`, people)).toEqual({});
		expect(mentionNamesIn("<@01234567>", people)).toEqual({});
	});
});

// #215: a bare link took what followed it up to a space: the punctuation of its sentence, and the ) of brackets around
// it. It then opened a URL ending in that, which many sites answer with a 404. It's read as the mobile app reads one.
describe("a bare link", () => {
	const linksIn = (text: string) =>
		parseTextSegments(text)
			.filter((s) => s.type === "link")
			.map((s) => s.content);
	const ID = "0190a3b2-0000-7000-8000-000000000001";

	test("ends before the punctuation after it", () => {
		expect(linksIn("see https://example.org/page, then")).toEqual(["https://example.org/page"]);
		expect(linksIn("open https://example.org/a.")).toEqual(["https://example.org/a"]);
		expect(linksIn("is it https://example.org/b?")).toEqual(["https://example.org/b"]);
		expect(linksIn("really https://example.org/b?!...")).toEqual(["https://example.org/b"]);
		expect(linksIn("https://example.org/a; http://example.org/b: and duvet://c!")).toEqual([
			"https://example.org/a",
			"http://example.org/b",
			"duvet://c",
		]);
	});

	test("keeps the punctuation inside it", () => {
		expect(linksIn("https://example.org/a.b,c;d:e!f?g=1&h=2#i")).toEqual(["https://example.org/a.b,c;d:e!f?g=1&h=2#i"]);
		expect(linksIn("http://example.org:8080/x")).toEqual(["http://example.org:8080/x"]);
		expect(linksIn("https://example.org/it's")).toEqual(["https://example.org/it's"]);
	});

	test("isn't closed by the ) of brackets around it, and keeps its own", () => {
		expect(linksIn("(https://example.org/c)")).toEqual(["https://example.org/c"]);
		expect(linksIn("https://en.wikipedia.org/wiki/Duvet_(bedding)")).toEqual([
			"https://en.wikipedia.org/wiki/Duvet_(bedding)",
		]);
		expect(linksIn("(see https://en.wikipedia.org/wiki/Duvet_(bedding)).")).toEqual([
			"https://en.wikipedia.org/wiki/Duvet_(bedding)",
		]);
		expect(linksIn("https://example.org/a_(b)_c_(d)")).toEqual(["https://example.org/a_(b)_c_(d)"]);
		// A ( it doesn't close, or a ) that closes nothing of its own, ends it.
		expect(linksIn("https://example.org/a(b c)")).toEqual(["https://example.org/a"]);
		expect(linksIn("https://example.org/a)b")).toEqual(["https://example.org/a"]);
	});

	test("ends before the quotes and brackets around it", () => {
		for (const [open, close] of [
			['"', '"'],
			["'", "'"],
			["[", "]"],
			["{", "}"],
			["<", ">"],
		]) {
			expect(linksIn(`${open}https://example.org/q${close}`)).toEqual(["https://example.org/q"]);
		}
	});

	test("ends before a mention, an emoji or a room written right after it, which reads as one", () => {
		for (const form of [`<@${ID}>`, `<:${ID}:>`, `<#${ID}>`]) {
			expect(parseTextSegments(`https://example.org/x${form}`)).toEqual([
				{ type: "link", content: "https://example.org/x" },
				{ type: "text", content: form },
			]);
		}
	});

	test("leaves the text around it whole, in order", () => {
		expect(parseTextSegments("(see https://example.org/a, and https://example.org/b_(c)).")).toEqual([
			{ type: "text", content: "(see " },
			{ type: "link", content: "https://example.org/a" },
			{ type: "text", content: ", and " },
			{ type: "link", content: "https://example.org/b_(c)" },
			{ type: "text", content: ")." },
		]);
	});

	test("a markdown link's URL is the markdown link's", () => {
		expect(linksIn("[docs](https://example.org/a), see")).toEqual([]);
		expect(renderMarkdown("[docs](https://example.org/a), see")).toContain('href="https://example.org/a"');
	});

	// #222: a URL in a markdown link's text was a bare link, the link's (…) taken for the URL's own brackets: the bare
	// link ran to the markdown link's end, and the markdown link broke.
	test("a markdown link's text is the markdown link's too, whatever it holds", () => {
		for (const text of [
			"[https://a.example](https://b.example)",
			"see [https://a.example/x_(y)](https://b.example/z), then",
			"[read https://a.example now](https://b.example)",
			"[duvet://c](https://b.example)",
		]) {
			expect(parseTextSegments(text)).toEqual([{ type: "text", content: text }]);
		}
		expect(renderMarkdown("[https://a.example](https://b.example)")).toBe(
			'<a href="https://b.example" target="_blank" rel="noopener noreferrer" class="msg-link">https://a.example</a>',
		);
		// The bare links around one are still links.
		expect(parseTextSegments("https://c.example [https://a.example](https://b.example) https://d.example")).toEqual([
			{ type: "link", content: "https://c.example" },
			{ type: "text", content: " [https://a.example](https://b.example) " },
			{ type: "link", content: "https://d.example" },
		]);
	});

	// #249: a URL in inline code was a bare link, with the code's closing backtick, and the code never rendered.
	test("isn't one in code, which renders as code", () => {
		for (const text of [
			"`https://a.example/x`",
			"see `https://a.example/x` now",
			"```\nhttps://a.example/x\n```",
			"```js\nfetch('https://a.example/x');\n```",
		]) {
			expect(parseTextSegments(text)).toEqual([{ type: "text", content: text }]);
		}
		expect(renderMarkdown("`https://a.example/x`")).toBe('<code class="msg-inline-code">https://a.example/x</code>');
		// Code right after a link is the code's, as the renderer takes code out first.
		expect(parseTextSegments("https://a.example/`x` y")).toEqual([
			{ type: "link", content: "https://a.example/" },
			{ type: "text", content: "`x` y" },
		]);
	});

	// #221: a link can end with a * or a _, so the closing marker of emphasis around a bare link was the link's: it
	// opened a URL ending in the marker, and the emphasis never closed.
	describe("with emphasis around it", () => {
		const closing = (marks: string[]) => [...marks.join("")].reverse().join("");

		test("ends before the closing marker, and is wrapped as markdown wraps text", () => {
			for (const marks of [["**"], ["*"], ["__"], ["_"], ["~~"], ["**", "*"], ["**", "_"], ["~~", "**"]]) {
				const text = `look ${marks.join("")}https://a.example/x${closing(marks)} now`;
				expect(parseTextSegments(text)).toEqual([
					{ type: "text", content: `look ${marks.join("")}` },
					{ type: "link", content: "https://a.example/x" },
					{ type: "text", content: `${closing(marks)} now` },
				]);
				// The tags around the link are those markdown puts around text with the same markers.
				const tags = marks.map((mark) => EMPHASIS_TAGS[mark]);
				expect(renderMarkdown(text, false, undefined, undefined, undefined, {})).toBe(
					`look ${tags.map((tag) => `<${tag}>`).join("")}${LINK("https://a.example/x")}${[...tags]
						.reverse()
						.map((tag) => `</${tag}>`)
						.join("")} now`,
				);
			}
		});

		test("keeps a URL's own * and _", () => {
			expect(linksIn("**https://a.example/a_b_c**")).toEqual(["https://a.example/a_b_c"]);
			expect(linksIn("**https://a.example/x_**")).toEqual(["https://a.example/x_"]);
			expect(linksIn("_https://docs.example/object.__init___")).toEqual(["https://docs.example/object.__init__"]);
			expect(linksIn("see https://a.example/a_b_ and https://a.example/*x*")).toEqual([
				"https://a.example/a_b_",
				"https://a.example/*x*",
			]);
			// Nothing right before it opens what its last characters would close: a _ inside a word opens nothing.
			expect(linksIn("https://a.example/x** and snake_https://a.example/y_")).toEqual([
				"https://a.example/x**",
				"https://a.example/y_",
			]);
		});

		// #248: markers that opened before other text ("**see https://…**"), and a spoiler's, were left in the link: it opened
		// a URL ending in them, and the emphasis or the spoiler never closed.
		test("ends before the markers that close what its line opened before it, a spoiler too", () => {
			const drawn = (text: string) => renderMarkdown(text, false, undefined, undefined, undefined, {});
			const x = LINK("https://a.example/x");
			expect(drawn("**see https://a.example/x**")).toBe(`<strong>see ${x}</strong>`);
			expect(drawn("*see https://a.example/x*, _see https://a.example/x_")).toBe(
				`<em>see ${x}</em>, <em>see ${x}</em>`,
			);
			expect(drawn("||https://a.example/x||")).toBe(`<span class="msg-spoiler">${x}</span>`);
			expect(drawn("||see https://a.example/x|| now")).toBe(`<span class="msg-spoiler">see ${x}</span> now`);
			expect(drawn("~~old: https://a.example/x and https://a.example/y~~")).toBe(
				`<del>old: ${x} and ${LINK("https://a.example/y")}</del>`,
			);
			expect(drawn("**see https://a.example/x** and **https://a.example/y**")).toBe(
				`<strong>see ${x}</strong> and <strong>${LINK("https://a.example/y")}</strong>`,
			);
			// What closed before the link, or opened on another line, is nothing the link's markers close.
			expect(linksIn("**a** https://a.example/x**")).toEqual(["https://a.example/x**"]);
			expect(linksIn("**a\nhttps://a.example/x**")).toEqual(["https://a.example/x**"]);
			expect(linksIn("https://a.example/x|| ||")).toEqual(["https://a.example/x||"]);
			// One of Duvet's own names what its card does.
			const text = "**see https://duvet.chat/invite/abc** ||https://duvet.chat/invite/def||";
			expect(linksIn(text)).toEqual(["https://duvet.chat/invite/abc", "https://duvet.chat/invite/def"]);
			expect(duvetLinksIn(text, "views://mainview")).toEqual([{ code: "abc" }, { code: "def" }]);
		});

		test("one of Duvet's own names what its card does", () => {
			const text = `**https://duvet.chat/invite/abc** and _https://duvet.chat/invite?bot=${ID}_`;
			const buttons = linksIn(text).flatMap((link) => parseDuvetLink(cardLink(link), "views://mainview") ?? []);
			expect(buttons).toEqual([{ code: "abc" }, { bot: ID }]);
			expect(duvetLinksIn(text, "views://mainview")).toEqual(buttons);
		});

		// #254: a link followed by thousands of markers took about a second to draw, as each count of them was tried
		// against the link's whole line. What nothing before the link opens is the link's, however much of it there is.
		test("keeps markers nothing before it opens, however many, at once", () => {
			const started = performance.now();
			const stars = `https://a.example/x${"*".repeat(4980)}`;
			expect(linksIn(stars)).toEqual([stars]);
			renderMarkdown(stars, false, undefined, undefined, undefined, {});
			duvetLinksIn(stars, "views://mainview");
			const many = `**a ${"https://a.example/x** ".repeat(200)}`;
			expect(linksIn(many)).toEqual(["https://a.example/x", ...Array(199).fill("https://a.example/x**")]);
			expect(performance.now() - started).toBeLessThan(150);
		});
	});

	// The API leaves one of Duvet's own links without a preview as the mobile app reads it (mobileLink), and the cards
	// under the text read it the same way (cardLink): the link in the text names what its card does.
	test("one of Duvet's own names what its card does", () => {
		for (const text of [
			"join (https://duvet.chat/invite/abc).",
			`add it: https://duvet.chat/invite?bot=${ID}.`,
			`"https://duvet.chat/channels/${ID}/${ID}/${ID}",`,
			`[https://duvet.chat/conversations/${ID}/${ID}]`,
		]) {
			const [link] = linksIn(text);
			const card = parseDuvetLink(cardLink(link!), "views://mainview");
			expect(card).not.toBeNull();
			expect([card]).toEqual(duvetLinksIn(text, "views://mainview"));
		}
	});

	// #223: the cards took each link up to a space, so one of Duvet's own glued after another link, by a < or a ), was
	// read as part of that link: it had its button in the text, and no card.
	test("one of Duvet's own glued after another link has its card, as it has its button", () => {
		for (const text of [
			"https://example.org<https://duvet.chat/invite/abc",
			"(see https://example.org)https://duvet.chat/invite/abc",
			`<https://example.org/a>https://duvet.chat/channels/${ID}/${ID}/${ID}.`,
			`https://duvet.chat/invite/abc)https://duvet.chat/invite?bot=${ID}`,
		]) {
			const buttons = linksIn(text).flatMap((link) => parseDuvetLink(cardLink(link), "views://mainview") ?? []);
			expect(buttons.length).toBeGreaterThan(0);
			expect(duvetLinksIn(text, "views://mainview")).toEqual(buttons);
		}
		// A markdown link's still has its card, as the API leaves it without a preview.
		expect(duvetLinksIn("[join us](https://duvet.chat/invite/abc)", "views://mainview")).toEqual([{ code: "abc" }]);
	});

	// Random text of URLs, brackets, quotes, punctuation, emphasis and spaces: the links and the text between them are the
	// text; each link starts with its scheme and closes its own brackets, and none ends with the punctuation around it.
	test("whatever the text, is one link, and leaves the rest as it was", () => {
		const PIECES = [
			"https://a.example/",
			"http://b.example/x",
			"duvet://c",
			"https://",
			"x",
			"_",
			"*",
			"**",
			"__",
			"~~",
			"~",
			"😀",
			" ",
			"\n",
			"\u00a0",
			".",
			",",
			";",
			":",
			"!",
			"?",
			"(",
			")",
			"(y)",
			"[",
			"]",
			"](",
			"{",
			"}",
			'"',
			"'",
			"<",
			">",
			`<@${ID}>`,
			"[https://a.example/](http://b.example/x)",
			"[see duvet://c](https://a.example/(y))",
		];
		let seed = 2150;
		const random = () => {
			seed ^= seed << 13;
			seed >>>= 0;
			seed ^= seed >>> 17;
			seed ^= seed << 5;
			seed >>>= 0;
			return seed / 0x100000000;
		};
		const found: string[] = [];
		for (let i = 0; i < 5000 && found.length < 5; i++) {
			let text = "";
			for (let n = 1 + Math.floor(random() * 16); n > 0; n--) text += PIECES[Math.floor(random() * PIECES.length)];
			const segments = parseTextSegments(text);
			const written = (s: (typeof segments)[number]) => s.content;
			let at = 0;
			const problem =
				(segments.map(written).join("") !== text ? "not the text" : null) ??
				segments
					.map((s) => {
						const before = text.slice(0, at);
						at += written(s).length;
						if (!s.content) return "an empty segment";
						if (s.type === "text") return null;
						if (!/^(?:https?|duvet):\/\/\S/.test(s.content)) return `${s.content}: no scheme`;
						if (/[\s<>]/.test(s.content)) return `${s.content}: a space, < or >`;
						if (/[.,;:!?\]}"']$/.test(s.content)) return `${s.content}: punctuation at its end`;
						if (/[()]/.test(s.content.replace(/\([^()]*\)/g, ""))) return `${s.content}: a bracket of its own open`;
						if (before.endsWith("](")) return `${s.content}: a markdown link's URL`;
						return null;
					})
					.find((p) => p !== null) ??
				// A markdown link that starts in the text stays whole in it: no link starts in its text or its URL.
				[...text.matchAll(/\[[^\]\n]+\]\(https?:\/\/[^)\n]+\)/g)]
					.map((m) => {
						let start = 0;
						for (const s of segments) {
							const end = start + written(s).length;
							if (m.index >= start && m.index < end)
								return s.type === "text" && m.index + m[0].length > end ? `${m[0]}: a markdown link cut` : null;
							start = end;
						}
						return null;
					})
					.find((p) => p !== null) ??
				null;
			if (problem) found.push(`${problem} in ${JSON.stringify(text)}`);
		}
		expect(found).toEqual([]);
	});
});

// Random text made of the pieces of markdown, HTML, URLs, mentions, emojis and placeholders, rendered both ways
// and read back with an HTML5 tokenizer (HTMLRewriter): every tag and attribute must be one the renderer means to
// write, every href http(s), every src an emoji's. The names in the maps are hostile, as a member's can be.
describe("the HTML it makes", () => {
	const ID1 = "0190a3b2-0000-7000-8000-000000000001";
	const ID2 = "0190a3b2-0000-7000-8000-000000000002";
	const ID3 = "0190a3b2-0000-7000-8000-000000000003";
	// Each also holds what the others are written as, which only one pass over the text leaves alone.
	const forms = `<@${ID1}><:${ID2}:><#${ID3}>`;
	const mentionMap = { [ID1]: `"><img src=x onerror=alert(1)>'&<b>${forms}` };
	const customEmojiMap = {
		[ID2]: { name: `x"><script>alert(1)</script>'${forms}`, attachment_id: "0190a3b2-0000-7000-8000-0000000000aa" },
	};
	const roomNames = { [ID3]: `"><img src=x onerror=alert(1)>'&<b>${forms}` };
	// Duvet's own links on the app's host, whose chips name a space as hostile as any name.
	const drawing = {
		duvet: { ownOrigin: "https://duvet.chat", spaceName: () => `"><img src=x onerror=alert(1)>'&<b>${forms}` },
	};
	const PIECES = [
		"https://duvet.chat/invite/",
		`https://duvet.chat/channels/${ID1}/${ID3}/${ID2}`,
		`https://duvet.chat/conversations/${ID1}/${ID2}`,
		`https://duvet.chat/invite?bot=${ID1}`,
		"duvet://c",
		"[",
		"]",
		"(",
		")",
		"](",
		"[x](",
		"https://a.example/",
		"http://b.example/?q=1&r=2",
		"https://",
		"javascript:alert(1)",
		"JaVaScRiPt:alert(1)",
		"javascript://%0aalert(1)",
		"data:text/html,x",
		"&#106;avascript:",
		'"',
		"'",
		"<",
		">",
		"&",
		"&lt;",
		"&gt;",
		"&quot;",
		"&amp;",
		"&#34;",
		";",
		"@",
		":",
		`<@${ID1}>`,
		`<:${ID2}:>`,
		`<#${ID3}>`,
		"<@abc>",
		"<:abc:>",
		"<#abc>",
		"<@",
		"<:",
		"<#",
		"#",
		"**",
		"*",
		"_",
		"__",
		"~~",
		"||",
		"`",
		"```",
		"```js\n",
		"```go\nfoo\n```",
		"\n",
		"# ",
		"## ",
		"-# ",
		"> ",
		">>> ",
		"- ",
		"1. ",
		"| ",
		"|---|",
		"\n|---|---|\n",
		" ",
		"\t",
		"\r",
		" ",
		"\\",
		"=",
		"/",
		"x",
		"0",
		"😀",
		"👨‍👩‍👧",
		"🇺🇸",
		"1️⃣",
		"✌🏽",
		"❤️",
		"\x00",
		"\x00I0\x00",
		"\x00B0\x00",
		"\x00P0\x00",
		"\x01",
		"\x00I0\x01",
		"\x00L0\x01",
		"\x00E0\x01",
		"B0",
		"E0",
		"I0",
		"L0",
		"P0",
		"\x00I1\x00",
		"\x00B1\x00",
		"onmouseover=",
		"onerror=",
		'"onmouseover="alert(1)',
		"'onmouseover='alert(1)",
		"<img src=x onerror=alert(1)>",
		"<script>alert(1)</script>",
		"</a>",
		"<a href=",
		'">',
		"`code`",
	];
	const TAGS = new Set([
		"a",
		"strong",
		"em",
		"u",
		"del",
		"span",
		"code",
		"pre",
		"button",
		"svg",
		"rect",
		"path",
		"br",
		"img",
		"h1",
		"h2",
		"h3",
		"blockquote",
		"ul",
		"ol",
		"li",
		"table",
		"thead",
		"tbody",
		"tr",
		"th",
		"td",
	]);
	const ATTRIBUTES: Record<string, Set<string>> = {
		a: new Set(["href", "target", "rel", "class"]),
		// No handler: a custom emoji's image that fails is tried again by the document (lib/emoji-retry.ts).
		img: new Set(["class", "src", "alt", "title", "draggable", "loading"]),
		span: new Set(["class", "title", "style", "data-room-id", "data-user-id"]),
		// A code block's copy button, and one of Duvet's own links: a message's chip, an invite's button.
		button: new Set([
			"class",
			"data-code",
			"title",
			"aria-label",
			"type",
			"data-space",
			"data-room",
			"data-message",
			"data-conversation",
			"data-bot",
			"data-invite",
		]),
		svg: new Set([
			"class",
			"xmlns",
			"width",
			"height",
			"viewbox",
			"fill",
			"stroke",
			"stroke-width",
			"stroke-linecap",
			"stroke-linejoin",
		]),
		rect: new Set(["width", "height", "x", "y", "rx", "ry"]),
		path: new Set(["d"]),
		th: new Set(["style", "class"]),
		td: new Set(["style", "class"]),
		pre: new Set(["class", "style", "tabindex"]),
		code: new Set(["class"]),
	};
	// Twemoji's PNGs, and its SVGs for large emojis (#331).
	const twemoji = [toTwemojiUrl("😀"), toTwemojiUrl("😀", true)].map((url) => url.replace(/[^/]+$/, ""));

	function violation(tag: string, attributes: Iterable<[string, string]>): string | null {
		if (!TAGS.has(tag)) return `<${tag}>`;
		const allowed = ATTRIBUTES[tag] ?? new Set(["class"]);
		for (const [name, value] of attributes) {
			if (!allowed.has(name)) return `${name} on <${tag}>`;
			if (name === "href" && !/^https?:\/\//.test(value)) return `href ${value}`;
			if (
				name === "src" &&
				!twemoji.some((base) => value.startsWith(base)) &&
				!value.startsWith("https://api.test/attachments/")
			)
				return `src ${value}`;
			if (
				name === "style" &&
				!/^(text-align:(left|right|center)|[a-z-]+:[#\w .,()%-]+(;[a-z-]+:[#\w .,()%-]+)*;?)$/.test(value)
			)
				return `style ${value}`;
			if (name === "data-room-id" && !/^[a-f0-9-]+$/.test(value)) return `data-room-id ${value}`;
			if (name === "data-user-id" && !isUuid(value)) return `data-user-id ${value}`;
			if (/^data-(space|room|message|conversation|bot)$/.test(name) && !isUuid(value)) return `${name} ${value}`;
			if (name === "type" && value !== "button") return `type ${value}`;
			if (name === "target" && value !== "_blank") return `target ${value}`;
			if (name === "rel" && value !== "noopener noreferrer") return `rel ${value}`;
		}
		return null;
	}

	async function inspect(html: string): Promise<string | null> {
		let found: string | null = null;
		let outer = true;
		const rewriter = new HTMLRewriter()
			.on("*", {
				element(el) {
					if (outer) outer = false;
					else found ??= violation(el.tagName, el.attributes);
				},
			})
			.onDocument({
				comments() {
					found ??= "a comment";
				},
			});
		await rewriter.transform(new Response(`<div>${html}</div>`)).text();
		return found;
	}

	test("has only the tags and attributes it means to write, whatever the text", async () => {
		let seed = 12345;
		const random = () => {
			seed ^= seed << 13;
			seed >>>= 0;
			seed ^= seed >>> 17;
			seed ^= seed << 5;
			seed >>>= 0;
			return seed / 0x100000000;
		};
		const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
		const found: string[] = [];
		for (let i = 0; i < 3000 && found.length < 5; i++) {
			let text = "";
			for (let n = 1 + Math.floor(random() * 22); n > 0; n--) text += pick(PIECES);
			if (random() < 0.5)
				text = `[${pick(PIECES)}${pick(PIECES)}](${pick(["https://", "http://", "javascript:", "javascript://", ""])}${text})${pick(PIECES)}`;
			for (const html of [
				renderMarkdown(text, random() < 0.2, mentionMap, customEmojiMap, roomNames),
				renderMarkdownLine(text, mentionMap, customEmojiMap, roomNames),
				// With its bare links, as a bio and a component draw it, and as a message's text does, Duvet's own as chips.
				renderMarkdown(text, random() < 0.2, mentionMap, customEmojiMap, roomNames, {}),
				renderMarkdown(text, false, mentionMap, customEmojiMap, roomNames, drawing),
			]) {
				// A placeholder that didn't come back whole leaves its mark, or "undefined" in another's place.
				const problem =
					(await inspect(html)) ??
					(/[\x00\x01]/.test(html) ? "a placeholder's mark" : null) ??
					(html.includes("undefined") && !text.includes("undefined") ? "undefined" : null);
				if (problem) found.push(`${problem} from ${JSON.stringify(text)}`);
			}
		}
		expect(found).toEqual([]);
	});
});

// #324: a member's presence or voice change gave the lists a new mention map, with the same names, and every message's
// text was drawn again. The lists keep their map while every name stays the same.
describe("sameNames", () => {
	test("says whether two maps give every ID the same name, in any order", () => {
		expect(sameNames({ a: "ana", b: "bea" }, { b: "bea", a: "ana" })).toBe(true);
		expect(sameNames({}, {})).toBe(true);
		expect(sameNames({ a: "ana" }, { a: "ana", b: "bea" })).toBe(false);
		expect(sameNames({ a: "ana", b: "bea" }, { a: "ana" })).toBe(false);
		expect(sameNames({ a: "ana" }, { a: "anabel" })).toBe(false);
		expect(sameNames({ a: "ana" }, { b: "ana" })).toBe(false);
	});

	test("the lists keep their mention map while its names stay", () => {
		for (const file of ["MessageList.svelte", "MessageSearch.svelte", "PinnedMessages.svelte"]) {
			const source = readFileSync(join(import.meta.dir, "components", file), "utf8");
			expect(source).toMatch(
				/const next = mentionMapOf\(members\);\s*if \(!sameNames\(next, mentionNames\)\) mentionNames = next;\s*return mentionNames;/,
			);
		}
	});
});

// #331: every Unicode emoji came from Twemoji's SVG, which Chromium loads as a document of its own: 300 distinct ones
// took 19.3 MB, against 1.9 MB as the 72×72 PNGs. The SVG stays for the large emojis of an emoji-only message (3rem).
describe("Twemoji's images", () => {
	const base = "https://cdn.jsdelivr.net/gh/jdecked/twemoji@16.0.1/assets";
	test("are the 72×72 PNGs, and the SVGs only for large emojis", () => {
		expect(toTwemojiUrl("😀")).toBe(`${base}/72x72/1f600.png`);
		expect(toTwemojiUrl("😀", true)).toBe(`${base}/svg/1f600.svg`);
		expect(toTwemojiUrl("❤️‍🔥")).toBe(`${base}/72x72/2764-fe0f-200d-1f525.png`);
		expect(toTwemojiUrl("\u{1F441}\uFE0F\u200D\u{1F5E8}\uFE0F")).toBe(`${base}/72x72/1f441-200d-1f5e8.png`);
	});

	test("a message's inline emojis draw from the PNGs, a large one from its SVG", () => {
		expect(renderEmoji("hi 😀")).toContain(`src="${base}/72x72/1f600.png"`);
		expect(renderEmoji("😀", true)).toContain(`src="${base}/svg/1f600.svg"`);
	});
});
