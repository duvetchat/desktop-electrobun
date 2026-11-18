<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		title,
		icon,
		children,
	}: {
		title: string;
		/** The chat's face: a room's #, a person's avatar, a group's faces. */
		icon: Snippet;
		/** The lines under the title, then any actions. */
		children: Snippet;
	} = $props();
</script>

<!-- The start of a chat, above its oldest message: what the chat is, where a short chat would leave empty space.
     Centred: its face, its name as a title, then its lines and any actions. It never shrinks: in the message list's
     flex column, it would be squashed down to its padding as soon as the messages fill the list. -->
<div class="relative mt-6 mb-[18px] flex shrink-0 flex-col items-center gap-1.5 px-4 text-center">
	{@render icon()}
	<h2 class="text-duvet-ink mt-1.5 max-w-full truncate font-serif text-[22px] leading-[1.15]">{title}</h2>
	<div class="text-duvet-ink2 flex max-w-full flex-col items-center gap-1 text-[12.5px] [&>p]:justify-center">
		{@render children()}
	</div>
</div>
