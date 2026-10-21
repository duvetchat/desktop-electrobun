import { describe, expect, test } from "bun:test";
import { displayName, isSpoiler, withSpoiler } from "$lib/spoilers";

const file = (name: string) => new File(["meow"], name, { type: "image/png", lastModified: 1_760_000_000_000 });

describe("isSpoiler", () => {
	test("a name that starts with SPOILER_ is a spoiler", () => {
		expect(isSpoiler("SPOILER_cat.png")).toBe(true);
		expect(isSpoiler("cat.png")).toBe(false);
	});

	test("only the prefix as it's written counts, at the start", () => {
		expect(isSpoiler("spoiler_cat.png")).toBe(false);
		expect(isSpoiler("my SPOILER_cat.png")).toBe(false);
		expect(isSpoiler("SPOILERcat.png")).toBe(false);
	});
});

describe("displayName", () => {
	test("drops the prefix", () => {
		expect(displayName("SPOILER_cat.png")).toBe("cat.png");
		expect(displayName("SPOILER_SPOILER_cat.png")).toBe("cat.png");
		expect(displayName("cat.png")).toBe("cat.png");
	});

	test("keeps a name that is nothing but the prefix", () => {
		expect(displayName("SPOILER_")).toBe("SPOILER_");
	});
});

describe("withSpoiler", () => {
	test("marks a file as a spoiler with a new file of the same type, date and content", async () => {
		const marked = withSpoiler(file("cat.png"), true);
		expect(marked.name).toBe("SPOILER_cat.png");
		expect(marked.type).toBe("image/png");
		expect(marked.lastModified).toBe(1_760_000_000_000);
		expect(await marked.text()).toBe("meow");
	});

	test("unmarks a spoiler, whatever prefixes it has", async () => {
		const unmarked = withSpoiler(file("SPOILER_SPOILER_cat.png"), false);
		expect(unmarked.name).toBe("cat.png");
		expect(unmarked.type).toBe("image/png");
		expect(await unmarked.text()).toBe("meow");
	});

	test("gives the file back when it already is what's asked", () => {
		const plain = file("cat.png");
		const spoiler = file("SPOILER_cat.png");
		expect(withSpoiler(plain, false)).toBe(plain);
		expect(withSpoiler(spoiler, true)).toBe(spoiler);
	});
});
