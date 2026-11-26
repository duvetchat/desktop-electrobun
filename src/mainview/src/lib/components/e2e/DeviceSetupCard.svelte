<script lang="ts">
	import Button from "$lib/components/ui/Button.svelte";
	import type { DeviceSetup } from "$lib/e2e/engine/engine";
	import { t } from "$lib/i18n";
	import { confirmAction } from "$lib/stores/confirm.svelte";
	import ApprovalNew from "./ApprovalNew.svelte";
	import RecoveryKeyInput from "./RecoveryKeyInput.svelte";

	// A new device's setup (PLAN-E2E-CLIENTES.md, Task 26; decisions 24 and 47), which the gate shows in a sheet: with
	// the recovery key, with another device of the person's (its QR, or a code), or, with neither, by starting over,
	// which says what's lost and asks before anything runs.
	let {
		setup,
		onRecover,
		onUseCode,
		onAcceptCode,
		onReset,
	}: {
		setup: DeviceSetup | undefined;
		onRecover: (recoveryKey: string) => Promise<void>;
		onUseCode: () => Promise<void>;
		onAcceptCode: (code: string) => Promise<void>;
		/** Starting over, once the person said yes to its warning. */
		onReset: () => Promise<void>;
	} = $props();

	// The approval's attempt, by the QR or the code: each one mounted anew, its field empty.
	const attempt = $derived(setup?.way === "qr" || setup?.way === "code" ? setup : null);
	const attemptKey = $derived(attempt?.way === "code" ? attempt.fingerprint : attempt?.way === "qr" ? attempt.qr : "");

	function startOver() {
		return confirmAction(t("e2e_start_over_warning"), t("e2e_start_over"), onReset);
	}
</script>

<div class="flex flex-col gap-5">
	<section class="flex flex-col gap-2" aria-labelledby="e2e-setup-key">
		<h3 id="e2e-setup-key" class="font-serif-sm text-duvet-ink text-[15px]">{t("e2e_setup_key_heading")}</h3>
		<RecoveryKeyInput {onRecover} />
	</section>
	<section class="flex flex-col gap-2" aria-labelledby="e2e-setup-approve">
		<h3 id="e2e-setup-approve" class="font-serif-sm text-duvet-ink text-[15px]">{t("e2e_setup_approve_heading")}</h3>
		{#if attempt}
			{#key attemptKey}
				<ApprovalNew setup={attempt} {onUseCode} {onAcceptCode} />
			{/key}
		{/if}
	</section>
	<section class="flex flex-col gap-2" aria-labelledby="e2e-setup-start-over">
		<h3 id="e2e-setup-start-over" class="font-serif-sm text-duvet-ink text-[15px]">
			{t("e2e_setup_start_over_heading")}
		</h3>
		<p class="text-duvet-ink2 text-[13px] leading-[1.45]">{t("e2e_start_over_line")}</p>
		<div>
			<Button variant="danger" size="sm" onclick={() => void startOver()}>{t("e2e_start_over")}</Button>
		</div>
	</section>
</div>
