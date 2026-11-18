// The API's error texts go to the user as they are (getApiError, lib/api/api.ts; the sign-in pages through
// lib/api/auth.ts). They are Go's: lowercase, some in a validator's or a decoder's own words, and they say "space",
// "user" and "conversation" where the app says Space, person and chat, and a few "channel" or "server", which the app
// never does (#357, docs/redesign/COPY.md §3, DECISIONS.md). The API can't change for this, so the texts a user can
// meet are put in the app's words here, on their way to the screen. Nothing sent or received changes.
//
// Only texts checked against the API are rewritten (api/internal/services/errors.go and the handlers in
// api/internal/http; the gateway has the first three permission texts too): any other text keeps its words, and
// takes only a capital first letter.
//   - "internal server error" gives way to what the app was doing;
//   - a field the API's validator refused ("Key: 'AuthLogInPayload.Email' Error:Field validation for 'Email' failed on
//     the 'required' tag") becomes a sentence about that field, and a body its decoder couldn't read gives way too;
//   - "you don't have permission to …" keeps its words, with room for channel and a capital on Space;
//   - the rest are listed, text by text (KNOWN).
// The texts with those two words are matched by pattern, not listed as strings: wording.test.ts keeps them out of the
// app's strings.

const INTERNAL = /^internal server error$/i;
const PERMISSION = /^you don't have permission to /i;
/** go-playground/validator's line for one field: the struct's field, then the rule it broke. */
const VALIDATION = /Key: '[^']*' Error:Field validation for '(\w+)' failed on the '(\w+)' tag/g;
/** What encoding/json, strconv, io and mime say of a body they couldn't read: nothing a user can act on. */
const DECODING =
	/^(json: |invalid character |unexpected end of JSON input$|unexpected EOF$|EOF$|strconv\.|parsing time |multipart: |mime: |http: )/;
/** An ID the API couldn't read, whichever handler says so: "invalid user_id", "invalid userId", "invalid space id". A
 * user ID is the one the user types themselves (adding a friend). */
const BAD_ID = /^invalid (user|space|room|message|conversation|member|role|invite|bucket|target)(?:_id| id|Id)\b/i;
/** The new group's member the user isn't friends with, named by ID. */
const NOT_FRIENDS_WITH = /^you must be friends with \S+$/i;

/** The API's texts a user can meet, in lower case, and the app's words for each. */
const KNOWN: Record<string, string> = {
	// Signing in and the account.
	"invalid email or password": "Wrong email or password",
	"too many failed login attempts, try again later": "Too many failed attempts to sign in. Try again later.",
	"too many requests, try again later": "Too many requests. Try again later.",
	"that username is taken": "That username is taken",
	"email is already in use": "That email is already in use",
	"email is already verified": "Your email is already verified",
	"email isn't the address the link was sent to": "That isn't the email address the link was sent to",
	"invalid or expired token": "This link is invalid or has expired",
	"couldn't send the email, try again later": "Couldn't send the email. Try again later.",
	"user has no email set": "This account has no email address",
	"password must not be empty": "Enter a password",
	"password must be at least 8 characters long": "Your password must be at least 8 characters long",
	"password must be at most 72 characters long": "Your password must be at most 72 characters long",
	"email must be verified to access developer features": "Verify your email to use the developer features",

	// Friends and people.
	"user not found": "That person wasn't found",
	"user_id is required": "Enter a user ID",
	"name is required": "Enter a name",
	"you are already friends with this user": "You're already friends with this person",
	"you must be friends with this user": "You must be friends with this person",
	"friend request already sent": "You already sent this person a friend request",
	"friend request not found": "That friend request is gone",
	"you cannot send a friend request to yourself": "You can't send yourself a friend request",
	"you are not the recipient of this friend request": "This friend request wasn't sent to you",
	"you are not a participant of this friend request": "This friend request isn't yours",
	"cannot send friend requests to bots": "A bot can't take a friend request",
	"the specified user is not a bot": "That account isn't a bot",

	// Chats: direct messages and groups.
	"conversation not found": "That chat wasn't found",
	"direct message not found": "That direct message wasn't found",
	"you are not a member of this conversation": "You're not in this chat",
	"user is already a member of this conversation": "This person is already in the group",
	"conversation member not found": "That person isn't in this chat",
	"cannot add members to a direct message conversation": "A direct message can't take more people",
	"direct messages can only have two members": "A direct message has two people only",
	"only the conversation owner can do this": "Only the group's owner can do this",
	"only group conversations can be renamed": "Only a group can be renamed",
	"cannot remove yourself": "You can't remove yourself",
	"cannot remove members from a dm": "Nobody can be removed from a direct message",
	"cannot create a dm with yourself": "You can't start a direct message with yourself",
	"user_ids is required for groups": "Pick who is in the group",
	"user_id is required for dms": "Pick who to message",

	// Spaces and their rooms.
	"space not found": "That Space wasn't found",
	"you are already a member of this space": "You're already a member of this Space",
	"you are not a member of this space": "You're not a member of this Space",
	"you are banned from this space": "You're banned from this Space",
	"you cannot be in more than 100 spaces": "You can't be in more than 100 Spaces",
	"the owner cannot leave the space": "The owner can't leave the Space",
	"only the space's owner can delete it": "Only the Space's owner can delete it",
	"the space's owner can't be kicked or banned": "The Space's owner can't be kicked or banned",
	"you can't kick or ban yourself: leave the space instead": "You can't kick or ban yourself. Leave the Space instead.",
	"you can only kick or ban members whose highest role is below your highest role":
		"You can only kick or ban members whose highest role is below your highest role",
	"you cannot manage a role higher than or equal to your highest role":
		"You can't manage a role at or above your highest role",
	"you cannot grant or deny permissions you don't have": "You can't grant or deny permissions you don't have",
	"overwrite target is not a role or member of this space": "That isn't a role or a member of this Space",
	"invite link not found or has expired": "This invite link doesn't exist or has expired",
	"this space already has 1000 invites that work; revoke some first":
		"This Space already has 1000 invites that work. Revoke some first.",
	"room not found or you're not a member of that space": "That room doesn't exist, or you're not a member of its Space",
	"no access to this room": "You don't have access to this room",
	"replied message must be in the same room": "A reply must be in the same room as its message",
	"webhooks can only be created on text rooms": "Webhooks can only be created in text rooms",
	"the person who used the interaction can no longer see its room":
		"The person who used the interaction can no longer see its room",

	// Bots in a Space, and a Space's storage.
	"this bot is already a member of the space": "This bot is already in the Space",
	"this bot is banned from this space": "This bot is banned from this Space",
	"the application's bot is not in this space": "The application's bot isn't in this Space",
	"a space has no default storage": "A Space has no default storage",
	"this space does not have a storage bucket configured": "This Space has no storage bucket set up",
};

