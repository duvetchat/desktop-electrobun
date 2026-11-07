<script lang="ts">
	import { copyCode } from "$lib/code-copy";
	import { countEmojis, isOnlyEmojis } from "$lib/emoji";
	import { friendUser } from "$lib/friends";
	import { mentionNamesIn, parseTextSegments, renderMarkdown } from "$lib/markdown";
	import { conversations, currentUser, friends, gatewaySpaces } from "$lib/stores.svelte";
	import { webUrl } from "$lib/urls";

	// A bio on a profile, with the messages' markdown, as anyone's text goes through it. It's nobody's space's: the people
	// it mentions show by the names the app knows, its rooms as #unknown, and its custom emojis as the ones the reader
	// doesn't have. A mention opens nothing here. A link is a plain <a>, which lib/external-links.ts opens as any.
	let { bio }: { bio: string } = $props();

	const emojiOnly = $derived(isOnlyEmojis(bio) && countEmojis(bio) <= 5);
	// Only a bio that names someone looks them up: the spaces change with every presence.
	const mentionMap = $derived(
		bio.includes("<@")
			? mentionNamesIn(bio, [
					...$gatewaySpaces.flatMap((s) => s.users),
					...$conversations.flatMap((c) => c.members.flatMap((m) => m.user ?? [])),
					...$friends.map((f) => friendUser(f, $currentUser?.id)),
					...($currentUser ? [$currentUser] : []),
				])
			: {},
	);
</script>

<!-- The click is a code block's copy button's, which the keyboard reaches as a button. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
	class="overflow-x-auto overflow-y-hidden text-sm break-words whitespace-pre-wrap text-zinc-300 select-text [&_.msg-mention]:pointer-events-none {emojiOnly
		? 'leading-12'
		: ''}"
	onclick={copyCode}
>
	{#each parseTextSegments(bio) as segment}
		{#if segment.type === "link" && webUrl(segment.content)}
			<a href={segment.content} target="_blank" rel="noopener noreferrer" class="text-stone-300 hover:underline"
				>{segment.content}</a
			>
		{:else}
			{@html renderMarkdown(segment.content, emojiOnly, mentionMap)}
		{/if}
	{/each}
</div>
