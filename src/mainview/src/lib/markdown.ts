import { renderEmoji } from "./emoji";
import { createHighlighter, type Highlighter } from "shiki";
import { getHostURL } from "$lib/common/common";

export interface CustomEmojiMap {
	[id: string]: { name: string; attachment_id: string };
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

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isBlockHtml(s: string): boolean {
	return /^<(h[123]|blockquote|pre)[\s>]/.test(s);
}

function applyInline(
	s: string,
	large: boolean,
	mentionMap?: Record<string, string>,
	customEmojiMap?: CustomEmojiMap,
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
		return `<img class="${ceCls}" src="${emojiHost}/attachments/${ce.attachment_id}" alt="<:${id}:>" title=":${escapeHtml(ce.name)}:" draggable="false" loading="lazy" onerror="var r=+(this.dataset.r||0);if(r<10){this.dataset.r=r+1;this.src=this.src.split('?')[0]+'?r='+Date.now()}else{this.replaceWith(Object.assign(document.createElement('span'),{className:'${ceDelCls}',title:'Emoji deleted',textContent:'💩'}))}">`;
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

export function renderMarkdown(
	input: string,
	large = false,
	mentionMap?: Record<string, string>,
	customEmojiMap?: CustomEmojiMap,
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
		return `\x00B${codeBlocks.length - 1}\x00`;
	});

	// ── 2. Extract inline code ─────────────────────────────────────────────────
	const inlineCodes: string[] = [];
	s = s.replace(/`([^`\n]+)`/g, (_, code) => {
		inlineCodes.push(`<code class="msg-inline-code">${escapeHtml(code)}</code>`);
		return `\x00I${inlineCodes.length - 1}\x00`;
	});

	// ── 3. Process line by line for block elements ─────────────────────────────
	const lines = s.split("\n");
	const out: string[] = lines.map((line) => {
		let m: RegExpExecArray | null;
		if ((m = /^### (.*)/.exec(line)))
			return `<h3 class="msg-h3">${applyInline(renderEmoji(m[1]), false, mentionMap, customEmojiMap)}</h3>`;
		if ((m = /^## (.*)/.exec(line)))
			return `<h2 class="msg-h2">${applyInline(renderEmoji(m[1]), false, mentionMap, customEmojiMap)}</h2>`;
		if ((m = /^# (.*)/.exec(line)))
			return `<h1 class="msg-h1">${applyInline(renderEmoji(m[1]), false, mentionMap, customEmojiMap)}</h1>`;
		if ((m = /^-# (.*)/.exec(line)))
			return `<span class="msg-subtext">${applyInline(renderEmoji(m[1]), false, mentionMap, customEmojiMap)}</span>`;
		if ((m = /^>>> (.*)/.exec(line)))
			return `<blockquote class="msg-blockquote">${applyInline(renderEmoji(m[1]), false, mentionMap, customEmojiMap)}</blockquote>`;
		if ((m = /^> (.*)/.exec(line)))
			return `<blockquote class="msg-blockquote">${applyInline(renderEmoji(m[1]), false, mentionMap, customEmojiMap)}</blockquote>`;
		return applyInline(renderEmoji(line, large), large, mentionMap, customEmojiMap);
	});

	// ── 4. Join with <br> except around block elements ─────────────────────────
	let result = "";
	for (let i = 0; i < out.length; i++) {
		result += out[i];
		if (i < out.length - 1) {
			const currIsBlock = isBlockHtml(out[i]) || /^\x00B\d+\x00$/.test(out[i].trim());
			const nextIsBlock = isBlockHtml(out[i + 1]) || /^\x00B\d+\x00$/.test(out[i + 1].trim());
			if (!currIsBlock && !nextIsBlock) {
				result += "<br>";
			}
		}
	}

	// ── 5. Restore placeholders ────────────────────────────────────────────────
	result = result.replace(/\x00B(\d+)\x00/g, (_, i) => codeBlocks[+i]);
	result = result.replace(/\x00I(\d+)\x00/g, (_, i) => inlineCodes[+i]);

	return result;
}
