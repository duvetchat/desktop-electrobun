<script lang="ts">
	import type { Snippet } from "svelte";
	import { X as XIcon } from "@lucide/svelte";
	import Notice from "$lib/components/Notice.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { renderMarkdownLine } from "$lib/markdown";
	import { dismissMentionNotice, mentionNotices, type MentionNotice } from "$lib/mention-notices";
	import { placeStyle, underCall } from "$lib/notice-place";
	import { noticeArea, watchNoticePlace } from "$lib/stores/notice-place.svelte";
	import { roomNames } from "$lib/stores.svelte";
	import type { MessageLink } from "$lib/urls";

	// The notices of mentions in rooms and conversations that aren't on screen (lib/mention-notices.ts), at the top
	// centre of the main column, under the window's title line, the same distance on every system and on the web
	// (lib/notice-place.ts), and under a call's notice while one is up: who, where, and their message's text on a line or two,
	// drawn as a reply's quote draws it. A click opens the message (onOpen); × takes the notice away. They stack: the
	// newest in front, the others behind it, each a little lower, smaller and fainter, and the stack fans out under the
	// pointer or the keyboard's focus so each can be read and pressed. What else notifies up there (an incoming call)
	// comes as `children`, above the stack, in a Notice of its own.
	let { onOpen, children = undefined }: { onOpen: (link: MessageLink) => void; children?: Snippet } = $props();

	// The place is read from the title line while there is something to show. Until it is, the classes hold the
	// notices where the shell's line puts them: 62 px down, in the window's middle.
	const showing = $derived($mentionNotices.length > 0 || !!children);
	$effect(() => {
		if (showing) return watchNoticePlace();
	});
	const place = $derived(noticeArea.place ? placeStyle(underCall(noticeArea.place, noticeArea.callHeight)) : undefined);

	function open(notice: MentionNotice) {
		dismissMentionNotice(notice.id);
		onOpen(notice.link);
	}
</script>

{#if showing}
	<div
		class="pointer-events-none fixed inset-x-0 top-[62px] z-9990 mx-auto flex w-[min(420px,calc(100vw-32px))] flex-col gap-2"
		style={place}
		role="region"
		aria-label="Notifications"
	>
		{@render children?.()}
		{#if $mentionNotices.length > 0}
			<div class="group/notices grid">
				{#each $mentionNotices as notice, i (notice.id)}
					<!-- One cell for all of them: --i is how far back this one sits. -->
					<div
						class="ease-spring pointer-events-none z-[calc(10_-_var(--i))] col-start-1 row-start-1 origin-top translate-y-[calc(var(--i)_*_10px)] scale-[calc(1_-_var(--i)_*_0.045)] opacity-[calc(1_-_var(--i)_*_0.3)] transition-[translate,scale,opacity] duration-[350ms] group-focus-within/notices:translate-y-[calc(var(--i)_*_(100%_+_8px))] group-focus-within/notices:scale-100 group-focus-within/notices:opacity-100 group-hover/notices:translate-y-[calc(var(--i)_*_(100%_+_8px))] group-hover/notices:scale-100 group-hover/notices:opacity-100 motion-reduce:transition-none"
						style="--i: {i}"
					>
						<Notice class="group/notice">
							<button
								type="button"
								class="focus-override flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-[18px] py-3 pr-1 pl-3.5 text-left outline-none focus-visible:shadow-[0_0_0_2px_var(--duvet-accent)]"
								onclick={() => open(notice)}
							>
								<span class="shrink-0">
									<UserAvatar src={notice.authorAvatar} name={notice.authorName} size={36} />
								</span>
								<span class="flex min-w-0 flex-1 flex-col gap-0.5">
									<span class="flex min-w-0 items-baseline gap-1 text-xs">
										<span class="text-duvet-ink shrink-0 font-semibold">{notice.authorName}</span>
										<span class="text-duvet-ink2 truncate">{notice.where}</span>
									</span>
									{#if notice.text}
										<span
											class="msg-content font-content text-duvet-ink line-clamp-2 text-[13.5px] leading-[1.35] wrap-break-word"
											>{@html renderMarkdownLine(
												notice.text,
												notice.mentionMap,
												notice.customEmojiMap,
												$roomNames,
											)}</span
										>
									{:else}
										<!-- No text to show: only files, a sticker or components -->
										<span class="text-duvet-ink2 text-[13.5px] leading-[1.35] italic">Click to see message</span>
									{/if}
								</span>
							</button>
							<!-- Out of sight until the notice is under the pointer, or the button itself has the focus. -->
							<button
								type="button"
								class="text-duvet-ink2 hover:bg-duvet-hover hover:text-duvet-ink m-2.5 grid size-6 shrink-0 place-items-center rounded-lg opacity-0 transition-opacity group-hover/notice:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
								aria-label="Dismiss"
								onclick={() => dismissMentionNotice(notice.id)}
							>
								<XIcon size={13} />
							</button>
						</Notice>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
