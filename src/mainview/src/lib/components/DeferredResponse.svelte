<script lang="ts">
	import { CircleAlert as AlertIcon } from "@lucide/svelte";
	import { onMount } from "svelte";
	import type { Message } from "$lib/types";

	// A bot's deferred response, which it hasn't completed by editing it: the bot is thinking for the 15 minutes it has,
	// then it didn't respond. Looked at again every 30 seconds.
	let { message }: { message: Pick<Message, "author_name" | "created_at"> } = $props();

	const RESPONSE_TIME = 15 * 60_000;
	let now = $state(Date.now());
	onMount(() => {
		const timer = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(timer);
	});
</script>

{#if now - new Date(message.created_at).getTime() > RESPONSE_TIME}
	<p class="flex items-center gap-1.5 text-sm text-red-400">
		<AlertIcon class="size-4 shrink-0" />
		The application did not respond
	</p>
{:else}
	<p class="flex items-center gap-1.5 text-sm text-zinc-400 italic">
		{message.author_name} is thinking
		<span class="flex items-center gap-0.75" aria-hidden="true">
			<span class="animate-typing-bounce block size-1 rounded-full bg-current"></span>
			<span class="animate-typing-bounce block size-1 rounded-full bg-current [animation-delay:0.2s]"></span>
			<span class="animate-typing-bounce block size-1 rounded-full bg-current [animation-delay:0.4s]"></span>
		</span>
	</p>
{/if}
