<script lang="ts">
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

<div class="border-duvet-line bg-duvet-bg/30 space-y-2.5 rounded-lg border px-4 py-3">
	<div class="flex items-center gap-3">
		<MoveIcon class="text-duvet-ink2 size-5 shrink-0" />
		<div class="min-w-0 flex-1">
			<p class="text-duvet-ink truncate text-sm font-medium">
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
		<button
			onclick={cancel}
			disabled={cancelling}
			class="rounded-row bg-duvet-ink/10 text-duvet-ink hover:bg-duvet-ink/15 shrink-0 px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
		>
			{cancelling ? "Cancelling…" : "Cancel"}
		</button>
	</div>
	<div class="bg-duvet-ink/10 h-1.5 w-full overflow-hidden rounded-full">
		<div class="bg-duvet-ink2 h-full rounded-full transition-all duration-300" style="width: {progress.percent}%"></div>
	</div>
</div>
