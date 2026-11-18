import { describe, expect, test } from "bun:test";
import { FetchError, getApiError } from "$lib/api/api";
import { inAppWords } from "$lib/api/error-wording";

// #357 (docs/redesign/DECISIONS.md, the copy rulings): the API's known error texts that say "channel" or "server" are
// shown in the app's words. The texts are the API's own (api/internal/services/errors.go). They read as sentences
// since Phase 3, with a capital, as every text the app rewords does.
const KNOWN: [api: string, app: string][] = [
	["you don't have permission to view this channel", "You don't have permission to view this room"],
	[
		"you don't have permission to send messages in this channel",
		"You don't have permission to send messages in this room",
	],
	["you don't have permission to manage channels", "You don't have permission to manage rooms"],
	[
		"you don't have permission to manage permissions for this channel",
		"You don't have permission to manage permissions for this room",
	],
];

// The API's texts a user can meet that are Go's, or say space, user or conversation: each as the API sends it
// (api/internal/services/errors.go, api/internal/http/handlers), and as the app says it.
const IN_APP_WORDS: [api: string, app: string][] = [
	["you are already a member of this space", "You're already a member of this Space"],
	["you are banned from this space", "You're banned from this Space"],
	["you are not a member of this space", "You're not a member of this Space"],
	["invite link not found or has expired", "This invite link doesn't exist or has expired"],
	["you cannot be in more than 100 spaces", "You can't be in more than 100 Spaces"],
	["the owner cannot leave the space", "The owner can't leave the Space"],
	["space not found", "That Space wasn't found"],
	[
		"room not found or you're not a member of that space",
		"That room doesn't exist, or you're not a member of its Space",
	],
	["no access to this room", "You don't have access to this room"],
	["you don't have permission to manage this space", "You don't have permission to manage this Space"],
	["you don't have permission to manage space emojis", "You don't have permission to manage Space emojis"],
	[
		"you don't have permission to create invite links for this space",
		"You don't have permission to create invite links for this Space",
	],
	["you don't have permission to pin messages in this room", "You don't have permission to pin messages in this room"],
	["you don't have permission to manage roles", "You don't have permission to manage roles"],
	["user not found", "That person wasn't found"],
	["you are already friends with this user", "You're already friends with this person"],
	["you must be friends with this user", "You must be friends with this person"],
	["you must be friends with 01a1edaa-df00-769f-bf7a-0599dcaffb1f", "You must be friends with everyone you add"],
	["friend request already sent", "You already sent this person a friend request"],
	["you cannot send a friend request to yourself", "You can't send yourself a friend request"],
	["invalid user_id", "That isn't a valid user ID"],
	["invalid user_id: not-an-id", "That isn't a valid user ID"],
	["invalid userId", "That isn't a valid user ID"],
	["you are not a member of this conversation", "You're not in this chat"],
	["user is already a member of this conversation", "This person is already in the group"],
	["only the conversation owner can do this", "Only the group's owner can do this"],
	["cannot create a DM with yourself", "You can't start a direct message with yourself"],
	["invalid email or password", "Wrong email or password"],
	["too many failed login attempts, try again later", "Too many failed attempts to sign in. Try again later."],
	["that username is taken", "That username is taken"],
	["email is already in use", "That email is already in use"],
	["invalid or expired token", "This link is invalid or has expired"],
	["password must be at least 8 characters long", "Your password must be at least 8 characters long"],
];

// What gin sends when a body doesn't bind: go-playground/validator's line for each field, joined by a line break.
const validation = (...fields: [struct: string, field: string, rule: string][]) =>
	fields
		.map(
			([struct, field, rule]) =>
				`Key: '${struct}.${field}' Error:Field validation for '${field}' failed on the '${rule}' tag`,
		)
		.join("\n");

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

	test("a text a user can meet reads as the app's own: a sentence, with Space, person and chat", () => {
		for (const [api, app] of IN_APP_WORDS) expect(inAppWords(api, "Failed"), api).toBe(app);
		// However the API cases it.
		expect(inAppWords("You are already a member of this space", "")).toBe("You're already a member of this Space");
	});

	test("none of them starts in lower case, or says space, user or conversation as the API does", () => {
		for (const [api] of [...KNOWN, ...IN_APP_WORDS]) {
			const shown = inAppWords(api, "Failed");
			expect(shown, api).toMatch(/^[A-Z]/);
			expect(shown, api).not.toMatch(/\bspaces?\b|\busers?\b(?! ID)|\bconversations?\b|\bDMs?\b|_/);
		}
	});

	test("a field the API's validator refused is a plain sentence, never Go's", () => {
		const logIn = validation(["AuthLogInPayload", "Email", "required"], ["AuthLogInPayload", "Password", "required"]);
		expect(inAppWords(logIn, "Failed to log in")).toBe("Enter your email and password");
		expect(inAppWords(validation(["AuthLogInPayload", "Email", "required"]), "")).toBe("Enter your email");
		expect(
			inAppWords(
				validation(
					["AuthSignInPayload", "Username", "required"],
					["AuthSignInPayload", "Email", "required"],
					["AuthSignInPayload", "Password", "required"],
				),
				"",
			),
		).toBe("Enter your username, email and password");
		expect(inAppWords(validation(["CreateSpacePayload", "Name", "required"]), "")).toBe("Name is required");
		expect(
			inAppWords(
				validation(["BucketPayload", "BucketName", "required"], ["BucketPayload", "AccessKeyID", "required"]),
				"",
			),
		).toBe("Bucket name and access key ID are required");
		expect(inAppWords(validation(["AuthSignInPayload", "Username", "max"]), "")).toBe("Username is too long");
		expect(inAppWords(validation(["MessagePayload", "Content", "max"]), "")).toBe("Content is too long");
		expect(inAppWords(validation(["SearchQuery", "Limit", "min"]), "")).toBe("Limit is too short");
		expect(inAppWords(validation(["SearchQuery", "After", "uuid"]), "")).toBe("After isn't a valid ID");
		expect(inAppWords(validation(["StatusPayload", "Status", "oneof"]), "")).toBe("Status isn't valid");
		for (const shown of [inAppWords(logIn, ""), inAppWords(validation(["P", "UserID", "required"]), "")])
			expect(shown).not.toMatch(/Key:|Error:|Field validation|tag|Payload/);
	});

	test("a body the API couldn't read gives way to what the app was doing", () => {
		for (const text of [
			"json: cannot unmarshal number into Go struct field AuthLogInPayload.email of type string",
			"invalid character 'x' looking for beginning of value",
			"unexpected end of JSON input",
			"EOF",
			'strconv.ParseInt: parsing "x": invalid syntax',
		]) {
			expect(inAppWords(text, "Failed to save"), text).toBe("Failed to save");
			expect(inAppWords(text, ""), text).toBe("That didn't go through. Try again.");
		}
	});

	test("an ID the API couldn't read gives way too, but for a user ID, which the user types", () => {
		expect(inAppWords("invalid space id", "Failed to join")).toBe("Failed to join");
		expect(inAppWords("invalid room id", "")).toBe("That ID isn't valid");
		expect(inAppWords("invalid user id", "Couldn't send the request")).toBe("That isn't a valid user ID");
	});

	test("any other text is the API's own, untouched", () => {
		for (const text of [
			"failed to upload attachment: file is too large",
			"room not found",
			"message not found",
			// The app reads this one to send the user back to sign-in (routes/invite): it stays as it comes.
			"Session invalid or expired",
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
