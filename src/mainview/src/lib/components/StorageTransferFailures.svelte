<script lang="ts">
	import { claimLayer, layerStyle, releaseLayer } from "$lib/overlay-layers";
	import { buttonClass, GLASS_STRONG, SCRIM, iconButtonClass } from "$lib/components/ui/recipes";
	import { calloutClass, SKELETON } from "$lib/components/settings/recipes";
	import { Dialog } from "bits-ui";
	import { untrack } from "svelte";
	import { X as XIcon } from "@lucide/svelte";
	import { getApiError } from "$lib/api/api";
	import { storageTransfers } from "$lib/stores/storage-transfers.svelte";
	import { countFiles } from "$lib/storage-transfers";
	import { formatFileSize } from "$lib/utils/format";
	import { StorageTransferFileStatus, type StorageTransfer, type StorageTransferFile } from "$lib/types";

	// The failed files of the transfer whose end notice's Show was clicked, a page at a time.
	const PAGE_SIZE = 100;
	const transfer = $derived(storageTransfers.failures);
	const sourceName = $derived(transfer ? storageTransfers.storageName(transfer.source_bucket_id) : null);
	let files = $state<StorageTransferFile[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let hasMore = $state(false);

	async function loadPage(t: StorageTransfer, after?: string) {
		loading = true;
		error = null;
		try {
			const page = await storageTransfers.files(t, {
				status: StorageTransferFileStatus.Failed,
				after,
				limit: PAGE_SIZE,
			});
			if (storageTransfers.failures?.id !== t.id) return;
			files = after ? [...files, ...page] : page;
			hasMore = page.length === PAGE_SIZE;
		} catch (err) {
			error = getApiError(err, "Failed to load the files");
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		const t = transfer;
		if (!t) return;
		untrack(() => {
			files = [];
			hasMore = false;
			void loadPage(t);
		});
	});

	// What opens last is in front, whatever opened it (lib/overlay-layers.ts): this can open over a sheet.
	const layer = $derived(transfer !== null ? claimLayer() : 0);
	$effect(() => {
		const mine = layer;
		if (mine) return () => releaseLayer(mine);
	});
</script>

<Dialog.Root
	bind:open={
		() => transfer !== null,
		(v) => {
			if (!v) storageTransfers.failures = null;
		}
	}
>
	<Dialog.Portal>
		<Dialog.Overlay style={layerStyle(layer)} class={SCRIM} />
		<Dialog.Content style={layerStyle(layer)} class="fixed inset-0 z-[900] flex items-center justify-center p-4">
			<div
				class="{GLASS_STRONG} animate-sheet-in text-duvet-ink flex max-h-[70vh] w-full max-w-lg flex-col gap-3 rounded-3xl p-4"
			>
				<div class="flex shrink-0 items-start justify-between gap-4">
					<div class="min-w-0">
						<Dialog.Title class="font-serif-lg text-[21px] leading-[1.2] font-normal tracking-[-0.01em]"
							>Files that didn't move</Dialog.Title
						>
						{#if transfer}
							<Dialog.Description class="text-duvet-ink2 mt-1 text-[13px]">
								{countFiles(transfer.failed_files)}
								{transfer.failed_files === 1 ? "stays" : "stay"}
								{sourceName ? `in ${sourceName}` : "where they were"}.
							</Dialog.Description>
						{/if}
					</div>
					<Dialog.Close class={iconButtonClass()} aria-label="Close">
						<XIcon class="size-4" />
					</Dialog.Close>
				</div>

				<div class="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
					{#each files as file (file.attachment_id)}
						<div class="bg-duvet-card shadow-duvet-raised rounded-xl px-3 py-2">
							<div class="flex items-center justify-between gap-3">
								<p class="truncate text-[13.5px] font-medium">{file.filename}</p>
								<span class="text-duvet-ink2 shrink-0 text-xs">{formatFileSize(file.size_bytes)}</span>
							</div>
							{#if file.error}
								<p class="text-duvet-danger mt-0.5 text-xs">{file.error}</p>
							{/if}
						</div>
					{/each}

					{#if loading}
						<div class="space-y-1">
							{#each Array(3) as _, index (index)}
								<div class="{SKELETON} h-12"></div>
							{/each}
						</div>
					{:else if error}
						<p class={calloutClass("danger")} role="alert">{error}</p>
					{:else if files.length === 0}
						<p class="text-duvet-ink2 py-6 text-center text-sm">No failed files.</p>
					{:else if hasMore && transfer}
						{@const t = transfer}
						<button
							class="{buttonClass('secondary')} mt-1 w-full"
							onclick={() => loadPage(t, files.at(-1)?.attachment_id)}
						>
							Load more
						</button>
					{/if}
				</div>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
