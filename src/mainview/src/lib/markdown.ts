import { renderEmoji } from "./emoji";
import { createHighlighter, type Highlighter } from "shiki";
import { getHostURL, isUuid } from "$lib/common/common";
import { CUSTOM_EMOJI_CLASS, retryEmojis } from "$lib/emoji-retry";
import { cardLink, parseDuvetLink, type DuvetLink } from "$lib/urls";

export interface CustomEmojiMap {
	[id: string]: { name: string; attachment_id: string };
}

/** A space's custom emojis by ID, as renderMarkdown takes them. */
export function customEmojiMapOf(emojis: { id: string; name: string; attachment_id: string }[]): CustomEmojiMap {
	const map: CustomEmojiMap = {};
	for (const e of emojis) map[e.id] = { name: e.name, attachment_id: e.attachment_id };
	return map;
}

/** The name a mention of each member shows, by user ID, as renderMarkdown takes them. */
export function mentionMapOf(
	members: { id: string; username: string; raw_username: string }[],
): Record<string, string> {
	const map: Record<string, string> = {};
	for (const m of members) map[m.id] = m.username || m.raw_username;
	return map;
}

/**
 * The name a mention shows of each of those people that text mentions, by user ID, as renderMarkdown takes them, where
 * no list of members goes with the text. The first of them with an ID goes.
 */
export function mentionNamesIn(
	text: string,
	people: { id: string; username: string; alias?: string | null }[],
): Record<string, string> {
	const mentioned = new Set([...text.matchAll(/<@([a-f0-9-]+)>/g)].map((m) => m[1]));
	const map: Record<string, string> = {};
	for (const p of people) if (mentioned.has(p.id)) map[p.id] ??= p.alias ?? p.username;
	return map;
}

const emojiHost = getHostURL();
// A custom emoji's image that fails to load is tried again after a wait, by the document (lib/emoji-retry.ts): the
// image carries no handler of its own, so the page needs no inline script. A hot update of this module, in
// development, runs it again: the old listener goes first. (Not import.meta.hot?.dispose(retryEmojis(document)):
// without import.meta.hot, a build's, the call and its argument wouldn't run.)
if (typeof document !== "undefined") {
	const stopRetrying = retryEmojis(document);
	import.meta.hot?.dispose(stopRetrying);
}

let highlighterPromise: Promise<Highlighter> | null = null;
let highlighter: Highlighter | null = null;

const LANGS = [
	"javascript",
	"typescript",
	"python",
	"go",
	"rust",
	"cpp",
	"c",
	"csharp",
	"java",
	"json",
	"xml",
	"html",
	"css",
	"bash",
	"sql",
	"markdown",
	"yaml",
	"toml",
	"kotlin",
	"swift",
	"ruby",
	"php",
	"svelte",
	"jsx",
	"tsx",
	"lua",
	"zig",
	"dockerfile",
	"graphql",
] as const;

const DEFAULT_THEME = "github-dark-default";
// The light theme's: code blocks carry both themes' colors, and app.css shows the one of the theme the app is in. A
// custom theme (Appearance) replaces the dark one.
const LIGHT_THEME = "github-light-default";
let currentThemeName = DEFAULT_THEME;

function getHighlighter(): Promise<Highlighter> {
	if (!highlighterPromise) {
		highlighterPromise = createHighlighter({
			themes: [DEFAULT_THEME, LIGHT_THEME],
			langs: [...LANGS],
		}).then((h) => {
			highlighter = h;
			return h;
		});
	}
	return highlighterPromise;
}

// Eagerly init on module load
getHighlighter();

function stripJsonc(text: string): string {
	// Remove single-line comments (// ...) and multi-line comments (/* ... */)
	// but not inside strings
	let result = "";
	let i = 0;
	while (i < text.length) {
		if (text[i] === '"') {
			const start = i;
			i++;
			while (i < text.length && text[i] !== '"') {
				if (text[i] === "\\") i++;
				i++;
			}
			i++;
			result += text.slice(start, i);
		} else if (text[i] === "/" && text[i + 1] === "/") {
			while (i < text.length && text[i] !== "\n") i++;
		} else if (text[i] === "/" && text[i + 1] === "*") {
			i += 2;
			while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
			i += 2;
		} else {
			result += text[i];
			i++;
		}
	}
	// Remove trailing commas before } or ]
	return result.replace(/,\s*([}\]])/g, "$1");
}

