<script lang="ts" module>
	import { channelMessages } from "$lib/stores.svelte";
	import { forgetUnlisted } from "$lib/uploads";
	import type { AllowedMentions, MessageReference } from "$lib/types";
	import type { SentNotice } from "$lib/typing";

	// The typing or recording notice the user last sent each chat (noticeDue in lib/typing.ts), by chat: a pane's Chat
	// stays as its rooms change, and two panes can show one chat, while the API's limit is per chat.
	const sentNotices = new Map<string, SentNotice>();

	// What each message being sent was sent with besides its text (files, ref, sticker, the reply's mention, or a voice
	// note's audio), and the draft it came from (a thread's, or else the room's), for its Retry. By nonce, and apart from
	// this view, which goes when a pane shows a conversation and on a READY: the message stays in its room's list, for its
	// Retry when the room shows again.
	const retryData = new Map<
		string,
		{
			files?: File[];
			ref?: MessageReference;
			stickerAttachmentId?: string;
			allowedMentions?: AllowedMentions;
			voiceNote?: Blob;
			draft?: string;
		}
	>();
	// A send's retry data goes once its message is in no list any more: nothing could retry or dismiss it (#323).
	channelMessages.subscribe((all) => forgetUnlisted(retryData, all));
</script>

<script lang="ts">
	import {
		AtSign as AtIcon,
		Eye as EyeIcon,
		EyeOff as EyeOffIcon,
		Pencil as PencilIcon,
		Reply as ReplyIcon,
		Upload as UploadIcon,
		X as CloseIcon,
	} from "@lucide/svelte";

	import { onMount, onDestroy, untrack, type Snippet } from "svelte";
	import ChatInput from "$lib/components/ChatInput.svelte";
	import CommandOptions from "$lib/components/CommandOptions.svelte";
	import MessageList from "$lib/components/MessageList.svelte";
	import type { CommandEntry } from "$lib/commands";
	import type {
		Message,
		MemberOnSidebar,
		GatewayMessage,
		GatewaySpace,
		Embed,
		SpaceCommandApplication,
	} from "$lib/types";
	import { gatewayMessageToMessage, isEphemeral, isNotice, MessageReferenceType } from "$lib/types";
	import {
		sendMessage,
		sendVoiceNote,
		sendTypingIndicator,
		sendRecordingIndicator,
		updateMessage,
	} from "$lib/api/messages";
	import { MessageType } from "$lib/types";
	import { currentUser, gatewaySpaces, noteOwnTyping, spaceEmojis, spaceStickers } from "$lib/stores.svelte";
	import { toast } from "$lib/stores/toast.svelte";
	import TypingIndicator from "$lib/components/TypingIndicator.svelte";
	import { noticeDue } from "$lib/typing";
	import { listEmojis } from "$lib/api/emojis";
	import { getAvatarURL } from "$lib/common/common";
	import { listStickers } from "$lib/api/stickers";
	import { getApiError } from "$lib/api/api";
	import { getSpaceCommands, sendCommandInteraction } from "$lib/api/interactions";
	import { hasPermission, mentionableRooms, Permission } from "$lib/permissions";
	import { displayName, isSpoiler, withSpoiler } from "$lib/spoilers";
	import { withSentMessage } from "$lib/arrivals";
	import {
		changeDraft,
		chatDrafts,
		draftOf,
		putBack,
		threadDraft,
		withoutDeletedReply,
		type SentDraft,
	} from "$lib/drafts";
	import { CANCELLED, sendFollowed, withoutSending } from "$lib/uploads";
	import { knowMessage, newestKnownIn } from "$lib/jumps";
	import { threadReplyTarget } from "$lib/threads";
	import { chatRequest, keyboard, leaveMessageBox } from "$lib/keyboard.svelte";
	import { takesChatShortcut } from "$lib/keyboard";
	import { layoutPrefs } from "$lib/layout-prefs.svelte";
	import IconButton from "$lib/components/ui/IconButton.svelte";

	let {
		messages,
		members = [],
		channelName,
		channelId,
		spaceId = "",
		space = null,
		isInitialLoading = false,
		isLoadingMore = false,
		isLoadingMoreBelow = false,
		hasMoreMessages = true,
		hasMoreMessagesBelow = false,
		highlightedMessageId = null,
		unreadAfterMessageId = null,
		onLoadMore = () => {},
		onLoadMoreBelow = () => {},
		onJumpToPresent = undefined,
		placeholder = undefined,
		failedNonces = $bindable(new Set<string>()),
		isAtBottom = $bindable(true),
		onSend = undefined,
		onSaveEdit = undefined,
		onDeleteMsg = undefined,
		onRetry = undefined,
		onDismiss = undefined,
		sendTyping = undefined,
		sendRecording = undefined,
		onUnreadMark = undefined,
		onVoiceNoteOverride = undefined,
		intro = undefined,
		retryFirstPage = null,
		paneFocused = true,
	}: {
		messages: Message[];
		members?: MemberOnSidebar[];
		channelName: string;
		channelId: string;
		spaceId?: string;
		space?: GatewaySpace | null;
		isInitialLoading?: boolean;
		isLoadingMore?: boolean;
		isLoadingMoreBelow?: boolean;
		hasMoreMessages?: boolean;
		hasMoreMessagesBelow?: boolean;
		highlightedMessageId?: string | null;
		unreadAfterMessageId?: string | null;
		onLoadMore?: () => Promise<void> | void;
		onLoadMoreBelow?: () => Promise<void> | void;
		/** Takes the list from a jump's pages to the present, as a message is sent from there; true once it's there. */
		onJumpToPresent?: () => Promise<boolean>;
		placeholder?: string;
		failedNonces?: Set<string>;
		isAtBottom?: boolean;
		/** A conversation's send. draft is the draft it came from (the conversation's, or a thread's), where a Cancel of its
		 * upload gives back what it took. */
		onSend?: (
			content: string,
			nonce: string,
			ref: MessageReference | undefined,
			files?: File[],
			stickerAttachmentId?: string,
			allowedMentions?: AllowedMentions,
			draft?: string,
		) => Promise<void>;
		onSaveEdit?: (msgId: string, content: string) => void | Promise<void>;
		onDeleteMsg?: (msgId: string) => Promise<void>;
		onRetry?: (message: Message) => void;
		onDismiss?: (nonce: string) => void;
		/** Tell the others the user is typing, or recording a voice message; a room's go to its endpoints. */
		sendTyping?: () => void;
		sendRecording?: () => void;
		onUnreadMark?: (messageId: string) => void;
		onVoiceNoteOverride?: (blob: Blob) => void;
		/** The start of the chat, above its oldest message (ChatIntro). */
		intro?: Snippet;
		/** Set while the chat's first page has failed: an empty list says so, with Try again calling this (MessageList). */
		retryFirstPage?: (() => void) | null;
		/**
		 * Whether this chat's pane is the focused one, whose message box takes a key pressed outside any input. A chat
		 * outside the panes (the friends view's) is the one on screen.
		 */
		paneFocused?: boolean;
	} = $props();
	// What's unsent in this chat, which stays when the user leaves it, whichever panes show it (lib/drafts.ts). The
	// message box keeps its text there, and this chat its reply and files.
	const draft = $derived(draftOf($chatDrafts, channelId));
	const replyTo = $derived(draft.replyTo);
	const replyMention = $derived(draft.replyMention);
	const pendingFiles = $derived(draft.files);
	// The reply bar's @ is on for each new reply. key is the draft's: the chat's, or one of its threads'.
	function setReplyIn(key: string, message: Message | null) {
		changeDraft(key, { replyTo: message, replyMention: true });
	}
	function setReply(message: Message | null) {
		setReplyIn(channelId, message);
	}
	// Nobody to mention in a reply to one's own message, a webhook's, or a notice: a pin's or a call's is the room's or
	// the conversation's, not its pinner's or caller's.
	const canMention = (message: Message) =>
		message.author_id !== $currentUser?.id && !message.webhook_id && !isNotice(message);
	let chatInputRef = $state<{ focus: () => void; focusAndInsert: (char: string) => void } | null>(null);
	// The message box of the thread open in this chat's list, which replies in it.
	let threadInputRef = $state<{ focus: () => void } | null>(null);
	// What was picked from the "/" menu (a command, or one of its subcommands), which the message box gives its place to.
	let command = $state<{ entry: CommandEntry; app: SpaceCommandApplication } | null>(null);
	// Commands are for the rooms the user can write in, not for conversations.
	const canUseCommands = $derived.by(() => {
		const room = space?.rooms.find((r) => r.id === channelId);
		return !!space && !!room && hasPermission(space, room, Permission.SendMessages);
	});
	// The rooms "#" suggests; a conversation has none.
	const mentionRooms = $derived(space ? mentionableRooms(space) : []);

	// Load emojis and stickers into global stores on space change
	$effect(() => {
		if (spaceId) {
			listEmojis(spaceId)
				.then((e) => {
					spaceEmojis.update((m) => ({ ...m, [spaceId]: e }));
				})
				.catch(() => {});
			listStickers(spaceId)
				.then((s) => {
					spaceStickers.update((m) => ({ ...m, [spaceId]: s }));
				})
				.catch(() => {});
		}
	});

	const customEmojis = $derived(spaceId ? ($spaceEmojis[spaceId] ?? []) : []);
	const spaceStickersArr = $derived(spaceId ? ($spaceStickers[spaceId] ?? []) : []);

	// A command and an edit are of the chat they started in: they end on leaving it, as neither is a draft. Focus input
	// when switching channels, unless keyboard navigation switched them and goes on
	$effect(() => {
		channelId;
		command = null;
		editingMessageId = null;
		editContent = "";
		editMessageIndex = null;
		replyMessageIndex = null;
		requestAnimationFrame(() => {
			if (!keyboard.keepNavigating) chatInputRef?.focus();
		});
	});

	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function removePendingFile(key: string, index: number) {
		changeDraft(key, { files: draftOf($chatDrafts, key).files.filter((_, i) => i !== index) });
	}

	// A spoiler is a file named SPOILER_<name> (lib/spoilers): the toggle renames the file waiting to be
	// sent, so whatever sends it (a room's message, a conversation's, a retry) sends it as a spoiler.
	function toggleSpoiler(key: string, index: number) {
		changeDraft(key, {
			files: draftOf($chatDrafts, key).files.map((f, i) => (i === index ? withSpoiler(f, !isSpoiler(f.name)) : f)),
		});
	}
	let editingMessageId = $state<string | null>(null);
	let editContent = $state("");
	let editMessageIndex = $state<number | null>(null);
	let replyMessageIndex = $state<number | null>(null);

	$effect(() => {
		if (editingMessageId === null) {
			editMessageIndex = null;
		}
	});

	$effect(() => {
		if (replyTo === null) {
			replyMessageIndex = null;
		}
	});

	// The messages Ctrl+Shift+Up and Up in an empty message box edit: the user's own, which a notice of theirs (a pin's,
	// or a call's they placed) isn't, as nobody edits one.
	function getOwnMessages() {
		const user = $currentUser;
		if (!user) return [];
		return [...messages]
			.filter((m) => m.author_id === user.id && !isNotice(m) && !failedNonces.has(m.nonce ?? ""))
			.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
	}

	function tryEditAtIndex(index: number) {
		const msg = getOwnMessages()[index];
		if (!msg) return false;
		editMessageIndex = index;
		editingMessageId = msg.id;
		editContent = msg.content ?? "";
		return true;
	}

	function tryEditLastMessage() {
		return tryEditAtIndex(0);
	}

	// The messages Ctrl+Up replies to: an ephemeral one isn't the room's, so nothing can reply to it, and a notice's row
	// has no Reply, which keyboard navigation's r skips too (decision 174).
	function getAllMessages() {
		return messages
			.filter((m) => !isEphemeral(m) && !isNotice(m))
			.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
	}

	function tryReplyAtIndex(index: number) {
		const msg = getAllMessages()[index];
		if (!msg) return false;
		replyMessageIndex = index;
		setReply(msg);
		return true;
	}

	function isOtherInputActive() {
		const active = document.activeElement;
		return (
			active &&
			(active.tagName === "INPUT" || active.tagName === "TEXTAREA" || (active as HTMLElement).isContentEditable)
		);
	}

	function handleGlobalKeyDown(event: KeyboardEvent) {
		// Keys pressed in a dialog or a menu (a modal, a picker, the image preview) are theirs, not the chat's.
		if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]'))
			return;
		// Hidden (the friends view hides the panes), the chat takes no keys: they'd go into a draft nobody sees.
		if (!rootEl?.offsetParent) return;
		// Ctrl+Up and Ctrl+Down, with Shift to edit, are one chat's: the one with the focus, or else the focused pane's.
		const chatShortcut = event.ctrlKey && (event.key === "ArrowUp" || event.key === "ArrowDown");
		if (chatShortcut && !takesChatShortcut(document.activeElement, rootEl, paneFocused)) return;

		const isCtrlShiftUp = event.ctrlKey && event.shiftKey && event.key === "ArrowUp";
		const isCtrlShiftDown = event.ctrlKey && event.shiftKey && event.key === "ArrowDown";

		if (isCtrlShiftUp) {
			event.preventDefault();
			const nextIndex = editMessageIndex === null ? 0 : editMessageIndex + 1;
			tryEditAtIndex(nextIndex);
			return;
		}

		if (isCtrlShiftDown) {
			event.preventDefault();
			if (editMessageIndex === null) return;
			if (editMessageIndex === 0) {
				editingMessageId = null;
				editContent = "";
				editMessageIndex = null;
			} else {
				tryEditAtIndex(editMessageIndex - 1);
			}
			return;
		}

		const isCtrlUp = event.ctrlKey && !event.shiftKey && event.key === "ArrowUp";
		const isCtrlDown = event.ctrlKey && !event.shiftKey && event.key === "ArrowDown";

		if (isCtrlUp) {
			event.preventDefault();
			const nextIndex = replyMessageIndex === null ? 0 : replyMessageIndex + 1;
			tryReplyAtIndex(nextIndex);
			return;
		}

		if (isCtrlDown) {
			event.preventDefault();
			if (replyMessageIndex === null) return;
			if (replyMessageIndex === 0) {
				setReply(null);
			} else {
				tryReplyAtIndex(replyMessageIndex - 1);
			}
			return;
		}

		if (isOtherInputActive()) return;

		// Focus chat input when typing a printable character, in the focused pane only: every pane's chat hears the key,
		// and the first to take it put it in its own box, whichever pane the user was in. A command's row has no message
		// box: its keys (Space on its switch) are its own.
		if (paneFocused && chatInputRef && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) {
			event.preventDefault();
			chatInputRef?.focusAndInsert(event.key);
		}
	}

	onMount(() => window.addEventListener("keydown", handleGlobalKeyDown));
	onDestroy(() => {
		if (typeof window === "undefined") return;
		window.removeEventListener("keydown", handleGlobalKeyDown);
	});

	// What a message is sent from: a draft (key), the chat's or one of its threads', and the message it replies to, with
	// whether the reply mentions its author. The chat's message box sends its draft's reply.
	type Sending = { key: string; replyTo: Message | null; replyMention: boolean };

	async function handleSendMessage(
		content: string,
		files?: File[],
		stickerAttachmentId?: string,
		sending: Sending = { key: channelId, replyTo, replyMention },
	) {
		const nonce = crypto.randomUUID();
		const user = $currentUser;
		if (!user) return;
		const replied = sending.replyTo;

		const ref = replied
			? ({
					type: MessageReferenceType.Reply,
					message_id: replied.id,
					room_id: channelId,
				} as MessageReference)
			: undefined;
		// A reply mentions the author of the message it replies to unless the reply bar's @ is off.
		const allowedMentions: AllowedMentions | undefined = replied ? { replied_user: sending.replyMention } : undefined;
		// What a Cancel of its upload gives back to the draft. A conversation's send (onSend) keeps its own.
		const fromDraft: SentDraft = {
			text: content,
			files: files ?? [],
			replyTo: replied,
			replyMention: sending.replyMention,
		};

		setReplyIn(sending.key, null);

		if (onSend) {
			try {
				await onSend(content, nonce, ref, files, stickerAttachmentId, allowedMentions, sending.key);
			} catch (err) {
				failedNonces = new Set(failedNonces).add(nonce);
				toast(getApiError(err, "Failed to send message"), "error");
			}
			return;
		}

		const isoNow = new Date().toISOString();
		// The quote shows the message as the list has it, or else as it was picked: a thread's can be older than the list.
		const quoted = replied ? (messages.find((m) => m.id === replied.id) ?? replied) : null;
		const pendingAttachments =
			files?.map((f) => ({
				id: "",
				message_id: "",
				filename: f.name,
				content_type: f.type || "application/octet-stream",
				size_bytes: f.size,
				created_at: isoNow,
				pending: true,
			})) ?? [];
		const pendingMessage = {
			id: nonce,
			content,
			author_id: user.id,
			author_name: user.alias ?? user.username,
			author_avatar_url: getAvatarURL(user.id, user.avatar),
			author_is_bot: user.is_bot ?? false,
			created_at: isoNow,
			updated_at: isoNow,
			nonce,
			known_newest: newestKnownIn(channelId),
			attachments: pendingAttachments.length > 0 ? pendingAttachments : null,
			sticker_attachment_id: stickerAttachmentId ?? null,
			...(ref && quoted
				? {
						referenced_message: {
							message_id: ref.message_id,
							content: quoted.content ?? "",
							author_id: quoted.author_id ?? "",
							author_name: quoted.author_name ?? "",
							author_avatar: quoted.author_avatar_url ?? null,
							created_at: quoted.created_at ?? isoNow,
						},
					}
				: {}),
		} as any;

		channelMessages.update((all) => ({
			...all,
			[channelId]: [...(all[channelId] ?? []), pendingMessage],
		}));

		retryData.set(nonce, { files, ref, stickerAttachmentId, allowedMentions, draft: sending.key });
		const roomId = channelId;
		sendFollowed(nonce, files, (upload) =>
			sendMessage(roomId, content, nonce, ref, files, undefined, stickerAttachmentId, allowedMentions, upload),
		)
			.then((raw) => (raw === CANCELLED ? cancelled(roomId, nonce, fromDraft, sending.key) : sent(roomId, nonce)(raw)))
			.catch((err) => {
				failedNonces = new Set(failedNonces).add(nonce);
				toast(getApiError(err, "Failed to send message"), "error");
			});
	}

	// What follows a send of this window's that the API took: its retry data goes, and the API's copy takes the place of
	// its pending one, by its nonce, as MESSAGE_CREATE's does. That event can be missed (a connection that dropped and
	// didn't resume), and the message would stay pending. The room is the one it was sent to.
	function sent(roomId: string, nonce: string) {
		return (raw: GatewayMessage) => {
			retryData.delete(nonce);
			knowMessage(roomId, raw.id);
			const message = gatewayMessageToMessage(raw, $gatewaySpaces);
			channelMessages.update((all) => {
				const existing = all[roomId] ?? [];
				const shown = withSentMessage(existing, nonce, message);
				return shown === existing ? all : { ...all, [roomId]: shown };
			});
		};
	}

	// A send of this window's whose upload was cancelled (lib/uploads): the message leaves its room's list, and what it
	// took from the room's draft goes back (lib/drafts' putBack): its files, and its text and reply while the draft has
	// neither. When MESSAGE_CREATE has replaced it already, the message was posted after all: it stays, and nothing goes
	// back. One that comes later takes back out what's still as it went (connection.ts, lib/drafts' takeBack). into is the
	// draft the send came from: the room's, or one of its threads'.
	function cancelled(roomId: string, nonce: string, fromDraft: SentDraft, into = roomId) {
		retryData.delete(nonce);
		let sending: Message | undefined;
		channelMessages.update((all) => {
			const list = all[roomId] ?? [];
			const kept = withoutSending(list, nonce);
			if (!kept) return all;
			sending = list.find((m) => m.id === nonce);
			return { ...all, [roomId]: kept };
		});
		if (sending) putBack(roomId, nonce, withoutDeletedReply(fromDraft, sending), into);
	}

	function handleReply(message: Message) {
		// The box holds one thing at a time: a reply picked while a message is edited ends the edit.
		if (editingMessageId !== null) cancelEdit();
		setReply(message);
		chatInputRef?.focus();
	}

	// An edit is made in the message box (DECISIONS.md): it holds the message's text, under a strip that says so, in
	// place of the chat's draft, which shows again as the edit ends. Enter saves, Esc cancels; an unchanged or empty
	// edit saves nothing.
	function cancelEdit() {
		editingMessageId = null;
		editContent = "";
	}

	function saveEdit(content: string) {
		const messageId = editingMessageId;
		if (messageId === null) return;
		const original = messages.find((m) => m.id === messageId)?.content;
		const trimmed = content.trim();
		if (trimmed && trimmed !== original) {
			if (onSaveEdit) Promise.resolve(onSaveEdit(messageId, trimmed)).catch(console.error);
			else updateMessage(messageId, trimmed, channelId).catch(console.error);
		}
		cancelEdit();
	}

	// The message box's height, for the list above it and the jump button (--composer-h): the list's newest message
	// clears the box however tall it grows, with a reply, files or several lines of text.
	let composerEl = $state<HTMLElement>();
	$effect(() => {
		const bar = composerEl;
		const root = rootEl;
		if (!bar || !root || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => root.style.setProperty("--composer-h", `${bar.offsetHeight}px`));
		observer.observe(bar);
		return () => observer.disconnect();
	});

	// Esc in the message box drops the reply being written; with nothing to drop, keyboard navigation leaves the box
	// for the messages.
	function handleEscape() {
		if (replyTo) setReply(null);
		else if (layoutPrefs.keyboardNavigation) leaveMessageBox(rootEl ?? null);
	}

	// What keyboard navigation asks of this chat, when it's the focused pane's: reply to or edit the message under the
	// cursor, or go back to the message box. Only the user's own messages are edited, as their menu offers.
	let rootEl = $state<HTMLElement>();
	$effect(() => {
		const request = chatRequest.current;
		if (!request || !rootEl || !request.pane.contains(rootEl)) return;
		untrack(() => {
			chatRequest.current = null;
			if (request.kind === "write") {
				chatInputRef?.focus();
				return;
			}
			const message = messages.find((m) => m.id === request.messageId);
			if (!message || isEphemeral(message) || isNotice(message)) return;
			if (request.kind === "reply") handleReply(message);
			else if (message.author_id === $currentUser?.id) {
				editingMessageId = message.id;
				editContent = message.content ?? "";
			}
		});
	});

	function retryMessage(message: Message) {
		if (onRetry) {
			onRetry(message);
			return;
		}
		const nonce = message.nonce!;
		const saved = retryData.get(nonce);
		const newSet = new Set(failedNonces);
		newSet.delete(nonce);
		failedNonces = newSet;
		// A voice note goes again as one: its audio, not its empty text.
		if (saved?.voiceNote) {
			sendVoiceNote(channelId, saved.voiceNote, nonce)
				.then(sent(channelId, nonce))
				.catch((err) => {
					failedNonces = new Set(failedNonces).add(nonce);
					toast(getApiError(err, "Failed to send voice note"), "error");
				});
			return;
		}
		const roomId = channelId;
		// What a Cancel gives back: the saved data has the reply's reference, whose message is found in the room's list.
		const fromDraft: SentDraft = {
			text: message.content ?? "",
			files: saved?.files ?? [],
			replyTo: messages.find((m) => m.id === saved?.ref?.message_id) ?? null,
			replyMention: saved?.allowedMentions?.replied_user ?? true,
		};
		sendFollowed(nonce, saved?.files, (upload) =>
			sendMessage(
				roomId,
				message.content ?? "",
				nonce,
				saved?.ref,
				saved?.files,
				undefined,
				saved?.stickerAttachmentId,
				saved?.allowedMentions,
				upload,
			),
		)
			.then((raw) => (raw === CANCELLED ? cancelled(roomId, nonce, fromDraft, saved?.draft) : sent(roomId, nonce)(raw)))
			.catch((err) => {
				failedNonces = new Set(failedNonces).add(nonce);
				toast(getApiError(err, "Failed to send message"), "error");
			});
	}

	// A reply in the thread of root, from its draft (threadReplyTarget).
	function sendThreadReply(root: Message, content: string, files?: File[], stickerAttachmentId?: string) {
		const key = threadDraft(root.id);
		void handleSendMessage(content, files, stickerAttachmentId, {
			key,
			...threadReplyTarget(draftOf($chatDrafts, key), root),
		});
	}

	// A message of the thread of root picked to reply to: its draft's reply bar shows it, and the thread's box takes the
	// focus.
	function replyInThread(message: Message, root: Message) {
		setReplyIn(threadDraft(root.id), message);
		threadInputRef?.focus();
	}

	function handleTyping(text: string) {
		if (!text) return;
		notifyTyping(false);
	}

	// The user is typing, or recording a voice message. Their own row of the members column shows it (noteOwnTyping),
	// and nothing else: it isn't kept with the others' notices (typingUsers). The others are told at most every 3 seconds
	// in each chat, but at once when typing turns into recording or back (noticeDue).
	function notifyTyping(recording: boolean) {
		const now = Date.now();
		noteOwnTyping(channelId, recording);
		if (!noticeDue(sentNotices, channelId, recording, now)) return;
		if (recording) (sendRecording ?? (() => sendRecordingIndicator(channelId)))();
		else (sendTyping ?? (() => sendTypingIndicator(channelId)))();
	}

	function dismissFailedMessage(nonce: string) {
		if (onDismiss) {
			onDismiss(nonce);
			return;
		}
		retryData.delete(nonce);
		const newSet = new Set(failedNonces);
		newSet.delete(nonce);
		failedNonces = newSet;
		channelMessages.update((all) => ({
			...all,
			[channelId]: (all[channelId] ?? []).filter((m) => m.nonce !== nonce),
		}));
	}

	async function handleVoiceNote(blob: Blob) {
		if (onVoiceNoteOverride) {
			onVoiceNoteOverride(blob);
			return;
		}

		const nonce = crypto.randomUUID();
		const user = $currentUser;
		if (!user) return;

		const isoNow = new Date().toISOString();
		const pendingMessage = {
			id: nonce,
			content: "",
			type: MessageType.Voice,
			author_id: user.id,
			author_name: user.alias ?? user.username,
			author_avatar_url: getAvatarURL(user.id, user.avatar),
			author_is_bot: user.is_bot ?? false,
			created_at: isoNow,
			updated_at: isoNow,
			nonce,
			known_newest: newestKnownIn(channelId),
			attachments: [
				{
					id: "",
					message_id: "",
					filename: "voice-note.webm",
					content_type: "audio/webm;codecs=opus",
					size_bytes: blob.size,
					created_at: isoNow,
					pending: true,
				},
			],
		} as any;

		channelMessages.update((all) => ({
			...all,
			[channelId]: [...(all[channelId] ?? []), pendingMessage],
		}));

		retryData.set(nonce, { voiceNote: blob });
		sendVoiceNote(channelId, blob, nonce)
			.then(sent(channelId, nonce))
			.catch((err) => {
				failedNonces = new Set(failedNonces).add(nonce);
				toast(getApiError(err, "Failed to send voice note"), "error");
			});
	}

	let fileDragOver = $state(false);

	function handleFileDragOver(e: DragEvent) {
		if (!e.dataTransfer?.types.includes("Files")) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = "copy";
		fileDragOver = true;
	}

	function handleFileDragLeave(e: DragEvent) {
		const el = e.currentTarget as HTMLElement;
		if (!el.contains(e.relatedTarget as Node)) {
			fileDragOver = false;
		}
	}

	function handleFileDrop(e: DragEvent) {
		fileDragOver = false;
		if (!e.dataTransfer?.files.length) return;
		e.preventDefault();
		changeDraft(channelId, { files: [...pendingFiles, ...Array.from(e.dataTransfer.files)] });
		chatInputRef?.focus();
	}
