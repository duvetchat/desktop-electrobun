import { describe, expect, test } from "bun:test";
import { renderEmoji, toTwemojiUrl } from "$lib/emoji";

// markdown.ts reads the API's host as it loads, from constants Vite defines at build time.
Object.assign(globalThis, { VITE_API_URL: "https://api.test", VITE_WS_URL: "", VITE_DOMAIN_TARGET_ENV: "duvet" });
const { renderMarkdown, renderMarkdownLine } = await import("$lib/markdown");

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

	test("a URL with code, a mention or an emoji in it isn't a link: their HTML would end up in the href", () => {
		for (const text of [
			"[x](https://a.example/`code`)",
			"[x](https://a.example/<@0190a3b2-0000-7000-8000-000000000001>)",
			"[x](https://a.example/😀)",
		]) {
			expect(renderMarkdown(text)).not.toContain("href=");
		}
	});

	test("a plain link keeps its URL", () => {
		expect(hrefOf(renderMarkdown("[docs](https://duvet.chat/a?b=1&c=2)"))).toBe("https://duvet.chat/a?b=1&amp;c=2");
	});
});

describe("a message's own \\x00 can't pass for a placeholder", () => {
	test("a reply's quote of it doesn't throw", () => {
		expect(renderMarkdownLine("\x00P9\x00")).toBe("P9");
	});

	test("it brings in no code's HTML, nor undefined", () => {
		expect(renderMarkdown("`a` \x00I0\x00")).toBe('<code class="msg-inline-code">a</code> I0');
		expect(renderMarkdown("\x00B9\x00 \x00I9\x00")).toBe("B9 I9");
	});
});

// Random text made of the pieces of markdown, HTML, URLs, mentions, emojis and placeholders, rendered both ways
// and read back with an HTML5 tokenizer (HTMLRewriter): every tag and attribute must be one the renderer means to
// write, every href http(s), every src an emoji's. The names in the maps are hostile, as a member's can be.
describe("the HTML it makes", () => {
	const ID1 = "0190a3b2-0000-7000-8000-000000000001";
	const ID2 = "0190a3b2-0000-7000-8000-000000000002";
	const mentionMap = { [ID1]: `"><img src=x onerror=alert(1)>'&<b>` };
	const customEmojiMap = {
		[ID2]: { name: `x"><script>alert(1)</script>'`, attachment_id: "0190a3b2-0000-7000-8000-0000000000aa" },
	};
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
		"<@abc>",
		"<:abc:>",
		"<@",
		"<:",
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
		img: new Set(["class", "src", "alt", "title", "draggable", "loading", "onerror"]),
		span: new Set(["class", "title", "style"]),
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
	// A custom emoji's image retries its load, then turns into its name: the one handler the renderer writes.
	const RETRY =
		"var r=+(this.dataset.r||0);if(r<10){this.dataset.r=r+1;this.src=this.src.split('?')[0]+'?r='+Date.now()}else{this.replaceWith(Object.assign(document.createElement('span'),{title:'Emoji failed to load',textContent:this.title}))}";
	const twemoji = toTwemojiUrl("😀").replace(/[^/]+$/, "");

	function violation(tag: string, attributes: Iterable<[string, string]>): string | null {
		if (!TAGS.has(tag)) return `<${tag}>`;
		const allowed = ATTRIBUTES[tag] ?? new Set(["class"]);
		for (const [name, value] of attributes) {
			if (!allowed.has(name)) return `${name} on <${tag}>`;
			if (name === "onerror" && value !== RETRY) return `onerror ${value}`;
			if (name === "href" && !/^https?:\/\//.test(value)) return `href ${value}`;
			if (name === "src" && !value.startsWith(twemoji) && !value.startsWith("https://api.test/attachments/"))
				return `src ${value}`;
			if (
				name === "style" &&
				!/^(text-align:(left|right|center)|[a-z-]+:[#\w .,()%-]+(;[a-z-]+:[#\w .,()%-]+)*;?)$/.test(value)
			)
				return `style ${value}`;
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
				renderMarkdown(text, random() < 0.2, mentionMap, customEmojiMap),
				renderMarkdownLine(text, mentionMap, customEmojiMap),
			]) {
				const problem = await inspect(html);
				if (problem) found.push(`${problem} from ${JSON.stringify(text)}`);
			}
		}
		expect(found).toEqual([]);
	});
});
