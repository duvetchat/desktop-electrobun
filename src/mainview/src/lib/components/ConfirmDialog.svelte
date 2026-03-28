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
			<div class="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
				{#if confirmStore.pending}
					<AlertDialog.Title class="mb-1 text-sm font-semibold text-white">Confirm</AlertDialog.Title>
					<AlertDialog.Description class="mb-4 text-sm text-zinc-300"
						>{confirmStore.pending.message}</AlertDialog.Description
					>

					{#if confirmStore.error}
						<p class="mb-4 rounded-md bg-red-400/10 px-3 py-2 text-sm text-red-400">{confirmStore.error}</p>
					{/if}

					<div class="flex justify-end gap-2">
						<AlertDialog.Cancel
							class="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-50"
							disabled={confirmStore.loading}
						>
							Cancel
						</AlertDialog.Cancel>
						<button
							class="flex min-w-20 items-center justify-center gap-1.5 rounded-md bg-red-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-50"
							disabled={confirmStore.loading}
							onclick={() => confirmStore.execute()}
						>
							{#if confirmStore.loading}
								<div class="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
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
