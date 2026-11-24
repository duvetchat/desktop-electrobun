import { afterEach, describe, expect, test } from "bun:test";
import { parse, TYPE } from "@formatjs/icu-messageformat-parser";
import en from "../../../messages/en.json";
import { FetchError, getApiError, NetworkError, NoAnswerError } from "$lib/api/api";
import { inAppWords } from "$lib/api/error-wording";
import { setLocalePref, t, type MessageKey } from "$lib/i18n";
import { formatList } from "$lib/i18n/format";
import { PSEUDO } from "$lib/i18n/locale";

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

// The other texts a user can meet (api/internal/services/errors.go, the handlers and the serializers in api/internal/http):
// their English is the API's words with a capital first letter, as it was before they were messages (#464).
const AS_THE_API_SAYS: string[] = [
	"username must not be empty",
	"email must be an address alone, without a name or angle brackets",
	"username must be at most 32 characters",
	"display name must be at most 32 characters",
	"bio must be at most 190 characters",
	"avatar file too large (max 10MB)",
	"banner file too large (max 10MB)",
	"image too large (max 10MB)",
	"failed to read file",
	"failed to update profile",
	"failed to fetch user",
	"Authentication required: no access token provided",
	"Authentication required: no session token provided",
	"Session expired",
	"User associated with this session no longer exists",
	"Access token does not match session",
	"Database error during authentication",
	"Failed to retrieve user data",
	"role not found",
	"overwrite not found",
	"categories do not support permission overwrites",
	"parent_id must be a category of this space",
	"member not found",
	"ban not found",
	"reason must be at most 512 characters",
	"icon file too large (max 10MB)",
	"webhook not found",
	"message not found",
	"cannot edit someone else's message",
	"referenced message not found",
	"this message is still being sent with this nonce: try again",
	"the message sent with this nonce has been deleted",
	"a value is longer than its field allows",
	"text can't contain NUL (U+0000) characters or invalid UTF-8",
	"the request body is over 32 MiB",
	"attachment not found",
	"failed to open file",
	"failed to fetch attachments",
	"failed to get members",
	"emoji not found",
	"sticker not found",
	"that sticker can't be sent here",
	"search for some text or with a filter",
	"the search took too long, narrow it down",
	"there are 250 pinned messages here already, unpin one first",
	"a pin or call notice can't be pinned",
	"a pin or call notice can't be edited",
	"this bot is private — only team members can add it",
	"application not found",
	"application already has a bot",
	"application has no bot",
	"failed to update bot profile",
	"you need an active storage bucket to upload bot images",
	"team not found",
	"not a team member",
	"not a team admin",
	"only the owner can edit the team",
	"only the owner can delete the team",
	"the team's owner can't be removed",
	"team invite not found",
	"cannot invite a bot to a team",
	"the application did not respond",
	"the application's response failed",
	"unknown command",
	"unknown modal",
	"bucket not found",
	"bucket has files",
	"bucket is in a transfer",
	"bucket files are in use as images: change them first",
	"invalid bucket",
	"invalid storage configuration: the endpoint must be an https URL, without user info, query or fragment",
	"invalid storage configuration: the endpoint must be on port 443",
	"invalid storage configuration: the bucket refused these credentials",
	"invalid storage configuration: no such bucket at this endpoint",
	"invalid storage configuration: could not reach the bucket at this endpoint",
	"max_bytes must be a non-zero positive number",
	"max_bytes is below what the bucket holds: move or delete files first",
	"upload_limit_bytes must be a non-zero positive number",
	"failed to fetch buckets",
	"failed to activate bucket",
	"failed to deactivate bucket",
	"failed to fetch storage status",
	"failed to delete attachments",
	"transfer not found",
	"a transfer is already running",
	"the transfer has ended",
	"a bucket of the transfer changed while it began, try again",
	"source and target must differ",
	"keep_source needs a bucket as the source",
	'source and target are "default" or a bucket ID',
	"not enough room in the target",
];

