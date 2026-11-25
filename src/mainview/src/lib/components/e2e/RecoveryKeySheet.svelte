<script lang="ts">
	import { Copy as CopyIcon, Download as DownloadIcon } from "@lucide/svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { t } from "$lib/i18n";

	// The first device's recovery key (decision 23): its 48 characters in 12 groups of 4 (decision 22), which the person
	// copies or downloads, then says they saved; nothing goes on before. `onContinue` uploads the identity: a failure
	// keeps the key here, and the button tries again with the same bytes.
	let {
		recoveryKey,
		saved = $bindable(false),
		onContinue,
	}: { recoveryKey: string; saved?: boolean; onContinue: () => Promise<void> } = $props();

	const groups = $derived(recoveryKey.match(/.{1,4}/g) ?? []);
	let copied = $state(false);
	let busy = $state(false);
	let failed = $state(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(groups.join(" "));
		} catch (error) {
			// The webview refused the clipboard: the key still shows, and Download keeps it.
			console.error("[e2e] The recovery key wasn't copied:", error);
			return;
		}
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	// A text file of its own, made here: the key goes nowhere else.
	function download() {
		const file = new Blob([`${t("e2e_recovery_file")}\n\n${groups.join(" ")}\n`], { type: "text/plain" });
		const link = document.createElement("a");
		link.href = URL.createObjectURL(file);
		link.download = "duvet-recovery-key.txt";
		link.click();
		setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
	}

	async function go() {
		if (!saved || busy) return;
		busy = true;
		failed = false;
		try {
			await onContinue();
		} catch {
			failed = true;
		} finally {
			busy = false;
		}
	}
</script>

<div class="flex flex-col gap-3">
	<ol
		aria-label={t("e2e_recovery_key")}
		class="bg-duvet-sunk shadow-duvet-press grid grid-cols-4 gap-x-2 gap-y-1.5 rounded-xl p-3 font-mono text-[15px] tracking-[0.06em] select-all"
	>
		{#each groups as group, n (n)}
			<li class="text-center">{group}</li>
		{/each}
	</ol>
	<div class="flex gap-2">
		<Button variant="secondary" size="sm" onclick={() => void copy()}>
			<CopyIcon size={14} aria-hidden="true" />
			{copied ? t("e2e_recovery_copied") : t("e2e_recovery_copy")}
		</Button>
		<Button variant="secondary" size="sm" onclick={download}>
			<DownloadIcon size={14} aria-hidden="true" />
			{t("e2e_recovery_download")}
		</Button>
	</div>
	<label class="text-duvet-ink flex items-center gap-2 text-[13.5px]">
		<input type="checkbox" bind:checked={saved} class="accent-duvet-accent size-4" />
		{t("e2e_recovery_saved")}
	</label>
	{#if failed}
		<p class="text-duvet-danger text-[13px]" role="alert">{t("e2e_recovery_failed")}</p>
	{/if}
	<div class="flex justify-end">
		<Button disabled={!saved || busy} onclick={() => void go()}>{t("e2e_recovery_continue")}</Button>
	</div>
</div>
