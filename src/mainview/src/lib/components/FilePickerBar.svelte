<script lang="ts">
	import type { FilePicker } from "$lib/file-picker.svelte";
	import { FILE_KINDS, FILE_KIND_LABELS, type PickableFile } from "$lib/storage-transfers";

	let { picker }: { picker: FilePicker<PickableFile> } = $props();
</script>

<!-- "Select all" over a storage's file list, and its kind filters: those of the kinds it has. -->
<div class="flex flex-wrap items-center gap-2 px-3">
	<label class="flex cursor-pointer items-center gap-2 text-xs font-medium text-zinc-300 select-none">
		<input
			type="checkbox"
			checked={picker.allShownPicked}
			indeterminate={picker.someShownPicked}
			disabled={picker.shown.length === 0}
			onchange={() => picker.toggleAll()}
			class="size-4 rounded border-zinc-600 bg-zinc-800 accent-stone-500"
		/>
		Select all
	</label>
	<div class="ml-auto flex flex-wrap items-center gap-1">
		{#each FILE_KINDS as kind (kind)}
			{#if picker.kindCounts[kind] > 0}
				{@const on = picker.kinds.includes(kind)}
				<button
					type="button"
					aria-pressed={on}
					onclick={() => picker.toggleKind(kind)}
					class="rounded-full px-2.5 py-1 text-xs font-medium transition-colors {on
						? 'bg-stone-600 text-white'
						: 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'}"
				>
					{FILE_KIND_LABELS[kind]}
					<span class="ml-0.5 tabular-nums {on ? 'text-white/70' : 'text-zinc-500'}">{picker.kindCounts[kind]}</span>
				</button>
			{/if}
		{/each}
	</div>
</div>
