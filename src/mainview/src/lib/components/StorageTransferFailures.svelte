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
				class="rounded-card border-duvet-line bg-duvet-bg text-duvet-ink shadow-duvet-float flex max-h-[70vh] w-full max-w-lg flex-col border"
			>
				<div class="border-duvet-line flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4">
					<div class="min-w-0">
						<Dialog.Title class="text-duvet-ink text-sm font-semibold">Files that didn't move</Dialog.Title>
						{#if transfer}
							<Dialog.Description class="text-duvet-ink2 mt-0.5 text-xs">
								{countFiles(transfer.failed_files)}
								{transfer.failed_files === 1 ? "stays" : "stay"}
								{sourceName ? `in ${sourceName}` : "where they were"}.
							</Dialog.Description>
						{/if}
					</div>
					<Dialog.Close
						class="text-duvet-ink2 hover:bg-duvet-card hover:text-duvet-ink flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors"
						aria-label="Close"
					>
						<XIcon class="size-4" />
					</Dialog.Close>
				</div>

				<div class="min-h-0 flex-1 space-y-1 overflow-y-auto px-5 py-4">
					{#each files as file (file.attachment_id)}
						<div class="border-duvet-line bg-duvet-card/30 rounded-md border px-3 py-2">
							<div class="flex items-center justify-between gap-3">
								<p class="text-duvet-ink truncate text-sm">{file.filename}</p>
								<span class="text-duvet-ink2 shrink-0 text-xs">{formatFileSize(file.size_bytes)}</span>
							</div>
							{#if file.error}
								<p class="text-duvet-danger mt-0.5 text-xs">{file.error}</p>
							{/if}
						</div>
					{/each}

					{#if loading}
						<div class="space-y-1">
							{#each Array(3) as _}
								<div class="bg-duvet-card/40 h-12 animate-pulse rounded-md"></div>
							{/each}
						</div>
					{:else if error}
						<p class="bg-duvet-danger/10 text-duvet-danger rounded-md px-3 py-2 text-sm">{error}</p>
					{:else if files.length === 0}
						<p class="text-duvet-ink2 py-6 text-center text-sm">No failed files.</p>
					{:else if hasMore && transfer}
						{@const t = transfer}
						<button
							class="bg-duvet-card text-duvet-ink hover:bg-duvet-ink/10 mt-2 w-full rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
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
