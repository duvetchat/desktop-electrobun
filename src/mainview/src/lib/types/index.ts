import { getAvatarURL } from "$lib/common/common";

export interface EmbedMedia {
	url: string;
	width?: number | null;
	height?: number | null;
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
}

export interface Attachment {
	id: string;
	message_id: string;
	filename: string;
	content_type: string;
	size_bytes: number;
	width?: number | null;
	height?: number | null;
	created_at: string;
	deleted?: boolean;
	pending?: boolean;
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

export interface ReferencedMessage {
	id: string;
	type: number | null;
	message_id: string | null;
	room_id: string | null;
	space_id: string | null;
	content?: string;
	author_id?: string;
	author_name?: string;
	author_avatar?: string | null;
	created_at?: string;
}

export const MessageType = {
	Text: 0,
	Voice: 1,
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export interface MessageReaction {
	emoji_name: string;
	emoji_id?: string | null;
	count: number;
	users: string[];
}

export interface GatewayMessage {
	id: string;
	room_id: string;
	author_id: string;
	content: string | null;
	type: MessageType;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
	nonce?: string;
	user?: GatewayUser;
	member_alias?: string | null;
	referenced_message?: ReferencedMessage | null;
	ref_message_id?: string | null;
	embeds?: Embed[] | null;
	attachments?: Attachment[] | null;
	reactions?: MessageReaction[] | null;
	sticker_attachment_id?: string | null;
}

export interface Message {
	id: string;
	content: string;
	type: MessageType;
	author_id: string;
	author_name: string;
	author_avatar_url: string | null;
	created_at: string;
	updated_at: string;
	nonce?: string;
	referenced_message?: ReferencedMessage | null;
	ref_message_id?: string | null;
	embeds?: Embed[] | null;
	attachments?: Attachment[] | null;
	reactions?: MessageReaction[] | null;
	sticker_attachment_id?: string | null;
}

export interface GatewayMessageDelete {
	id: string;
	room_id: string;
}

export interface GatewayUserStatusUpdate {
	user_id: string;
	status_id: UserStatus;
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
	deleted_at: string | null;
}

export type RoomType = 1 | 2 | 3; // 1 = text, 2 = voice, 3 = category

export interface GatewayRoom {
	id: string;
	space_id: string;
	parent_id: string | null;
	type: RoomType;
	name: string;
	description: string | null;
	position: number;
	nsfw: boolean;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
}

export interface GatewayMember {
	id: string;
	space_id: string;
	user_id: string;
	alias: string | null;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
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
	deleted_at: string | null;
	hoisted: boolean;
	position: number;
}

export type UserStatus = 0 | 1 | 2; // 0 = offline, 1 = online, 2 = dnd

export interface GatewayUser {
	id: string;
	username: string;
	email: string;
	email_verified: boolean;
	password: string;
	alias: string | null;
	birthdate: string | null;
	phone: string | null;
	avatar: string | null;
	banner: string | null;
	custom: string;
	status_id: UserStatus;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
}

export interface GatewayVoiceState {
	room_id: string;
	user_id: string;
	muted?: boolean;
	deafened?: boolean;
	screen_sharing?: boolean;
}

export interface GatewaySpace {
	id: string;
	name: string;
	description: string | null;
	banner: string | null;
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
	deleted_at: string | null;
}

export interface SpaceEmoji {
	id: string;
	name: string;
	space_id: string;
	attachment_id: string;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
}

export interface SpaceSticker {
	id: string;
	name: string;
	space_id: string;
	attachment_id: string;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
}

export interface GatewaySpaceCreatePayload {
	space: {
		id: string;
		name: string;
		description: string | null;
		banner: string | null;
		owner_id: string;
		locale: string | null;
		created_at: string;
		updated_at: string;
		deleted_at: string | null;
	};
	rooms: Record<string, GatewayRoom>;
	roles_permissions: Record<string, GatewayRole>;
	member_roles: Partial<Record<string, string[]>>;
	overwrites?: Record<string, GatewayRoomOverwrite[]>;
	owner_id: string;
	voice_states?: GatewayVoiceState[];
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

export interface DMTypingEvent {
	conversation_id: string;
	user_id: string;
	username: string;
	alias: string | null;
	avatar: string | null;
}

export interface CallIncomingEvent {
	conversation_id: string;
	initiator_id: string;
	initiator_name: string;
	initiator_avatar: string | null;
	member_ids: string[];
}

export interface CallEndedEvent {
	conversation_id: string;
}

export interface VoiceStateEvent {
	room_id: string;
	user_id: string;
	joined: boolean;
	muted?: boolean;
	deafened?: boolean;
	screen_sharing?: boolean;
}

export interface WebRTCEvent {
	candidate?: string;
	sdpMLineIndex?: number;
	sdpMid?: string;
	sdp?: string;
}

export interface SpaceDeleteEvent {
	id: string;
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
	room_id: string;
	conversation_id?: string;
}

export interface UserUpdateEvent {
	id: string;
	username: string;
	alias: string | null;
	avatar: string | null;
	banner: string | null;
}

export interface VoiceJoinedEvent {
	user_id: string;
	sdp: string;
}

export interface RoleDeleteEvent {
	id: string;
	space_id: string;
}

export interface MemberRoleEvent {
	member_id: string;
	role_id: string;
	space_id: string;
}

export interface SpaceMemberEvent {
	member_id: string;
	space_id: string;
}

export interface GuildMemberAddEvent {
	space_id: string;
	user_id: string;
	member_id: string;
	user?: GatewayUser;
}

export interface GuildMemberRemoveEvent {
	space_id: string;
	user_id: string;
	member_id: string;
}

export interface SpaceAssetDeleteEvent {
	id: string;
	space_id: string;
}

export interface FriendRequestRejectEvent {
	request_id: string;
}

export interface FriendRemoveEvent {
	user_id: string;
}

export interface ConversationUpdateEvent {
	id: string;
	name: string | null;
}

export interface ConversationDeleteEvent {
	id: string;
}

export interface ConversationMemberAddEvent {
	conversation_id: string;
	user_id: string;
	member_id: string;
	username?: string;
	alias?: string | null;
	avatar?: string | null;
	banner?: string | null;
	status_id?: number;
	user?: GatewayUser;
}

export interface ConversationMemberRemoveEvent {
	conversation_id: string;
	user_id: string;
}

export interface DMMessageDeleteEvent {
	id: string;
	conversation_id: string;
}

export interface CallResponseEvent {
	conversation_id: string;
	user_id: string;
}

export type GatewayEventPayload =
	| { type: "READY"; data: GatewayReadyData }
	| { type: "SPACE_CREATE"; data: GatewaySpaceCreatePayload }
	| { type: "SPACE_DELETE"; data: SpaceDeleteEvent }
	| { type: "SPACE_UPDATE"; data: GatewaySpace }
	| { type: "ROOM_CREATE"; data: GatewayRoom }
	| { type: "ROOM_UPDATE"; data: GatewayRoom }
	| { type: "ROOM_DELETE"; data: RoomDeleteEvent }
	| { type: "ROOM_OVERWRITE_UPDATE"; data: GatewayRoomOverwrite }
	| { type: "ROOM_OVERWRITE_DELETE"; data: OverwriteDeleteEvent }
	| { type: "MESSAGE_CREATE"; data: GatewayMessage }
	| { type: "MESSAGE_UPDATE"; data: GatewayMessage }
	| { type: "MESSAGE_DELETE"; data: GatewayMessageDelete }
	| { type: "MENTION_CREATE"; data: MentionCreateEvent }
	| { type: "USER_UPDATE"; data: UserUpdateEvent }
	| { type: "USER_STATUS_UPDATE"; data: GatewayUserStatusUpdate }
	| { type: "VOICE_STATE_UPDATE"; data: VoiceStateEvent }
	| { type: "VOICE_JOINED"; data: VoiceJoinedEvent }
	| { type: "WEBRTC_ICE_CANDIDATE"; data: WebRTCEvent }
	| { type: "WEBRTC_RENEGOTIATE"; data: WebRTCEvent }
	| { type: "WEBRTC_RENEGOTIATE_ANSWER"; data: WebRTCEvent }
	| { type: "ROLE_CREATE"; data: GatewayRole }
	| { type: "ROLE_UPDATE"; data: GatewayRole }
	| { type: "ROLE_DELETE"; data: RoleDeleteEvent }
	| { type: "MEMBER_ROLE_ADD"; data: MemberRoleEvent }
	| { type: "MEMBER_ROLE_REMOVE"; data: MemberRoleEvent }
	| { type: "SPACE_MEMBER_ADD"; data: SpaceMemberEvent }
	| { type: "SPACE_MEMBER_REMOVE"; data: SpaceMemberEvent }
	| { type: "GUILD_MEMBER_ADD"; data: GuildMemberAddEvent }
	| { type: "GUILD_MEMBER_REMOVE"; data: GuildMemberRemoveEvent }
	| { type: "SPACE_EMOJI_CREATE"; data: SpaceEmoji }
	| { type: "SPACE_EMOJI_UPDATE"; data: SpaceEmoji }
	| { type: "SPACE_EMOJI_DELETE"; data: SpaceAssetDeleteEvent }
	| { type: "SPACE_STICKER_CREATE"; data: SpaceSticker }
	| { type: "SPACE_STICKER_UPDATE"; data: SpaceSticker }
	| { type: "SPACE_STICKER_DELETE"; data: SpaceAssetDeleteEvent }
	| { type: "REACTION_ADD"; data: ReactionEvent }
	| { type: "REACTION_REMOVE"; data: ReactionRemoveEvent }
	| { type: "FRIEND_REQUEST_CREATE"; data: import("$lib/api/friends").FriendRequest }
	| { type: "FRIEND_REQUEST_ACCEPT"; data: import("$lib/api/friends").Friend }
	| { type: "FRIEND_REQUEST_REJECT"; data: FriendRequestRejectEvent }
	| { type: "FRIEND_REMOVE"; data: FriendRemoveEvent }
	| { type: "CONVERSATION_CREATE"; data: import("$lib/api/conversations").Conversation }
	| { type: "CONVERSATION_UPDATE"; data: ConversationUpdateEvent }
	| { type: "CONVERSATION_DELETE"; data: ConversationDeleteEvent }
	| { type: "CONVERSATION_MEMBER_ADD"; data: ConversationMemberAddEvent }
	| { type: "CONVERSATION_MEMBER_REMOVE"; data: ConversationMemberRemoveEvent }
	| { type: "DM_MESSAGE_CREATE"; data: import("$lib/api/conversations").DirectMessage }
	| { type: "DM_MESSAGE_UPDATE"; data: import("$lib/api/conversations").DirectMessage }
	| { type: "DM_MESSAGE_DELETE"; data: DMMessageDeleteEvent }
	| { type: "DM_REACTION_ADD"; data: ReactionEvent }
	| { type: "DM_REACTION_REMOVE"; data: ReactionRemoveEvent }
	| { type: "TYPING"; data: TypingEvent }
	| { type: "DM_TYPING"; data: DMTypingEvent }
	| { type: "CALL_INCOMING"; data: CallIncomingEvent }
	| { type: "CALL_ACCEPTED"; data: CallResponseEvent }
	| { type: "CALL_DECLINED"; data: CallResponseEvent }
	| { type: "CALL_ENDED"; data: CallEndedEvent };

export interface GatewayEvent {
	op: number;
	d?: GatewayEventPayload;
	s: number;
	event: string;
}

export interface GatewayReadyActiveCall {
	conversation_id: string;
	initiator_id: string;
	voice_states?: {
		user_id: string;
		muted?: boolean;
		deafened?: boolean;
		screen_sharing?: boolean;
	}[];
}

export interface GatewayReadyData {
	user: GatewayUser;
	sessionToken: string;
	unread_rooms?: string[];
	last_read_rooms?: Record<string, string>;
	last_msg_rooms?: Record<string, string>;
	unread_convs?: string[];
	active_calls?: GatewayReadyActiveCall[];
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

export function gatewayMessageToMessage(msg: GatewayMessage, spaces: GatewaySpace[]): Message {
	let author_name = "Unknown";
	let author_avatar_url: string | null = null;

	if (msg.user) {
		const memberAlias = msg.member_alias ?? null;
		author_name = memberAlias ?? msg.user.alias ?? msg.user.username;
		author_avatar_url = getAvatarURL(msg.user.id, msg.user.avatar);
	} else {
		for (const space of spaces) {
			const user = space.users.find((u) => u.id === msg.author_id);
			if (user) {
				const member = space.members.find((m) => m.user_id === msg.author_id);
				author_name = member?.alias ?? user.alias ?? user.username;
				author_avatar_url = getAvatarURL(user.id, user.avatar);
				break;
			}
		}
	}

	return {
		id: msg.id,
		content: msg.content ?? "",
		type: msg.type ?? 0,
		author_id: msg.author_id,
		author_name,
		author_avatar_url,
		created_at: msg.created_at,
		updated_at: msg.updated_at,
		nonce: msg.nonce,
		referenced_message: msg.referenced_message ?? null,
		ref_message_id: msg.ref_message_id ?? null,
		embeds: msg.embeds ?? null,
		attachments: msg.attachments ?? null,
		reactions: msg.reactions ?? null,
		sticker_attachment_id: msg.sticker_attachment_id ?? null,
	};
}

export function gatewaySpaceToGuild(space: GatewaySpace): Guild {
	return {
		id: space.id,
		name: space.name,
		icon_url: "",
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
	is_bot: boolean;
	is_owner: boolean;
	roles: Role[];
}

function userStatusToString(statusId: UserStatus): MemberOnSidebar["status"] {
	switch (statusId) {
		case 1:
			return "online";
		case 2:
			return "dnd";
		default:
			return "offline";
	}
}

export function gatewaySpaceToMembers(space: GatewaySpace): MemberOnSidebar[] {
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
				status: userStatusToString(u.status_id),
				is_bot: false,
				is_owner: u.id === space.owner_id,
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
	channelId: string;
	channelName: string;
	channelType: string;
	spaceId: string;
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
