<script lang="ts">
	import { claimLayer, layerStyle, releaseLayer } from "$lib/overlay-layers";
	import { buttonClass, GLASS_STRONG, SCRIM } from "$lib/components/ui/recipes";
	import { calloutClass } from "$lib/components/settings/recipes";
	import { AlertDialog } from "bits-ui";
	import { getApiError } from "$lib/api/api";
	import { t } from "$lib/i18n";
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
			error = getApiError(err, t("storage_bucket_delete_failed"));
			deleting = false;
			return;
		}
		deleting = false;
		close();
	}

	// What opens last is in front, whatever opened it (lib/overlay-layers.ts): this can open over a sheet.
	const layer = $derived(request !== null ? claimLayer() : 0);
	$effect(() => {
		const mine = layer;
		if (mine) return () => releaseLayer(mine);
	});
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
		<AlertDialog.Overlay style={layerStyle(layer)} class={SCRIM} />
		<AlertDialog.Content style={layerStyle(layer)} class="fixed inset-0 z-[900] flex items-center justify-center p-4">
			<div class="{GLASS_STRONG} animate-sheet-in text-duvet-ink flex w-full max-w-md flex-col gap-3 rounded-3xl p-4">
				{#if request}
					{@const bucket = request.bucket}
					<AlertDialog.Title class="font-serif-lg text-[21px] leading-[1.2] font-normal tracking-[-0.01em]">
						{t("storage_bucket_files_title", { count: request.files })}
					</AlertDialog.Title>
					<AlertDialog.Description class="text-duvet-ink2 font-content text-[13.5px] leading-[1.4]">
						{inSpace
							? t("storage_bucket_files_description_space", { count: request.files, name: bucket.name })
							: t("storage_bucket_files_description", { count: request.files, name: bucket.name })}
					</AlertDialog.Description>

					{#if error}
						<p class={calloutClass("danger")} role="alert">{error}</p>
					{/if}

					<div class="mt-2 flex justify-end gap-2">
						<AlertDialog.Cancel class={buttonClass("quiet")} disabled={deleting}
							>{t("storage_cancel")}</AlertDialog.Cancel
						>
						<button class={buttonClass("secondary")} disabled={deleting} onclick={() => move(bucket)}>
							{t("storage_bucket_files_move")}
						</button>
						<button class="{buttonClass('danger')} min-w-24" disabled={deleting} onclick={() => deleteThem(bucket)}>
							{#if deleting}
								<span class="size-3.5 animate-spin rounded-full border-2 border-current/30 border-t-current"></span>
								{t("storage_bucket_files_deleting")}
							{:else}
								{t("storage_bucket_files_delete")}
							{/if}
						</button>
					</div>
				{/if}
			</div>
		</AlertDialog.Content>
	</AlertDialog.Portal>
</AlertDialog.Root>