export async function loadCustomTheme(url: string): Promise<void> {
	const h = await getHighlighter();
	try {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const raw = await res.text();
		const themeData = JSON.parse(stripJsonc(raw));
		const name = themeData.name || "custom-theme";
		await h.loadTheme(themeData);
		currentThemeName = name;
		if (typeof window !== "undefined") localStorage.setItem("duvet.code_theme_url", url);
	} catch (e) {
		console.error("[Shiki] Failed to load custom theme:", e);
		throw e;
	}
}

export async function resetTheme(): Promise<void> {
	currentThemeName = DEFAULT_THEME;
	if (typeof window !== "undefined") localStorage.removeItem("duvet.code_theme_url");
}

export function getThemeUrl(): string {
	if (typeof localStorage === "undefined") return "";
	return localStorage.getItem("duvet.code_theme_url") ?? "";
}

// Auto-load saved custom theme on init
if (typeof window !== "undefined") {
	const savedThemeUrl = localStorage.getItem("duvet.code_theme_url");
	if (savedThemeUrl) loadCustomTheme(savedThemeUrl).catch(() => {});
}

const LANG_ALIASES: Record<string, string> = {
	js: "javascript",
	ts: "typescript",
	py: "python",
	rs: "rust",
	"c++": "cpp",
	cs: "csharp",
	"c#": "csharp",
	sh: "bash",
	shell: "bash",
	yml: "yaml",
	md: "markdown",
	kt: "kotlin",
	rb: "ruby",
};

export function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function isBlockHtml(s: string): boolean {
	return /^<(h[123]|blockquote|pre|ul|ol|table)[\s>]/.test(s);
}

// ── List regex ──────────────────────────────────────────────────────────────
const UL_RE = /^(\s*)[-*]\s+(.*)/;
const OL_RE = /^(\s*)\d+[.)]\s+(.*)/;

function parseList(
	lines: string[],
	startIdx: number,
	inline: (s: string) => string,
): { html: string; consumed: number } {
	const items: string[] = [];
	const firstMatch = UL_RE.exec(lines[startIdx]) ?? OL_RE.exec(lines[startIdx]);
	if (!firstMatch) return { html: "", consumed: 0 };
	const ordered = OL_RE.test(lines[startIdx]);
	let i = startIdx;
	const re = ordered ? OL_RE : UL_RE;
	while (i < lines.length) {
		const m = re.exec(lines[i]);
		if (!m) break;
		items.push(inline(m[2]));
		i++;
	}
	const tag = ordered ? "ol" : "ul";
	const cls = ordered ? "msg-ol" : "msg-ul";
	const html = `<${tag} class="${cls}">${items.map((it) => `<li>${it}</li>`).join("")}</${tag}>`;
	return { html, consumed: i - startIdx };
}