// What the API says of an upload that failed: what was uploaded, then why (api/internal/services/user.go, and the
// handlers user.go, space.go, developer.go, webhook.go and conversation.go of api/internal/http). The causes it wraps so
// (api/internal/services/errors.go), which never come alone; a file over a limit is OVER_LIMIT's.
const UPLOADED = ["attachment", "avatar", "banner", "icon"];
const UPLOAD_CAUSES = [
	"not enough storage space for this file",
	"the storage bucket was pointed elsewhere during the upload, try again",
	"the storage bucket was removed during the upload, try again",
	"the upload took too long and its file wasn't kept, try again",
	"the file's storage failed",
	"the file's storage didn't answer in time",
];
const UPLOADS = UPLOADED.flatMap((what) => UPLOAD_CAUSES.map((cause) => `failed to upload ${what}: ${cause}`));

// A file over the per-file limit where it goes, the user's or its bucket's, as the API says it
// (api/internal/services/attachments.go), and the app's English: the API's, with a capital first letter and its numbers
// grouped as the app's language groups them.
const OVER_LIMIT: [api: string, app: string][] = [
	[
		"failed to upload attachment: file is too large: 26214400 bytes, your limit is 20971520",
		"Failed to upload attachment: file is too large: 26,214,400 bytes, your limit is 20,971,520",
	],
	[
		"failed to upload attachment: file is too large: 9000000 bytes, the bucket's limit is 5242880",
		"Failed to upload attachment: file is too large: 9,000,000 bytes, the bucket's limit is 5,242,880",
	],
	[
		"failed to upload avatar: file is too large: 2097152 bytes, the bucket's limit is 1048576",
		"Failed to upload avatar: file is too large: 2,097,152 bytes, the bucket's limit is 1,048,576",
	],
	[
		"failed to upload banner: file is too large: 3000000 bytes, your limit is 2000000",
		"Failed to upload banner: file is too large: 3,000,000 bytes, your limit is 2,000,000",
	],
	[
		"failed to upload icon: file is too large: 2097152 bytes, the bucket's limit is 1048576",
		"Failed to upload icon: file is too large: 2,097,152 bytes, the bucket's limit is 1,048,576",
	],
];

// The texts that carry a reason or a number, each as the API sends it: an emoji's or a sticker's image over its cap
// (api/internal/services/space_images.go), and a transfer's bucket that didn't take its probe
// (api/internal/services/storage_transfers.go). Their English is the API's words with a capital first letter.
const WITH_A_VALUE: string[] = [
	"invalid image: emoji images can be 256 KiB at most",
	"invalid image: sticker images can be 512 KiB at most",
	"storage bucket unreachable: the target refused the credentials",
	"storage bucket unreachable: the target has no such bucket",
	"storage bucket unreachable: the target answered 503",
	"storage bucket unreachable: the target didn't answer",
	"storage bucket unreachable: the source refused the credentials",
	"storage bucket unreachable: the source has no such bucket",
	"storage bucket unreachable: the source answered 500",
	"storage bucket unreachable: the source didn't answer",
];

// Every "you don't have permission to …" the API sends (api/internal/services/errors.go; the gateway sends six of them
// too, gateway/internal/core/services/errors.go), and the app's English for it.
const PERMISSIONS: [api: string, app: string][] = [
	["you don't have permission to view this channel", "You don't have permission to view this room"],
	[
		"you don't have permission to send messages in this channel",
		"You don't have permission to send messages in this room",
	],
	["you don't have permission to delete this message", "You don't have permission to delete this message"],
	["you don't have permission to manage channels", "You don't have permission to manage rooms"],
	["you don't have permission to manage this space", "You don't have permission to manage this Space"],
	["you don't have permission to manage roles", "You don't have permission to manage roles"],
	[
		"you don't have permission to create invite links for this space",
		"You don't have permission to create invite links for this Space",
	],
	[
		"you don't have permission to manage permissions for this channel",
		"You don't have permission to manage permissions for this room",
	],
	["you don't have permission to manage space emojis", "You don't have permission to manage Space emojis"],
	[
		"you don't have permission to manage storage buckets for this space",
		"You don't have permission to manage storage buckets for this Space",
	],
	["you don't have permission to manage space stickers", "You don't have permission to manage Space stickers"],
	["you don't have permission to manage bots in this space", "You don't have permission to manage bots in this Space"],
	["you don't have permission to manage space attachments", "You don't have permission to manage Space attachments"],
	[
		"you don't have permission to manage webhooks in this space",
		"You don't have permission to manage webhooks in this Space",
	],
	[
		"you don't have permission to manage invite links for this space",
		"You don't have permission to manage invite links for this Space",
	],
	["you don't have permission to pin messages in this room", "You don't have permission to pin messages in this room"],
	["you don't have permission to kick members", "You don't have permission to kick members"],
	["you don't have permission to ban members", "You don't have permission to ban members"],
];

