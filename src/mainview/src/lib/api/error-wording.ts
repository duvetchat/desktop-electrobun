// The API's error texts go to the user as they are (getApiError, lib/api/api.ts; the sign-in pages through
// lib/api/auth.ts). They are Go's: lowercase, some in a validator's or a decoder's own words, and they say "space",
// "user" and "conversation" where the app says Space, person and chat, and a few "channel" or "server", which the app
// never does (#357, docs/redesign/COPY.md §3, DECISIONS.md). The API can't change for this, so the texts a user can
// meet are put in the app's words here, on their way to the screen. Nothing sent or received changes.
//
// Only texts checked against the API are rewritten (api/internal/services/errors.go and the handlers in
// api/internal/http; the gateway sends six of the permission texts too, gateway/internal/core/services/errors.go): any
// other text keeps its words, and takes only a capital first letter.
//   - "internal server error" gives way to what the app was doing;
//   - a field the API's validator refused ("Key: 'AuthLogInPayload.Email' Error:Field validation for 'Email' failed on
//     the 'required' tag") becomes a sentence about that field, and a body its decoder couldn't read gives way too;
//   - "you don't have permission to …" is listed by what it refuses, with room for channel (PERMISSIONS); one the
//     list doesn't have keeps its words, with room for channel and a capital on Space;
//   - the rest are listed, text by text (KNOWN), and the texts that carry a value (a size, a bucket's reason) by
//     pattern; an upload's failure is listed by its cause, as a select on what was uploaded (UPLOAD_CAUSES,
//     FILE_TOO_LARGE: "failed to upload attachment: file is too large: 26214400 bytes, your limit is 20971520").
// The texts with those two words are matched by pattern, not listed as strings: wording.test.ts keeps them out of the
// app's strings.
//
// The API's texts are what it sends, and stay as they are here: they're what a text is matched by. The app's words for
// them are messages (#464), in the app's language; a text the app doesn't know is shown in the API's words.
import { currentLocale, t, type MessageKey } from "$lib/i18n";
import { formatList } from "$lib/i18n/format";

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
/** An upload that failed, what it was, and why after the colon: a message's files or a Space's emoji or sticker
 * (attachment), a profile's, a bot's or a webhook's images, a Space's (api/internal/services/user.go, and the handlers
 * user.go, space.go, developer.go, webhook.go and conversation.go of api/internal/http). */
const UPLOAD_FAILED = /^failed to upload (attachment|avatar|banner|icon): (.+)$/i;
/** A file over the per-file limit where it goes, the user's or the bucket's (api/internal/services/attachments.go):
 * ErrFileTooLarge always comes with the file's size and that limit, in bytes, and only as an upload's cause. */
