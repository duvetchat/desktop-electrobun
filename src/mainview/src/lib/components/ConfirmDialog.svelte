<script lang="ts">
import { AlertDialog } from "bits-ui";
import { confirmStore } from "$lib/stores/confirm.svelte";

const open = $derived(confirmStore.pending !== null);
</script>

<AlertDialog.Root {open} onOpenChange={(v) => { if (!v && !confirmStore.loading) confirmStore.cancel(); }}>
    <AlertDialog.Portal>
        <AlertDialog.Overlay class="fixed inset-0 z-9998 bg-black/60 backdrop-blur-sm" />
        <AlertDialog.Content class="fixed inset-0 z-9999 flex items-center justify-center p-4">
            <div class="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
                {#if confirmStore.pending}
                    <AlertDialog.Title class="text-sm font-semibold text-white mb-1">Confirm</AlertDialog.Title>
                    <AlertDialog.Description class="text-sm text-zinc-300 mb-4">{confirmStore.pending.message}</AlertDialog.Description>

                    {#if confirmStore.error}
                        <p class="text-sm text-red-400 bg-red-400/10 rounded-md px-3 py-2 mb-4">{confirmStore.error}</p>
                    {/if}

                    <div class="flex justify-end gap-2">
                        <AlertDialog.Cancel
                            class="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-50"
                            disabled={confirmStore.loading}
                        >
                            Cancel
                        </AlertDialog.Cancel>
                        <button
                            class="rounded-md bg-red-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-500 transition-colors disabled:opacity-50 min-w-20 flex items-center justify-center gap-1.5"
                            disabled={confirmStore.loading}
                            onclick={() => confirmStore.execute()}
                        >
                            {#if confirmStore.loading}
                                <div class="size-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin"></div>
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
