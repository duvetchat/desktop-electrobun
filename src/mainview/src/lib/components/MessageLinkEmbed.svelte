<script lang="ts">
	import { onMount } from "svelte";
	import { getMessageById } from "$lib/api/messages";
	import { getDirectMessageById } from "$lib/api/conversations";
	import { authorLabel, gatewayMessageToMessage, messageText } from "$lib/types";
	import { gatewaySpaces, jumpToMessageRequest, conversations, roomNames } from "$lib/stores.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import type { Message } from "$lib/types";
	import { renderMarkdown } from "$lib/markdown";
	import { getAvatarURL } from "$lib/common/common";
	import { t } from "$lib/i18n";
	import { formatDate } from "$lib/i18n/format";
	import { MESSAGE_CARD, MESSAGE_CARD_ACTION } from "$lib/message-styles";

	let {
		spaceId = "",
		roomId = "",
		messageId,
		conversationId,
	}: {
		spaceId?: string;
		roomId?: string;
		messageId: string;
		conversationId?: string;
	} = $props();

	const isConv = $derived(!!conversationId);

	let message = $state<Message | null>(null);
	let loading = $state(true);
	let error = $state(false);

	const space = $derived(!isConv ? ($gatewaySpaces.find((s) => s.id === spaceId) ?? null) : null);
	const room = $derived(space?.rooms.find((r) => r.id === roomId) ?? null);
	const conv = $derived(isConv ? ($conversations.find((c) => c.id === conversationId) ?? null) : null);
	const convName = $derived(conv?.name ?? t("media_link_direct_message"));

	function formatTime(dateStr: string): string {
		return formatDate(new Date(dateStr), { hour: "2-digit", minute: "2-digit" });
	}

	onMount(async () => {
		try {
			if (isConv && conversationId) {
				const raw = await getDirectMessageById(conversationId, messageId);
				message = {
					id: raw.id,
					content: raw.content,
					type: raw.type ?? 0,
					author_id: raw.author_id,
					author_name: raw.user?.alias ?? raw.user?.username ?? raw.author_id.slice(0, 8),
					author_avatar_url: getAvatarURL(raw.author_id, raw.user?.avatar),
					author_is_bot: raw.user?.is_bot ?? false,
					created_at: raw.created_at,
					updated_at: raw.updated_at,
					embeds: raw.embeds ?? null,
					attachments: raw.attachments ?? null,
					reactions: raw.reactions ?? null,
				};
			} else {
				const raw = await getMessageById(roomId, messageId);
				message = gatewayMessageToMessage(raw, $gatewaySpaces);
			}
		} catch {
			error = true;
		} finally {
			loading = false;
		}
	});

	function jump() {
		if (isConv && conversationId) {
			jumpToMessageRequest.set({
				id: crypto.randomUUID(),
				spaceId: "",
				roomId: "",
				messageId,
				conversationId,
			});
		} else {
			jumpToMessageRequest.set({
				id: crypto.randomUUID(),
				spaceId,
				roomId,
				messageId,
			});
		}
	}
</script>

{#if loading}
	<div class="{MESSAGE_CARD} flex w-[380px] max-w-full items-center gap-2 px-3.5 py-3">
		<div class="border-duvet-ink2/40 h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-t-transparent"></div>
		<span class="text-duvet-ink2 text-xs">{t("media_link_loading")}</span>
	</div>
{:else if !error && message}
	<button
		type="button"
		onclick={jump}
		class="{MESSAGE_CARD_ACTION} flex w-[380px] max-w-full cursor-pointer flex-col overflow-hidden text-left"
	>
		<!-- Breadcrumb header -->
		<div class="border-duvet-line flex min-w-0 items-center gap-1.5 border-b px-3.5 pt-2.5 pb-2">
			{#if isConv}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="text-duvet-ink2 shrink-0"
					><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg
				>
				<span class="text-duvet-ink2 truncate text-xs font-medium">{convName}</span>
			{:else}
				{#if space}
					<div
						class="bg-duvet-ink/15 text-duvet-ink flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[9px] leading-none font-bold select-none"
					>
						{space.name.charAt(0).toUpperCase()}
					</div>
					<span class="text-duvet-ink2 max-w-25 truncate text-xs font-medium">{space.name}</span>
					<span class="text-duvet-ink2 shrink-0 text-xs">></span>
				{/if}
				{#if room}
					<span class="text-duvet-ink2 shrink-0 text-xs">#</span>
					<span class="text-duvet-ink2 max-w-22.5 truncate text-xs font-medium">{room.name}</span>
				{:else}
					<span class="text-duvet-ink2 text-xs italic">{t("media_link_unknown_room")}</span>
				{/if}
			{/if}
		</div>

		<!-- Message preview -->
		<div class="flex items-start gap-2.5 px-3.5 py-2.5">
			<div class="mt-0.5 shrink-0">
				<UserAvatar src={message.author_avatar_url} name={authorLabel(message)} size={28} />
			</div>
			<div class="flex min-w-0 flex-1 flex-col">
				<div class="mb-0.5 flex items-baseline gap-1.5">
					<span class="text-duvet-ink truncate text-sm font-semibold">{authorLabel(message)}</span>
					<span class="text-xxs text-duvet-ink2 shrink-0">{formatTime(message.created_at)}</span>
				</div>
				<p class="font-content text-duvet-ink line-clamp-3 text-sm wrap-break-word whitespace-pre-wrap">
					{@html renderMarkdown(messageText(message), false, undefined, undefined, $roomNames)}
				</p>
			</div>
		</div>
	</button>
{/if}
