<script lang="ts">
	import type { Snippet } from "svelte";
	import MascotPeek from "$lib/components/MascotPeek.svelte";

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

<!-- The start of a chat, above its oldest message: what the chat is, where a short chat would leave empty space. -->
<div class="border-duvet-line relative mb-2 overflow-hidden border-b px-1 pt-8 pb-5">
	{@render icon()}
	<h2 class="text-duvet-ink mt-3.5 mb-1 truncate pr-28 text-2xl leading-tight font-bold">{title}</h2>
	<div class="text-duvet-ink2 flex flex-col gap-1 pr-28 text-sm">
		{@render children()}
	</div>
	<MascotPeek class="pointer-events-none absolute right-6 -bottom-5 w-24" />
</div>
