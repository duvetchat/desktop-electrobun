// The order of a prerendered page's <head>. SvelteKit writes every `modulepreload` link first and the page's
// stylesheet after them. The stylesheet is the one thing the first paint waits for, and a browser starts requests in
// the order it meets them: with 32 preloads ahead of it the stylesheet's answer came about 3 ms later than with 16
// (measured: a Chromium trace of both builds, see docs/redesign/BASELINE.md). So the stylesheet goes first.

const PRELOAD = /<link\b[^>]*\brel="modulepreload"[^>]*>/;
const STYLESHEET = /[ \t]*<link\b[^>]*\brel="stylesheet"[^>]*>\r?\n?/g;

/** The page with every stylesheet link that follows the first `modulepreload` link moved in front of it. A page
 *  without both (the dev server's, which has neither) comes back as it is. */
export function stylesheetsFirst(html: string): string {
	const first = PRELOAD.exec(html);
	if (!first) return html;
	const headEnd = html.indexOf("</head>");
	if (headEnd < first.index) return html;
	const before = html.slice(0, first.index);
	const head = html.slice(first.index, headEnd);
	const sheets: string[] = [];
	const rest = head.replace(STYLESHEET, (tag) => {
		sheets.push(tag.trim());
		return "";
	});
	if (sheets.length === 0) return html;
	// The indentation of the line the first preload is on, so the moved links sit as the others do.
	const indent = /[ \t]*$/.exec(before)?.[0] ?? "";
	return before + sheets.map((tag) => `${tag}\n${indent}`).join("") + rest + html.slice(headEnd);
}
