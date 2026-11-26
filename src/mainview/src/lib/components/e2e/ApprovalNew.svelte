<script module lang="ts">
	import { CoreError } from "$lib/e2e/errors";
	import type { MessageKey } from "$lib/i18n";

	/** What an approval's step that failed says, by what failed. */
	export function codeProblem(error: unknown): MessageKey {
		if (error instanceof CoreError) {
			if (error.code === "rule_violation" && error.rule === "code_mismatch") return "e2e_code_mismatch";
			if (error.code === "not_found" && error.what === "approver") return "e2e_no_approver";
			if (error.code === "not_found") return "e2e_approval_over";
		}
		return "e2e_setup_failed";
	}
</script>

<script lang="ts">
	import Button from "$lib/components/ui/Button.svelte";
	import { fieldClass } from "$lib/components/ui/recipes";
	import type { DeviceSetup } from "$lib/e2e/engine/engine";
	import { t } from "$lib/i18n";
	import QrCode from "./QrCode.svelte";

	// A new device approved by another device of the person's (PLAN-E2E-CLIENTES.md, Task 26; decision 24): its QR,
	// which their phone scans, or, with «Use a code instead», the fingerprint of what it asks, which the approving device
	// shows too, then, once that device offered, an empty field for the six digits it shows: the person types them, and
	// the core compares them with its own, which nothing shows. The card mounts it anew for each attempt.
	let {
		setup,
		onUseCode,
		onAcceptCode,
	}: {
		setup: DeviceSetup;
		onUseCode: () => Promise<void>;
		onAcceptCode: (code: string) => Promise<void>;
	} = $props();

	let code = $state("");
	let busy = $state(false);
	let problem = $state<MessageKey | null>(null);
	const SIX_DIGITS = /^\d{6}$/;

	async function run(work: () => Promise<void>) {
		busy = true;
		problem = null;
		try {
			await work();
		} catch (error) {
			problem = codeProblem(error);
		} finally {
			busy = false;
		}
	}

	function accept(event: SubmitEvent) {
		event.preventDefault();
		if (busy || !SIX_DIGITS.test(code)) return;
		void run(() => onAcceptCode(code));
	}
</script>

<div class="flex flex-col items-center gap-3">
	{#if setup.way === "qr"}
		<QrCode text={setup.qr} label={t("e2e_qr_label")} />
		<p class="text-duvet-ink2 text-center text-[13px]">{t("e2e_setup_qr_line")}</p>
		<Button variant="secondary" size="sm" disabled={busy} onclick={() => void run(onUseCode)}
			>{t("e2e_use_code")}</Button
		>
	{:else if setup.way === "code"}
		<p class="text-duvet-ink font-mono text-[15px] tracking-[0.06em]">
			{t("e2e_code_fingerprint", { fingerprint: setup.fingerprint })}
		</p>
		<p class="text-duvet-ink2 text-center text-[13px]">{t("e2e_code_fingerprint_line")}</p>
		{#if setup.accepted}
			<p class="text-duvet-ink text-center text-[13.5px]" role="status">{t("e2e_code_accepted")}</p>
		{:else if setup.offered}
			<form class="flex w-full flex-col gap-2" onsubmit={accept}>
				<label class="text-duvet-ink2 text-[12.5px] font-medium" for="e2e-approval-code">{t("e2e_code_label")}</label>
				<input
					id="e2e-approval-code"
					class="{fieldClass()} text-center font-mono text-[18px] tracking-[0.3em]"
					bind:value={code}
					inputmode="numeric"
					autocomplete="off"
					maxlength="6"
					pattern={"[0-9]{6}"}
					aria-describedby="e2e-approval-code-hint"
					aria-invalid={problem === "e2e_code_mismatch"}
					disabled={busy}
				/>
				<p id="e2e-approval-code-hint" class="text-duvet-ink2 text-[12.5px]">{t("e2e_approval_code_hint")}</p>
				<div class="flex justify-end">
					<Button type="submit" size="sm" disabled={busy || !SIX_DIGITS.test(code)}>{t("e2e_code_accept")}</Button>
				</div>
			</form>
		{:else}
			<p class="text-duvet-ink2 text-center text-[13px]" role="status">{t("e2e_code_waiting")}</p>
		{/if}
	{/if}
	{#if problem}
		<p class="text-duvet-danger text-center text-[13px]" role="alert">{t(problem)}</p>
	{/if}
</div>
