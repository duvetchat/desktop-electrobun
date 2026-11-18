<script lang="ts">
	import { AlertDialog } from "bits-ui";
	import { getApiError } from "$lib/api/api";
	import { countFiles } from "$lib/storage-transfers";
	import type { StorageBucket } from "$lib/api/user";

	let {
		request = $bindable(null),
		inSpace = false,
		onMove,
		onDelete,
	}: {
		/** The bucket whose delete was refused for its files, and how many it has; null when closed. */
		request?: { bucket: StorageBucket; files: number } | null;
		/** It's a space's bucket: the emojis and stickers made from its files go with them. */
		inSpace?: boolean;
		/** Opens the move of all its files. */
		onMove: (bucket: StorageBucket) => void;
		/** Deletes the bucket with its files. */
		onDelete: (bucket: StorageBucket) => Promise<void>;
	} = $props();

	let deleting = $state(false);
	let error = $state<string | null>(null);

	function close() {
		if (deleting) return;
		request = null;
		error = null;
	}

	function move(bucket: StorageBucket) {
		close();
		onMove(bucket);
	}

	async function deleteThem(bucket: StorageBucket) {
		deleting = true;
		error = null;
		try {
			await onDelete(bucket);
		} catch (err) {
			error = getApiError(err, "Failed to delete the bucket");
			deleting = false;
			return;
		}
		deleting = false;
		close();
	}
</script>

<!-- Open while there's a request: closing it (Esc, Cancel) is refused during the delete. -->
<AlertDialog.Root
	bind:open={
		() => request !== null,
		(v) => {
			if (!v) close();
		}
	}
>
	<AlertDialog.Portal>
		<AlertDialog.Overlay class="fixed inset-0 z-600 bg-black/60 backdrop-blur-sm" />
		<AlertDialog.Content class="fixed inset-0 z-601 flex items-center justify-center p-4">
			<div class="rounded-card border-duvet-line bg-duvet-bg shadow-duvet-float w-full max-w-md border p-5">
				{#if request}
					{@const bucket = request.bucket}
					{@const them = request.files === 1 ? "it" : "them"}
					<AlertDialog.Title class="text-duvet-ink mb-1 text-sm font-semibold">
						This bucket has {countFiles(request.files)}
					</AlertDialog.Title>
					<AlertDialog.Description class="text-duvet-ink mb-4 text-sm">
						Move {them} to another storage before deleting "{bucket.name}", or delete {them} with the bucket. Deleted files
						disappear wherever they're shown{inSpace ? ", and the emojis and stickers made from them are deleted" : ""}.
					</AlertDialog.Description>

					{#if error}
						<p class="bg-duvet-danger/10 text-duvet-danger mb-4 rounded-md px-3 py-2 text-sm">{error}</p>
					{/if}

					<div class="flex justify-end gap-2">
						<AlertDialog.Cancel
							class="text-duvet-ink hover:bg-duvet-card rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
							disabled={deleting}
						>
							Cancel
						</AlertDialog.Cancel>
						<button
							class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised rounded-xl px-3 py-1.5 text-sm font-bold transition-colors hover:brightness-110 disabled:opacity-50"
							disabled={deleting}
							onclick={() => move(bucket)}
						>
							Move them to…
						</button>
						<button
							class="text-duvet-on-accent rounded-row bg-duvet-danger hover:bg-duvet-danger/85 flex min-w-24 items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50"
							disabled={deleting}
							onclick={() => deleteThem(bucket)}
						>
							{#if deleting}
								<div
									class="border-fixed-white/30 border-t-fixed-white size-3.5 animate-spin rounded-full border-2"
								></div>
								Deleting…
							{:else}
								Delete them
							{/if}
						</button>
					</div>
				{/if}
			</div>
		</AlertDialog.Content>
	</AlertDialog.Portal>
</AlertDialog.Root>