// The fields each rule of the API's validator can name (the binding tags of api/internal/http/serializers): a sentence
// about one field is a case of its rule's select, a whole sentence that can agree with the field. The required fields
// but the user's own (username, email, password), which are asked for as theirs.
const RULE_FIELDS: Record<string, [key: MessageKey, fields: string[]]> = {
	max: [
		"error_validation_too_long",
		[
			"Username",
			"FID",
			"Content",
			"Query",
			"Nonce",
			"MaxAge",
			"Status",
			"Limit",
			"AuthorIDs",
			"Mentions",
			"RoomIDs",
			"Has",
		],
	],
	min: ["error_validation_too_short", ["MaxAge", "Status", "Limit", "StartedAt"]],
	uuid: ["error_validation_invalid_id", ["After", "Before", "Cursor"]],
	oneof: ["error_validation_invalid", ["Level", "DefaultNotifications", "Type", "TargetType", "Status"]],
	required: [
		"error_validation_required_one",
		[
			"AccessKeyID",
			"BucketName",
			"Content",
			"EmojiName",
			"Endpoint",
			"FID",
			"Level",
			"MessageID",
			"Name",
			"SecretAccessKey",
			"Source",
			"Status",
			"Target",
			"TargetID",
			"TargetType",
			"Token",
			"Type",
			"UserID",
		],
	],
};

/** A select's cases in an English message. */
function cases(key: MessageKey): string[] {
	const [select] = parse(en[key], { requiresOtherClause: true });
	if (select?.type !== TYPE.select) throw new Error(`${key} isn't a select`);
	return Object.keys(select.options).sort();
}

// A struct field's name in the API's words, as the app's English has it: "BucketName" is "bucket name".
const words = (field: string) =>
	field
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.split(" ")
		.map((word) => (/^(IDs?|FID)$/.test(word) ? word : word.toLowerCase()))
		.join(" ");
const snake = (field: string) => words(field).toLowerCase().replace(/ /g, "_");

