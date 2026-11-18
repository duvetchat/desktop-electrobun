<script lang="ts">
	import ReactionCount from "$lib/components/ReactionCount.svelte";
	import ReactionEmoji from "$lib/components/ReactionEmoji.svelte";
	import type { CustomEmojiMap } from "$lib/markdown";
	import { currentUser } from "$lib/stores.svelte";
	import type { MessageReaction } from "$lib/types";

	// A message's reactions, as the chat and the previews (pins, search results, a thread) show them: each emoji with its
	// count, the user's own picked out. A click adds the user's reaction or takes it back; a right click shows who reacted
	// with it. Each is keyed by its emoji: a badge keeps its element, and its count's roll, when another reaction comes or
	// goes.
	let {
		reactions,
		customEmojiMap = {},
		onToggle,
		onShowReactors,
	}: {
		reactions: MessageReaction[];
		customEmojiMap?: CustomEmojiMap;
		onToggle: (reaction: MessageReaction) => void;
		onShowReactors: (reaction: MessageReaction) => void;
	} = $props();
</script>

{#if reactions.length > 0}
	<div class="mt-1 flex flex-wrap gap-1">
		{#each reactions as reaction (reaction.emoji_name)}
			{@const mine = $currentUser ? reaction.users.includes($currentUser.id) : false}
			<button
				class="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-sm transition-colors {mine
					? 'border-duvet-accent/40 bg-duvet-accent/20 text-duvet-accent-text'
					: 'border-duvet-line bg-duvet-card/60 text-duvet-ink2 hover:bg-duvet-ink/8'}"
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
	</div>
{/if}
