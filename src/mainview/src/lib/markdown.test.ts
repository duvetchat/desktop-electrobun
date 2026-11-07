import { describe, expect, test } from "bun:test";
import { isUuid } from "$lib/common/common";
import { renderEmoji, toTwemojiUrl } from "$lib/emoji";
import { clickedMention, mentionNamesIn, renderMarkdown, renderMarkdownLine } from "$lib/markdown";

// The value of the first href in html: what's between its quotes.
const hrefOf = (html: string) => /href="([^"]*)"/.exec(html)?.[1];

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
		for (const between of ["B0", "I0", "I5", "L0", "L5", "P0"]) {
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

// The text holds only a custom emoji's ID, so one that's gone (or of a space the reader isn't in) has no name to show.
describe("a custom emoji with no name to show", () => {
	const GONE = "0190a3b2-0000-7000-8000-0000000000e2";

	test("reads :emoji:, as text", () => {
		expect(renderMarkdown(`Before <:${GONE}:> after`)).toBe("Before :emoji: after");
		expect(renderMarkdownLine(`Before <:${GONE}:> after`)).toBe("Before :emoji: after");
	});

	test("reads the same alone, where a live one would be large", () => {
		expect(renderMarkdown(`<:${GONE}:>`, true)).toBe(":emoji:");
	});

	test("a live one beside it is still its image", () => {
		const emojis = { "0190a3b2-0000-7000-8000-0000000000e3": { name: "party", attachment_id: "file" } };
		const html = renderMarkdown(`<:${GONE}:> <:0190a3b2-0000-7000-8000-0000000000e3:>`, false, undefined, emojis);
		expect(html).toStartWith(":emoji: <img ");
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
	const PIECES = [
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
		"B0",
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
		button: new Set(["class", "data-code", "title", "aria-label"]),
		svg: new Set([
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
	const twemoji = toTwemojiUrl("😀").replace(/[^/]+$/, "");

	function violation(tag: string, attributes: Iterable<[string, string]>): string | null {
		if (!TAGS.has(tag)) return `<${tag}>`;
		const allowed = ATTRIBUTES[tag] ?? new Set(["class"]);
		for (const [name, value] of attributes) {
			if (!allowed.has(name)) return `${name} on <${tag}>`;
			if (name === "href" && !/^https?:\/\//.test(value)) return `href ${value}`;
			if (name === "src" && !value.startsWith(twemoji) && !value.startsWith("https://api.test/attachments/"))
				return `src ${value}`;
			if (
				name === "style" &&
				!/^(text-align:(left|right|center)|[a-z-]+:[#\w .,()%-]+(;[a-z-]+:[#\w .,()%-]+)*;?)$/.test(value)
			)
				return `style ${value}`;
			if (name === "data-room-id" && !/^[a-f0-9-]+$/.test(value)) return `data-room-id ${value}`;
			if (name === "data-user-id" && !isUuid(value)) return `data-user-id ${value}`;
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
