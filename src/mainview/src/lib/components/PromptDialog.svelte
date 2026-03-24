<script lang="ts">
import { AlertDialog } from "bits-ui";
import { promptStore } from "$lib/stores/prompt.svelte";

const open = $derived(promptStore.pending !== null);

function submit() {
    promptStore.resolve(promptStore.value.trim() || null);
}
</script>

<AlertDialog.Root {open} onOpenChange={(v) => { if (!v) promptStore.resolve(null); }}>
    <AlertDialog.Portal>
        <AlertDialog.Overlay class="fixed inset-0 z-9998 bg-black/60 backdrop-blur-sm" />
        <AlertDialog.Content class="fixed inset-0 z-9999 flex items-center justify-center p-4">
            <div class="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
                {#if promptStore.pending}
                    <AlertDialog.Title class="text-sm font-semibold text-white mb-3">{promptStore.pending.message}</AlertDialog.Title>
                    <input
                        type="text"
                        class="w-full h-9 rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500 mb-4"
                        placeholder={promptStore.pending.placeholder}
                        bind:value={promptStore.value}
                        onkeydown={(e) => { if (e.key === "Enter") submit(); }}
                    />
                    <div class="flex justify-end gap-2">
                        <AlertDialog.Cancel
                            class="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800 transition-colors"
                        >
                            Cancel
                        </AlertDialog.Cancel>
                        <AlertDialog.Action
                            class="rounded-md bg-stone-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-stone-500 transition-colors"
                            onclick={submit}
                        >
                            OK
                        </AlertDialog.Action>
                    </div>
                {/if}
            </div>
        </AlertDialog.Content>
    </AlertDialog.Portal>
</AlertDialog.Root>
