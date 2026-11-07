<script lang="ts">
	import { Mic as MicIcon } from "@lucide/svelte";
	import type { TypingUser } from "$lib/stores.svelte";

	/** A chat's mark on its row or tab while someone types there, or a microphone while all of them record a voice
	 * message: the size of the mark it stands in for, so that nothing beside it moves. Whoever draws it says who in
	 * words. */
	let { users, size = 16, class: className = "" }: { users: TypingUser[]; size?: number; class?: string } = $props();

	const onlyRecording = $derived(users.every((u) => u.recording));
</script>

<span
	class="flex shrink-0 items-center justify-center gap-px {className}"
	style="width: {size}px; height: {size}px;"
	aria-hidden="true"
>
	{#if onlyRecording}
		<MicIcon class="animate-pulse text-red-400 motion-reduce:animate-none" style="width: {size}px; height: {size}px;" />
	{:else}
		<span class="animate-typing-bounce block size-1 rounded-full bg-current motion-reduce:animate-none"></span>
		<span
			class="animate-typing-bounce block size-1 rounded-full bg-current [animation-delay:0.2s] motion-reduce:animate-none"
		></span>
		<span
			class="animate-typing-bounce block size-1 rounded-full bg-current [animation-delay:0.4s] motion-reduce:animate-none"
		></span>
	{/if}
</span>
