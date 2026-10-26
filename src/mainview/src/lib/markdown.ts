import { renderEmoji } from "./emoji";
import { createHighlighter, type Highlighter } from "shiki";
import { getHostURL } from "$lib/common/common";

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

const emojiHost = getHostURL();

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
let currentThemeName = DEFAULT_THEME;

function getHighlighter(): Promise<Highlighter> {
	if (!highlighterPromise) {
		highlighterPromise = createHighlighter({
			themes: [DEFAULT_THEME],
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

function applyInline(
	s: string,
	large: boolean,
	mentionMap?: Record<string, string>,
	customEmojiMap?: CustomEmojiMap,
	roomNames?: Record<string, string>,
): string {
	s = s.replace(/\*\*\*(.+?)\*\*\*/gs, (_, t) => `<strong><em>${t}</em></strong>`);
	s = s.replace(/\*\*(.+?)\*\*/gs, (_, t) => `<strong>${t}</strong>`);
	s = s.replace(/\*([^\s*](?:[^*]*[^\s*])?)\*/gs, (_, t) => `<em>${t}</em>`);
	s = s.replace(/__(.+?)__/gs, (_, t) => `<u>${t}</u>`);
	s = s.replace(/(?<!\w)_([^\s_](?:[^_]*[^\s_])?)_(?!\w)/gs, (_, t) => `<em>${t}</em>`);
	s = s.replace(/~~(.+?)~~/gs, (_, t) => `<del>${t}</del>`);
	s = s.replace(/\|\|(.+?)\|\|/gs, (_, t) => `<span class="msg-spoiler">${t}</span>`);
	// Resolve <@id> mentions to @username
	s = s.replace(/&lt;@([a-f0-9-]+)&gt;/g, (_, id) => {
		const name = mentionMap?.[id] ?? id.slice(0, 8);
		return `<span class="msg-mention">@${escapeHtml(name)}</span>`;
	});
	// Resolve <:id:> custom emojis to inline images
	const ceCls = large ? "emoji-img emoji-large custom-emoji" : "emoji-img custom-emoji";
	const ceDelCls = large ? "emoji-deleted emoji-deleted-large" : "emoji-deleted";
	s = s.replace(/&lt;:([a-f0-9-]+):&gt;/g, (full, id) => {
		const ce = customEmojiMap?.[id];
		if (!ce) return `<span class="${ceDelCls}" title="Emoji deleted">💩</span>`;
		return `<img class="${ceCls}" src="${emojiHost}/attachments/${ce.attachment_id}" alt="${escapeHtml(ce.name)}" title=":${escapeHtml(ce.name)}:" draggable="false" loading="lazy" onerror="var r=+(this.dataset.r||0);if(r<10){this.dataset.r=r+1;this.src=this.src.split('?')[0]+'?r='+Date.now()}else{this.replaceWith(Object.assign(document.createElement('span'),{title:'Emoji failed to load',textContent:this.title}))}">`;
	});
	// Resolve <#id> room mentions to #name, for the rooms the reader can view (roomNames). Any other one, or one that's
	// gone, reads #unknown, with no room to open. Last, so that no rule above reads a room's name as markdown.
	s = s.replace(/&lt;#([a-f0-9-]+)&gt;/g, (_, id: string) => {
		const name = roomNames?.[id];
		if (name === undefined) return `<span class="msg-room-mention msg-room-unknown">#unknown</span>`;
		return `<span class="msg-room-mention" data-room-id="${id}">#${escapeHtml(name)}</span>`;
	});
	return s;
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
			theme: currentThemeName,
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

export function renderMarkdown(
	input: string,
	large = false,
	mentionMap?: Record<string, string>,
	customEmojiMap?: CustomEmojiMap,
	roomNames?: Record<string, string>,
): string {
	return render(withoutMarks(input), large, mentionMap, customEmojiMap, roomNames);
}

function render(
	input: string,
	large: boolean,
	mentionMap?: Record<string, string>,
	customEmojiMap?: CustomEmojiMap,
	roomNames?: Record<string, string>,
): string {
	// ── 1. Extract fenced code blocks ─────────────────────────────────────────
	const codeBlocks: string[] = [];
	let s = input.replace(/```([\w+#-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
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
	s = s.replace(/`([^`\n\x00\x01]+)`/g, (_, code) => {
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
	s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\x00\x01\n]+)\)/g, (_, text: string, url: string) => {
		links.push(
			`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="msg-link">${inline(text)}</a>`,
		);
		return `\x00L${links.length - 1}\x01`;
	});

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
	for (let i = 0; i < out.length; i++) {
		result += out[i];
		if (i < out.length - 1) {
			const currIsBlock = isBlockHtml(out[i]) || /^\x00B\d+\x01$/.test(out[i].trim());
			const nextIsBlock = isBlockHtml(out[i + 1]) || /^\x00B\d+\x01$/.test(out[i + 1].trim());
			if (!currIsBlock && !nextIsBlock) {
				result += "<br>";
			}
		}
	}

	// ── 6. Restore placeholders ────────────────────────────────────────────────
	// Links first: their text can hold a code's placeholder.
	result = result.replace(/\x00L(\d+)\x01/g, (_, n) => links[+n]);
	result = result.replace(/\x00B(\d+)\x01/g, (_, i) => codeBlocks[+i]);
	result = result.replace(/\x00I(\d+)\x01/g, (_, i) => inlineCodes[+i]);

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

/** Splits a message's text into its bare links (http(s) and duvet://) and the text between them, for renderMarkdown. */
export function parseTextSegments(text: string) {
	const segments: { type: "text" | "link"; content: string }[] = [];
	const bareUrlRegex = /(?<!\]\()(?:https?|duvet):\/\/[^\s)]+(?:\)[^\s)]*)*|(?<=\s|^)(?:https?|duvet):\/\/[^\s]+/g;
	let lastIndex = 0;
	let match;
	while ((match = bareUrlRegex.exec(text)) !== null) {
		if (match.index > lastIndex) {
			segments.push({ type: "text", content: text.slice(lastIndex, match.index) });
		}
		segments.push({ type: "link", content: match[0] });
		lastIndex = bareUrlRegex.lastIndex;
	}
	if (lastIndex < text.length) {
		segments.push({ type: "text", content: text.slice(lastIndex) });
	}
	return segments;
}
