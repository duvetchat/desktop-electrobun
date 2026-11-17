import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tags, type Tag } from "./server-render";

const { default: EmbedPlayer } = await import("./EmbedPlayer.svelte");

const YOUTUBE = "https://www.youtube.com/embed/dQw4w9WgXcQ";
const PAGE = "https://player.example/v/1";
const POSTER = "https://api.test/media/0190a3b2-0000-7000-8000-000000000001.jpg?exp=1&sig=x";

const player = (props: { url: string; packaged?: boolean; played?: string }) =>
	tags(EmbedPlayer, {
		title: "A video",
		aspect: "aspect-video",
		allow: "autoplay; encrypted-media",
		poster: POSTER,
		ownHosts: ["localhost", "api.test"],
		packaged: false,
		...props,
	});
const named = (found: Tag[], name: string) => found.filter((tag) => tag.name === name);

// A player page loads, and its host sees a view, only once someone plays it (desktop#147).
describe("EmbedPlayer", () => {
	test("a player waits for a click on its poster, with no frame", async () => {
		for (const packaged of [false, true]) {
			const found = await player({ url: YOUTUBE, packaged });
			expect(named(found, "iframe")).toEqual([]);
			expect(named(found, "button").map((tag) => tag.attributes["aria-label"])).toEqual(["Play A video"]);
			expect(named(found, "img").map((tag) => tag.attributes.src)).toEqual([POSTER]);
		}
	});

	test("once played, a player is framed at its URL that starts it, with its own origin", async () => {
		const found = await player({ url: YOUTUBE, played: YOUTUBE });
		expect(named(found, "iframe").map((tag) => [tag.attributes.src, tag.attributes.sandbox])).toEqual([
			[`${YOUTUBE}?autoplay=1`, "allow-scripts allow-same-origin"],
		]);
		expect(named(found, "button")).toEqual([]);
		// Another page played before (an edit changed the embed's link) waits for its own click.
		expect(named(await player({ url: YOUTUBE, played: PAGE }), "iframe")).toEqual([]);
	});

	test("in the packaged app any other page opens in the browser: its poster is a link, never a frame", async () => {
		const packaged = await player({ url: PAGE, packaged: true });
		expect(named(packaged, "button")).toEqual([]);
		expect(named(packaged, "a").map((tag) => tag.attributes)).toEqual([
			expect.objectContaining({ href: PAGE, target: "_blank", rel: "noopener noreferrer" }),
		]);
		// In the web build it's framed once played, without its origin.
		const web = await player({ url: PAGE });
		expect(named(web, "a")).toEqual([]);
		expect(named(web, "button")).toHaveLength(1);
		const played = await player({ url: PAGE, played: PAGE });
		expect(named(played, "iframe").map((tag) => [tag.attributes.src, tag.attributes.sandbox])).toEqual([
			[PAGE, "allow-scripts"],
		]);
	});
});

// #329: a played player stayed framed until its message unmounted, so several could run at once, each a cross-site page
// with its scripts and media, likely a renderer process of its own. One plays at a time across the app: starting one
// sends the one before back to its poster.
test("starting a player sends the one playing back to its poster", () => {
	const source = readFileSync(join(import.meta.dir, "EmbedPlayer.svelte"), "utf8");
	expect(source).toMatch(/<script module lang="ts">[\s\S]*const nowPlaying = writable<symbol \| null>\(null\);[\s\S]*<\/script>/);
	expect(source).toMatch(/function play\(\) \{\s*played = url;\s*nowPlaying\.set\(me\);\s*\}/);
	expect(source).toMatch(/\$effect\(\(\) => \{\s*if \(\$nowPlaying !== null && \$nowPlaying !== me\) played = undefined;\s*\}\);/);
	expect(source).toContain("onclick={play}");
});