const FILE_TOO_LARGE = /^file is too large: (\d+) bytes, (your|the bucket's) limit is (\d+)$/i;
/** An emoji's or a sticker's image over its size cap (api/internal/services/space_images.go): an animated GIF from the
 * image editor can be. The check's other three texts (the image's type, one it can't read, its size in pixels) are
 * left in the API's words: the editor makes a PNG, a WebP or a GIF it can read, of 128 or 320 px, under those caps. */
const IMAGE_OVER_KIB = /^invalid image: (emoji|sticker) images can be (\d+) KiB at most$/i;
/** A transfer's bucket that didn't take its probe, the target or the source, and why: it refused the credentials, has
 * no such bucket, answered with an HTTP status, or didn't answer (api/internal/services/storage_transfers.go,
 * storageReason). */
const BUCKET_UNREACHABLE =
	/^storage bucket unreachable: the (target|source) (?:(refused) the credentials|(has no) such bucket|answered (\d+)|didn't answer)$/i;

/** The API's texts a user can meet, in lower case, and the message that says each in the app's words. The ones the app
 * doesn't reword say the API's words, with a capital first letter, in English. */
const KNOWN: Record<string, MessageKey> = {
	// Signing in and the account.
	"invalid email or password": "error_wrong_credentials",
	"too many failed login attempts, try again later": "error_too_many_sign_in_attempts",
	"too many requests, try again later": "error_too_many_requests",
	"that username is taken": "error_username_taken",
	"email is already in use": "error_email_in_use",
	"email is already verified": "error_email_already_verified",
	"email isn't the address the link was sent to": "error_email_not_link_address",
	"invalid or expired token": "error_link_expired",
	"couldn't send the email, try again later": "error_email_not_sent",
	"user has no email set": "error_account_without_email",
	"password must not be empty": "error_password_empty",
	"password must be at least 8 characters long": "error_password_too_short",
	"password must be at most 72 characters long": "error_password_too_long",
	"email must be verified to access developer features": "error_developer_needs_verified_email",
	"username must not be empty": "error_username_empty",
	"email must be an address alone, without a name or angle brackets": "error_email_not_bare",
	"username must be at most 32 characters": "error_username_too_long",
	"display name must be at most 32 characters": "error_display_name_too_long",
	"bio must be at most 190 characters": "error_bio_too_long",
	"avatar file too large (max 10mb)": "error_avatar_too_large",
	"banner file too large (max 10mb)": "error_banner_too_large",
	"image too large (max 10mb)": "error_image_too_large",
	"failed to read file": "error_file_unreadable",
	"failed to update profile": "error_profile_not_saved",
	"failed to fetch user": "error_account_not_loaded",

	// The session, as the API checks it on each request.
	"authentication required: no access token provided": "error_session_no_access_token",
	"authentication required: no session token provided": "error_session_no_session_token",
	"session expired": "error_session_expired",
	"user associated with this session no longer exists": "error_session_account_gone",
	"access token does not match session": "error_session_token_mismatch",
	"session invalid or expired": "error_session_invalid",
	"database error during authentication": "error_session_check_failed",
	"failed to retrieve user data": "error_session_account_not_loaded",

	// Friends and people.
	"user not found": "error_person_not_found",
	"user_id is required": "error_user_id_missing",
	"name is required": "error_name_missing",
	"you are already friends with this user": "error_already_friends",
	"you must be friends with this user": "error_not_friends",
	"friend request already sent": "error_friend_request_already_sent",
	"friend request not found": "error_friend_request_gone",
	"you cannot send a friend request to yourself": "error_friend_request_to_self",
	"you are not the recipient of this friend request": "error_friend_request_not_to_you",
	"you are not a participant of this friend request": "error_friend_request_not_yours",
	"cannot send friend requests to bots": "error_friend_request_to_bot",
	"the specified user is not a bot": "error_not_a_bot",

	// Chats: direct messages and groups.
	"conversation not found": "error_chat_not_found",
	"direct message not found": "error_direct_message_not_found",
	"you are not a member of this conversation": "error_not_in_chat",
	"user is already a member of this conversation": "error_already_in_group",
	"conversation member not found": "error_chat_member_not_found",
	"cannot add members to a direct message conversation": "error_direct_message_add_people",
	"direct messages can only have two members": "error_direct_message_two_people",
	"only the conversation owner can do this": "error_group_owner_only",
	"only group conversations can be renamed": "error_rename_groups_only",
	"cannot remove yourself": "error_remove_yourself",
	"cannot remove members from a dm": "error_direct_message_remove_people",
	"cannot create a dm with yourself": "error_direct_message_with_yourself",
	"user_ids is required for groups": "error_group_members_missing",
	"user_id is required for dms": "error_direct_message_recipient_missing",

	// Spaces and their rooms.
	"space not found": "error_space_not_found",
	"you are already a member of this space": "error_already_space_member",
	"you are not a member of this space": "error_not_space_member",
	"you are banned from this space": "error_banned_from_space",
	"you cannot be in more than 100 spaces": "error_space_limit",
	"the owner cannot leave the space": "error_owner_cannot_leave",
	"only the space's owner can delete it": "error_space_delete_owner_only",
	"the space's owner can't be kicked or banned": "error_owner_cannot_be_removed",
	"you can't kick or ban yourself: leave the space instead": "error_remove_yourself_from_space",
	"you can only kick or ban members whose highest role is below your highest role": "error_remove_higher_role",
	"you cannot manage a role higher than or equal to your highest role": "error_manage_higher_role",
	"you cannot grant or deny permissions you don't have": "error_permissions_not_yours",
	"overwrite target is not a role or member of this space": "error_overwrite_target_unknown",
	"invite link not found or has expired": "error_invite_gone",
	"this space already has 1000 invites that work; revoke some first": "error_invite_limit",
	"room not found or you're not a member of that space": "error_room_not_found",
	"no access to this room": "error_room_no_access",
	"replied message must be in the same room": "error_reply_other_room",
	"webhooks can only be created on text rooms": "error_webhook_text_rooms_only",
	"the person who used the interaction can no longer see its room": "error_interaction_room_hidden",
	"role not found": "error_role_not_found",
	"overwrite not found": "error_overwrite_not_found",
	"categories do not support permission overwrites": "error_category_overwrite",
	"parent_id must be a category of this space": "error_room_parent_not_category",
	"member not found": "error_member_not_found",
	"ban not found": "error_ban_not_found",
	"reason must be at most 512 characters": "error_ban_reason_too_long",
	"icon file too large (max 10mb)": "error_icon_too_large",
	"webhook not found": "error_webhook_not_found",

	// Messages: sent, edited, searched and pinned, with their files, emojis and stickers.
	"message not found": "error_message_not_found",
	"cannot edit someone else's message": "error_edit_not_yours",
	"referenced message not found": "error_reply_target_not_found",
	"this message is still being sent with this nonce: try again": "error_message_still_sending",
	"the message sent with this nonce has been deleted": "error_message_sent_then_deleted",
	"a value is longer than its field allows": "error_value_too_long",
	"text can't contain nul (u+0000) characters or invalid utf-8": "error_text_unstorable",
	"the request body is over 32 mib": "error_request_too_large",
	"attachment not found": "error_attachment_not_found",
	"failed to open file": "error_file_unopenable",
	"failed to fetch attachments": "error_attachments_not_loaded",
	"failed to get members": "error_reaction_people_not_loaded",
	"emoji not found": "error_emoji_not_found",
	"sticker not found": "error_sticker_not_found",
	"that sticker can't be sent here": "error_sticker_not_here",
	"search for some text or with a filter": "error_search_empty",
	"the search took too long, narrow it down": "error_search_timeout",
	"there are 250 pinned messages here already, unpin one first": "error_pin_limit",
	"a pin or call notice can't be pinned": "error_notice_not_pinnable",
	"a pin or call notice can't be edited": "error_notice_not_editable",

	// Bots and their applications, teams and interactions.
	"this bot is already a member of the space": "error_bot_already_in_space",
	"this bot is banned from this space": "error_bot_banned",
	"the application's bot is not in this space": "error_bot_not_in_space",
	"this bot is private — only team members can add it": "error_bot_private",
	"application not found": "error_application_not_found",
	"application already has a bot": "error_application_has_bot",
	"application has no bot": "error_application_without_bot",
	"failed to update bot profile": "error_bot_profile_not_saved",
	"you need an active storage bucket to upload bot images": "error_bot_images_need_bucket",
	"team not found": "error_team_not_found",
	"not a team member": "error_not_team_member",
	"not a team admin": "error_not_team_admin",
	"only the owner can edit the team": "error_team_edit_owner_only",
	"only the owner can delete the team": "error_team_delete_owner_only",
	"the team's owner can't be removed": "error_team_owner_cannot_be_removed",
	"team invite not found": "error_team_invite_not_found",
	"cannot invite a bot to a team": "error_team_invite_bot",
	"the application did not respond": "error_interaction_no_response",
	"the application's response failed": "error_interaction_failed",
	"unknown command": "error_command_gone",
	"unknown modal": "error_modal_gone",

	// Storage: Duvet's, a Space's, and storage buckets, with the moves of files between them.
	"a space has no default storage": "error_space_no_default_storage",
	"this space does not have a storage bucket configured": "error_space_no_bucket",
	"bucket not found": "error_bucket_not_found",
	"bucket has files": "error_bucket_has_files",
	"bucket is in a transfer": "error_bucket_in_transfer",
	"bucket files are in use as images: change them first": "error_bucket_images_in_use",
	"invalid bucket": "error_bucket_invalid",
	// A bucket's settings the API refused, and why (api/internal/services/attachments.go: checkBucketEndpoint,
	// bucketCheckError).
	"invalid storage configuration: the endpoint must be an https url, without user info, query or fragment":
		"error_bucket_endpoint_not_https",
	"invalid storage configuration: the endpoint must be on port 443": "error_bucket_endpoint_port",
	"invalid storage configuration: the bucket refused these credentials": "error_bucket_credentials_refused",
	"invalid storage configuration: no such bucket at this endpoint": "error_bucket_not_at_endpoint",
	"invalid storage configuration: could not reach the bucket at this endpoint": "error_bucket_endpoint_unreachable",
	"max_bytes must be a non-zero positive number": "error_bucket_max_bytes_invalid",
	"max_bytes is below what the bucket holds: move or delete files first": "error_bucket_max_below_usage",
	"upload_limit_bytes must be a non-zero positive number": "error_upload_limit_invalid",
	"failed to fetch buckets": "error_buckets_not_loaded",
	"failed to activate bucket": "error_bucket_not_activated",
	"failed to deactivate bucket": "error_bucket_not_deactivated",
	"failed to fetch storage status": "error_storage_status_not_loaded",
	"failed to delete attachments": "error_attachments_not_deleted",
	"transfer not found": "error_transfer_not_found",
	"a transfer is already running": "error_transfer_running",
	"the transfer has ended": "error_transfer_ended",
	"a bucket of the transfer changed while it began, try again": "error_transfer_bucket_changed",
	"source and target must differ": "error_transfer_same_storage",
	"keep_source needs a bucket as the source": "error_transfer_keep_source_needs_bucket",
	'source and target are "default" or a bucket id': "error_transfer_storage_invalid",
	"not enough room in the target": "error_transfer_no_room",
};

/** What an upload's failure says after its colon, for the causes the API wraps so (ErrStorageFull and the ErrUpload*
 * errors of api/internal/services/errors.go, which never come alone), in lower case, and the message that says the
 * whole sentence: a select on what was uploaded, so its English is the API's sentence with a capital first letter. A
 * file over a limit is FILE_TOO_LARGE's. */
const UPLOAD_CAUSES: Record<string, MessageKey> = {
	"not enough storage space for this file": "error_upload_failed_storage_full",
	"the storage bucket was pointed elsewhere during the upload, try again": "error_upload_failed_bucket_moved",
	"the storage bucket was removed during the upload, try again": "error_upload_failed_bucket_removed",
	"the upload took too long and its file wasn't kept, try again": "error_upload_failed_too_slow",
	"the file's storage failed": "error_upload_failed_storage_error",
	"the file's storage didn't answer in time": "error_upload_failed_storage_no_answer",
};

/** What the API's "you don't have permission to …" says the user may not do, in lower case and with room for channel,
 * and the message that says the whole sentence in the app's words. */
const PERMISSIONS: Record<string, MessageKey> = {
	"view this room": "error_no_permission_view_room",
	"send messages in this room": "error_no_permission_send",
	"pin messages in this room": "error_no_permission_pin",
	"delete this message": "error_no_permission_delete_message",
	"manage rooms": "error_no_permission_manage_rooms",
	"manage roles": "error_no_permission_manage_roles",
	"manage permissions for this room": "error_no_permission_manage_room_permissions",
	"manage this space": "error_no_permission_manage_space",
	"manage space emojis": "error_no_permission_manage_emojis",
	"manage space stickers": "error_no_permission_manage_stickers",
	"manage space attachments": "error_no_permission_manage_attachments",
	"manage storage buckets for this space": "error_no_permission_manage_buckets",
	"manage webhooks in this space": "error_no_permission_manage_webhooks",
	"manage bots in this space": "error_no_permission_manage_bots",
	"manage invite links for this space": "error_no_permission_manage_invites",
	"create invite links for this space": "error_no_permission_create_invites",
	"kick members": "error_no_permission_kick",
	"ban members": "error_no_permission_ban",
};

/** The fields the API's validator can name (the binding rules of api/internal/http/serializers), by their struct
 * names, and the message that is each one's name, for a list of the missing ones. A field's English is its words
 * (fieldWords). A sentence about one field is a select on it instead (fieldCase), each case a whole sentence that can
 * agree with the field's gender. */
const FIELDS: Record<string, MessageKey> = {
	AccessKeyID: "error_field_access_key_id",
	After: "error_field_after",
	AuthorIDs: "error_field_author_ids",
	Before: "error_field_before",
	BucketName: "error_field_bucket_name",
	Content: "error_field_content",
	Cursor: "error_field_cursor",
	DefaultNotifications: "error_field_default_notifications",
	Email: "error_field_email",
	EmojiName: "error_field_emoji_name",
	Endpoint: "error_field_endpoint",
	FID: "error_field_fid",
	Has: "error_field_has",
	Level: "error_field_level",
	Limit: "error_field_limit",
	MaxAge: "error_field_max_age",
	Mentions: "error_field_mentions",
	MessageID: "error_field_message_id",
	Name: "error_field_name",
	Nonce: "error_field_nonce",
	Password: "error_field_password",
	Query: "error_field_query",
	RoomIDs: "error_field_room_ids",
	SecretAccessKey: "error_field_secret_access_key",
	Source: "error_field_source",
	StartedAt: "error_field_started_at",
	Status: "error_field_status",
	Target: "error_field_target",
	TargetID: "error_field_target_id",
	TargetType: "error_field_target_type",
	Token: "error_field_token",
	Type: "error_field_type",
	UserID: "error_field_user_id",
	Username: "error_field_username",
};

/** A struct field's name as words: "Email" is "email", "BucketName" "bucket name", "UserID" "user ID". They're the
 * API's names for its fields, in English. */
function fieldWords(field: string): string {
	return field
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.split(" ")
		.map((word) => (/^(IDs?|FID|URL|IP|OS)$/.test(word) ? word : word.toLowerCase()))
		.join(" ");
}

/** A field's name in the app's language (FIELDS), or in the API's words for one the app doesn't know. */
const fieldName = (struct: string) => (Object.hasOwn(FIELDS, struct) ? t(FIELDS[struct]!) : fieldWords(struct));

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A sentence about one field: its case in the rule's select is the field's FIELDS key without error_field_
 * ("bucket_name"), and a field the rule's select has no case for (one the app doesn't know) says its name in the other
 * case. The other case may start with that name, in lower case: the sentence takes a capital. */
const aboutField = (key: MessageKey, struct: string) =>
	capital(
		t(key, {
			field: Object.hasOwn(FIELDS, struct) ? FIELDS[struct]!.slice("error_field_".length) : "other",
			name: fieldName(struct),
		}),
	);

/** Fields' names joined as a list, as the locale lists them; in English as the app always has, whatever the region:
 * "name, endpoint and bucket name", where US English's list has a comma before "and". */
function listed(names: string[]): string {
	if (currentLocale() !== "en") return formatList(names);
	return names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The fields that are the user's own, in the order the sign-up form and the API's payloads have them: a form that
 * lacks one asks for "your" email. */
const OWN = ["username", "email", "password"];

/** What the validator refused, as a sentence: the fields that are missing, together, else the first field's fault. */
function validationWords(refused: { field: string; rule: string }[]): string {
	const missing = [...new Set(refused.filter((r) => r.rule === "required").map((r) => r.field))];
	if (missing.length > 0) {
		// Which of the user's own are missing names the sentence's case: "email_password". It's read from the API's names,
		// in English, whatever the app's language.
		const words = missing.map(fieldWords);
		if (words.every((field) => OWN.includes(field)))
			return t("error_validation_enter_own", { fields: OWN.filter((field) => words.includes(field)).join("_") });
		if (missing.length === 1) return aboutField("error_validation_required_one", missing[0]!);
		// Two or more: a list of their names, which the sentence is phrased not to agree with.
		return capital(t("error_validation_required", { fields: listed(missing.map(fieldName)) }));
	}
	const { field: struct, rule } = refused[0]!;
	if (rule === "max") return aboutField("error_validation_too_long", struct);
	if (rule === "min") return aboutField("error_validation_too_short", struct);
	if (rule === "email") return t("error_validation_email");
	if (rule === "uuid") return aboutField("error_validation_invalid_id", struct);
	return aboutField("error_validation_invalid", struct);
}

/**
 * An API error's text in the app's words. A text the app knows is put in its words; one that tells the user nothing
 * ("internal server error", a decoder's complaint) gives way to the caller's own message (`fallback`) when there is
 * one. Any other text comes back in the API's words, with a capital first letter: Go's start in lower case.
 */
export function inAppWords(text: string, fallback: string): string {
	const trimmed = text.trim();
	if (INTERNAL.test(trimmed)) return fallback || t("error_internal");
	const refused = [...trimmed.matchAll(VALIDATION)].map((m) => ({ field: m[1]!, rule: m[2]! }));
	if (refused.length > 0) return validationWords(refused);
	if (DECODING.test(trimmed)) return fallback || t("error_unreadable_request");
	if (PERMISSION.test(trimmed)) {
		const what = trimmed
			.replace(PERMISSION, "")
			.toLowerCase()
			.replace(/\bchannels\b/g, "rooms")
			.replace(/\bchannel\b/g, "room");
		if (Object.hasOwn(PERMISSIONS, what)) return t(PERMISSIONS[what]!);
		// One the app doesn't know yet keeps the API's words, but for room and Space.
		return capital(trimmed)
			.replace(/\bchannels\b/gi, "rooms")
			.replace(/\bchannel\b/gi, "room")
			.replace(/\bspace\b/g, "Space");
	}
	const lower = trimmed.toLowerCase();
	if (Object.hasOwn(KNOWN, lower)) return t(KNOWN[lower]!);
	// An upload's failure whose cause the app knows: the whole sentence, with what was uploaded.
	const upload = UPLOAD_FAILED.exec(trimmed);
	if (upload) {
		const what = upload[1]!.toLowerCase();
		const cause = upload[2]!.toLowerCase();
		if (Object.hasOwn(UPLOAD_CAUSES, cause)) return t(UPLOAD_CAUSES[cause]!, { what });
		const over = FILE_TOO_LARGE.exec(cause);
		if (over)
			return t("error_upload_failed_file_too_large", {
				what,
				whose: over[2] === "your" ? "yours" : "bucket",
				size: Number(over[1]),
				limit: Number(over[3]),
			});
	}
	const heavy = IMAGE_OVER_KIB.exec(trimmed);
	if (heavy) return t("error_image_over_kib", { kind: heavy[1]!.toLowerCase(), kib: Number(heavy[2]) });
	const unreachable = BUCKET_UNREACHABLE.exec(trimmed);
	if (unreachable) {
		const [, side, refusedKeys, noBucket, status] = unreachable;
		return t("error_bucket_unreachable", {
			side: side!.toLowerCase(),
			why: refusedKeys ? "refused" : noBucket ? "missing" : status ? "status" : "other",
			// An HTTP status: a code, not a quantity.
			status: status ?? "",
		});
	}
	if (NOT_FRIENDS_WITH.test(trimmed)) return t("error_not_friends_with_everyone");
	const badId = BAD_ID.exec(trimmed);
	if (badId) return badId[1]!.toLowerCase() === "user" ? t("error_invalid_user_id") : fallback || t("error_invalid_id");
	// A text the app doesn't know keeps the API's words, but starts as every sentence on screen does (COPY.md, Errors).
	return capital(trimmed);
}

// A move of files between storages keeps why it stopped (StorageTransfer.error), and why each file it couldn't move
// failed (StorageTransferFile.error), in the API's words: lower case, after "Moving files failed:" or under the file's
// name (api/internal/services/storage_transfers.go: finish, bucketFailed, copyFile, checkTarget, storageReason). Their
// English messages are those words.

/** Why a transfer stopped, when it's a text of its own. */
const TRANSFER_REASONS: Record<string, MessageKey> = {
	"target full": "storage_transfer_reason_target_full",
	"a bucket of the transfer is gone": "storage_transfer_reason_bucket_gone",
	"internal error": "storage_transfer_reason_internal",
};

/** Why a file of a transfer failed, when it's a text of its own. */
const FILE_REASONS: Record<string, MessageKey> = {
	"not in the source": "storage_file_reason_not_in_source",
	"the source has other content than was uploaded": "storage_file_reason_other_content",
	"size mismatch in the source": "storage_file_reason_source_size",
	"size mismatch in the target": "storage_file_reason_target_size",
	"the target has another file under its key": "storage_file_reason_target_has_other",
};

/** A transfer's bucket that a call couldn't reach, and why (storageReason), or a target that took a file and kept
 * nothing. */
const TRANSFER_UNREACHABLE =
	/^(source|target) unreachable: (?:(refused) the credentials|(has no) such bucket|answered (\d+)|(kept nothing)|didn't answer)$/;
/** A file a transfer's bucket refused to give or take, and why (storageReason). */
const FILE_REFUSED =
	/^the (source|target) refused it: (?:(refused) the credentials|(has no) such bucket|answered (\d+)|didn't answer)$/;

/** The values of a reason that names the source or the target and why: its side, why, and an HTTP status, a code. */
function storageWhy(match: RegExpExecArray): { side: string; why: string; status: string } {
	const [, side, refused, missing, status, keptNothing] = match;
	return {
		side: side!,
		why: refused ? "refused" : missing ? "missing" : status ? "status" : keptNothing ? "kept_nothing" : "other",
		status: status ?? "",
	};
}

/** Why a transfer stopped (StorageTransfer.error), in the app's words; one the app doesn't know, as the API sent it. */
export function transferReason(error: string): string {
	if (Object.hasOwn(TRANSFER_REASONS, error)) return t(TRANSFER_REASONS[error]!);
	const unreachable = TRANSFER_UNREACHABLE.exec(error);
	if (unreachable) return t("storage_transfer_reason_unreachable", storageWhy(unreachable));
	return error;
}

/** Why a file of a transfer failed (StorageTransferFile.error), in the app's words; one the app doesn't know, as the
 * API sent it. */
export function transferFileReason(error: string): string {
	if (Object.hasOwn(FILE_REASONS, error)) return t(FILE_REASONS[error]!);
	const refused = FILE_REFUSED.exec(error);
	if (refused) return t("storage_file_reason_refused", storageWhy(refused));
	return transferReason(error);
}
