<script lang="ts">
	import { X as XIcon } from "@lucide/svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { isElectrobunWindow } from "$lib/electrobun-rpc";
	import { renderMarkdownLine } from "$lib/markdown";
	import { dismissMentionNotice, mentionNotices, type MentionNotice } from "$lib/mention-notices";
	import { roomNames } from "$lib/stores.svelte";
	import type { MessageLink } from "$lib/urls";

	// The notices of mentions in rooms and conversations that aren't on screen (lib/mention-notices.ts), at the top of the
	// window, under the desktop app's title bar, the newest first: who, where, and their message's text on a line or two,
	// drawn as a reply's quote draws it. A click opens the message (onOpen); × takes the notice away.
	let { onOpen }: { onOpen: (link: MessageLink) => void } = $props();

	const top = isElectrobunWindow() ? "top-14" : "top-3";

	function open(notice: MentionNotice) {
		dismissMentionNotice(notice.id);
		onOpen(notice.link);
	}
</script>

{#if $mentionNotices.length > 0}
	<div
		class="pointer-events-none fixed {top} left-1/2 z-9990 flex w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2"
		role="region"
		aria-label="Notifications"
	>
		{#each $mentionNotices as notice (notice.id)}
			<div
				class="pointer-events-auto flex items-start rounded-lg border border-zinc-700 bg-zinc-900/95 text-left shadow-lg backdrop-blur-sm"
			>
				<button
					type="button"
					class="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 px-3 py-2.5 text-left"
					onclick={() => open(notice)}
				>
					<span class="shrink-0">
						<UserAvatar src={notice.authorAvatar} name={notice.authorName} size={32} />
					</span>
					<span class="flex min-w-0 flex-1 flex-col gap-0.5">
						<span class="flex min-w-0 items-baseline gap-1 text-xs">
							<span class="shrink-0 font-semibold text-zinc-100">{notice.authorName}</span>
							<span class="truncate text-zinc-400">{notice.where}</span>
						</span>
						{#if notice.text}
							<span class="msg-content line-clamp-2 text-sm wrap-break-word text-zinc-300"
								>{@html renderMarkdownLine(notice.text, notice.mentionMap, notice.customEmojiMap, $roomNames)}</span
							>
						{:else}
							<!-- No text to show: only files, a sticker or components -->
							<span class="text-sm text-zinc-400 italic">Click to see message</span>
						{/if}
					</span>
				</button>
				<button
					type="button"
					class="m-1.5 shrink-0 rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
					aria-label="Dismiss"
					onclick={() => dismissMentionNotice(notice.id)}
				>
					<XIcon class="size-3.5" />
				</button>
			</div>
		{/each}
	</div>
{/if}
