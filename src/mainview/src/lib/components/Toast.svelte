<script lang="ts">
	import { toastStore } from "$lib/stores/toast.svelte";
	import { callCardBox, toastsBottom } from "$lib/corner";
</script>

<!-- In the app's bottom right corner, right above the call card while it shows (lib/corner.ts). -->
{#if toastStore.items.length > 0}
	<div
		class="pointer-events-none fixed right-4 z-9999 flex flex-col gap-2"
		style="bottom: {toastsBottom($callCardBox)}px"
	>
		{#each toastStore.items as t (t.id)}
			<div
				class="animate-slide-in bg-duvet-card shadow-duvet-float rounded-card pointer-events-auto flex items-center gap-2 border px-4 py-2.5 text-sm
                {t.type === 'error'
					? 'border-duvet-danger/40 text-duvet-danger'
					: t.type === 'success'
						? 'border-duvet-alive/40 text-duvet-alive'
						: 'border-duvet-line text-duvet-ink'}"
			>
				<span class="flex-1">{t.message}</span>
				{#if t.action}
					{@const action = t.action}
					<button
						class="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold text-current underline-offset-2 hover:underline"
						onclick={() => {
							action.run();
							toastStore.dismiss(t.id);
						}}
					>
						{action.label}
					</button>
				{/if}
				<button
					class="shrink-0 text-current opacity-50 transition-opacity hover:opacity-100"
					aria-label="Dismiss"
					onclick={() => toastStore.dismiss(t.id)}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg
					>
				</button>
			</div>
		{/each}
	</div>
{/if}
