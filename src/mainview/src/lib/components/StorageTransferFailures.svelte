<script lang="ts">
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
		<Dialog.Overlay class="fixed inset-0 z-600 bg-black/60 backdrop-blur-sm" />
		<Dialog.Content class="fixed inset-0 z-601 flex items-center justify-center p-4">
			<div
				class="flex max-h-[70vh] w-full max-w-lg flex-col rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-100 shadow-2xl"
			>
				<div class="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-800 px-5 py-4">
					<div class="min-w-0">
						<Dialog.Title class="text-sm font-semibold text-white">Files that didn't move</Dialog.Title>
						{#if transfer}
							<Dialog.Description class="mt-0.5 text-xs text-zinc-400">
								{countFiles(transfer.failed_files)}
								{transfer.failed_files === 1 ? "stays" : "stay"}
								{sourceName ? `in ${sourceName}` : "where they were"}.
							</Dialog.Description>
						{/if}
					</div>
					<Dialog.Close
						class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
						aria-label="Close"
					>
						<XIcon class="size-4" />
					</Dialog.Close>
				</div>

				<div class="min-h-0 flex-1 space-y-1 overflow-y-auto px-5 py-4">
					{#each files as file (file.attachment_id)}
						<div class="rounded-md border border-zinc-800 bg-zinc-800/30 px-3 py-2">
							<div class="flex items-center justify-between gap-3">
								<p class="truncate text-sm text-zinc-200">{file.filename}</p>
								<span class="shrink-0 text-xs text-zinc-500">{formatFileSize(file.size_bytes)}</span>
							</div>
							{#if file.error}
								<p class="mt-0.5 text-xs text-red-400">{file.error}</p>
							{/if}
						</div>
					{/each}

					{#if loading}
						<div class="space-y-1">
							{#each Array(3) as _}
								<div class="h-12 animate-pulse rounded-md bg-zinc-800/40"></div>
							{/each}
						</div>
					{:else if error}
						<p class="rounded-md bg-red-400/10 px-3 py-2 text-sm text-red-400">{error}</p>
					{:else if files.length === 0}
						<p class="py-6 text-center text-sm text-zinc-500">No failed files.</p>
					{:else if hasMore && transfer}
						{@const t = transfer}
						<button
							class="mt-2 w-full rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
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
