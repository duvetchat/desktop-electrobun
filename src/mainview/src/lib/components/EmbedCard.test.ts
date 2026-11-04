import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The video tags a component writes, each whole.
const videos = (file: string) => readFileSync(join(import.meta.dir, file), "utf8").match(/<video\b[^>]*>/g) ?? [];

// An embed's video is asked for only when it's played: its host, or the API's proxy of it, sees each request
// (desktop#147). The players wait for a click too (playerFrame, lib/urls.ts).
describe("embed videos", () => {
	// With nothing preloaded a video shows only its poster, the embed's image, until it's played.
	test("an embed's videos preload nothing, and show a poster", () => {
		const tags = videos("EmbedCard.svelte");
		expect(tags.length).toBeGreaterThan(0);
		for (const tag of tags) {
			expect(tag).toContain('preload="none"');
			expect(tag).toMatch(/\sposter=\{card\.(image|thumbnail)\?\.url \?\? card\.(image|thumbnail)\?\.url/);
		}
	});

	test("a component's video of another host preloads nothing", () => {
		const tags = videos("MessageComponents.svelte");
		expect(tags.length).toBeGreaterThan(0);
		for (const tag of tags) expect(tag).toContain('preload={item.media.url.startsWith("/") ? undefined : "none"}');
	});
});
