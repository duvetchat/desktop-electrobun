import { renderEmoji } from "./emoji";
import hljs from "highlight.js/lib/core";

// Register only the most common languages to keep bundle size small
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import cpp from "highlight.js/lib/languages/cpp";
import c from "highlight.js/lib/languages/c";
import csharp from "highlight.js/lib/languages/csharp";
import java from "highlight.js/lib/languages/java";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import bash from "highlight.js/lib/languages/bash";
import sql from "highlight.js/lib/languages/sql";
import markdown from "highlight.js/lib/languages/markdown";
import yaml from "highlight.js/lib/languages/yaml";
import toml from "highlight.js/lib/languages/ini"; // TOML uses ini highlighter
import kotlin from "highlight.js/lib/languages/kotlin";
import swift from "highlight.js/lib/languages/swift";
import ruby from "highlight.js/lib/languages/ruby";
import php from "highlight.js/lib/languages/php";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("go", go);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("rs", rust);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c++", cpp);
hljs.registerLanguage("c", c);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("cs", csharp);
hljs.registerLanguage("c#", csharp);
hljs.registerLanguage("java", java);
hljs.registerLanguage("json", json);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);
hljs.registerLanguage("toml", toml);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("kt", kotlin);
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("rb", ruby);
hljs.registerLanguage("php", php);

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isBlockHtml(s: string): boolean {
	return /^<(h[123]|blockquote|pre)[\s>]/.test(s);
}

function applyInline(s: string): string {
	s = s.replace(/\*\*\*(.+?)\*\*\*/gs, (_, t) => `<strong><em>${t}</em></strong>`);
	s = s.replace(/\*\*(.+?)\*\*/gs, (_, t) => `<strong>${t}</strong>`);
	s = s.replace(/\*([^\s*](?:[^*]*[^\s*])?)\*/gs, (_, t) => `<em>${t}</em>`);
	s = s.replace(/__(.+?)__/gs, (_, t) => `<u>${t}</u>`);
	s = s.replace(/(?<!\w)_([^\s_](?:[^_]*[^\s_])?)_(?!\w)/gs, (_, t) => `<em>${t}</em>`);
	s = s.replace(/~~(.+?)~~/gs, (_, t) => `<del>${t}</del>`);
	s = s.replace(/\|\|(.+?)\|\|/gs, (_, t) => `<span class="msg-spoiler">${t}</span>`);
	return s;
}

function highlightCode(code: string, lang: string): string {
	if (!lang) {
		return escapeHtml(code);
	}
	// Normalize common aliases
	const alias = lang.toLowerCase();
	try {
		if (hljs.getLanguage(alias)) {
			return hljs.highlight(code, { language: alias, ignoreIllegals: true }).value;
		}
	} catch {
		// fall through to plain escaping
	}
	return escapeHtml(code);
}

export function renderMarkdown(input: string, large = false): string {
	// ── 1. Extract fenced code blocks ─────────────────────────────────────────
	const codeBlocks: string[] = [];
	let s = input.replace(/```([\w+#-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
		const trimmed = code.replace(/\n$/, "");
		const lines = trimmed.split("\n");
		const highlighted = highlightCode(trimmed, lang);
		// Split highlighted HTML by newlines to add line numbers
		const highlightedLines = highlighted.split("\n");
		const linesHtml = highlightedLines
			.map(
				(line, i) =>
					`<span class="msg-ln">${i + 1}</span><span class="msg-lc">${line || "\u200b"}</span>`,
			)
			.join("\n");
		const langLabel = lang ? lang.toLowerCase() : "";
		const langBadge = langLabel
			? `<span class="msg-code-lang">${escapeHtml(langLabel)}</span>`
			: "";
		codeBlocks.push(
			`<pre class="msg-code-block">${langBadge}<code>${linesHtml}</code></pre>`,
		);
		return `\x00B${codeBlocks.length - 1}\x00`;
	});

	// ── 2. Extract inline code ─────────────────────────────────────────────────
	const inlineCodes: string[] = [];
	s = s.replace(/`([^`\n]+)`/g, (_, code) => {
		inlineCodes.push(
			`<code class="msg-inline-code">${escapeHtml(code)}</code>`,
		);
		return `\x00I${inlineCodes.length - 1}\x00`;
	});

	// ── 3. Process line by line for block elements ─────────────────────────────
	const lines = s.split("\n");
	const out: string[] = lines.map((line) => {
		let m: RegExpExecArray | null;
		if ((m = /^### (.*)/.exec(line)))
			return `<h3 class="msg-h3">${applyInline(renderEmoji(m[1]))}</h3>`;
		if ((m = /^## (.*)/.exec(line)))
			return `<h2 class="msg-h2">${applyInline(renderEmoji(m[1]))}</h2>`;
		if ((m = /^# (.*)/.exec(line)))
			return `<h1 class="msg-h1">${applyInline(renderEmoji(m[1]))}</h1>`;
		if ((m = /^-# (.*)/.exec(line)))
			return `<span class="msg-subtext">${applyInline(renderEmoji(m[1]))}</span>`;
		if ((m = /^>>> (.*)/.exec(line)))
			return `<blockquote class="msg-blockquote">${applyInline(renderEmoji(m[1]))}</blockquote>`;
		if ((m = /^> (.*)/.exec(line)))
			return `<blockquote class="msg-blockquote">${applyInline(renderEmoji(m[1]))}</blockquote>`;
		return applyInline(renderEmoji(line, large));
	});

	// ── 4. Join with <br> except around block elements ─────────────────────────
	let result = "";
	for (let i = 0; i < out.length; i++) {
		result += out[i];
		if (i < out.length - 1) {
			const currIsBlock =
				isBlockHtml(out[i]) || /^\x00B\d+\x00$/.test(out[i].trim());
			const nextIsBlock =
				isBlockHtml(out[i + 1]) || /^\x00B\d+\x00$/.test(out[i + 1].trim());
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
