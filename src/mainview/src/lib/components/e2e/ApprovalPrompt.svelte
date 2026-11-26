<script module lang="ts">
	import type { DeviceApproval } from "$lib/e2e/engine/engine";
	import { t } from "$lib/i18n";

	/** The question's title: «Is this device yours?» until the person's yes, then the device's approval by its name. */
	export function approvalTitle(approval: DeviceApproval): string {
		return approval.step === "asked" ? t("e2e_approval_ask") : t("e2e_approval_title", { name: approval.name });
	}
</script>

<script lang="ts">
	import Button from "$lib/components/ui/Button.svelte";

	// What a device of the person's says of a new one that asks to be approved (PLAN-E2E-CLIENTES.md, Task 26), in the
	// gate's dialog: its name and the fingerprint its screen shows, with a yes and a no before anything is offered; then
	// the code to type into it, and when to confirm. On the desktop Bun asks once more in its own box, naming that
	// fingerprint; on the web this page's Confirm stands for it.
	let {
		approval,
		onApprove,
		onDecline,
		onConfirm,
	}: {
		approval: DeviceApproval;
		onApprove: () => Promise<void>;
		onDecline: () => Promise<void>;
		onConfirm: () => Promise<void>;
	} = $props();

	let busy = $state(false);
	let failed = $state(false);

	async function run(work: () => Promise<void>) {
		busy = true;
		failed = false;
		try {
			await work();
		} catch (error) {
			console.error("[e2e] The approval's step failed:", error);
			failed = true;
		} finally {
			busy = false;
		}
	}
</script>

<div class="flex flex-col gap-3">
	{#if approval.step === "asked"}
		<p class="text-duvet-ink font-content text-[13.5px] leading-[1.4]">
			{t("e2e_approval_asks", { name: approval.name })}
		</p>
	{/if}
	<p class="text-duvet-ink font-mono text-[15px] tracking-[0.06em]">
		{t("e2e_code_fingerprint", { fingerprint: approval.fingerprint })}
	</p>
	<p class="text-duvet-ink2 text-[12.5px] leading-[1.4]">{t("e2e_approval_fingerprint_line")}</p>
	{#if approval.step === "offered"}
		<p class="text-duvet-ink2 text-[13px]" role="status">{t("e2e_approval_waiting", { name: approval.name })}</p>
	{:else if approval.step === "code"}
		<p class="text-duvet-ink2 text-[13px]">{t("e2e_approval_code", { name: approval.name })}</p>
		<p class="text-duvet-ink text-center font-mono text-[28px] tracking-[0.3em]">{approval.code}</p>
		<p class="text-duvet-ink text-[13px] font-medium">{t("e2e_approval_confirm_after")}</p>
	{/if}
	{#if failed}
		<p class="text-duvet-danger text-[13px]" role="alert">{t("e2e_approval_failed")}</p>
	{/if}
	<div class="flex justify-end gap-2">
		{#if approval.step === "asked"}
			<Button variant="quiet" disabled={busy} onclick={() => void run(onDecline)}>{t("e2e_approval_no")}</Button>
			<Button disabled={busy} onclick={() => void run(onApprove)}>{t("e2e_approval_yes")}</Button>
		{:else}
			<Button variant="quiet" disabled={busy} onclick={() => void run(onDecline)}>{t("e2e_cancel")}</Button>
			{#if approval.step === "code"}
				<Button disabled={busy} onclick={() => void run(onConfirm)}>{t("e2e_approval_confirm")}</Button>
			{/if}
		{/if}
	</div>
</div>
