<script lang="ts">
	import type { Snippet } from "svelte";
	import { CircleAlert, MailCheck } from "@lucide/svelte";

	// What a form of the sign-in pages answers under its fields: the API's refusal (danger, announced at once), or
	// that an email is on its way (mobile's "Link sent" card).
	let { tone = "error", children }: { tone?: "error" | "sent"; children: Snippet } = $props();
</script>

{#if tone === "error"}
	<p
		class="text-duvet-danger flex items-start gap-2 rounded-xl bg-[color-mix(in_oklab,var(--duvet-danger)_12%,transparent)] px-3 py-2.5 text-[13px] leading-[1.35]"
		role="alert"
		data-auth-error
	>
		<CircleAlert size={16} class="mt-px shrink-0" aria-hidden="true" />
		<span class="min-w-0 wrap-break-word">{@render children()}</span>
	</p>
{:else}
	<p
		class="bg-duvet-card text-duvet-ink shadow-duvet-raised flex items-start gap-3 rounded-[20px] p-4 text-[13px] leading-[1.4]"
		role="status"
		data-auth-sent
	>
		<MailCheck size={20} class="shrink-0" aria-hidden="true" />
		<span class="min-w-0">{@render children()}</span>
	</p>
{/if}
