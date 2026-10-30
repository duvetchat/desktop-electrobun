import { describe, expect, test } from "bun:test";
import { parseThemePref, resolveTheme } from "$lib/theme";

describe("theme", () => {
	test("System follows the system, dark when it doesn't say light", () => {
		expect(resolveTheme("system", true)).toBe("light");
		expect(resolveTheme("system", false)).toBe("dark");
	});

	test("Light and Dark keep to theirs whatever the system says", () => {
		expect(resolveTheme("light", false)).toBe("light");
		expect(resolveTheme("dark", true)).toBe("dark");
	});

	test("a saved value that isn't a pick is System", () => {
		expect(parseThemePref("light")).toBe("light");
		expect(parseThemePref("dark")).toBe("dark");
		expect(parseThemePref(null)).toBe("system");
		expect(parseThemePref("sepia")).toBe("system");
	});
});
