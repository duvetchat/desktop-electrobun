import { describe, expect, test } from "bun:test";
import { tags } from "./server-render";

const { default: ActivityList } = await import("./ActivityList.svelte");

const PNG = "data:image/png;base64,iVBORw0KGgo=";

// An activity's images come from whoever set it: only inline ones are drawn, never one by URL, whose host would learn
// the viewer's IP (desktop#149).
describe("ActivityList", () => {
	test("draws an activity's inline images, and neither image an activity names by URL", async () => {
		const found = await tags(ActivityList, {
			activities: [
				{ name: "Visual Studio Code", assets: { large_image: PNG, small_image: PNG } },
				{
					name: "A game",
					assets: { large_image: "https://images.test/large.png", small_image: "https://images.test/small.png" },
				},
			],
		});
		const sources = found.filter((tag) => tag.name === "img").map((tag) => tag.attributes.src);
		// The game's large image is the "?" in its place, and it has no badge.
		expect(sources).toEqual([PNG, PNG, expect.stringMatching(/^data:image\/svg\+xml,/)]);
		expect(sources.join(" ")).not.toContain("images.test");
	});
});
