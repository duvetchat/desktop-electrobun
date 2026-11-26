<script module lang="ts">
	import { CoreError } from "$lib/e2e/errors";
	import type { MessageKey } from "$lib/i18n";

	/** What a recovery that failed says, by what failed: nothing for the person's no in Bun's box, which is no failure. */
	export function recoveryProblem(error: unknown): MessageKey | null {
		if (error instanceof CoreError) {
			if (error.code === "refused") return null;
			if (error.code === "bad_command" && error.field === "recovery_key") return "e2e_recovery_key_mistyped";
			if (error.code === "decrypt_failed") return "e2e_recovery_key_wrong";
			if (error.code === "list_changed") return "e2e_setup_again";
		}
		return "e2e_setup_failed";
	}
</script>

<script lang="ts">
	import Button from "$lib/components/ui/Button.svelte";
	import { fieldClass } from "$lib/components/ui/recipes";
	import { t } from "$lib/i18n";

	// The recovery key's field on a new device (PLAN-E2E-CLIENTES.md, Task 26; decision 22): what the person types or
	// pastes goes as it is, spaces and dashes too, which the core reads aside, and a mistyped key is the core's word,
	// said here at once. Nothing fills it in, completes it or corrects it, and it's kept nowhere but here until the
	// engine's recover takes it.
	let { onRecover }: { onRecover: (recoveryKey: string) => Promise<void> } = $props();

	let value = $state("");
	let busy = $state(false);
	let problem = $state<MessageKey | null>(null);

	async function recover(event: SubmitEvent) {
		event.preventDefault();
		if (busy || !value.trim()) return;
		busy = true;
		problem = null;
		try {
			await onRecover(value);
		} catch (error) {
			problem = recoveryProblem(error);
		} finally {
			busy = false;
		}
	}
</script>

<form class="flex flex-col gap-2" onsubmit={recover}>
	<label class="text-duvet-ink2 text-[12.5px] font-medium" for="e2e-recovery-key">{t("e2e_recovery_key")}</label>
	<input
		id="e2e-recovery-key"
		class="{fieldClass()} font-mono tracking-[0.04em]"
		bind:value
		autocomplete="off"
		autocorrect="off"
		autocapitalize="off"
		spellcheck="false"
		aria-invalid={problem === "e2e_recovery_key_mistyped" || problem === "e2e_recovery_key_wrong"}
		disabled={busy}
	/>
	{#if problem}
		<p class="text-duvet-danger text-[13px]" role="alert">{t(problem)}</p>
	{/if}
	<div class="flex justify-end">
		<Button type="submit" size="sm" disabled={busy || !value.trim()}>{t("e2e_recovery_key_use")}</Button>
	</div>
</form>
