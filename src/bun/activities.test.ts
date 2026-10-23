import { describe, expect, test } from "bun:test";
import { fitActivity } from "./activities";

describe("fitActivity", () => {
	test("keeps an activity within the limits as it is", () => {
		const vscode = {
			name: "Visual Studio Code",
			details: "Editing connection.ts",
			state: "Workspace: duvet",
			timestamps: { start: 1_792_785_070_629 },
			assets: { large_image: `data:image/svg+xml;base64,${"A".repeat(900)}`, large_text: "TypeScript" },
		};
		expect(fitActivity(vscode)).toEqual(vscode);
		expect(fitActivity({ type: 2, name: "Spotify" })).toEqual({ type: 2, name: "Spotify" });
	});

	test("has nothing to show without a name", () => {
		for (const data of [null, "Spotify", 5, [], {}, { name: "" }, { name: 5 }, { details: "x" }]) {
			expect(fitActivity(data)).toBeNull();
		}
	});

	test("fits what's past the limits instead of losing the activity", () => {
		const fitted = fitActivity({
			name: "n".repeat(200),
			state: "ñ".repeat(129),
			details: "🎵".repeat(128),
			assets: { large_image: "x".repeat((8 << 10) + 1), small_image: "y".repeat(8 << 10), small_text: "t" },
		});
		expect([...(fitted?.name ?? "")].length).toBe(128);
		expect(fitted?.name.endsWith("…")).toBe(true);
		expect([...(fitted?.state ?? "")].length).toBe(128);
		expect(fitted?.details).toBe("🎵".repeat(128));
		expect(fitted?.assets).toEqual({ small_image: "y".repeat(8 << 10), small_text: "t" });
	});

	test("drops a field of the wrong type, and shows a type it doesn't know as playing", () => {
		expect(
			fitActivity({
				type: 1,
				name: "Game",
				details: 5,
				state: { text: "x" },
				timestamps: { start: 1500.4, end: Number.NaN },
				assets: { large_text: ["x"], large_image: 7 },
			}),
		).toEqual({ name: "Game", timestamps: { start: 1500 }, assets: {} });
		expect(fitActivity({ name: "Game", type: "2", timestamps: { start: 2 ** 64 } })).toEqual({
			name: "Game",
			timestamps: {},
		});
	});
});
