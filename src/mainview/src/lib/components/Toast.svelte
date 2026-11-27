<script lang="ts">
	import { CircleAlert, X as XIcon } from "@lucide/svelte";
	import { toastStore } from "$lib/stores/toast.svelte";
	import { callCardBox, toastsBottom } from "$lib/corner";
	import CircleCheck from "$lib/components/ui/icons/CircleCheck.svelte";
	import { GLASS } from "$lib/components/ui/recipes";
	import { t } from "$lib/i18n";
</script>

<!-- At the bottom centre of the window, the newest lowest, and above the call card's height while it shows
     (lib/corner.ts), so a narrow window's toasts never sit on its buttons. Each kind reads apart: an error in the
     danger color with its mark, a success in green with its tick, the rest in ink. -->
{#if toastStore.items.length > 0}
	<div
		class="pointer-events-none fixed inset-x-0 z-9999 flex flex-col items-center gap-1.5 px-4"
		style="bottom: {toastsBottom($callCardBox)}px"
	>
		{#each toastStore.items as item (item.id)}
			<div
				role={item.type === "error" ? "alert" : "status"}
				class="{GLASS} animate-toast-in pointer-events-auto flex max-w-[min(480px,100%)] items-center gap-2 rounded-xl py-[9px] pr-2 pl-3.5 text-[12.5px] leading-[1.3] font-medium {item.type ===
				'error'
					? 'text-duvet-danger'
					: item.type === 'success'
						? 'text-duvet-alive-text'
						: 'text-duvet-ink'}"
			>
				{#if item.type === "error"}
					<CircleAlert size={15} class="shrink-0" aria-hidden="true" />
				{:else if item.type === "success"}
					<CircleCheck size={15} class="shrink-0" aria-hidden="true" />
				{/if}
				<span class="min-w-0 flex-1 wrap-break-word">{item.message}</span>
				{#if item.action}
					{@const action = item.action}
					<button
						class="text-duvet-accent-text hover:bg-duvet-hover shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold"
						onclick={() => {
							action.run();
							toastStore.dismiss(item.id);
						}}
					>
						{action.label}
					</button>
				{/if}
				<button
					class="text-duvet-ink2 hover:bg-duvet-hover hover:text-duvet-ink grid size-5 shrink-0 place-items-center rounded-md"
					aria-label={t("dialog_dismiss")}
					onclick={() => toastStore.dismiss(item.id)}
				>
					<XIcon size={13} />
				</button>
			</div>
		{/each}
	</div>
{/if}
