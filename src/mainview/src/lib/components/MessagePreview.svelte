<script lang="ts">
	import { Hash as HashIcon, Paperclip as PaperclipIcon } from "@lucide/svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { renderMarkdown, type CustomEmojiMap } from "$lib/markdown";
	import type { Message } from "$lib/types";

	// A message as the search results and the pinned messages list it: its channel (when given), author,
	// date, content, files and sticker. The content is marked data-search-content for the search's
	// highlights.
	let {
		message,
		roomName = null,
		mentionMap = {},
		customEmojiMap = {},
	}: {
		message: Message;
		roomName?: string | null;
		mentionMap?: Record<string, string>;
		customEmojiMap?: CustomEmojiMap;
	} = $props();

	const locale = typeof navigator !== "undefined" ? navigator.language : "en-US";
	const formatDate = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
</script>

{#if roomName !== null}
	<div class="text-xxs flex items-center gap-0.5 font-semibold text-stone-500">
		<HashIcon class="size-3" />
		{roomName}
	</div>
{/if}
<div class="flex items-start gap-2.5">
	<div class="mt-0.5 shrink-0">
		<UserAvatar src={message.author_avatar_url} name={message.author_name} size={32} />
	</div>
	<div class="flex min-w-0 flex-1 flex-col">
		<div class="flex items-baseline gap-1.5">
			<span class="truncate text-sm font-semibold text-stone-100">{message.author_name}</span>
			<span class="text-xxs shrink-0 text-stone-500">{formatDate(message.created_at)}</span>
		</div>
		{#if message.content}
			<div data-search-content class="line-clamp-6 text-sm wrap-break-word whitespace-pre-wrap text-stone-300">
				{@html renderMarkdown(message.content, false, mentionMap, customEmojiMap)}
			</div>
		{/if}
		{#each message.attachments ?? [] as a (a.id)}
			<div class="flex min-w-0 items-center gap-1 text-xs text-stone-400">
				<PaperclipIcon class="size-3 shrink-0" />
				<span class="truncate">{a.filename}</span>
			</div>
		{/each}
		{#if message.sticker_attachment_id}
			<span class="text-xs text-stone-500 italic">Sticker</span>
		{/if}
	</div>
</div>
