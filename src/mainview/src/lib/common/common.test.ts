import { describe, expect, test } from "bun:test";

// The API's host comes from constants Vite defines at build time.
Object.assign(globalThis, { VITE_API_URL: "https://api.test", VITE_WS_URL: "", VITE_DOMAIN_TARGET_ENV: "duvet" });
const { getAvatarURL } = await import("$lib/common/common");

describe("getAvatarURL", () => {
	const ID = "0190a3b2-0000-7000-8000-000000000001";

	test("an attachment's ID is its file on the API, a URL stays as it is", () => {
		expect(getAvatarURL("u", ID)).toBe(`https://api.test/attachments/${ID}`);
		expect(getAvatarURL("u", "https://cdn.example/a.png")).toBe("https://cdn.example/a.png");
		expect(getAvatarURL("u", null)).toBeNull();
		expect(getAvatarURL("u", "")).toBeNull();
	});

	test("anything else is no image: a webhook's message can name any text as its avatar", () => {
		for (const avatar of [
			"../api/users/@me",
			"..\\api\\users\\@me",
			`${ID}/../../api/users/@me`,
			`${ID}?x=1`,
			"@me",
			"x",
		]) {
			expect(getAvatarURL("u", avatar)).toBeNull();
		}
	});
});
