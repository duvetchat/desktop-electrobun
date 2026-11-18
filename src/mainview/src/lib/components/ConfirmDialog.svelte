<script lang="ts">
	import { confirmStore } from "$lib/stores/confirm.svelte";
	import Dialog from "$lib/components/ui/Dialog.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { busyLabel, ERROR_NOTE, spinnerClass } from "$lib/overlay-forms";

	const open = $derived(confirmStore.pending !== null);
	const label = $derived(confirmStore.pending?.confirmLabel ?? "Confirm");
</script>

<!-- While the confirmed action runs it can't be dismissed: its answer closes it, or says why it failed. -->
<Dialog
	bind:open={
		() => open,
		(next) => {
			if (!next && !confirmStore.loading) confirmStore.cancel();
		}
	}
	title="Confirm"
	escapeKeydownBehavior={confirmStore.loading ? "ignore" : "close"}
>
	{#if confirmStore.pending}
		<span class="text-duvet-ink block">{confirmStore.pending.message}</span>
		{#if confirmStore.error}
			<span role="alert" class="{ERROR_NOTE} mt-3 block font-sans">{confirmStore.error}</span>
		{/if}
	{/if}
	{#snippet actions()}
		<Button variant="quiet" disabled={confirmStore.loading} onclick={() => confirmStore.cancel()}>Cancel</Button>
		<Button variant="danger" class="min-w-20" disabled={confirmStore.loading} onclick={() => confirmStore.execute()}>
			{#if confirmStore.loading}
				<span class={spinnerClass()} aria-hidden="true"></span>
				{busyLabel(label)}
			{:else}
				{label}
			{/if}
		</Button>
	{/snippet}
</Dialog>