// ── Table regex ─────────────────────────────────────────────────────────────
function parseTable(
	lines: string[],
	startIdx: number,
	inline: (s: string) => string,
): { html: string; consumed: number } {
	// Need at least header + separator + 1 row
	if (startIdx + 2 > lines.length) return { html: "", consumed: 0 };
	const headerLine = lines[startIdx];
	const sepLine = lines[startIdx + 1];
	if (!headerLine.includes("|") || !sepLine.includes("|")) return { html: "", consumed: 0 };
	// Separator must be like |---|---|
	if (!/^[\s|:-]+$/.test(sepLine)) return { html: "", consumed: 0 };

	function parseCells(line: string): string[] {
		return line
			.replace(/^\||\|$/g, "")
			.split("|")
			.map((c) => c.trim());
	}

	const headers = parseCells(headerLine);
	// Parse alignment from separator
	const sepCells = parseCells(sepLine);
	const aligns: ("left" | "center" | "right" | "")[] = sepCells.map((c) => {
		const left = c.startsWith(":");
		const right = c.endsWith(":");
		if (left && right) return "center";
		if (right) return "right";
		if (left) return "left";
		return "";
	});

	const rows: string[][] = [];
	let i = startIdx + 2;
	while (i < lines.length && lines[i].includes("|")) {
		rows.push(parseCells(lines[i]));
		i++;
	}

	const alignAttr = (idx: number) => (aligns[idx] ? ` style="text-align:${aligns[idx]}"` : "");
	const thead = `<thead><tr>${headers.map((h, idx) => `<th${alignAttr(idx)}>${inline(h)}</th>`).join("")}</tr></thead>`;
	const tbody = rows.length
		? `<tbody>${rows.map((row) => `<tr>${row.map((c, idx) => `<td${alignAttr(idx)}>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody>`
		: "";
	return { html: `<table class="msg-table">${thead}${tbody}</table>`, consumed: i - startIdx };
}

// The inline rules of emphasis and spoilers, in the order they're read: each pair of markers, and the tags it becomes.
const EMPHASIS: [RegExp, string, string][] = [
	[/\*\*\*(.+?)\*\*\*/gs, "<strong><em>", "</em></strong>"],
	[/\*\*(.+?)\*\*/gs, "<strong>", "</strong>"],
	[/\*([^\s*](?:[^*]*[^\s*])?)\*/gs, "<em>", "</em>"],
	[/__(.+?)__/gs, "<u>", "</u>"],
	[/(?<!\w)_([^\s_](?:[^_]*[^\s_])?)_(?!\w)/gs, "<em>", "</em>"],
	[/~~(.+?)~~/gs, "<del>", "</del>"],
	[/\|\|(.+?)\|\|/gs, '<span class="msg-spoiler">', "</span>"],
];

const emphasized = (s: string) =>
	EMPHASIS.reduce((text, [rule, open, close]) => text.replace(rule, (_, inner) => `${open}${inner}${close}`), s);

function applyInline(
	s: string,
	large: boolean,
	mentionMap?: Record<string, string>,
	customEmojiMap?: CustomEmojiMap,
	roomNames?: Record<string, string>,
): string {
	s = emphasized(s);
	const ceCls = large ? `emoji-img emoji-large ${CUSTOM_EMOJI_CLASS}` : `emoji-img ${CUSTOM_EMOJI_CLASS}`;
	// Mentions, custom emojis and rooms' mentions, last, so that no rule above reads their names as markdown, and in one
	// pass, as a name can hold any of the three, which a later pass would read in what the pass before it wrote.
	return s.replace(
		/&lt;(?:@([a-f0-9-]+)|:([a-f0-9-]+):|#([a-f0-9-]+))&gt;/g,
		(_, userId: string | undefined, emojiId: string | undefined, roomId: string | undefined) => {
			// <@id> reads @username. One of someone the map knows carries their ID, to open their profile (clickedMention); any
			// other one, of someone who left or isn't loaded, is only a name, as their name on a message is.
			if (userId !== undefined) {
				const name = mentionMap?.[userId];
				const user = name !== undefined && isUuid(userId) ? ` data-user-id="${userId}"` : "";
				return `<span class="msg-mention"${user}>@${escapeHtml(name ?? userId.slice(0, 8))}</span>`;
			}
			// <:id:> is an inline image. The text holds only its ID, so one that's gone, or of a space the reader isn't in,
			// has no name to show.
			if (emojiId !== undefined) {
				const ce = customEmojiMap?.[emojiId];
				if (!ce) return ":emoji:";
				return `<img class="${ceCls}" src="${emojiHost}/attachments/${ce.attachment_id}" alt="${escapeHtml(ce.name)}" title=":${escapeHtml(ce.name)}:" draggable="false" loading="lazy">`;
			}
			// <#id> reads #name, for the rooms the reader can view (roomNames). Any other one, or one that's gone, reads
			// #unknown, with no room to open.
			const name = roomNames?.[roomId ?? ""];
			if (name === undefined) return `<span class="msg-room-mention msg-room-unknown">#unknown</span>`;
			return `<span class="msg-room-mention" data-room-id="${roomId}">#${escapeHtml(name)}</span>`;
		},
	);
}

function highlightCode(code: string, lang: string): string {
	const resolved = LANG_ALIASES[lang] ?? lang;
	if (!highlighter) {
		return escapeHtml(code);
	}
	try {
		const loaded = highlighter.getLoadedLanguages();
		if (!loaded.includes(resolved)) {
			return escapeHtml(code);
		}
		const html = highlighter.codeToHtml(code, {
			lang: resolved,
			themes: { dark: currentThemeName, light: LIGHT_THEME },
			defaultColor: false,
		});
		// shiki returns <pre class="shiki ..."><code>...</code></pre>
		// Extract just the inner content of <code>
		const match = html.match(/<code[^>]*>([\s\S]*)<\/code>/);
		return match ? match[1] : escapeHtml(code);
	} catch {
		return escapeHtml(code);
	}
}

// The renderer marks the code and links it takes out with placeholders that open with \x00 and close with \x01, so
// the text it renders has neither of its own: one would pass for a placeholder's edge and put another code's or
// link's HTML where it stands, or "undefined". As the two edges differ, text between two placeholders ("`a`L0`b`")
// can't read as a third.
const withoutMarks = (text: string) => text.replace(/[\x00\x01]/g, "");

// What the renderer takes out of a text before anything else, in this order: code blocks, inline code (never across a
// block's placeholder), and markdown links, [text](url), whose URL holds no code.
const CODE_BLOCK = /```([\w+#-]*)\n?([\s\S]*?)```/g;
const INLINE_CODE = /`([^`\n\x00\x01]+)`/g;
const MARKDOWN_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^)\x00\x01\n]+)\)/g;

// The text with what the renderer takes out first (code and markdown links) filled with \x00, a character for each, so
// that a place in it is the same place in the text.
function masked(text: string): string {
	const fill = (taken: string) => "\x00".repeat(taken.length);
	return text.replace(CODE_BLOCK, fill).replace(INLINE_CODE, fill).replace(MARKDOWN_LINK, fill);
}

// A bare link, as the mobile app reads one (its lib/data/markdown.dart): up to a space, a < or a >, with a (…) in it
// only whole, as in Wikipedia's Foo_(bar), so that a ) closing a ( opened before the link is the text's; and without the
// .,;:!? or ]}"' at its end, the punctuation of the sentence around it. Not right after "](", where a markdown link that
// isn't one (its URL holds code) leaves its URL as text, and never across \x00 or \x01, what the renderer took out.
const BARE_LINK =
	/(?<!\]\()(?:https?|duvet):\/\/(?:[^\s<>()\x00\x01]|\([^\s<>()\x00\x01]*\))*(?:[^\s<>.,;:!?()\]}"'\x00\x01]|\([^\s<>()\x00\x01]*\))/g;

const WHOLE_LINK = new RegExp(`^${BARE_LINK.source}$`);

// Where the bare links of text are, as [start, end] pairs, in order. text has what the renderer takes out first filled
// in, or in its placeholders. A link can end with markers of emphasis or a spoiler (* _ ~ |) that close what its line
// opened before it, right before it ("**https://a.example/x**") or further back ("**see https://a.example/x**",
// "||https://a.example/x||"): it ends before as many of them as the inline rules read as closing tags right after it,
// trying the most first, and those are the text's. A URL's own * or _, which nothing before it opens, stays its own,
// and so do markers whose link would then end as no link does (with a . or a ', say). The inline rules read every link
// as one character, out of their way.
function linkSpans(text: string): [number, number][] {
	const spans = [...text.matchAll(BARE_LINK)].map((m): [number, number] => [m.index, m.index + m[0].length]);
	// text from from to to, with the links in it, as far as they're decided, out of the inline rules' way, and with no
	// \x02 of its own, the mark of the link being decided.
	const read = (from: number, to: number) => {
		let out = "";
		let at = from;
		for (const [start, end] of spans) {
			if (end <= at || start >= to) continue;
			out += `${text.slice(at, Math.max(start, at))}\x00`;
			at = Math.min(end, to);
		}
		return (out + text.slice(at, to)).replace(/\x02/g, "\x00");
	};
	spans.forEach(([start, end], i) => {
		const lineStart = text.lastIndexOf("\n", start - 1) + 1;
		const nextLine = text.indexOf("\n", end);
		const lineEnd = nextLine < 0 ? text.length : nextLine;
		const link = text.slice(start, end);
		const markers = /[*_~|]*$/.exec(link)?.[0] ?? "";
		for (let n = markers.length; n > 0; n--) {
			if (!WHOLE_LINK.test(link.slice(0, -n))) continue;
			const tried = emphasized(`${read(lineStart, start)}\x02${link.slice(-n)}${read(end, lineEnd)}`);
			if (/\x02(?:<\/[a-z]+>)+(?![*_~|])/.test(tried)) {
				spans[i] = [start, end - n];
				return;
			}
		}
	});
	return spans;
}

/**
 * How renderMarkdown draws a text's bare links, which are text without it: an http(s) one as a link, and a duvet:// one,
 * which nothing here opens, as text. With duvet, Duvet's own links on duvet.chat or ownOrigin's host (parseDuvetLink,
 * read as cardLink reads them, as the cards under the text are) are drawn as MessageText takes their clicks: a message's
 * as a chip of its room, which names its space (spaceName), and an invite's as a button.
 */
export interface LinkDrawing {
	duvet?: { ownOrigin: string; spaceName: (spaceId: string) => string | undefined };
}

function linkHtml(url: string, drawing: LinkDrawing, roomNames?: Record<string, string>): string {
	const own = drawing.duvet;
	const card = own ? cardLink(url) : "";
	const duvet = own ? parseDuvetLink(card, own.ownOrigin) : null;
	// What follows the card's link in the bare link is text, as the card reads the link without it.
	if (own && duvet) return duvetLinkHtml(duvet, card, own.spaceName, roomNames) + escapeHtml(url.slice(card.length));
	if (!/^https?:\/\//.test(url)) return escapeHtml(url);
	return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="msg-bare-link text-stone-300 hover:underline">${escapeHtml(url)}</a>`;
}

