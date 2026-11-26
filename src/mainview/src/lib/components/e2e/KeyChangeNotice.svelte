<script lang="ts">
	import { ShieldAlert, X } from "@lucide/svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { iconButtonClass } from "$lib/components/ui/recipes";
	import { t } from "$lib/i18n";

	// A contact's changed key over a conversation's message box (PLAN-E2E-CLIENTES.md, Task 28; decision 25), in each
	// conversation with them until the person closes it, with their security number to check. For one the person had
	// verified, the strong notice: it says to check before sending, as what's sent there next waits for their yes.
	let {
		name,
		verified,
		onVerify,
		onClose,
	}: {
		/** The contact, by the name the app shows them. */
		name: string;
		/** The person had verified the identity that changed. */
		verified: boolean;
		onVerify: () => void;
		onClose: () => void;
	} = $props();
</script>

<div
	role="status"
	class="flex items-center gap-2 text-[12.5px] leading-[1.3] {verified
		? 'bg-duvet-danger/10 text-duvet-ink mb-2 rounded-xl px-3 py-2'
		: 'text-duvet-ink2 px-1.5 pb-2'}"
>
	<ShieldAlert class="size-4 shrink-0 {verified ? 'text-duvet-danger' : ''}" aria-hidden="true" />
	<span class="min-w-0 flex-1"
		>{t("e2e_key_changed", { name })}{#if verified}{" "}{t("e2e_key_changed_verified", { name })}{/if}</span
	>
	<Button variant="secondary" size="sm" onclick={onVerify}>{t("e2e_verify_number")}</Button>
	<button
		type="button"
		class={iconButtonClass("sm")}
		aria-label={t("e2e_key_changed_close")}
		title={t("e2e_key_changed_close")}
		onclick={onClose}
	>
		<X size={14} />
	</button>
</div>
