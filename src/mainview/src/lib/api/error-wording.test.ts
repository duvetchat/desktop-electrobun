import { describe, expect, test } from "bun:test";
import { FetchError, getApiError } from "$lib/api/api";
import { inAppWords } from "$lib/api/error-wording";

// #357 (docs/redesign/DECISIONS.md, the copy rulings): the API's known error texts that say "channel" or "server" are
// shown in the app's words. The texts are the API's own (api/internal/services/errors.go).
const KNOWN: [api: string, app: string][] = [
	["you don't have permission to view this channel", "you don't have permission to view this room"],
	[
		"you don't have permission to send messages in this channel",
		"you don't have permission to send messages in this room",
	],
	["you don't have permission to manage channels", "you don't have permission to manage rooms"],
	[
		"you don't have permission to manage permissions for this channel",
		"you don't have permission to manage permissions for this room",
	],
];

/** A request the API refused with this error text, as the client throws it. */
const refused = (error: string, status = 403) =>
	new FetchError(
		`Request failed with status ${status}`,
		{},
		{ data: { error }, status, statusText: "", headers: new Headers() },
	);

describe("the API's known error texts, in the app's words", () => {
	test("a permission error about a channel says room", () => {
		for (const [api, app] of KNOWN) expect(inAppWords(api, "Failed to send message")).toBe(app);
	});

	test("an internal error gives way to what the app was doing, or says whose side it was on", () => {
		expect(inAppWords("internal server error", "Failed to delete room")).toBe("Failed to delete room");
		expect(inAppWords("Internal Server Error", "Couldn't load your calls")).toBe("Couldn't load your calls");
		expect(inAppWords("internal server error", "")).toBe("Something went wrong on Duvet's side");
	});

	test("no text it puts on the screen says channel or server", () => {
		const shown = [...KNOWN.map(([api]) => inAppWords(api, "")), inAppWords("internal server error", "")];
		expect(shown.filter((text) => /\b(servers?|channels?)\b/i.test(text))).toEqual([]);
	});

	test("any other text is the API's own, untouched", () => {
		for (const text of [
			"failed to upload attachment: file is too large",
			"you don't have permission to manage roles",
			"room not found",
			"you are being rate limited",
			// Not one of the known texts, though it has the word: only what was checked against the API is rewritten.
			"this channel is archived",
			"",
		])
			expect(inAppWords(text, "Failed")).toBe(text);
	});
});

describe("getApiError", () => {
	test("shows the API's reason in the app's words", () => {
		for (const [api, app] of KNOWN) expect(getApiError(refused(api), "Failed to send message")).toBe(app);
		expect(getApiError(refused("internal server error", 500), "Failed to create room")).toBe("Failed to create room");
	});

	test("still shows every other reason as the API gave it, and its own errors and fallback as before", () => {
		expect(getApiError(refused("room not found", 404), "Failed to open room")).toBe("room not found");
		expect(getApiError(new Error("No answer from the server in time"), "Failed")).toBe(
			"No answer from the server in time",
		);
		expect(getApiError("not an error", "Failed to open room")).toBe("Failed to open room");
	});
});
