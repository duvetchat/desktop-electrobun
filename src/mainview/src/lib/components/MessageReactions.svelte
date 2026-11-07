<script lang="ts">
	import ReactionCount from "$lib/components/ReactionCount.svelte";
	import ReactionEmoji from "$lib/components/ReactionEmoji.svelte";
	import type { CustomEmojiMap } from "$lib/markdown";
	import { currentUser } from "$lib/stores.svelte";
	import type { MessageReaction } from "$lib/types";

	// A message's reactions, as the chat and the previews (pins, search results, a thread) show them: each emoji with its
	// count, the user's own picked out. A click adds the user's reaction or takes it back. Each is keyed by its emoji: a
	// badge keeps its element, and its count's roll, when another reaction comes or goes.
	let {
		reactions,
		customEmojiMap = {},
		onToggle,
	}: {
		reactions: MessageReaction[];
		customEmojiMap?: CustomEmojiMap;
		onToggle: (reaction: MessageReaction) => void;
	} = $props();
</script>

{#if reactions.length > 0}
	<div class="mt-1 flex flex-wrap gap-1">
		{#each reactions as reaction (reaction.emoji_name)}
			{@const mine = $currentUser ? reaction.users.includes($currentUser.id) : false}
			<button
				class="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-sm transition-colors {mine
					? 'border-indigo-500/40 bg-indigo-500/20 text-indigo-300'
					: 'border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700/60'}"
				onclick={() => onToggle(reaction)}
				title={reaction.emoji_name}
			>
				<ReactionEmoji {reaction} {customEmojiMap} />
				<ReactionCount count={reaction.count} />
			</button>
		{/each}
	</div>
{/if}