/** A struct field's name as words: "Email" is "email", "BucketName" "bucket name", "UserID" "user ID". */
function fieldWords(field: string): string {
	return field
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.split(" ")
		.map((word) => (/^(IDs?|FID|URL|IP|OS)$/.test(word) ? word : word.toLowerCase()))
		.join(" ");
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "email", "email and password", "username, email and password". */
function listed(words: string[]): string {
	return words.length < 3 ? words.join(" and ") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** The fields that are the user's own: a form that lacks one asks for "your" email. */
const OWN = new Set(["email", "password", "username"]);

/** What the validator refused, as a sentence: the fields that are missing, together, else the first field's fault. */
function validationWords(refused: { field: string; rule: string }[]): string {
	const missing = [...new Set(refused.filter((r) => r.rule === "required").map((r) => fieldWords(r.field)))];
	if (missing.length > 0) {
		if (missing.every((field) => OWN.has(field))) return `Enter your ${listed(missing)}`;
		return `${capital(listed(missing))} ${missing.length === 1 ? "is" : "are"} required`;
	}
	const { field, rule } = refused[0]!;
	const name = capital(fieldWords(field));
	if (rule === "max") return `${name} is too long`;
	if (rule === "min") return `${name} is too short`;
	if (rule === "email") return "Enter a valid email address";
	if (rule === "uuid") return `${name} isn't a valid ID`;
	return `${name} isn't valid`;
}

/**
 * An API error's text in the app's words. A text the app knows is put in its words; one that tells the user nothing
 * ("internal server error", a decoder's complaint) gives way to the caller's own message (`fallback`) when there is
 * one. Any other text comes back in the API's words, with a capital first letter: Go's start in lower case.
 */
export function inAppWords(text: string, fallback: string): string {
	const trimmed = text.trim();
	if (INTERNAL.test(trimmed)) return fallback || "Something went wrong on Duvet's side";
	const refused = [...trimmed.matchAll(VALIDATION)].map((m) => ({ field: m[1]!, rule: m[2]! }));
	if (refused.length > 0) return validationWords(refused);
	if (DECODING.test(trimmed)) return fallback || "That didn't go through. Try again.";
	if (PERMISSION.test(trimmed))
		return capital(trimmed)
			.replace(/\bchannels\b/gi, "rooms")
			.replace(/\bchannel\b/gi, "room")
			.replace(/\bspace\b/g, "Space");
	const known = KNOWN[trimmed.toLowerCase()];
	if (known) return known;
	if (NOT_FRIENDS_WITH.test(trimmed)) return "You must be friends with everyone you add";
	const badId = BAD_ID.exec(trimmed);
	if (badId)
		return badId[1]!.toLowerCase() === "user" ? "That isn't a valid user ID" : fallback || "That ID isn't valid";
	// A text the app doesn't know keeps the API's words, but starts as every sentence on screen does (COPY.md, Errors).
	return capital(trimmed);
}
