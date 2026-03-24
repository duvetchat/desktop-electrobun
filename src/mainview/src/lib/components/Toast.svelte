<script lang="ts">
import { toastStore } from "$lib/stores/toast.svelte";
</script>

{#if toastStore.items.length > 0}
<div class="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
    {#each toastStore.items as t (t.id)}
        <div
            class="pointer-events-auto flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm shadow-lg backdrop-blur-sm animate-slide-in
                {t.type === 'error' ? 'border-red-800 bg-red-950/90 text-red-200' :
                 t.type === 'success' ? 'border-green-800 bg-green-950/90 text-green-200' :
                 'border-zinc-700 bg-zinc-900/90 text-zinc-200'}"
        >
            <span class="flex-1">{t.message}</span>
            <button
                class="shrink-0 text-current opacity-50 hover:opacity-100 transition-opacity"
                onclick={() => toastStore.dismiss(t.id)}
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
        </div>
    {/each}
</div>
{/if}

<style>
@keyframes slide-in {
    from { opacity: 0; transform: translateX(20px); }
    to { opacity: 1; transform: translateX(0); }
}
.animate-slide-in {
    animation: slide-in 0.2s ease-out;
}
</style>