// One of Duvet's own links: a message's as a chip of its room, an invite's as a button with the link. What it opens is
// in its data, which MessageText reads; the IDs are UUIDs (parseDuvetLink), and an invite's code is escaped.
function duvetLinkHtml(
	link: DuvetLink,
	text: string,
	spaceName: (spaceId: string) => string | undefined,
	roomNames?: Record<string, string>,
): string {
	if ("message" in link) {
		const { spaceId, roomId, messageId, conversationId } = link.message;
		const room = conversationId ? "Direct Message" : (roomNames?.[roomId] ?? "unknown");
		const space = conversationId ? "" : (spaceName(spaceId) ?? "Unknown Space");
		const data = conversationId
			? `data-conversation="${conversationId}" data-message="${messageId}"`
			: `data-space="${spaceId}" data-room="${roomId}" data-message="${messageId}"`;
		return `<button type="button" class="msg-duvet-link mx-0.5 inline-flex cursor-pointer items-center gap-1 rounded border border-zinc-600/50 bg-zinc-700/70 px-1.5 py-0.5 align-middle text-zinc-300 transition-colors hover:bg-zinc-600/80 hover:text-white" ${data} title="${escapeHtml(`${space} › #${room}`)}"><span class="text-xs text-zinc-400">#</span><span class="text-xs font-medium">${escapeHtml(room)}</span><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-zinc-400"><path d="m9 18 6-6-6-6"/></svg></button>`;
	}
	const data = "bot" in link ? `data-bot="${link.bot}"` : `data-invite="${escapeHtml(link.code)}"`;
	return `<button type="button" class="msg-duvet-link cursor-pointer text-stone-300 hover:underline" ${data}>${escapeHtml(text)}</button>`;
}

