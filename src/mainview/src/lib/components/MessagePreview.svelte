<script lang="ts">
	import { Hash as HashIcon } from "@lucide/svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import MessageAttachments from "$lib/components/MessageAttachments.svelte";
	import MessageComponents from "$lib/components/MessageComponents.svelte";
	import { renderMarkdown, type CustomEmojiMap } from "$lib/markdown";
	import { isComponentsV2, type Message } from "$lib/types";
	import { formatShortDateTime } from "$lib/utils/time";

	// A message as the search results and the pinned messages list it: its channel (when given), author,
	// date, content, and its voice note, sticker, files or components as the chat shows them, smaller;
	// onPreview opens an image. The content is marked data-search-content for the search's highlights.
	let {
		message,
		roomName = null,
		mentionMap = {},
		customEmojiMap = {},
		onPreview,
	}: {
		message: Message;
		roomName?: string | null;
		mentionMap?: Record<string, string>;
		customEmojiMap?: CustomEmojiMap;
		onPreview: (src: string, alt?: string) => void;
	} = $props();

	const html = $derived(message.content ? renderMarkdown(message.content, false, mentionMap, customEmojiMap) : "");
	// The content shows six lines; Show more shows the rest. clamped says whether the six hide some of it,
	// measured once the content is laid out, and again when it or its width changes.
	let contentEl = $state<HTMLElement | null>(null);
	let expanded = $state(false);
	let clamped = $state(false);
	$effect(() => {
		if (!contentEl || !html || expanded) return;
		const el = contentEl;
		const measure = () => (clamped = el.scrollHeight > el.clientHeight + 1);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	});
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
			<span class="text-xxs shrink-0 text-stone-500">{formatShortDateTime(message.created_at)}</span>
		</div>
		{#if html}
			<div
				bind:this={contentEl}
				data-search-content
				class="text-sm wrap-break-word whitespace-pre-wrap text-stone-300 {expanded ? '' : 'line-clamp-6'}"
			>
				{@html html}
			</div>
			{#if clamped}
				<button
					type="button"
					class="mt-0.5 self-start text-xs font-medium text-stone-400 hover:text-stone-200 hover:underline"
					onclick={() => (expanded = !expanded)}
				>
					{expanded ? "Show less" : "Show more"}
				</button>
			{/if}
		{/if}
		{#if !isComponentsV2(message)}
			<MessageAttachments {message} channelName={roomName ?? ""} {onPreview} maxWidth={320} maxHeight={240} />
		{/if}
		{#if message.components?.length}
			<MessageComponents components={message.components} {mentionMap} {customEmojiMap} {onPreview} compact />
		{/if}
	</div>
</div>
