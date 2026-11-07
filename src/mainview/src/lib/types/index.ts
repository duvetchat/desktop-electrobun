import { getAvatarURL } from "$lib/common/common";
import { memberMobileOnly, memberStatus } from "$lib/status";
import type { Conversation, DirectMessage } from "$lib/api/conversations";
import type { UserActivity } from "$lib/stores.svelte";

export interface EmbedMedia {
	url: string;
	width?: number | null;
	height?: number | null;
	/** A video's media type, when known: video/* plays as a file, text/html is a player page. */
	content_type?: string;
}

export interface EmbedFooter {
	text: string;
	icon_url?: string | null;
}

export interface EmbedAuthor {
	name: string;
	url?: string | null;
	icon_url?: string | null;
}

export interface EmbedField {
	name: string;
	value: string;
	inline: boolean;
}

export interface EmbedColor {
	color_from?: number | null;
	color_via?: number | null;
	color_to?: number | null;
}

export const EmbedType = {
	Rich: "rich",
	Video: "video",
	Gifv: "gifv",
	Image: "image",
	Audio: "audio",
	Sticker: "sticker",
} as const;

export interface Embed {
	type?: string | null;
	provider?: string;
	title?: string | null;
	description?: string | null;
	url?: string | null;
	timestamp?: string | null;
	color?: EmbedColor | null;
	footer?: EmbedFooter | null;
	image?: EmbedMedia | null;
	thumbnail?: EmbedMedia | null;
	video?: EmbedMedia | null;
	author?: EmbedAuthor | null;
	fields?: EmbedField[];
	/** The card a link's page publishes for its previews: a single container, drawn in place of the rest. */
	components?: Component[];
}

export interface Attachment {
	id: string;
	message_id: string | null;
	filename: string;
	content_type: string;
	size_bytes: number;
	width?: number | null;
	height?: number | null;
	created_at: string;
	deleted_at?: string | null;
	deleted?: boolean;
	pending?: boolean;
	url?: string;
}

export const MessageReferenceType = {
	Reply: 0,
} as const;

export type MessageReferenceType = (typeof MessageReferenceType)[keyof typeof MessageReferenceType];

export interface MessageReference {
	type?: MessageReferenceType | null;
	message_id?: string | null;
	room_id?: string | null;
	space_id?: string | null;
	fail_if_not_exists?: boolean;
}

/** What a new message says about the mentions it makes beyond its text. */
export interface AllowedMentions {
	/** Whether a reply mentions the author of the message it replies to. Without allowed_mentions it does. */
	replied_user: boolean;
}

export interface ReferencedMessage {
	type: number | null;
	message_id: string | null;
	room_id: string | null;
	space_id: string | null;
	/** Whether the reply mentions the author of the message it replies to; it stays once that message is deleted. */
	mention_author?: boolean;
	content?: string | null;
	author_id?: string;
	author_name?: string;
	author_avatar?: string | null;
	created_at?: string;
}

