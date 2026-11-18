<script lang="ts">
	import { copyCode } from "$lib/code-copy";
	import { countEmojis, isOnlyEmojis } from "$lib/emoji";
	import { friendUser } from "$lib/friends";
	import { mentionNamesIn, renderMarkdown } from "$lib/markdown";
	import { messageTextClass } from "$lib/message-styles";
	import { conversations, currentUser, everyEmoji, friends, gatewaySpaces } from "$lib/stores.svelte";

	// A bio on a profile, with the messages' markdown, as anyone's text goes through it. It's nobody's space's: the people
	// it mentions show by the names the app knows, its rooms as #unknown, and its custom emojis as the ones the reader
	// doesn't have. A mention opens nothing here. A bare link is a plain <a>, which lib/external-links.ts opens as any,
	// and a duvet:// one stays text.
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
	class="font-content text-duvet-ink overflow-x-auto overflow-y-hidden text-sm break-words whitespace-pre-wrap select-text [&_.msg-mention]:pointer-events-none {messageTextClass()} {emojiOnly
		? 'leading-12'
		: ''}"
	onclick={copyCode}
>
	{@html renderMarkdown(bio, emojiOnly, mentionMap, $everyEmoji, undefined, {})}
</div>
