import { describe, expect, test } from "bun:test";
import { gifsUrl, parseGifs } from "./gifs";

// One of an item's sizes as KLIPY answers it: a GIF and the same picture in other formats.
const size = (name: string, width: number, height: number) => ({
	gif: { url: `https://static.klipy.com/ii/${name}.gif`, width, height, size: 1000 },
	webp: { url: `https://static.klipy.com/ii/${name}.webp`, width, height, size: 900 },
	mp4: { url: `https://static.klipy.com/ii/${name}.mp4`, width, height, size: 800 },
});

const allSizes = (id: number) => ({
	hd: size(`${id}-hd`, 498, 498),
	md: size(`${id}-md`, 640, 640),
	sm: size(`${id}-sm`, 220, 220),
	xs: size(`${id}-xs`, 90, 90),
});

const item = (id: number, file: Record<string, unknown>, type = "gif") => ({
	id,
	slug: `gif-${id}`,
	title: `GIF ${id}`,
	type,
	file,
	tags: [],
});

// KLIPY's answer to gifs/trending and gifs/search.
const answer = (...items: unknown[]) => ({
	result: true,
	data: { data: items, current_page: 1, per_page: 20, has_next: true },
});

// value without some of its keys.
const without = (value: Record<string, unknown>, ...keys: string[]) =>
	Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

const gifUrl = (name: string) => `https://static.klipy.com/ii/${name}.gif`;

describe("parseGifs", () => {
	test("sends each GIF's medium file and shows its small one, with its title", () => {
		expect(parseGifs(answer(item(1, allSizes(1)), item(2, allSizes(2))))).toEqual([
			{ url: gifUrl("1-md"), preview: { url: gifUrl("1-sm"), width: 220, height: 220 }, description: "GIF 1" },
			{ url: gifUrl("2-md"), preview: { url: gifUrl("2-sm"), width: 220, height: 220 }, description: "GIF 2" },
		]);
	});

	test("leaves out ads, whatever they hold", () => {
		const gifs = parseGifs(answer(item(1, allSizes(1), "ad"), item(2, allSizes(2)), { id: 3, type: "ad" }));
		expect(gifs.map((gif) => gif.url)).toEqual([gifUrl("2-md")]);
	});

	test("sends the large GIF when there's no medium one", () => {
		expect(parseGifs(answer(item(1, without(allSizes(1), "md"))))[0]!.url).toBe(gifUrl("1-hd"));
		// A medium size without a GIF counts as none.
		const mediumWithoutGif = { ...allSizes(1), md: without(size("1-md", 640, 640), "gif") };
		expect(parseGifs(answer(item(1, mediumWithoutGif)))[0]!.url).toBe(gifUrl("1-hd"));
	});

	test("shows the extra-small GIF without a small one, and the medium one without either", () => {
		expect(parseGifs(answer(item(1, without(allSizes(1), "sm"))))[0]!.preview).toEqual({
			url: gifUrl("1-xs"),
			width: 90,
			height: 90,
		});
		expect(parseGifs(answer(item(1, without(allSizes(1), "sm", "xs"))))).toEqual([
			{ url: gifUrl("1-md"), preview: { url: gifUrl("1-md"), width: 640, height: 640 }, description: "GIF 1" },
		]);
	});

	test("shows a preview without a size it doesn't give, and an item without a title untitled", () => {
		const file = { ...allSizes(1), sm: { gif: { url: gifUrl("1-sm"), width: "220", height: 0 } } };
		expect(parseGifs(answer(without(item(1, file), "title")))).toEqual([
			{ url: gifUrl("1-md"), preview: { url: gifUrl("1-sm") }, description: "" },
		]);
	});

	test("describes a GIF by its title only when that's text", () => {
		for (const title of [42, null, true, { text: "GIF" }, ["GIF"]]) {
			expect(parseGifs(answer({ ...item(1, allSizes(1)), title }))[0]!.description).toBe("");
		}
	});

	test("skips an item whose GIF URLs hold whitespace, as a pick sends its URL word for word", () => {
		const whitespace = [" ", "\t", "\n", String.fromCharCode(160)];
		const urls = whitespace.flatMap((space) => [
			`${gifUrl("1-md")}${space}`,
			`https://static.klipy.com/ii/a${space}b.gif`,
		]);
		for (const url of urls) {
			const spaced = { gif: { url, width: 640, height: 640 } };
			expect(parseGifs(answer(item(1, { ...allSizes(1), md: spaced, hd: spaced })))).toEqual([]);
			// A large GIF without it is sent instead, as for a medium GIF without a URL.
			expect(parseGifs(answer(item(2, { ...allSizes(2), md: spaced })))[0]!.url).toBe(gifUrl("2-hd"));
		}
	});

	test("skips malformed items and keeps the rest", () => {
		const notWeb = { ...allSizes(3), md: { gif: { url: "javascript:alert(1)" } }, hd: { gif: { url: 7 } } };
		const gifs = parseGifs(
			answer(
				null,
				"gif",
				42,
				[],
				{ type: "gif" },
				{ type: "gif", file: gifUrl("x") },
				item(2, without(allSizes(2), "md", "hd")),
				item(3, notWeb),
				item(4, { hd: size("4-hd", 498, 498) }),
				item(5, allSizes(5)),
			),
		);
		expect(gifs.map((gif) => gif.url)).toEqual([gifUrl("5-md")]);
	});

	test("finds nothing in an answer without results", () => {
		for (const json of [null, undefined, "", [], {}, { result: false }, { data: null }, { data: { data: {} } }]) {
			expect(parseGifs(json)).toEqual([]);
		}
	});
});

describe("gifsUrl", () => {
	test("asks for KLIPY's trending GIFs while the query is blank", () => {
		for (const query of ["", "   "]) {
			expect(gifsUrl(query)).toMatch(/^https:\/\/api\.klipy\.com\/api\/v1\/[A-Za-z0-9]+\/gifs\/trending\?per_page=20$/);
		}
	});

	test("searches the query without its outer spaces", () => {
		expect(gifsUrl("  cat dance & naïve ")).toMatch(
			/^https:\/\/api\.klipy\.com\/api\/v1\/[A-Za-z0-9]+\/gifs\/search\?q=cat\+dance\+%26\+na%C3%AFve&per_page=20$/,
		);
	});
});