// The fields the API's validator can name: each struct field of api/internal/http/serializers with a required, max,
// min, email, uuid or oneof rule.
const FIELDS = [
	"AccessKeyID",
	"After",
	"AuthorIDs",
	"Before",
	"BucketName",
	"Content",
	"Cursor",
	"DefaultNotifications",
	"Email",
	"EmojiName",
	"Endpoint",
	"FID",
	"Has",
	"Level",
	"Limit",
	"MaxAge",
	"Mentions",
	"MessageID",
	"Name",
	"Nonce",
	"Password",
	"Query",
	"RoomIDs",
	"SecretAccessKey",
	"Source",
	"StartedAt",
	"Status",
	"Target",
	"TargetID",
	"TargetType",
	"Token",
	"Type",
	"UserID",
	"Username",
];

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

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

	test("every permission error the API sends reads as before, room and Space and all", () => {
		for (const [api, app] of PERMISSIONS) expect(inAppWords(api, "Failed"), api).toBe(app);
		// However the API cases it.
		expect(inAppWords("You don't have permission to manage Channels", "")).toBe(
			"You don't have permission to manage rooms",
		);
		// One the app doesn't know yet keeps the API's words, but for room and Space.
		expect(inAppWords("you don't have permission to archive this channel in this space", "")).toBe(
			"You don't have permission to archive this room in this Space",
		);
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

	test("every other text a user can meet is a message, in the API's words with a capital first letter", () => {
		for (const api of AS_THE_API_SAYS) expect(inAppWords(api, "Failed"), api).toBe(capital(api));
		// However the API cases it.
		expect(inAppWords("MESSAGE NOT FOUND", "")).toBe("Message not found");
	});

	test("an upload that failed says the whole sentence, what was uploaded and why, as it did", () => {
		for (const api of UPLOADS) expect(inAppWords(api, "Failed"), api).toBe(capital(api));
		// However the API cases it.
		expect(inAppWords("Failed to upload Avatar: The file's storage failed", "")).toBe(
			"Failed to upload avatar: the file's storage failed",
		);
		// A cause the app doesn't know keeps the API's words.
		expect(inAppWords("failed to upload attachment: the disk caught fire", "Failed")).toBe(
			"Failed to upload attachment: the disk caught fire",
		);
	});

	test("a file over its limit says the file's size and the limit, the user's or the bucket's", () => {
		for (const [api, app] of OVER_LIMIT) expect(inAppWords(api, "Failed"), api).toBe(app);
	});

	test("a text with a reason or a number in it is a message too, in the API's words with a capital first letter", () => {
		for (const api of WITH_A_VALUE) expect(inAppWords(api, "Failed"), api).toBe(capital(api));
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
		expect(inAppWords(validation(["AuthResetPassword", "Password", "required"]), "")).toBe("Enter your password");
		expect(inAppWords(validation(["CreateWebhookPayload", "Username", "required"]), "")).toBe("Enter your username");
		expect(
			inAppWords(
				validation(["AuthSignInPayload", "Username", "required"], ["AuthSignInPayload", "Password", "required"]),
				"",
			),
		).toBe("Enter your username and password");
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
		// A field's name is its words in English.
		expect(inAppWords(validation(["BucketPayload", "SecretAccessKey", "max"]), "")).toBe(
			"Secret access key is too long",
		);
		expect(inAppWords(validation(["InvitePayload", "MaxAge", "max"]), "")).toBe("Max age is too long");
		expect(inAppWords(validation(["P", "MessageID", "uuid"]), "")).toBe("Message ID isn't a valid ID");
		// One the app doesn't know yet too.
		expect(inAppWords(validation(["P", "ThemeURL", "max"]), "")).toBe("Theme URL is too long");
		expect(inAppWords(validation(["P", "ThemeURL", "required"]), "")).toBe("Theme URL is required");
	});

	test("a sentence about one field is its own case of the rule's message, each in the English it had", () => {
		for (const [rule, [key, fields]] of Object.entries(RULE_FIELDS)) {
			expect(cases(key), key).toEqual([...fields.map(snake), "other"].sort());
			const said = { max: "is too long", min: "is too short", uuid: "isn't a valid ID", oneof: "isn't valid" }[rule];
			for (const field of fields)
				expect(inAppWords(validation(["P", field, rule]), ""), `${field} ${rule}`).toBe(
					`${capital(words(field))} ${said ?? "is required"}`,
				);
		}
	});

	// formatList joins them as the system's region joins a list: "a, b, and c" in US English, "a, b and c" in British.
	test("three or more missing fields are joined as a list is where the user is", () => {
		const bucket = validation(
			["CreateBucketBody", "Name", "required"],
			["CreateBucketBody", "Endpoint", "required"],
			["CreateBucketBody", "BucketName", "required"],
		);
		expect(inAppWords(bucket, "")).toBe(`${capital(formatList(["name", "endpoint", "bucket name"]))} are required`);
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

	// Texts the API doesn't send: one it may send some day.
	test("any other text keeps the API's own words, and starts with a capital letter as the app's do", () => {
		for (const [text, shown] of [
			["poll not found", "Poll not found"],
			// The app reads this one to send the user back to sign-in (routes/invite): it stays as it comes.
			["Session invalid or expired", "Session invalid or expired"],
			["you are being rate limited", "You are being rate limited"],
			// Not one of the known texts, though it has the word: only what was checked against the API is rewritten.
			["this channel is archived", "This channel is archived"],
			// A field's name stays the API's but for its first letter, and a text that starts with no letter is as it came.
			["min_bytes must be a non-zero positive number", "Min_bytes must be a non-zero positive number"],
			["2 files are still uploading", "2 files are still uploading"],
			// The image check's texts the image editor never causes (error-wording.ts, IMAGE_OVER_KIB).
			[
				"invalid image: emoji images must be PNG, GIF, JPEG or WebP",
				"Invalid image: emoji images must be PNG, GIF, JPEG or WebP",
			],
			[
				"invalid image: sticker images can be 1024x1024 pixels at most",
				"Invalid image: sticker images can be 1024x1024 pixels at most",
			],
			["  poll not found ", "Poll not found"],
			// Not a known text, though the table's object has it.
			["constructor", "Constructor"],
			["", ""],
		] as const)
			expect(inAppWords(text, "Failed"), text).toBe(shown);
	});
});

// The pseudo-language (lib/i18n/pseudo.ts) accents every letter of every message, in brackets: a plain letter on screen
// is a word that came from no message.
describe("in another language", () => {
	afterEach(() => setLocalePref("en"));

	test("every permission error the API sends is in the app's language", async () => {
		await setLocalePref(PSEUDO);
		for (const [api] of PERMISSIONS) expect(inAppWords(api, ""), api).not.toMatch(/[A-Za-z]/);
	});

	test("every other text a user can meet is in the app's language, an upload's failure and a text with a value too", async () => {
		await setLocalePref(PSEUDO);
		for (const api of [
			...AS_THE_API_SAYS,
			...IN_APP_WORDS.map(([text]) => text),
			...UPLOADS,
			...OVER_LIMIT.map(([text]) => text),
			...WITH_A_VALUE,
		])
			expect(inAppWords(api, ""), api).not.toMatch(/[A-Za-z]/);
	});

	test("a field's name is in the app's language, in every sentence about it", async () => {
		await setLocalePref(PSEUDO);
		for (const field of FIELDS)
			for (const rule of ["required", "max", "min", "uuid", "oneof"])
				expect(inAppWords(validation(["P", field, rule]), ""), `${field} ${rule}`).not.toMatch(/[A-Za-z]/);
		// Each field a rule can name is a whole sentence of its own, not its name in another's.
		expect(inAppWords(validation(["SearchQuery", "Limit", "min"]), "")).toBe(
			t("error_validation_too_short", { field: "limit", name: "" }),
		);
		expect(inAppWords(validation(["BucketPayload", "BucketName", "required"]), "")).toBe(
			t("error_validation_required_one", { field: "bucket_name", name: "" }),
		);
		expect(
			inAppWords(
				validation(["BucketPayload", "BucketName", "required"], ["BucketPayload", "AccessKeyID", "required"]),
				"",
			),
		).toBe(
			capital(
				t("error_validation_required", {
					fields: formatList([t("error_field_bucket_name"), t("error_field_access_key_id")]),
				}),
			),
		);
	});

	test("the user's own fields are still asked for as theirs", async () => {
		await setLocalePref(PSEUDO);
		const logIn = validation(["AuthLogInPayload", "Email", "required"], ["AuthLogInPayload", "Password", "required"]);
		expect(inAppWords(logIn, "")).toBe(t("error_validation_enter_own", { fields: "email_password" }));
	});
});

describe("getApiError", () => {
	test("shows the API's reason in the app's words", () => {
		for (const [api, app] of KNOWN) expect(getApiError(refused(api), "Failed to send message")).toBe(app);
		expect(getApiError(refused("internal server error", 500), "Failed to create room")).toBe("Failed to create room");
	});

	test("still shows every other reason in the API's words, capital first, and its own errors and fallback as before", () => {
		expect(getApiError(refused("poll not found", 404), "Failed to open room")).toBe("Poll not found");
		expect(getApiError(new Error("No answer from the server in time"), "Failed")).toBe(
			"No answer from the server in time",
		);
		expect(getApiError("not an error", "Failed to open room")).toBe("Failed to open room");
	});

	// api.test.ts has fetch fail with each webview's words.
	test("a request that failed on the network says so in the app's words, and a bug's TypeError gives way", () => {
		expect(getApiError(new NetworkError(new TypeError("Load failed")), "Failed")).toBe("Failed to fetch");
		expect(getApiError(new NoAnswerError(), "Failed")).toBe("No answer from the server in time");
		// Not the network's: a caller's try block reading a property of null.
		expect(
			getApiError(new TypeError("Cannot read properties of null (reading 'type')"), "This interaction failed"),
		).toBe("This interaction failed");
	});
});
