<script lang="ts">
	import { Hash as HashIcon } from "@lucide/svelte";

	import { onMount, onDestroy } from "svelte";
	import ChatInput from "$lib/components/ChatInput.svelte";
	import CommandOptions from "$lib/components/CommandOptions.svelte";
	import MessageList from "$lib/components/MessageList.svelte";
	import MessageSearch from "$lib/components/MessageSearch.svelte";
	import PinnedMessages from "$lib/components/PinnedMessages.svelte";
	import type {
		ApplicationCommand,
		Message,
		MemberOnSidebar,
		GatewaySpace,
		MessageReference,
		Embed,
		SpaceCommandApplication,
	} from "$lib/types";
	import { MessageReferenceType } from "$lib/types";
	import { sendMessage, sendVoiceNote, sendTypingIndicator, sendRecordingIndicator } from "$lib/api/messages";
	import { MessageType } from "$lib/types";
	import { currentUser, channelMessages, typingUsers, spaceEmojis, spaceStickers } from "$lib/stores.svelte";
	import { toast } from "$lib/stores/toast.svelte";
	import TypingIndicator from "$lib/components/TypingIndicator.svelte";
	import { listEmojis } from "$lib/api/emojis";
	import { getAvatarURL } from "$lib/common/common";
	import { listStickers } from "$lib/api/stickers";
	import { getApiError } from "$lib/api/api";
	import { getSpaceCommands, sendCommandInteraction } from "$lib/api/interactions";
	import { hasPermission, Permission } from "$lib/permissions";

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
		showHeader = true,
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
		showHeader?: boolean;
		placeholder?: string;
		failedNonces?: Set<string>;
		isAtBottom?: boolean;
		onSend?: (
			content: string,
			nonce: string,
			ref: MessageReference | undefined,
			files?: File[],
			stickerAttachmentId?: string,
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
	} = $props();
	let replyTo = $state<Message | null>(null);
	let chatInputRef = $state<{ focus: () => void; focusAndInsert: (char: string) => void } | null>(null);
	let pendingFiles = $state<File[]>([]);
	// The command picked from the "/" menu, which the message box gives its place to.
	let command = $state<{ command: ApplicationCommand; app: SpaceCommandApplication } | null>(null);
	// Commands are for the rooms the user can write in, not for conversations.
	const canUseCommands = $derived.by(() => {
		const room = space?.rooms.find((r) => r.id === channelId);
		return !!space && !!room && hasPermission(space, room, Permission.SendMessages);
	});
	let lastTypingSent = 0;
	let lastTypingRecording = false;

	// Store original send data for retry (files, ref, sticker)
	const retryData = new Map<string, { files?: File[]; ref?: MessageReference; stickerAttachmentId?: string }>();

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

	// Focus input when switching channels
	$effect(() => {
		channelId;
		command = null;
		requestAnimationFrame(() => chatInputRef?.focus());
	});

	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function removePendingFile(index: number) {
		pendingFiles = pendingFiles.filter((_, i) => i !== index);
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

	function getOwnMessages() {
		const user = $currentUser;
		if (!user) return [];
		return [...messages]
			.filter((m) => m.author_id === user.id && !failedNonces.has(m.nonce ?? ""))
			.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
	}

	function tryEditAtIndex(index: number) {
		const msgs = getOwnMessages();
		if (index < 0 || index >= msgs.length) return false;
		editMessageIndex = index;
		editingMessageId = msgs[index].id;
		editContent = msgs[index].content ?? "";
		return true;
	}

	function tryEditLastMessage() {
		tryEditAtIndex(0);
	}

	function getAllMessages() {
		return [...messages].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
	}

	function tryReplyAtIndex(index: number) {
		const msgs = getAllMessages();
		if (index < 0 || index >= msgs.length) return false;
		replyMessageIndex = index;
		replyTo = msgs[index];
		return true;
	}

	function isOtherInputActive() {
		const active = document.activeElement;
		return (
			active &&
			(active as HTMLElement).dataset?.chatinput !== "true" &&
			(active.tagName === "INPUT" || active.tagName === "TEXTAREA" || (active as HTMLElement).isContentEditable)
		);
	}

	function handleGlobalKeyDown(event: KeyboardEvent) {
		// Keys pressed in a dialog or a menu (a modal, a picker, the image preview) are theirs, not the chat's.
		if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]'))
			return;

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
				replyTo = null;
			} else {
				tryReplyAtIndex(replyMessageIndex - 1);
			}
			return;
		}

		if (isOtherInputActive()) return;

		// Focus chat input when typing a printable character. A command's row has no message box: its keys
		// (Space on its switch) are its own.
		if (chatInputRef && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) {
			event.preventDefault();
			chatInputRef?.focusAndInsert(event.key);
		}
	}

	onMount(() => window.addEventListener("keydown", handleGlobalKeyDown));
	onDestroy(() => {
		if (typeof window === "undefined") return;
		window.removeEventListener("keydown", handleGlobalKeyDown);
	});

	async function handleSendMessage(content: string, files?: File[], stickerAttachmentId?: string) {
		const nonce = crypto.randomUUID();
		const user = $currentUser;
		if (!user) return;

		const ref = replyTo
			? ({
					type: MessageReferenceType.Reply,
					message_id: replyTo.id,
					room_id: channelId,
				} as MessageReference)
			: undefined;

		replyTo = null;

		if (onSend) {
			try {
				await onSend(content, nonce, ref, files, stickerAttachmentId);
			} catch {
				failedNonces = new Set(failedNonces).add(nonce);
			}
			return;
		}

		const isoNow = new Date().toISOString();
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
			attachments: pendingAttachments.length > 0 ? pendingAttachments : null,
			sticker_attachment_id: stickerAttachmentId ?? null,
			...(ref
				? {
						referenced_message: {
							message_id: ref.message_id,
							content: messages.find((m) => m.id === ref.message_id)?.content ?? "",
							author_id: messages.find((m) => m.id === ref.message_id)?.author_id ?? "",
							author_name: messages.find((m) => m.id === ref.message_id)?.author_name ?? "",
							author_avatar: messages.find((m) => m.id === ref.message_id)?.author_avatar_url ?? null,
							created_at: messages.find((m) => m.id === ref.message_id)?.created_at ?? isoNow,
						},
					}
				: {}),
		} as any;

		channelMessages.update((all) => ({
			...all,
			[channelId]: [...(all[channelId] ?? []), pendingMessage],
		}));

		retryData.set(nonce, { files, ref, stickerAttachmentId });
		sendMessage(channelId, content, nonce, ref, files, undefined, stickerAttachmentId)
			.then(() => retryData.delete(nonce))
			.catch((err) => {
				failedNonces = new Set(failedNonces).add(nonce);
				toast(getApiError(err, "Failed to send message"), "error");
			});
	}

	function handleReply(message: Message) {
		replyTo = message;
		chatInputRef?.focus();
	}

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
		sendMessage(
			channelId,
			message.content ?? "",
			nonce,
			saved?.ref,
			saved?.files,
			undefined,
			saved?.stickerAttachmentId,
		)
			.then(() => retryData.delete(nonce))
			.catch((err) => {
				failedNonces = new Set(failedNonces).add(nonce);
				toast(getApiError(err, "Failed to send message"), "error");
			});
	}

	function handleTyping(text: string) {
		if (!text) return;
		notifyTyping(false);
	}

	// Shows the user typing, or recording a voice message, and tells the others: at most every 3
	// seconds, but at once when typing turns into recording or back.
	function notifyTyping(recording: boolean) {
		const now = Date.now();
		const user = $currentUser;
		if (user) {
			typingUsers.update((all) => {
				const filtered = (all[channelId] ?? []).filter((u) => u.user_id !== user.id);
				return {
					...all,
					[channelId]: [
						...filtered,
						{
							user_id: user.id,
							username: user.username,
							alias: user.alias ?? null,
							avatar: user.avatar ?? null,
							timestamp: now,
							recording,
						},
					],
				};
			});
		}
		if (now - lastTypingSent < 3000 && recording === lastTypingRecording) return;
		lastTypingSent = now;
		lastTypingRecording = recording;
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

		sendVoiceNote(channelId, blob, nonce).catch((err) => {
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
		pendingFiles = [...pendingFiles, ...Array.from(e.dataTransfer.files)];
		chatInputRef?.focus();
	}
</script>

<div
	class="relative flex flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,oklch(0.22_0.01_80),oklch(0.19_0.008_80))]"
	ondragover={handleFileDragOver}
	ondragleave={handleFileDragLeave}
	ondrop={handleFileDrop}
	role="region"
	aria-label="Chat"
>
	{#if fileDragOver}
		<div
			class="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
		>
			<div
				class="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-indigo-400 bg-zinc-900/80 px-10 py-8"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="40"
					height="40"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="text-indigo-400"
					><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line
						x1="12"
						x2="12"
						y1="3"
						y2="15"
					/></svg
				>
				<span class="text-sm font-medium text-indigo-300">Drop files to upload</span>
			</div>
		</div>
	{/if}
	{#if showHeader}
		<div
			class="flex h-10 shrink-0 items-center justify-between border-b border-stone-800 bg-stone-950/45 px-3 font-semibold text-stone-100"
		>
			<div class="flex flex-row items-center gap-2">
				<HashIcon class="size-5 text-zinc-400" />
				{channelName}
			</div>
			<div class="flex flex-row items-center gap-3">
				{#key channelId}
					<PinnedMessages {space} {channelId} {members} {customEmojis} />
				{/key}
				{#key spaceId}
					<MessageSearch {space} {members} {customEmojis} />
				{/key}
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
		{failedNonces}
		bind:isAtBottom
		{onSaveEdit}
		{onDeleteMsg}
		bind:editingMessageId
		bind:editContent
		onRetry={retryMessage}
		onDismiss={dismissFailedMessage}
		onReply={handleReply}
		{onUnreadMark}
		{customEmojis}
	/>

	<div class="relative w-full">
		<div
			class="pointer-events-none absolute bottom-0 z-10 h-5 w-full bg-linear-to-t from-stone-950/45 to-transparent"
		></div>
	</div>
	<!-- Typing indicator -->
	<TypingIndicator {channelId} />
	<!-- Bottom input bar -->
	<div
		class="relative flex max-h-48 min-h-16 flex-row items-end gap-2 border-t border-stone-800 bg-stone-950/45 px-3 py-2"
	>
		{#if replyTo || pendingFiles.length > 0}
			<div class="absolute right-0 bottom-full left-0 flex flex-col">
				{#if replyTo}
					<div
						class="flex items-center justify-between border-t border-stone-800 bg-stone-900/90 px-3 py-1.5 text-xs text-zinc-400"
					>
						<span>Replying to <span class="font-semibold text-zinc-200">{replyTo.author_name}</span></span>
						<button
							class="text-zinc-500 transition-colors hover:text-zinc-300"
							onclick={() => {
								replyTo = null;
							}}
							aria-label="Cancel reply"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg
							>
						</button>
					</div>
				{/if}
				{#if pendingFiles.length > 0}
					<div class="flex flex-wrap gap-1.5 border-t border-stone-800 bg-stone-900/90 px-3 py-1.5">
						{#each pendingFiles as file, i}
							<div class="flex max-w-56 items-center gap-1.5 rounded border border-stone-700 bg-stone-800 px-2 py-1">
								<span class="truncate text-xs text-zinc-300">{file.name}</span>
								<span class="text-xxs shrink-0 text-zinc-500">{formatFileSize(file.size)}</span>
								<button
									class="shrink-0 text-zinc-500 transition-colors hover:text-zinc-300"
									onclick={() => removePendingFile(i)}
									aria-label="Remove {file.name}"
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2.5"
										stroke-linecap="round"
										stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg
									>
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
		{#if command}
			{@const active = command}
			<CommandOptions
				command={active.command}
				app={active.app}
				{space}
				{members}
				onSend={(data) => sendCommandInteraction(channelId, active.app.id, data)}
				onExit={() => (command = null)}
			/>
		{:else}
			<ChatInput
				bind:this={chatInputRef}
				bind:pendingFiles
				placeholder={placeholder ?? `Message #${channelName}`}
				onSubmit={handleSendMessage}
				onVoiceNote={handleVoiceNote}
				onRecording={() => notifyTyping(true)}
				onArrowUpWhenEmpty={tryEditLastMessage}
				onValueChange={handleTyping}
				{members}
				{customEmojis}
				spaceStickers={spaceStickersArr}
				loadCommands={canUseCommands ? () => getSpaceCommands(spaceId) : undefined}
				onCommand={(picked, app) => (command = { command: picked, app })}
				autofocus
			/>
		{/if}
	</div>
</div>
