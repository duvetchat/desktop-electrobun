<script lang="ts">
	import { SvelteSet } from "svelte/reactivity";
	import Button from "$lib/components/ui/Button.svelte";
	import type { SharedOffer } from "$lib/e2e/engine/engine";
	import { t } from "$lib/i18n";
	import { spinnerClass } from "$lib/overlay-forms";

	// What other members shared of the conversation's history with this person (PLAN-E2E-CLIENTES.md, Task 30), over its
	// message box: who shared how far back, and Add to this device, which takes it in on the person's word alone (Ruling
	// 22: nothing a member or a server made up comes in unasked). One that didn't come in says so, and can be asked again.
	let {
		offers,
		nameOf,
		onAdd,
	}: {
		offers: SharedOffer[];
		/** A member's name as the app shows it, by their user ID. */
		nameOf: (userId: string) => string;
		/** The person's yes: it comes in on this device, or rejects. */
		onAdd: (shareId: string) => Promise<void>;
	} = $props();

	const adding = new SvelteSet<string>();
	const failed = new SvelteSet<string>();

	async function add(shareId: string) {
		if (adding.has(shareId)) return;
		adding.add(shareId);
		failed.delete(shareId);
		try {
			await onAdd(shareId);
		} catch (error) {
			console.error("[e2e] A shared history didn't come in:", error);
			failed.add(shareId);
		} finally {
			adding.delete(shareId);
		}
	}
</script>

{#each offers as offer (offer.share_id)}
	<div class="text-duvet-ink2 flex items-center gap-3 px-1.5 pb-2 text-[12.5px] leading-[1.3]" role="status">
		<span class="min-w-0 flex-1"
			>{t("e2e_shared_with_you", {
				a: nameOf(offer.from_user_id),
				range: offer.range ?? "all",
			})}{#if failed.has(offer.share_id)}{" "}{t("e2e_shared_add_failed")}{/if}</span
		>
		<Button size="sm" disabled={adding.has(offer.share_id)} onclick={() => void add(offer.share_id)}>
			{#if adding.has(offer.share_id)}<span class={spinnerClass()} aria-hidden="true"></span>{/if}
			{t("e2e_shared_add")}
		</Button>
	</div>
{/each}
