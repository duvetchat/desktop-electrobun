<script lang="ts">
	import { LoaderCircle } from "@lucide/svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import type { SafetyNumber } from "$lib/e2e/engine/contacts";
	import { t } from "$lib/i18n";
	import QrCode from "./QrCode.svelte";
	import VerifiedMark from "./VerifiedMark.svelte";

	// A contact's security number (PLAN-E2E-CLIENTES.md, Task 28; decision 25): its 60 digits in 12 groups of 5, as the
	// core gives them, and its QR, the core's qr as its text, which the contact's phone scans (e2e-conventions.json's
	// safety_qr); then Mark as verified, once the person compared them, or the mark of a contact they verified. Nothing
	// to compare while it loads; what went wrong, or that it changed meanwhile, said.
	let {
		name,
		number,
		verified,
		problem,
		busy = false,
		onVerify,
	}: {
		/** The contact, by the name the app shows them. */
		name: string;
		number: SafetyNumber | null;
		verified: boolean;
		problem: string | null;
		busy?: boolean;
		onVerify: () => void;
	} = $props();

	const groups = $derived(number ? number.digits.split(" ") : []);
</script>

<div class="flex flex-col items-center gap-3">
	{#if number}
		<ol
			aria-label={t("e2e_safety_digits", { name })}
			class="text-duvet-ink grid grid-cols-4 gap-x-5 gap-y-1.5 font-mono text-[17px] tracking-[0.04em]"
		>
			{#each groups as group, at (at)}
				<li>{group}</li>
			{/each}
		</ol>
		<QrCode text={number.qr} label={t("e2e_safety_qr_label", { name })} />
		<p class="text-duvet-ink2 text-center text-[13px]">{t("e2e_safety_compare", { name })}</p>
		{#if verified}
			<p class="text-duvet-alive-text flex items-center gap-1.5 text-[13.5px] font-medium">
				<VerifiedMark />{t("e2e_verified")}
			</p>
		{:else}
			<Button disabled={busy} onclick={onVerify}>{t("e2e_mark_verified")}</Button>
		{/if}
	{:else if !problem}
		<p class="text-duvet-ink2 flex items-center gap-2 text-[13px]" role="status">
			<LoaderCircle class="size-4 animate-spin" aria-hidden="true" />{t("e2e_safety_loading")}
		</p>
	{/if}
	{#if problem}
		<p class="text-duvet-danger text-center text-[13px]" role="alert">{problem}</p>
	{/if}
</div>
