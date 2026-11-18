<script lang="ts">
	import ReactionCount from "$lib/components/ReactionCount.svelte";
	import ReactionEmoji from "$lib/components/ReactionEmoji.svelte";
	import SmilePlusIcon from "$lib/components/ui/icons/SmilePlus.svelte";
	import type { CustomEmojiMap } from "$lib/markdown";
	import { reactionKey } from "$lib/reactions";
	import { currentUser } from "$lib/stores.svelte";
	import type { MessageReaction } from "$lib/types";

	// A message's reactions, as the chat and the previews (pins, search results, a thread) show them: each emoji with its
	// count, the user's own picked out. A click adds the user's reaction or takes it back; a right click shows who reacted
	// with it. Each is keyed by its emoji: a badge keeps its element, and its count's roll, when another reaction comes or
	// goes.
	let {
		reactions,
		customEmojiMap = {},
		end = false,
		onToggle,
		onShowReactors,
		onAdd = undefined,
	}: {
		reactions: MessageReaction[];
		customEmojiMap?: CustomEmojiMap;
		/** Whether the chips line up from the right: under one's own bubble. */
		end?: boolean;
		onToggle: (reaction: MessageReaction) => void;
		onShowReactors: (reaction: MessageReaction) => void;
		/** Opens the emoji picker for the message. Given, an Add reaction chip follows the reactions while their row is
		 * hovered (the row is a `group/row`). */
		onAdd?: () => void;
	} = $props();
</script>

{#if reactions.length > 0}
	<div class="flex flex-wrap gap-1 {end ? 'justify-end' : ''}">
		{#each reactions as reaction (reactionKey(reaction))}
			{@const mine = $currentUser ? reaction.users.includes($currentUser.id) : false}
			<button
				class="inline-flex h-6 items-center gap-1 rounded-xl px-2 text-[11.5px] leading-none font-semibold transition-transform duration-[120ms] hover:-translate-y-px active:scale-[0.96] motion-reduce:transition-none {mine
					? 'bg-duvet-chosen text-duvet-chosen-ink'
					: 'bg-duvet-secondary-fill text-duvet-ink2'}"
				onclick={() => onToggle(reaction)}
				oncontextmenu={(e) => {
					e.preventDefault();
					onShowReactors(reaction);
				}}
				title={reaction.emoji_name}
			>
				<ReactionEmoji {reaction} {customEmojiMap} />
				<ReactionCount count={reaction.count} />
			</button>
		{/each}
		{#if onAdd}
			<button
				type="button"
				class="text-duvet-ink2 hover:text-duvet-ink inline-flex h-6 items-center rounded-xl px-1.5 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
				title="Add reaction"
				aria-label="Add reaction"
				onclick={onAdd}
			>
				<SmilePlusIcon size={14} />
			</button>
		{/if}
	</div>
{/if}