</script>

<div
	bind:this={rootEl}
	data-chat
	class="bg-duvet-bg relative flex flex-1 flex-col overflow-hidden"
	ondragover={handleFileDragOver}
	ondragleave={handleFileDragLeave}
	ondrop={handleFileDrop}
	role="region"
	aria-label="Chat"
>
	{#if fileDragOver}
		<div
			class="bg-duvet-scrim pointer-events-none absolute inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
		>
			<div
				class="border-duvet-accent bg-duvet-glass-strong text-duvet-accent-text flex flex-col items-center gap-2 rounded-[20px] border-2 border-dashed px-10 py-8"
			>
				<UploadIcon size={36} strokeWidth={1.5} />
				<span class="text-sm font-medium">Drop files to upload</span>
			</div>
		</div>
	{/if}
	<MessageList
		{messages}
		{members}
		{channelId}
		{spaceId}
		{space}
		{isInitialLoading}
		{isLoadingMore}
		{isLoadingMoreBelow}
		{hasMoreMessages}
		{hasMoreMessagesBelow}
		highlightedMessageId={replyTo?.id ?? highlightedMessageId}
		{unreadAfterMessageId}
		{onLoadMore}
		{onLoadMoreBelow}
		{onJumpToPresent}
		{failedNonces}
		bind:isAtBottom
		{onDeleteMsg}
		bind:editingMessageId
		bind:editContent
		onRetry={retryMessage}
		onDismiss={dismissFailedMessage}
		onReply={handleReply}
		{onUnreadMark}
		{customEmojis}
		{intro}
		{retryFirstPage}
		{threadComposer}
		onThreadReply={replyInThread}
	/>

	<!-- The message box: a glass bar docked over the list's foot, which scrolls under it. Its height is the list's
	     bottom padding (--composer-h), so no message hides behind it. -->
	<div
		bind:this={composerEl}
		class="bg-duvet-glass absolute inset-x-0 bottom-0 z-4 flex flex-col px-(--duvet-pad-x) pt-2 pb-3.5 shadow-[0_-1px_0_var(--duvet-line)] backdrop-blur-[20px] backdrop-saturate-[1.8]"
	>
		{@render draftBars(channelId, () => chatInputRef?.focus(), true)}
		{#if command}
			{@const active = command}
			<CommandOptions
				entry={active.entry}
				app={active.app}
				{space}
				{members}
				onSend={(data) =>
					sendCommandInteraction(channelId, active.app.id, data, {
						space,
						members,
						from: {
							name: active.app.bot.alias ?? active.app.bot.username,
							avatarUrl: getAvatarURL(active.app.bot.id, active.app.bot.avatar),
						},
					})}
				onExit={() => (command = null)}
			/>
		{:else if editingMessageId !== null}
			<!-- The edit of one message, in the box: its own text and undo steps, apart from the chat's draft -->
			<div class="text-duvet-accent-text flex items-center gap-2 px-1.5 pb-2 text-[12.5px] leading-[1.2]">
				<PencilIcon size={14} class="shrink-0" />
				<span class="font-semibold">Editing your message</span>
				<span class="text-duvet-ink2 min-w-0 flex-1 truncate">Esc to cancel · Enter to save</span>
				<IconButton label="Cancel edit" title="Cancel edit" size="sm" onclick={cancelEdit}>
					<CloseIcon size={14} />
				</IconButton>
			</div>
			{#key editingMessageId}
				<ChatInput
					initialValue={editContent}
					placeholder="Edit your message"
					onValueChange={(text) => {
						editContent = text;
					}}
					onSubmit={saveEdit}
					onCancel={cancelEdit}
					editing
					autofocus
					{members}
					rooms={mentionRooms}
					{customEmojis}
				/>
			{/key}
		{:else}
			<!-- A box of its own for each chat: its text, undo steps, suggestions, pickers and recording are that chat's. -->
			{#key channelId}
				<ChatInput
					bind:this={chatInputRef}
					draftChat={channelId}
					bind:pendingFiles={() => pendingFiles, (files) => changeDraft(channelId, { files })}
					placeholder={placeholder ?? `Message #${channelName}`}
					onSubmit={handleSendMessage}
					onVoiceNote={handleVoiceNote}
					onRecording={() => notifyTyping(true)}
					onArrowUpWhenEmpty={tryEditLastMessage}
					onCancel={handleEscape}
					onValueChange={handleTyping}
					{members}
					rooms={mentionRooms}
					{customEmojis}
					spaceStickers={spaceStickersArr}
					loadCommands={canUseCommands ? () => getSpaceCommands(spaceId) : undefined}
					onCommand={(entry, app) => (command = { entry, app })}
					autofocus={!keyboard.keepNavigating}
				/>
			{/key}
		{/if}
	</div>
</div>

<!-- Over a message box, the chat's or a thread's (key). Who's typing in the chat (typing) hangs over the list's bottom,
     out of the box's own height: it shows in the 24 px the list leaves under its newest message, so it covers none and
     moves none as it comes and goes. The draft's strips are the box's own: the message it replies to, and its files.
     focus gives the box the focus back. -->
{#snippet draftBars(key: string, focus: () => void, typing = false)}
	{@const pending = draftOf($chatDrafts, key)}
	{#if typing}
		<div class="pointer-events-none absolute right-0 bottom-full left-0 flex flex-col px-(--duvet-pad-x)">
			<TypingIndicator channelId={key} />
		</div>
	{/if}
	{#if pending.replyTo}
		{@const own = pending.replyTo.author_id === $currentUser?.id}
		<div class="text-duvet-ink2 flex items-center gap-2 px-1.5 pb-2 text-[12.5px] leading-[1.2]">
			<ReplyIcon size={14} class="shrink-0" />
			<span class="shrink-0"
				>Replying to <span class="text-duvet-ink font-semibold">{own ? "yourself" : pending.replyTo.author_name}</span
				></span
			>
			<span class="font-content min-w-0 flex-1 truncate">{pending.replyTo.content ?? ""}</span>
			{#if canMention(pending.replyTo)}
				<!-- Whether the reply mentions the author of the message it replies to -->
				<button
					type="button"
					class="flex h-[26px] shrink-0 items-center gap-0.5 rounded-lg px-1.5 text-[11.5px] font-semibold transition-colors motion-reduce:transition-none {pending.replyMention
						? 'bg-duvet-accent-tint text-duvet-accent-text'
						: 'text-duvet-ink2 hover:bg-duvet-hover hover:text-duvet-ink'}"
					onclick={() => {
						changeDraft(key, { replyMention: !pending.replyMention });
						focus();
					}}
					aria-pressed={pending.replyMention}
					aria-label="Mention {pending.replyTo.author_name}"
					title={pending.replyMention
						? `Click to not mention ${pending.replyTo.author_name}`
						: `Click to mention ${pending.replyTo.author_name}`}
					><AtIcon size={13} />{pending.replyMention ? "ON" : "OFF"}</button
				>
			{/if}
			<IconButton label="Cancel reply" title="Cancel reply" size="sm" onclick={() => setReplyIn(key, null)}>
				<CloseIcon size={14} />
			</IconButton>
		</div>
	{/if}
	{#if pending.files.length > 0}
		<div class="flex flex-wrap gap-1.5 px-0.5 pb-2">
			{#each pending.files as file, i}
				{@const name = displayName(file.name)}
				{@const spoiler = isSpoiler(file.name)}
				<div class="bg-duvet-card shadow-duvet-raised flex h-8 max-w-60 items-center gap-1.5 rounded-xl pr-1 pl-2.5">
					<span class="text-duvet-ink truncate text-xs font-medium">{name}</span>
					<span class="text-duvet-ink2 shrink-0 text-[11px] tabular-nums">{formatFileSize(file.size)}</span>
					<button
						class="grid size-6 shrink-0 place-items-center rounded-md transition-colors motion-reduce:transition-none {spoiler
							? 'bg-duvet-accent-tint text-duvet-accent-text'
							: 'text-duvet-ink2 hover:bg-duvet-hover hover:text-duvet-ink'}"
						onclick={() => toggleSpoiler(key, i)}
						aria-pressed={spoiler}
						aria-label="Mark {name} as spoiler"
						title={spoiler ? "Remove spoiler" : "Mark as spoiler"}
					>
						{#if spoiler}
							<EyeOffIcon class="size-3.5" />
						{:else}
							<EyeIcon class="size-3.5" />
						{/if}
					</button>
					<button
						class="text-duvet-ink2 hover:bg-duvet-hover hover:text-duvet-ink grid size-6 shrink-0 place-items-center rounded-md transition-colors motion-reduce:transition-none"
						onclick={() => removePendingFile(key, i)}
						aria-label="Remove {name}"
					>
						<CloseIcon class="size-3.5" />
					</button>
				</div>
			{/each}
		</div>
	{/if}
{/snippet}

<!-- The message box of the thread of root open in this chat's list, which replies in it (sendThreadReply): its own
     draft (threadDraft), with its reply bar and files, and the message box's suggestions and pickers, without a voice
     note, which replies to nothing, nor a command. -->
{#snippet threadComposer(root: Message)}
	{@const key = threadDraft(root.id)}
	<div class="border-duvet-line relative flex shrink-0 flex-col border-t px-4 pt-2 pb-3">
		{@render draftBars(key, () => threadInputRef?.focus())}
		{#key key}
			<ChatInput
				bind:this={threadInputRef}
				draftChat={key}
				bind:pendingFiles={() => draftOf($chatDrafts, key).files, (files) => changeDraft(key, { files })}
				placeholder="Reply in thread"
				onSubmit={(content, files, sticker) => sendThreadReply(root, content, files, sticker)}
				onValueChange={handleTyping}
				{members}
				rooms={mentionRooms}
				{customEmojis}
				spaceStickers={spaceStickersArr}
				autofocus
			/>
		{/key}
	</div>
{/snippet}
