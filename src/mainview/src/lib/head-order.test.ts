import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stylesheetsFirst } from "./head-order";

const page = (head: string) =>
	`<!doctype html>\n<html>\n<head>\n\t\t<script>theme()</script>\n${head}</head>\n<body><link href="./in-body.css" rel="stylesheet"></body>\n</html>`;

describe("stylesheetsFirst", () => {
	test("moves the stylesheet in front of the first modulepreload link", () => {
		const html = page(
			'\t\t<link href="./a.js" rel="modulepreload">\n\t\t<link href="./b.js" rel="modulepreload">\n\t\t<link rel="icon" href="data:,">\n\t\t<link href="./0.css" rel="stylesheet">\n\t\t<script>boot()</script>\n',
		);
		const out = stylesheetsFirst(html);
		expect(out).toBe(
			page(
				'\t\t<link href="./0.css" rel="stylesheet">\n\t\t<link href="./a.js" rel="modulepreload">\n\t\t<link href="./b.js" rel="modulepreload">\n\t\t<link rel="icon" href="data:,">\n\t\t<script>boot()</script>\n',
			),
		);
	});

	test("keeps several stylesheets in their order, and everything else where it was", () => {
		const html = page(
			'\t\t<link href="./a.js" rel="modulepreload">\n\t\t<link href="./0.css" rel="stylesheet">\n\t\t<link href="./9.css" rel="stylesheet" disabled media="(max-width: 0)">\n',
		);
		const out = stylesheetsFirst(html);
		expect(out.indexOf("./0.css")).toBeLessThan(out.indexOf("./9.css"));
		expect(out.indexOf("./9.css")).toBeLessThan(out.indexOf("./a.js"));
		expect(out.length).toBe(html.length);
		// The theme script still runs before anything loads, and a link in the body is not the head's.
		expect(out.indexOf("theme()")).toBeLessThan(out.indexOf("./0.css"));
		expect(out.indexOf("./in-body.css")).toBeGreaterThan(out.indexOf("</head>"));
	});

	test("leaves a page alone when the stylesheet is already first, or when it has no preloads or no stylesheet", () => {
		const ordered = page('\t\t<link href="./0.css" rel="stylesheet">\n\t\t<link href="./a.js" rel="modulepreload">\n');
		expect(stylesheetsFirst(ordered)).toBe(ordered);
		const noPreload = page('\t\t<link href="./0.css" rel="stylesheet">\n');
		expect(stylesheetsFirst(noPreload)).toBe(noPreload);
		const noSheet = page('\t\t<link href="./a.js" rel="modulepreload">\n');
		expect(stylesheetsFirst(noSheet)).toBe(noSheet);
		expect(stylesheetsFirst("")).toBe("");
	});

	test("the server hook applies it to every page", () => {
		const hook = readFileSync(join(import.meta.dir, "..", "hooks.server.ts"), "utf8");
		expect(hook).toContain("transformPageChunk: ({ html }) => stylesheetsFirst(html)");
	});
});
