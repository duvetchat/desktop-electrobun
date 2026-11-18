<script lang="ts">
	import type { Message } from "$lib/types";

	// What a message's author is when it isn't a person, beside their name: a webhook's messages say WEBHOOK, a bot's BOT.
	let { message, class: className = "" }: { message: Pick<Message, "webhook_id" | "author_is_bot">; class?: string } =
		$props();
</script>

{#if message.webhook_id}
	<span class="text-xxs bg-duvet-accent text-duvet-on-accent rounded px-1 py-0.5 font-bold {className}">WEBHOOK</span>
{:else if message.author_is_bot}
	<span class="text-xxs bg-duvet-accent text-duvet-on-accent rounded px-1 py-0.5 font-bold {className}">BOT</span>
{/if}
