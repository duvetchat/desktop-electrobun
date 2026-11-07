<script lang="ts">
	import type { Message } from "$lib/types";

	// What a message's author is when it isn't a person, beside their name: a webhook's messages say WEBHOOK, a bot's BOT.
	let { message, class: className = "" }: { message: Pick<Message, "webhook_id" | "author_is_bot">; class?: string } =
		$props();
</script>

{#if message.webhook_id}
	<span class="text-xxs bg-fill-600 text-fixed-white rounded px-1 py-0.5 font-semibold {className}">WEBHOOK</span>
{:else if message.author_is_bot}
	<span class="text-xxs bg-fill-600 text-fixed-white rounded px-1 py-0.5 font-semibold {className}">BOT</span>
{/if}
