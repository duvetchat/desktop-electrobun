<script lang="ts">
	import type { Message } from "$lib/types";
	import { t } from "$lib/i18n";

	// What a message's author is when it isn't a person, beside their name: a webhook's messages say WEBHOOK, a bot's BOT.
	let { message, class: className = "" }: { message: Pick<Message, "webhook_id" | "author_is_bot">; class?: string } =
		$props();
</script>

{#if message.webhook_id}
	<span
		class="bg-duvet-accent text-duvet-on-accent shrink-0 rounded px-1 py-[3px] text-[9px] leading-none font-bold tracking-[0.04em] [-webkit-text-fill-color:var(--duvet-on-accent)] {className}"
		>{t("people_tag_webhook")}</span
	>
{:else if message.author_is_bot}
	<span
		class="bg-duvet-accent text-duvet-on-accent shrink-0 rounded px-1 py-[3px] text-[9px] leading-none font-bold tracking-[0.04em] [-webkit-text-fill-color:var(--duvet-on-accent)] {className}"
		>{t("people_tag_bot")}</span
	>
{/if}