export const MessageType = {
	Text: 0,
	Voice: 1,
	/** A room's or conversation's notice that its author pinned the message it references; no content. */
	PinNotice: 2,
	/** A conversation's notice that a call in it ended, by its caller; no content, and its call says who was in it. */
	Call: 3,
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

/** What a call notice (MessageType.Call) says about its call (calls.Notice in the API). */
export interface CallNotice {
	/** Who was in the call, by user ID: its caller first, then each member who joined its voice, once. The caller alone
	 * is a call nobody else got into. */
	participants: string[];
	/** When it started ringing, and when it ended. */
	started_at: string;
	ended_at: string;
}

export const MessageFlag = {
	/**
	 * A bot's response to an interaction, or a follow-up, that only the user who used it sees. It isn't one of
	 * the room's messages: no history has it, so it lasts until dismissed or the app reloads.
	 */
	Ephemeral: 1 << 6,
	/** A bot's deferred response to an interaction, which it completes by editing the message. */
	Loading: 1 << 7,
	/** The components are the whole message: it has no content, embeds or files of its own. */
	IsComponentsV2: 1 << 15,
} as const;

/** What a message a bot sends for an interaction says about it (interactions.Metadata in the API). */
export interface InteractionMetadata {
	id: string;
	/** 2 for a command, 3 for a component, 5 for a modal's submit. */
	type: number;
	/** Who used it, as they were when the message was made. */
	user: { id: string; username: string; alias: string | null; avatar: string | null };
	/** The message whose component was used, for a component's interaction. */
	interacted_message_id?: string;
	/** The interaction's first response, on its follow-ups. */
	original_response_message_id?: string;
	/** The command's name, for a command's interaction. */
	name?: string;
}

/** The option types of an application's command (commands.OptionType in the API). */
export const CommandOptionType = {
	/** Something a command does, with options of its own. */
	Subcommand: 1,
	/** Subcommands that go together. */
	SubcommandGroup: 2,
	String: 3,
	Integer: 4,
	Boolean: 5,
	User: 6,
	Room: 7,
	Role: 8,
	Mentionable: 9,
	Number: 10,
} as const;

/**
 * What a command takes; the required ones come first. A command's options are all subcommands and groups of them,
 * or none: a subcommand's options take values, and a group's are its subcommands.
 */
export interface CommandOption {
	type: number;
	name: string;
	description: string;
	required?: boolean;
	/** A subcommand's options, or a group's subcommands. */
	options?: CommandOption[];
	/** The only values it takes, for string, integer and number options. */
	choices?: { name: string; value: string | number }[];
	min_value?: number;
	max_value?: number;
	min_length?: number;
	max_length?: number;
	room_types?: RoomType[];
}

/** A chat command an application registers. */
export interface ApplicationCommand {
	id: string;
	/** 1, a chat command. */
	type: number;
	application_id: string;
	name: string;
	description: string;
	options: CommandOption[];
	version: string;
}

export interface SpaceCommandApplication {
	id: string;
	name: string;
	bot: { id: string; username: string; alias: string | null; avatar: string | null };
}

/** The commands a member can use in a space: those of the applications whose bots are in it. */
export interface SpaceCommands {
	applications: SpaceCommandApplication[];
	commands: ApplicationCommand[];
}

/** The component types of messages and modals (components.Type in the API). */
export const ComponentType = {
	ActionRow: 1,
	Button: 2,
	StringSelect: 3,
	/** A modal's. */
	TextInput: 4,
	UserSelect: 5,
	RoleSelect: 6,
	MentionableSelect: 7,
	RoomSelect: 8,
	Section: 9,
	TextDisplay: 10,
	Thumbnail: 11,
	MediaGallery: 12,
	File: 13,
	Separator: 14,
	Container: 17,
	/** A modal's: the label of the input it holds. */
	Label: 18,
	/** A modal's. */
	RadioGroup: 21,
	/** A modal's. */
	CheckboxGroup: 22,
	/** A modal's. */
	Checkbox: 23,
} as const;

export type ComponentType = (typeof ComponentType)[keyof typeof ComponentType];

export const ButtonStyle = {
	Primary: 1,
	Secondary: 2,
	Success: 3,
	Danger: 4,
	/** Opens its url instead of sending an interaction. */
	Link: 5,
} as const;

/** A button's or an option's emoji: a space emoji by id, or a Unicode one by name. */
export interface ComponentEmoji {
	id?: string;
	name?: string;
	animated?: boolean;
}

export interface SelectOption {
	label: string;
	value: string;
	description?: string;
	emoji?: ComponentEmoji;
	default?: boolean;
}

export interface ComponentDefaultValue {
	id: string;
	type: "user" | "role" | "room";
}

/** An image, a video or a file: an http(s) url, or for a file sent with the message a signed /attachments path, with its type and size. */
export interface ComponentMedia {
	url: string;
	attachment_id?: string;
	content_type?: string;
	width?: number;
	height?: number;
}

export interface GalleryItem {
	media: ComponentMedia;
	description?: string;
	spoiler?: boolean;
}

/** Any message or modal component (components.Component in the API): its type says which of the fields it has. */
export interface Component {
	type: ComponentType;
	id?: number;
	components?: Component[];
	accessory?: Component;
	/** A modal's label: the input it names. */
	component?: Component;
	custom_id?: string;
	style?: number;
	label?: string;
	emoji?: ComponentEmoji;
	url?: string;
	disabled?: boolean;
	placeholder?: string;
	min_values?: number;
	max_values?: number;
	options?: SelectOption[];
	default_values?: ComponentDefaultValue[];
	room_types?: RoomType[];
	/** A modal's input: whether it must be answered (true unless it says otherwise). */
	required?: boolean;
	/** A text input's bounds, in characters, and the text it starts with. */
	min_length?: number;
	max_length?: number;
	value?: string;
	/** Whether a checkbox starts checked. */
	default?: boolean;
	content?: string;
	media?: ComponentMedia;
	description?: string;
	spoiler?: boolean;
	items?: GalleryItem[];
	file?: ComponentMedia;
	/** A file's name and size, from the file sent with the message. */
	name?: string;
	size?: number;
	divider?: boolean;
	spacing?: number;
	accent_color?: number;
}

/** A form a bot opens for the person who used its component or command (components.Modal in the API). */
export interface Modal {
	custom_id: string;
	title: string;
	/** Labels, each with its input, and text displays. */
	components: Component[];
}

export interface MessageReaction {
	emoji_name: string;
	emoji_id?: string | null;
	count: number;
	users: string[];
}

export interface GatewayMessage {
	id: string;
	room_id: string | null;
	/** Null for webhook messages, which carry webhook_id instead. */
	author_id: string | null;
	webhook_id?: string;
	content: string | null;
	type: MessageType;
	created_at: string;
	updated_at: string;
	nonce?: string;
	user?: GatewayUser;
	referenced_message?: ReferencedMessage | null;
	embeds?: Embed[] | null;
	attachments?: Attachment[] | null;
	reactions?: MessageReaction[] | null;
	sticker_attachment_id?: string | null;
	/** When it was pinned; null while it isn't. Events that create or edit a message leave it out. */
	pinned_at?: string | null;
	/** MessageFlag bits. */
	flags?: number;
	components?: Component[] | null;
	/** Set on the messages a bot sends for an interaction. */
	interaction_metadata?: InteractionMetadata;
	/** A call notice's call, in a conversation's thread; no other message has one. */
	call?: CallNotice;
}

export interface Message {
	id: string;
	content: string | null;
	type: MessageType;
	author_id: string;
	/** Set on a webhook's messages, whose author_id is the webhook: there is no user behind them. */
	webhook_id?: string;
	author_name: string;
	author_avatar_url: string | null;
	author_is_bot: boolean;
	created_at: string;
	updated_at: string;
	nonce?: string;
	/** A message being sent: the newest message of its room the client knew of when it sent it (withPresent). */
	known_newest?: string;
	referenced_message?: ReferencedMessage | null;
	ref_message_id?: string | null;
	embeds?: Embed[] | null;
	attachments?: Attachment[] | null;
	reactions?: MessageReaction[] | null;
	sticker_attachment_id?: string | null;
	/** When it was pinned; null while it isn't. Events that create or edit a message leave it out. */
	pinned_at?: string | null;
	flags?: number;
	components?: Component[] | null;
	/** Set on the messages a bot sends for an interaction. */
	interaction_metadata?: InteractionMetadata;
	/** A call notice's call; no other message has one. */
	call?: CallNotice;
}

export interface GatewayMessageDelete {
	id: string;
	room_id: string;
}

export interface GatewayUserStatusUpdate extends Presence {
	user_id: string;
	space_id?: string;
}

// --- Gateway raw types ---

export interface GatewayRoomOverwrite {
	id: string;
	room_id: string;
	target_id: string;
	target_type: number; // smallint: e.g. 0 = role, 1 = member
	deny_flags: number;
	allow_flags: number;
	created_at: string;
	updated_at: string;
}

export type RoomType = 1 | 2 | 3; // 1 = text, 2 = voice, 3 = category

/** MESSAGE_UPDATE: the edited message, without its attachments, reactions or referenced message. */
export interface MessageUpdateEvent {
	id: string;
	room_id: string | null;
	author_id: string | null;
	content: string | null;
	type: MessageType;
	created_at: string;
	updated_at: string;
	sticker_attachment_id: string | null;
	embeds: Embed[] | null;
	flags: number;
	components: Component[] | null;
	interaction_metadata?: InteractionMetadata;
	user?: GatewayUser;
}

/** DM_MESSAGE_UPDATE: like MESSAGE_UPDATE, for a conversation. */
export interface DMMessageUpdateEvent {
	id: string;
	conversation_id: string | null;
	author_id: string | null;
	content: string | null;
	type: MessageType;
	created_at: string;
	updated_at: string;
	sticker_attachment_id: string | null;
	embeds: Embed[] | null;
	user?: GatewayUser;
}

/** SPACE_UPDATE: the space itself, without its rooms, roles or members. */
export interface SpaceUpdateEvent {
	id: string;
	name: string;
	description: string | null;
	owner_id: string;
	banner: string | null;
	locale: string | null;
	icon: string | null;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
}

export interface GatewayRoom {
	id: string;
	space_id: string | null;
	parent_id: string | null;
	type: RoomType;
	name: string;
	description: string | null;
	position: number;
	nsfw: boolean;
	created_at: string;
	updated_at: string;
	/** Always null in the API's ROOM_* events; the gateway's SPACE_CREATE leaves it out, and so do the ROOM_CREATE and
	 * ROOM_UPDATE it builds from the snapshot. */
	deleted_at?: string | null;
}

/** ROOM_CREATE: a room the connection gets now that it wasn't sent, a new one or one the user can view since a change,
 * or the category that holds one. */
export interface RoomCreateEvent extends Omit<GatewayRoom, "deleted_at"> {
	/** For a room the user can view, their read state in it, as READY gives it for the rooms READY sends. Left out of a
	 * category the user gets only as a container, of a bot's, and when the gateway couldn't read it. */
	read_state?: RoomReadState;
}

/** A user's read state in a room, as READY's unread_rooms, last_read_rooms and last_msg_rooms have it. */
export interface RoomReadState {
	/** The room has a message the user hasn't read: unread_rooms lists it. */
	unread: boolean;
	/** The last message they read in the room, as last_read_rooms has it: null when they never read it. */
	last_read: string | null;
	/** The room's newest message, as last_msg_rooms has it: null when it has none. */
	last_msg: string | null;
}

export interface GatewayMember {
	id: string;
	space_id: string;
	user_id: string;
	alias: string | null;
	created_at: string;
	updated_at: string;
}

export interface GatewayRole {
	id: string;
	space_id: string;
	name: string;
	color_from: number | null;
	color_via: number | null;
	color_to: number | null;
	flags: number;
	permissions: number;
	created_at: string;
	updated_at: string;
	/** Always null in ROLE_* events; the SPACE_CREATE snapshot leaves it out. */
	deleted_at?: string | null;
	hoisted: boolean;
	position: number;
}

export type UserStatus = 0 | 1 | 2; // 0 = offline, 1 = online, 2 = do not disturb

/** The statuses a user can choose: offline isn't one, the gateway says it while they have no connection. */
export type ChosenStatus = Exclude<UserStatus, 0>;

/** What a client says it runs on when it identifies: the desktop app, a browser, or the mobile app. */
export type ClientPlatform = "desktop" | "web" | "mobile";

/** A user's client status: each platform they're connected on, with their status there, the same on each. A bot's
 * connections, and a client that doesn't say what it runs on, count as desktop. */
export type ClientStatus = Partial<Record<ClientPlatform, UserStatus>>;

/** What others see of a user's connection, wherever the API and the gateway give it: their status, and their client
 * status, which they leave out while the user is offline. */
export interface Presence {
	status_id: UserStatus;
	client_status?: ClientStatus;
}

export interface GatewayUser {
	id: string;
	username: string;
	email_verified: boolean;
	alias: string | null;
	avatar: string | null;
	banner: string | null;
	custom: string;
	flags: number;
	badges: number;
	is_bot: boolean;
	created_at: string;
	updated_at: string;
	/** The API's user objects carry it; the gateway's (READY, SPACE_CREATE) leave it out. */
	deleted_at?: string | null;
	/** The status the user chose: only on their own, in READY (a bot's has none). */
	status?: ChosenStatus;
}

export interface GatewayVoiceState {
	room_id: string;
	user_id: string;
	muted: boolean;
	deafened: boolean;
	screen_sharing: boolean;
	/** Their camera is on. A gateway from before cameras leaves it out: read it with `?? false`. */
	camera: boolean;
	version: number;
}

export interface GatewaySpace {
	id: string;
	name: string;
	description: string | null;
	banner: string | null;
	icon?: string | null;
	owner_id: string;
	locale: string | null;
	member?: GatewayMember;
	member_roles: Partial<Record<string, string[]>>;
	room_overwrites: GatewayRoomOverwrite[];
	rooms: GatewayRoom[];
	members: GatewayMember[];
	roles: GatewayRole[];
	users: GatewayUser[];
	voice_states?: GatewayVoiceState[];
	created_at: string;
	updated_at: string;
}

export interface SpaceEmoji {
	id: string;
	name: string;
	space_id: string;
	attachment_id: string;
	created_at: string;
	updated_at: string;
}

export interface SpaceSticker {
	id: string;
	name: string;
	space_id: string;
	attachment_id: string;
	created_at: string;
	updated_at: string;
}

export interface GatewaySpaceCreateSpace {
	id: string;
	name: string;
	description: string | null;
	owner_id: string;
	banner: string | null;
	locale: string | null;
	icon: string | null;
	created_at: string;
	updated_at: string;
}

export interface GatewaySpaceCreatePayload {
	space: GatewaySpaceCreateSpace;
	rooms: Record<string, GatewayRoom>;
	roles_permissions: Record<string, GatewayRole>;
	member_roles: Partial<Record<string, string[]>>;
	overwrites?: Record<string, GatewayRoomOverwrite[]>;
	owner_id: string;
	voice_states?: GatewayVoiceState[];
	activities?: Record<string, UserActivity[]>;
	member_statuses?: Record<string, UserStatus>;
	/** The client status of each member member_statuses has, by user ID. */
	member_client_status?: Record<string, ClientStatus>;
	/** In a person's SPACE_CREATE after READY (a space they joined or made, or its retry), their read state in each room
	 * of it they can view, by room ID, as a ROOM_CREATE's read_state. READY's own SPACE_CREATEs have none, as READY has
	 * theirs, nor has a bot's; nor one whose read failed, nor one of a space where they can view no room: its absence
	 * says nothing about the rooms. */
	read_states?: Record<string, RoomReadState>;
}

export interface ReactionEvent {
	message_id: string;
	user_id: string;
	emoji_name: string;
	emoji_id?: string | null;
}

export interface ReactionRemoveEvent {
	message_id: string;
	user_id: string;
	emoji_name: string;
}

export interface TypingEvent {
	user_id: string;
	username: string;
	alias: string | null;
	avatar: string | null;
	room_id: string;
}

/** A user recording a voice message in a room: what TYPING has. */
export type RecordingEvent = TypingEvent;

export interface DMTypingEvent {
	conversation_id: string;
	user_id: string;
	username: string;
	alias: string | null;
	avatar: string | null;
}

/** A user recording a voice message in a conversation: what DM_TYPING has. */
export type DMRecordingEvent = DMTypingEvent;

export interface CallIncomingEvent {
	conversation_id: string;
	initiator_id: string;
	initiator_name: string;
	initiator_avatar: string | null;
}

/** The user started a call, on this device or another: it rings none of theirs. */
export interface CallOutgoingEvent {
	conversation_id: string;
}

/** Someone in a call's voice, as READY's active calls and CALL_ONGOING carry them. */
export interface GatewayCallVoiceState {
	user_id: string;
	muted: boolean;
	deafened: boolean;
	screen_sharing: boolean;
	camera: boolean;
	version: number;
}

/** A call goes on in one of the user's conversations without ringing them: its ring window ended before they
 * answered, or they joined the group during it. They can still join it. */
export interface CallOngoingEvent {
	conversation_id: string;
	initiator_id: string;
	/** Who is in its voice; null while nobody is. */
	voice_states: GatewayCallVoiceState[] | null;
}

export interface CallAcceptedEvent {
	conversation_id: string;
	user_id: string;
}

export interface CallDeclinedEvent {
	conversation_id: string;
	user_id: string;
}

export interface CallEndedEvent {
	conversation_id: string;
}

export interface VoiceStateUpdateEvent {
	room_id: string;
	user_id: string;
	joined: boolean;
	muted: boolean;
	deafened: boolean;
	screen_sharing: boolean;
	camera: boolean;
	/** Grows with every change: an update not newer than the last one seen for this user and room is stale. */
	version: number;
}

export interface VoiceSessionReplacedEvent {
	room_id: string;
	reason?: "permissions";
}

/** The gateway turned one of this session's videos off, or never let it on. */
export interface VoiceVideoRefusedEvent {
	room_id: string;
	/** `screen` only comes with `permission`. */
	kind: "camera" | "screen";
	/** `limit`: the room already has its most cameras on; `permission`: no Video permission in the room;
	 * `bitrate`: the camera sent more than the gateway allows. */
	reason: "limit" | "permission" | "bitrate";
	/** With `limit`: how many cameras the room can have on. */
	limit?: number;
}

export interface WebRTCIceCandidateEvent {
	candidate: string;
	room_id: string;
}

export interface WebRTCRenegotiateEvent {
	offer: RTCSessionDescriptionInit;
	room_id: string;
}

export interface WebRTCRenegotiateAnswerEvent {
	room_id: string;
	answer: RTCSessionDescriptionInit;
}

export interface UserActivityUpdateEvent {
	user_id: string;
	activities: UserActivity[] | null;
}

export interface SpaceDeleteEvent {
	id: string;
}

export interface RoomReorderEvent {
	rooms: GatewayRoom[];
}

export interface RoomDeleteEvent {
	id: string;
	space_id: string;
}

export interface OverwriteDeleteEvent {
	room_id: string;
	target_id: string;
}

export interface MentionCreateEvent {
	message_id: string;
	room_id: string;
	author_id: string;
}

export interface DMMentionCreateEvent {
	message_id: string;
	conversation_id: string;
	author_id: string;
}

export interface UserUpdateEvent {
	id: string;
	username: string;
	alias: string | null;
	avatar: string | null;
	banner: string | null;
	/** The bio, "" when there's none. */
	custom: string;
	flags: number;
	badges: number;
}

export interface VoiceJoinedEvent {
	room_id: string;
	answer: RTCSessionDescriptionInit;
}

export interface RoleDeleteEvent {
	id: string;
	space_id: string;
}

export interface MemberRoleAddEvent {
	member_id: string;
	role_id: string;
	space_id: string;
}

export interface MemberRoleRemoveEvent {
	member_id: string;
	role_id: string;
}

/** Its presence is the new member's; a bot's is always offline, as a bot's status is per space. */
export interface SpaceMemberAddEvent extends Presence {
	space_id: string;
	user_id: string;
	member_id: string;
	user?: GatewayUser;
}

export interface SpaceMemberRemoveEvent {
	space_id: string;
	user_id: string;
	member_id: string;
}

export interface FriendRequestRejectEvent {
	id: string;
}

/** It reaches the recipient and the sender's own sessions. The two copies differ only in `user`, the other user's public
 * profile: the sender's for the recipient, the recipient's for the sender's sessions. username, alias, avatar and banner
 * are the sender's in both. An API from before recipient_id, banner and user leaves them out. */
export interface FriendRequestCreateEvent {
	id: string;
	sender_id: string;
	recipient_id?: string;
	username: string;
	alias: string | null;
	avatar: string | null;
	banner?: string | null;
	user?: GatewayUser;
}

/** Its presence is that of `user`, the other side: from now on the two get each other's USER_STATUS_UPDATE. */
export interface FriendRequestAcceptEvent extends Presence {
	id: string;
	request_id: string;
	sender_id: string;
	recipient_id: string;
	user?: GatewayUser;
}

export interface FriendRemoveEvent {
	user_id: string;
}

export interface TeamInviteCreateEvent {
	id: string;
	team_id: string;
	user_id: string;
	invited_by: string;
	created_at: string;
	team_name: string;
	invited_by_username: string;
}

/** The conversation's name and owner as they are now (renamed, or its owner left). */
export interface ConversationUpdateEvent {
	id: string;
	name: string | null;
	owner_id: string;
}

/** Its presence is the added user's. */
export interface ConversationMemberAddEvent extends Presence {
	conversation_id: string;
	user_id: string;
	member_id: string;
	username?: string;
	alias?: string | null;
	avatar?: string | null;
	banner?: string | null;
}

export interface ConversationMemberRemoveEvent {
	conversation_id: string;
	user_id: string;
}

export interface DMMessageDeleteEvent {
	id: string;
	conversation_id: string;
}

/** A room's message was pinned (pinned_at set) or unpinned (pinned_at null). */
export interface MessagePinUpdateEvent {
	id: string;
	room_id: string;
	pinned_at: string | null;
}

/** MessagePinUpdateEvent for a conversation's message. */
export interface DMMessagePinUpdateEvent {
	id: string;
	conversation_id: string;
	pinned_at: string | null;
}

/** Where a storage transfer is (StorageTransfer's `status`). */
export const StorageTransferStatus = {
	Queued: 0,
	Moving: 1,
	Done: 2,
	/** Stopped on an error: what it didn't move stays in the source. */
	Failed: 3,
	/** Stopped by a person: what it moved stays in the target. */
	Cancelled: 4,
} as const;

export type StorageTransferStatus = (typeof StorageTransferStatus)[keyof typeof StorageTransferStatus];

/** Where one of a transfer's files is (StorageTransferFile's `status`). */
export const StorageTransferFileStatus = {
	Pending: 0,
	Copying: 1,
	Moved: 2,
	/** Left where it was: deleted, moved by something else, or too large for the target. */
	Skipped: 3,
	Failed: 4,
} as const;

export type StorageTransferFileStatus = (typeof StorageTransferFileStatus)[keyof typeof StorageTransferFileStatus];

/** A move of a user's or a space's files from one of its storages to another, also the data of
 * STORAGE_TRANSFER_UPDATE. A null bucket is the user's default storage. */
export interface StorageTransfer {
	id: string;
	/** The user or the space whose files move. */
	owner_id: string;
	/** The user who started it, the only one who gets its events. */
	started_by: string;
	source_bucket_id: string | null;
	target_bucket_id: string | null;
	/** The originals stay in the source: asked for, or because the API couldn't tell whether source and target are one bucket. */
	keep_source: boolean;
	/** Source and target are one bucket under two names: only the rows change. */
	same_bucket: boolean;
	status: StorageTransferStatus;
	/** Why it failed (`target full`, `source unreachable: …`, …); null otherwise. */
	error: string | null;
	total_files: number;
	total_bytes: number;
	moved_files: number;
	moved_bytes: number;
	/** Deleted meanwhile, moved by something else, or too large for the target. */
	skipped_files: number;
	failed_files: number;
	created_at: string;
	started_at: string | null;
	finished_at: string | null;
	updated_at: string;
}

/** One of a transfer's files (GET …/storage/transfers/{id}/files). */
export interface StorageTransferFile {
	attachment_id: string;
	filename: string;
	size_bytes: number;
	status: StorageTransferFileStatus;
	/** Why it was skipped or failed; null otherwise. */
	error: string | null;
}

export type GatewayEventPayload =
	| { type: "READY"; data: GatewayReadyData }
	| { type: "SPACE_CREATE"; data: GatewaySpaceCreatePayload }
	| { type: "SPACE_DELETE"; data: SpaceDeleteEvent }
	| { type: "SPACE_UPDATE"; data: SpaceUpdateEvent }
	| { type: "ROOM_CREATE"; data: RoomCreateEvent }
	| { type: "ROOM_UPDATE"; data: GatewayRoom }
	| { type: "ROOM_REORDER"; data: RoomReorderEvent }
	| { type: "ROOM_DELETE"; data: RoomDeleteEvent }
	| { type: "ROOM_OVERWRITE_UPDATE"; data: GatewayRoomOverwrite }
	| { type: "ROOM_OVERWRITE_DELETE"; data: OverwriteDeleteEvent }
	| { type: "MESSAGE_CREATE"; data: GatewayMessage }
	| { type: "MESSAGE_UPDATE"; data: MessageUpdateEvent }
	| { type: "MESSAGE_DELETE"; data: GatewayMessageDelete }
	| { type: "MESSAGE_PIN_UPDATE"; data: MessagePinUpdateEvent }
	| { type: "MENTION_CREATE"; data: MentionCreateEvent }
	| { type: "DM_MENTION_CREATE"; data: DMMentionCreateEvent }
	| { type: "USER_UPDATE"; data: UserUpdateEvent }
	| { type: "USER_STATUS_UPDATE"; data: GatewayUserStatusUpdate }
	| { type: "USER_ACTIVITY_UPDATE"; data: UserActivityUpdateEvent }
	| { type: "VOICE_STATE_UPDATE"; data: VoiceStateUpdateEvent }
	| { type: "VOICE_SESSION_REPLACED"; data: VoiceSessionReplacedEvent }
	| { type: "VOICE_VIDEO_REFUSED"; data: VoiceVideoRefusedEvent }
	| { type: "VOICE_JOINED"; data: VoiceJoinedEvent }
	| { type: "WEBRTC_ICE_CANDIDATE"; data: WebRTCIceCandidateEvent }
	| { type: "WEBRTC_RENEGOTIATE"; data: WebRTCRenegotiateEvent }
	| { type: "WEBRTC_RENEGOTIATE_ANSWER"; data: WebRTCRenegotiateAnswerEvent }
	| { type: "ROLE_CREATE"; data: GatewayRole }
	| { type: "ROLE_UPDATE"; data: GatewayRole }
	| { type: "ROLE_DELETE"; data: RoleDeleteEvent }
	| { type: "MEMBER_ROLE_ADD"; data: MemberRoleAddEvent }
	| { type: "MEMBER_ROLE_REMOVE"; data: MemberRoleRemoveEvent }
	| { type: "SPACE_MEMBER_ADD"; data: SpaceMemberAddEvent }
	| { type: "SPACE_MEMBER_REMOVE"; data: SpaceMemberRemoveEvent }
	| { type: "SPACE_EMOJI_CREATE"; data: SpaceEmoji }
	| { type: "SPACE_EMOJI_UPDATE"; data: SpaceEmoji }
	| { type: "SPACE_EMOJI_DELETE"; data: SpaceEmoji }
	| { type: "SPACE_STICKER_CREATE"; data: SpaceSticker }
	| { type: "SPACE_STICKER_UPDATE"; data: SpaceSticker }
	| { type: "SPACE_STICKER_DELETE"; data: SpaceSticker }
	| { type: "REACTION_ADD"; data: ReactionEvent }
	| { type: "REACTION_REMOVE"; data: ReactionRemoveEvent }
	| { type: "FRIEND_REQUEST_CREATE"; data: FriendRequestCreateEvent }
	| { type: "FRIEND_REQUEST_ACCEPT"; data: FriendRequestAcceptEvent }
	| { type: "FRIEND_REQUEST_REJECT"; data: FriendRequestRejectEvent }
	| { type: "FRIEND_REMOVE"; data: FriendRemoveEvent }
	| { type: "CONVERSATION_CREATE"; data: Conversation }
	| { type: "CONVERSATION_UPDATE"; data: ConversationUpdateEvent }
	| { type: "CONVERSATION_MEMBER_ADD"; data: ConversationMemberAddEvent }
	| { type: "CONVERSATION_MEMBER_REMOVE"; data: ConversationMemberRemoveEvent }
	| { type: "DM_MESSAGE_CREATE"; data: DirectMessage }
	| { type: "DM_MESSAGE_UPDATE"; data: DMMessageUpdateEvent }
	| { type: "DM_MESSAGE_DELETE"; data: DMMessageDeleteEvent }
	| { type: "DM_MESSAGE_PIN_UPDATE"; data: DMMessagePinUpdateEvent }
	| { type: "DM_REACTION_ADD"; data: ReactionEvent }
	| { type: "DM_REACTION_REMOVE"; data: ReactionRemoveEvent }
	| { type: "TYPING"; data: TypingEvent }
	| { type: "DM_TYPING"; data: DMTypingEvent }
	| { type: "RECORDING"; data: RecordingEvent }
	| { type: "DM_RECORDING"; data: DMRecordingEvent }
	| { type: "CALL_INCOMING"; data: CallIncomingEvent }
	| { type: "CALL_OUTGOING"; data: CallOutgoingEvent }
	| { type: "CALL_ONGOING"; data: CallOngoingEvent }
	| { type: "CALL_ACCEPTED"; data: CallAcceptedEvent }
	| { type: "CALL_DECLINED"; data: CallDeclinedEvent }
	| { type: "CALL_ENDED"; data: CallEndedEvent }
	| { type: "TEAM_INVITE_CREATE"; data: TeamInviteCreateEvent }
	| { type: "STORAGE_TRANSFER_UPDATE"; data: StorageTransfer };

export interface GatewayEvent {
	op: number;
	d?: GatewayEventPayload;
	s: number;
	event: string;
	/** With `event: "close-with-reason"`, sent just before the gateway closes the socket. */
	code?: number;
	reason?: string;
}

export interface GatewayReadyActiveCall {
	conversation_id: string;
	initiator_id: string;
	// The caller's name and avatar, as CALL_INCOMING carries them, whether the call still rings the user, and whether
	// someone has answered it. A gateway from before calls followed users across their devices sends none of the four,
	// and the client then does what it did before.
	initiator_name?: string;
	initiator_avatar?: string | null;
	voice_states: GatewayCallVoiceState[] | null;
	/** Whether the call still rings the user: false for their own call, once they answered or declined it on any
	 * device, and once its ring window passed. */
	ringing?: boolean;
	/** Whether someone other than its caller has accepted it: on the caller's devices, false means it still rings the
	 * others. */
	answered?: boolean;
}

export interface GatewayReadyData {
	user: GatewayUser;
	sessionToken: string;
	guild_ids: string[];
	shard?: [number, number];
	unread_rooms?: string[];
	last_read_rooms?: Record<string, string>;
	last_msg_rooms?: Record<string, string>;
	unread_convs?: string[];
	last_read_convs?: Record<string, string>;
	/** Each conversation's newest message: none for one without messages, nor for one whose newest is past the 90 days
	 * the API keeps it. */
	last_msg_convs?: Record<string, string>;
	active_calls?: GatewayReadyActiveCall[];
	/** Not sent to bots. */
	ice_servers?: RTCIceServer[];
}

export function roomTypeToChannelType(type: RoomType): Channel["type"] {
	switch (type) {
		case 3:
			return "category";
		case 2:
			return "voice";
		default:
			return "text";
	}
}

/** A space's rooms once one is deleted (ROOM_DELETE): the rooms in it, a category's, move to the top level, as the API
 * moves them; the ROOM_REORDER that follows gives them their new places. */
export function withoutRoom(rooms: GatewayRoom[], roomId: string): GatewayRoom[] {
	return rooms.filter((r) => r.id !== roomId).map((r) => (r.parent_id === roomId ? { ...r, parent_id: null } : r));
}

/** A space once a room of it goes with ROOM_DELETE, deleted or no longer one the user can view: its overwrites and the
 * voice states in it go too, as nothing updates them while it's away. If it comes back, ROOM_CREATE brings it,
 * followed by its overwrites and voice states as they are then. */
export function spaceWithoutRoom<S extends Pick<GatewaySpace, "rooms" | "room_overwrites" | "voice_states">>(
	space: S,
	roomId: string,
): S {
	return {
		...space,
		rooms: withoutRoom(space.rooms, roomId),
		room_overwrites: space.room_overwrites.filter((o) => o.room_id !== roomId),
		voice_states: space.voice_states?.filter((v) => v.room_id !== roomId),
	};
}

/** The loaded messages of every room but one that ROOM_DELETE takes away (deleted, or no longer one the user can view):
 * nothing updates them while it's away, so if it comes back (ROOM_CREATE) it loads what it missed rather than show what
 * it had. The same object when the room had none loaded. */
export function withoutRoomMessages<T>(all: Record<string, T[]>, roomId: string): Record<string, T[]> {
	if (!(roomId in all)) return all;
	const rest = { ...all };
	delete rest[roomId];
	return rest;
}

/** READY's read states of the rooms (unread_rooms, last_read_rooms, last_msg_rooms) with a room's from its ROOM_CREATE in
 * place of what they had of it: a room the user can view since READY comes with its unread mark, which READY couldn't
 * give. newest is the newest message the client already has in the room: one newer than the read state's (its
 * MESSAGE_CREATE came before the ROOM_CREATE, whose read state was read earlier) keeps the room unread, and stays its
 * newest. */
export function withRoomReadState(
	rooms: { unread: Set<string>; lastRead: Record<string, string>; lastMsg: Record<string, string> },
	roomId: string,
	state: RoomReadState,
	newest?: string,
) {
	const unread = new Set(rooms.unread);
	const lastRead = { ...rooms.lastRead };
	const lastMsg = { ...rooms.lastMsg };
	const newer = newest !== undefined && newest > (state.last_msg ?? "");
	if (state.unread || newer) unread.add(roomId);
	else unread.delete(roomId);
	if (state.last_read) lastRead[roomId] = state.last_read;
	else delete lastRead[roomId];
	const last = newer ? newest : state.last_msg;
	if (last) lastMsg[roomId] = last;
	else delete lastMsg[roomId];
	return { unread, lastRead, lastMsg };
}

/** Whether every space READY listed (guild_ids) has had its SPACE_CREATE. One of a space READY didn't list (a space
 * the user joined while their connection was identifying) or a second one of a space isn't one of those it waits for
 * (#128). */
export function readySpacesArrived(listed: ReadonlySet<string>, arrived: ReadonlySet<string>): boolean {
	for (const id of listed) if (!arrived.has(id)) return false;
	return true;
}

/** The spaces with one from a SPACE_CREATE: added at the end, or in the place of an earlier copy of it, which it
 * replaces, as the gateway goes by the last SPACE_CREATE it sent and keeps the client up to date from there (#128). What
 * a SPACE_CREATE doesn't carry stays as the client has it: the space's members and users it loaded, and the user's own
 * member. */
export function withSpaceCreate(spaces: GatewaySpace[], space: GatewaySpace): GatewaySpace[] {
	const at = spaces.findIndex((s) => s.id === space.id);
	if (at === -1) return [...spaces, space];
	const { member, members, users } = spaces[at];
	return spaces.map((s, i) => (i === at ? { ...space, member, members, users } : s));
}

/** READY's read states of the rooms with rooms' from the gateway in place of what they had of them, each as a
 * ROOM_CREATE's is (withRoomReadState): a ROOM_CREATE's, or a SPACE_CREATE's read_states, which bring the unread marks of
 * a space the user joined since READY. newest gives the newest message the client already has in a room. */
export function withRoomReadStates(
	rooms: { unread: Set<string>; lastRead: Record<string, string>; lastMsg: Record<string, string> },
	states: Record<string, RoomReadState>,
	newest: (roomId: string) => string | undefined,
) {
	return Object.entries(states).reduce(
		(read, [roomId, state]) => withRoomReadState(read, roomId, state, newest(roomId)),
		rooms,
	);
}

/** Where a room or category dropped below everything goes: after the highest place at the top level. Its rooms and
 * categories share positions, which keep the gaps deleted rooms leave, so their count can be a place that's taken.
 * The moving room doesn't count, so one already last stays where it is. */
export function topLevelEnd(channels: Channel[], movingId: string): number {
	return Math.max(-1, ...channels.filter((c) => !c.categoryId && c.id !== movingId).map((c) => c.position)) + 1;
}

/** Where a category dropped above or below a room goes at the top level. A category can't go inside another, so a room
 * inside one stands for it: the category goes right after that one, on either side of the room, since its rooms show
 * below its header. (The room's own place counts within its category, not at the top level.) A loose room is at the
 * top level itself: the category goes above or below it. Like every place the API takes, it's counted with the dragged
 * category still where it is, so it's the same wherever that category starts, before the target one or after it. */
export function categoryDropPosition(channels: Channel[], room: Channel, side: "above" | "below"): number {
	const category = room.categoryId ? channels.find((c) => c.id === room.categoryId) : undefined;
	if (category) return category.position + 1;
	return side === "above" ? room.position : room.position + 1;
}

/** A space's roles once one is created (ROLE_CREATE): the API puts it at position 1, just above @everyone's 0, and
 * moves every other role from 1 up by one (ShiftRolePositions) without an event of their own. */
export function withCreatedRole(roles: GatewayRole[], created: GatewayRole): GatewayRole[] {
	return [...roles.map((r) => (r.position >= 1 ? { ...r, position: r.position + 1 } : r)), created];
}

export function gatewayMessageToMessage(msg: GatewayMessage, spaces: GatewaySpace[]): Message {
	let author_name = "Unknown";
	let author_avatar_url: string | null = null;
	let author_is_bot = false;

	if (msg.user) {
		author_name = msg.user.alias ?? msg.user.username;
		author_avatar_url = getAvatarURL(msg.user.id, msg.user.avatar);
		author_is_bot = msg.user.is_bot ?? false;
	} else {
		for (const space of spaces) {
			const user = space.users.find((u) => u.id === msg.author_id);
			if (user) {
				const member = space.members.find((m) => m.user_id === msg.author_id);
				author_name = member?.alias ?? user.alias ?? user.username;
				author_avatar_url = getAvatarURL(user.id, user.avatar);
				author_is_bot = user.is_bot ?? false;
				break;
			}
		}
	}

	return {
		id: msg.id,
		content: msg.content ?? "",
		type: msg.type ?? 0,
		// A webhook's message has no author: its webhook stands in, as in the synthetic user.
		author_id: msg.author_id ?? msg.webhook_id ?? "",
		webhook_id: msg.webhook_id,
		author_name,
		author_avatar_url,
		author_is_bot,
		created_at: sentAt(msg),
		updated_at: msg.updated_at,
		nonce: msg.nonce,
		referenced_message: msg.referenced_message ?? null,
		ref_message_id:
			msg.referenced_message?.message_id ??
			("ref_message_id" in msg && typeof msg.ref_message_id === "string" ? msg.ref_message_id : null),
		embeds: msg.embeds ?? null,
		attachments: msg.attachments ?? null,
		reactions: msg.reactions ?? null,
		sticker_attachment_id: msg.sticker_attachment_id ?? null,
		pinned_at: msg.pinned_at ?? null,
		flags: msg.flags ?? 0,
		components: msg.components ?? null,
		interaction_metadata: msg.interaction_metadata,
		call: msg.call,
	};
}

export function isComponentsV2(message: Pick<Message, "flags">): boolean {
	return ((message.flags ?? 0) & MessageFlag.IsComponentsV2) !== 0;
}

/** Whether a message is a bot's deferred response that it hasn't completed yet. */
export function isLoading(message: Pick<Message, "flags">): boolean {
	return ((message.flags ?? 0) & MessageFlag.Loading) !== 0;
}

/** Whether a message is ephemeral: a bot's to this user alone, not one of the room's. */
export function isEphemeral(message: Pick<Message, "flags">): boolean {
	return ((message.flags ?? 0) & MessageFlag.Ephemeral) !== 0;
}

/** Whether a message is a notice the API posts, a pin's or a call's, rather than one someone wrote: nobody edits or
 * pins it, and a reply to it mentions nobody. */
export function isNotice(message: Pick<Message, "type">): boolean {
	return message.type === MessageType.PinNotice || message.type === MessageType.Call;
}

/** When a message was sent, as the chat shows it and orders it by: its creation, but a call notice's call's end, when
 * its ID was minted. So the notice sits where its call ended, as the history has it by ID, also when the API posted it
 * late, after newer messages. */
export function sentAt(message: { created_at: string; call?: CallNotice }): string {
	return message.call?.ended_at ?? message.created_at;
}

/** The text a message shows: its content, or its text displays' when its components are all of it. */
export function messageText(message: Pick<Message, "flags" | "content" | "components">): string {
	if (!isComponentsV2(message)) return message.content ?? "";
	const texts: string[] = [];
	const walk = (components: Component[] | null | undefined) => {
		for (const c of components ?? []) {
			if (c.type === ComponentType.TextDisplay && c.content) texts.push(c.content);
			walk(c.components);
		}
	};
	walk(message.components);
	return texts.join("\n");
}

/** Whether a message is a reply that mentions userId, the author of the message it replies to: as a reply does unless
 * it's sent with allowed_mentions.replied_user false. Its text's mentions are messageText's. */
export function mentionsByReply(message: Pick<Message, "referenced_message">, userId: string): boolean {
	const ref = message.referenced_message;
	return !!ref?.mention_author && ref.author_id === userId;
}

/** The name of the author of the message a reply replies to, as the reply's quote shows it: with an @ when the reply
 * mentioned them, so that everyone can tell it did. */
export function quotedAuthorName(
	name: string | undefined,
	reference: Pick<ReferencedMessage, "mention_author"> | null | undefined,
): string {
	return `${reference?.mention_author ? "@" : ""}${name ?? ""}`;
}

export function gatewaySpaceToGuild(space: GatewaySpace): Guild {
	return {
		id: space.id,
		name: space.name,
		icon_url: space.icon ? (getAvatarURL(space.id, space.icon) ?? "") : "",
		banner_url: space.banner ? (getAvatarURL(space.id, space.banner) ?? "") : "",
		channels: space.rooms.map((room) => {
			const channelType = roomTypeToChannelType(room.type);
			const channel: Channel = {
				id: room.id,
				name: room.name,
				type: channelType,
				position: room.position,
				categoryId: room.parent_id ?? undefined,
			};

			if (channelType === "voice") {
				const voiceStates = space.voice_states?.filter((vs) => vs.room_id === room.id) ?? [];
				channel.voiceUsers = voiceStates.map((vs) => {
					const user = space.users.find((u) => u.id === vs.user_id);
					return {
						id: vs.user_id,
						username: user?.alias ?? user?.username ?? "Unknown",
						avatar_url: user ? getAvatarURL(user.id, user.avatar) : null,
						muted: vs.muted,
						deafened: vs.deafened,
						screen_sharing: vs.screen_sharing,
						camera: vs.camera,
					};
				});
			}

			return channel;
		}),
	};
}

export interface VoiceUser {
	id: string;
	username: string;
	avatar_url: string | null;
	muted?: boolean;
	deafened?: boolean;
	screen_sharing?: boolean;
	camera?: boolean;
}

export interface Channel {
	id: string;
	name: string;
	type: "category" | "voice" | "text";
	position: number;
	categoryId?: string;
	messages?: Message[];
	voiceUsers?: VoiceUser[];
}

export interface Guild {
	id: string;
	name: string;
	icon_url: string;
	banner_url: string;
	channels: Channel[];
	category?: string;
	muted?: boolean;
}

export interface Role {
	id: string;
	name: string;
	color_from: number | null;
	color_via: number | null;
	color_to: number | null;
	permissions: number;
	hoisted: boolean;
	position: number;
}

export interface MemberOnSidebar {
	id: string;
	member_id: string;
	username: string;
	raw_username: string;
	avatar_url: string | null;
	banner_url: string | null;
	status: "offline" | "online" | "idle" | "dnd";
	/** They're connected only from the mobile app, and their status shows as a phone (isMobileOnly, lib/status.ts). */
	mobile_only: boolean;
	badges: number;
	is_bot: boolean;
	is_owner: boolean;
	roles: Role[];
	/** The user's bio (their custom), "" when they have none. */
	bio: string;
}

/** How a status_id shows: online, do not disturb, or else offline. */
export function userStatusToString(statusId: UserStatus): MemberOnSidebar["status"] {
	switch (statusId) {
		case 1:
			return "online";
		case 2:
			return "dnd";
		default:
			return "offline";
	}
}

export function gatewaySpaceToMembers(
	space: GatewaySpace,
	statusLookup?: ReadonlyMap<string, Presence>,
): MemberOnSidebar[] {
	const memberUserIds = new Set(space.members.map((m) => m.user_id));
	return space.users
		.filter((u) => memberUserIds.has(u.id))
		.map((u) => {
			const member = space.members.find((m) => m.user_id === u.id);
			return {
				id: u.id,
				member_id: member?.id ?? "",
				username: u.alias ?? u.username,
				raw_username: u.username,
				avatar_url: getAvatarURL(u.id, u.avatar),
				banner_url: getAvatarURL(u.id, u.banner),
				status: userStatusToString(statusLookup ? memberStatus(statusLookup, u, space.id) : 0),
				mobile_only: statusLookup ? memberMobileOnly(statusLookup, u) : false,
				badges: u.badges ?? 0,
				is_bot: u.is_bot ?? false,
				is_owner: u.id === space.owner_id,
				bio: u.custom ?? "",
				roles: (space.member_roles[u.id] ?? [])
					.map((roleId) => space.roles.find((r) => r.id === roleId))
					.filter(Boolean)
					.map((r) => ({
						id: r!.id,
						name: r!.name,
						color_from: r!.color_from,
						color_via: r!.color_via,
						color_to: r!.color_to,
						permissions: r!.permissions,
						hoisted: r!.hoisted,
						position: r!.position,
					}))
					// higher position = higher hierarchy, sort descending so index 0 = highest role
					.sort((a, b) => b.position - a.position),
			};
		});
}

export interface Tab {
	/** The room's ID, or the conversation's for a conversation's tab. */
	channelId: string;
	channelName: string;
	/** A room's type ("text", "voice"); "conversation" for a conversation's tab. */
	channelType: string;
	/** The room's space; empty for a conversation's tab. */
	spaceId: string;
	/** What the tab shows: a room when it's missing, as every tab saved before conversations had tabs is one. */
	kind?: "room" | "conversation";
}

export interface PaneLeaf {
	kind: "leaf";
	id: string;
	tabs: Tab[];
	activeChannelId: string | null;
}

export interface PaneSplit {
	kind: "split";
	id: string;
	direction: "h" | "v"; // h = side-by-side, v = top/bottom
	ratio: number; // 0–1, fraction for child A
	a: PaneNode;
	b: PaneNode;
}

export type PaneNode = PaneLeaf | PaneSplit;
