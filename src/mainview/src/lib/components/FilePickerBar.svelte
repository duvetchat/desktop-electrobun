<script lang="ts">
	import { pillClass } from "$lib/components/ui/recipes";
	import { CHECKBOX } from "$lib/components/settings/recipes";
	import type { FilePicker } from "$lib/file-picker.svelte";
	import { t } from "$lib/i18n";
	import { formatNumber } from "$lib/i18n/format";
	import { FILE_KINDS, FILE_KIND_LABELS, type PickableFile } from "$lib/storage-transfers";

	let { picker }: { picker: FilePicker<PickableFile> } = $props();
</script>

<!-- "Select all" over a storage's file list, and its kind filters: those of the kinds it has. -->
<div class="flex flex-wrap items-center gap-2 px-1.5">
	<label class="text-duvet-ink flex cursor-pointer items-center gap-2 text-xs font-medium select-none">
		<input
			type="checkbox"
			checked={picker.allShownPicked}
			indeterminate={picker.someShownPicked}
			disabled={picker.shown.length === 0}
			onchange={() => picker.toggleAll()}
			class={CHECKBOX}
		/>
		{t("storage_files_select_all")}
	</label>
	<div class="ml-auto flex flex-wrap items-center gap-1">
		{#each FILE_KINDS as kind (kind)}
			{#if picker.kindCounts[kind] > 0}
				{@const on = picker.kinds.includes(kind)}
				<button type="button" aria-pressed={on} onclick={() => picker.toggleKind(kind)} class={pillClass(on)}>
					{FILE_KIND_LABELS[kind]}
					<span class="tabular-nums opacity-70">{formatNumber(picker.kindCounts[kind])}</span>
				</button>
			{/if}
		{/each}
	</div>
</div>
