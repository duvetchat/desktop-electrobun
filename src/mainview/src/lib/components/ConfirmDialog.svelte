<script lang="ts">
	import { AlertDialog } from "bits-ui";
	import { confirmStore } from "$lib/stores/confirm.svelte";

	const open = $derived(confirmStore.pending !== null);
</script>

<AlertDialog.Root
	{open}
	onOpenChange={(v) => {
		if (!v && !confirmStore.loading) confirmStore.cancel();
	}}
>
	<AlertDialog.Portal>
		<AlertDialog.Overlay class="fixed inset-0 z-9998 bg-black/60 backdrop-blur-sm" />
		<AlertDialog.Content class="fixed inset-0 z-9999 flex items-center justify-center p-4">
			<div class="rounded-card border-duvet-line bg-duvet-bg shadow-duvet-float w-full max-w-sm border p-5">
				{#if confirmStore.pending}
					<AlertDialog.Title class="text-duvet-ink mb-1 text-sm font-semibold">Confirm</AlertDialog.Title>
					<AlertDialog.Description class="text-duvet-ink mb-4 text-sm"
						>{confirmStore.pending.message}</AlertDialog.Description
					>

					{#if confirmStore.error}
						<p class="bg-duvet-danger/10 text-duvet-danger mb-4 rounded-md px-3 py-2 text-sm">{confirmStore.error}</p>
					{/if}

					<div class="flex justify-end gap-2">
						<AlertDialog.Cancel
							class="text-duvet-ink hover:bg-duvet-card rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
							disabled={confirmStore.loading}
						>
							Cancel
						</AlertDialog.Cancel>
						<button
							class="text-duvet-on-accent rounded-row bg-duvet-danger hover:bg-duvet-danger/85 flex min-w-20 items-center justify-center gap-1.5 px-4 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50"
							disabled={confirmStore.loading}
							onclick={() => confirmStore.execute()}
						>
							{#if confirmStore.loading}
								<div
									class="border-fixed-white/30 border-t-fixed-white size-3.5 animate-spin rounded-full border-2"
								></div>
								{confirmStore.pending.confirmLabel ?? "Confirm"}...
							{:else}
								{confirmStore.pending.confirmLabel ?? "Confirm"}
							{/if}
						</button>
					</div>
				{/if}
			</div>
		</AlertDialog.Content>
	</AlertDialog.Portal>
</AlertDialog.Root>
