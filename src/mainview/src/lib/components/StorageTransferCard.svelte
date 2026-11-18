<script lang="ts">
	import { buttonClass } from "$lib/components/ui/recipes";
	import { ArrowRightLeft as MoveIcon } from "@lucide/svelte";
	import { getApiError } from "$lib/api/api";
	import { storageTransfers } from "$lib/stores/storage-transfers.svelte";
	import { toast } from "$lib/stores/toast.svelte";
	import { transferProgress } from "$lib/storage-transfers";
	import { formatFileSize } from "$lib/utils/format";
	import { StorageTransferStatus, type StorageTransfer } from "$lib/types";

	let {
		transfer,
		source,
		target,
		startedBy = null,
	}: {
		/** A queued or moving transfer. */
		transfer: StorageTransfer;
		/** The names of its storages. */
		source: string;
		target: string;
		/** Who started it, when that's someone else. */
		startedBy?: string | null;
	} = $props();

	const progress = $derived(transferProgress(transfer));
	const queued = $derived(transfer.status === StorageTransferStatus.Queued);
	// The worker stops after the file it's on: the transfer stays "cancelling" until it ends.
	let cancelledId = $state<string | null>(null);
	const cancelling = $derived(cancelledId === transfer.id);

	async function cancel() {
		const t = transfer;
		cancelledId = t.id;
		try {
			await storageTransfers.cancel(t);
		} catch (err) {
			cancelledId = null;
			toast(getApiError(err, "Failed to cancel the transfer"), "error");
		}
	}
</script>

<div class="bg-duvet-card shadow-duvet-raised flex flex-col gap-2.5 rounded-2xl px-3.5 py-3">
	<div class="flex items-center gap-3">
		<span
			class="bg-duvet-secondary-fill text-duvet-accent-text grid size-[30px] shrink-0 place-items-center rounded-[9px]"
			><MoveIcon class="size-4" /></span
		>
		<div class="min-w-0 flex-1">
			<p class="truncate text-[13.5px] font-medium">
				{queued ? "Waiting to move" : "Moving"} to {target}
				<span class="text-duvet-ink2">·</span>
				{progress.done}/{progress.total} files
				{#if !queued}
					<span class="text-duvet-ink2">·</span>
					{progress.percent}%
				{/if}
			</p>
			<p class="text-duvet-ink2 truncate text-xs">
				From {source} · {formatFileSize(transfer.moved_bytes)} of {formatFileSize(transfer.total_bytes)} moved
				{#if startedBy}
					· started by {startedBy}
				{/if}
			</p>
		</div>
		<button onclick={cancel} disabled={cancelling} class={buttonClass("secondary", "sm")}>
			{cancelling ? "Cancelling…" : "Cancel"}
		</button>
	</div>
	<div class="bg-duvet-toggle-off h-1.5 w-full overflow-hidden rounded-full">
		<div
			class="bg-duvet-alive h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
			style="width: {progress.percent}%"
		></div>
	</div>
</div>