/**
 * A text's markdown as HTML. With links, its bare links too (LinkDrawing), read with the rest of the text: emphasis
 * around one wraps it, and the text after one goes on its line.
 */
export function renderMarkdown(
	input: string,
	large = false,
	mentionMap?: Record<string, string>,
	customEmojiMap?: CustomEmojiMap,
	roomNames?: Record<string, string>,
	links?: LinkDrawing,
): string {
	return render(withoutMarks(input), large, mentionMap, customEmojiMap, roomNames, links);
}

function render(
	input: string,
	large: boolean,
	mentionMap?: Record<string, string>,
	customEmojiMap?: CustomEmojiMap,
	roomNames?: Record<string, string>,
	drawing?: LinkDrawing,
): string {
	// ── 1. Extract fenced code blocks ─────────────────────────────────────────
	const codeBlocks: string[] = [];
	let s = input.replace(CODE_BLOCK, (_, lang, code) => {
		const trimmed = code.replace(/\n$/, "");
		const highlighted = highlightCode(trimmed, lang);
		const lines = highlighted.split("\n");
		const linesHtml = lines
			.map((line, i) => `<span class="msg-ln">${i + 1}</span><span class="msg-lc">${line || "\u200b"}</span>`)
			.join("\n");
		const langLabel = lang ? lang.toLowerCase() : "";
		const langBadge = langLabel ? `<span class="msg-code-lang">${escapeHtml(langLabel)}</span>` : "";
		const escaped = escapeHtml(trimmed).replace(/"/g, "&quot;");
		const copyBtn = `<button class="msg-code-copy" data-code="${escaped}" title="Copy code" aria-label="Copy code"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button>`;
		codeBlocks.push(`<pre class="msg-code-block">${langBadge}${copyBtn}<code>${linesHtml}</code></pre>`);
		return `\x00B${codeBlocks.length - 1}\x01`;
	});

	// ── 2. Extract inline code ─────────────────────────────────────────────────
	// Never across a placeholder (a code block's, or a reply quote's): it would come back inside this code, whole.
	const inlineCodes: string[] = [];
	s = s.replace(INLINE_CODE, (_, code) => {
		inlineCodes.push(`<code class="msg-inline-code">${escapeHtml(code)}</code>`);
		return `\x00I${inlineCodes.length - 1}\x01`;
	});

	const inline = (t: string) => applyInline(renderEmoji(t), false, mentionMap, customEmojiMap, roomNames);

	// ── 3. Extract links ───────────────────────────────────────────────────────
	// Markdown links [text](url), taken out before the inline rules as code is, so that the URL stays as it was
	// written: those rules would turn a *, _, ~~, || or < in it into HTML. It goes into the href escaped, quotes
	// included (one would end the href and start an attribute of the URL's own), and only as http(s). It can't
	// hold a code's placeholder (\x00…\x01): the code's HTML would land in the href. The text is rendered as any.
	const links: string[] = [];
	s = s.replace(MARKDOWN_LINK, (_, text: string, url: string) => {
		links.push(
			`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="msg-link">${inline(text)}</a>`,
		);
		return `\x00L${links.length - 1}\x01`;
	});

	// ── 3½. Extract bare links, when they're drawn ──────────────────────────────
	// After code and markdown links, so neither holds one, and before the lines and the inline rules, which then read
	// the text around a link as one: emphasis wraps the link, and what follows it goes on its line.
	const bare: string[] = [];
	if (drawing) {
		let taken = "";
		let at = 0;
		for (const [start, end] of linkSpans(s)) {
			taken += `${s.slice(at, start)}\x00U${bare.length}\x01`;
			bare.push(linkHtml(s.slice(start, end), drawing, roomNames));
			at = end;
		}
		s = taken + s.slice(at);
	}

	// ── 4. Process line by line for block elements ─────────────────────────────
	const lines = s.split("\n");
	const out: string[] = [];

	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		let m: RegExpExecArray | null;

		// Lists
		if (UL_RE.test(line) || OL_RE.test(line)) {
			const { html, consumed } = parseList(lines, i, inline);
			if (consumed > 0) {
				out.push(html);
				i += consumed;
				continue;
			}
		}

		// Tables
		if (line.includes("|") && i + 1 < lines.length && lines[i + 1].includes("|")) {
			const { html, consumed } = parseTable(lines, i, inline);
			if (consumed > 0) {
				out.push(html);
				i += consumed;
				continue;
			}
		}

		if ((m = /^### (.*)/.exec(line))) out.push(`<h3 class="msg-h3">${inline(m[1])}</h3>`);
		else if ((m = /^## (.*)/.exec(line))) out.push(`<h2 class="msg-h2">${inline(m[1])}</h2>`);
		else if ((m = /^# (.*)/.exec(line))) out.push(`<h1 class="msg-h1">${inline(m[1])}</h1>`);
		else if ((m = /^-# (.*)/.exec(line))) out.push(`<span class="msg-subtext">${inline(m[1])}</span>`);
		else if ((m = /^>>> (.*)/.exec(line))) out.push(`<blockquote class="msg-blockquote">${inline(m[1])}</blockquote>`);
		else if ((m = /^> (.*)/.exec(line))) out.push(`<blockquote class="msg-blockquote">${inline(m[1])}</blockquote>`);
		else out.push(applyInline(renderEmoji(line, large), large, mentionMap, customEmojiMap, roomNames));

		i++;
	}

	// ── 5. Join with <br> except around block elements ─────────────────────────
	let result = "";
	for (let j = 0; j < out.length; j++) {
		result += out[j];
		if (j < out.length - 1) {
			const currIsBlock = isBlockHtml(out[j]) || /^\x00B\d+\x01$/.test(out[j].trim());
			const nextIsBlock = isBlockHtml(out[j + 1]) || /^\x00B\d+\x01$/.test(out[j + 1].trim());
			if (!currIsBlock && !nextIsBlock) {
				result += "<br>";
			}
		}
	}

	// ── 6. Restore placeholders ────────────────────────────────────────────────
	// Links first: their text can hold a code's placeholder.
	result = result.replace(/\x00L(\d+)\x01/g, (_, n) => links[+n]);
	result = result.replace(/\x00B(\d+)\x01/g, (_, n) => codeBlocks[+n]);
	result = result.replace(/\x00I(\d+)\x01/g, (_, n) => inlineCodes[+n]);
	result = result.replace(/\x00U(\d+)\x01/g, (_, n) => bare[+n]);

	return result;
}

// A message on one line, for the quote above a reply or a thread's parent: code blocks become inline
// code, and the block syntax (headings, quotes, lists, line breaks) goes.
export function renderMarkdownLine(
	input: string,
	mentionMap?: Record<string, string>,
	customEmojiMap?: CustomEmojiMap,
	roomNames?: Record<string, string>,
): string {
	const codes: string[] = [];
	const line = withoutMarks(input)
		.replace(/```[\w+#-]*\n?([\s\S]*?)```/g, (_, code: string) => {
			codes.push(code.trim().replace(/\s+/g, " "));
			return `\x00P${codes.length - 1}\x01`;
		})
		.split("\n")
		.map((l) => l.replace(/^(?:#{1,3} |-# |>>> |> |\s*[-*]\s+|\s*\d+[.)]\s+)/, ""))
		.join(" ");
	return render(line, false, mentionMap, customEmojiMap, roomNames).replace(
		/\x00P(\d+)\x01/g,
		(_, i) => `<code class="msg-inline-code">${escapeHtml(codes[+i])}</code>`,
	);
}

/**
 * The mention a click landed on: its chip, which renderMarkdown gives the user's ID, and that ID. One in a link's text is
 * the link's, as the app's external links go by what the click landed in.
 */
export function clickedMention(target: EventTarget | null): { chip: HTMLElement; userId: string } | null {
	if (!(target instanceof Element)) return null;
	const chip = target.closest<HTMLElement>(".msg-mention[data-user-id]");
	const userId = chip?.dataset.userId;
	return chip && userId && !chip.closest("a") ? { chip, userId } : null;
}

/**
 * A text's bare links (http(s) and duvet://, as BARE_LINK reads one), as renderMarkdown draws them, and the text between
 * them, as written. Not in code nor in a markdown link ([text](url)), its text or its URL, which the renderer takes out
 * first: they stay whole in the text around them.
 */
export function parseTextSegments(text: string) {
	const segments: { type: "text" | "link"; content: string }[] = [];
	let at = 0;
	for (const [start, end] of linkSpans(masked(text))) {
		if (start > at) segments.push({ type: "text", content: text.slice(at, start) });
		segments.push({ type: "link", content: text.slice(start, end) });
		at = end;
	}
	if (at < text.length) segments.push({ type: "text", content: text.slice(at) });
	return segments;
}

/**
 * The cards a message's text shows for Duvet's own links (parseDuvetLink), in its order. Its links are found as the API
 * finds the ones it leaves without a preview (mobileLink), and the mobile app its cards' (duvetLinksIn): each up to a
 * space or one of <>()[]"', so one glued after another link by a < or a ) has its card, as it has its button in the text;
 * each read as cardLink reads it, and where the text draws a link from the same place, without the markers of emphasis
 * or a spoiler that end that one (linkSpans), so the card names what the button opens.
 */
export function duvetLinksIn(content: string, ownOrigin: string): DuvetLink[] {
	const drawn = new Map(linkSpans(masked(content)));
	return [...content.matchAll(/(?:https?|duvet):\/\/[^\s<>()[\]"']+/g)].flatMap((m) => {
		const link = cardLink(m[0]);
		const end = drawn.get(m.index);
		const own = end !== undefined && /^[*_~|]+$/.test(link.slice(end - m.index)) ? link.slice(0, end - m.index) : link;
		return parseDuvetLink(own, ownOrigin) ?? [];
	});
}
