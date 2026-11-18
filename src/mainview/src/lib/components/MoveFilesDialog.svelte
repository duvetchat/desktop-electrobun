<script lang="ts">
	import { Dialog } from "bits-ui";
	import { untrack } from "svelte";
	import { X as XIcon } from "@lucide/svelte";
	import { getApiError } from "$lib/api/api";
	import {
		activateStorage,
		storageTransfers,
		transferRoutes,
		transferStartError,
	} from "$lib/stores/storage-transfers.svelte";
	import { toast } from "$lib/stores/toast.svelte";
	import {
		countFiles,
		takesAll,
		targetRoom,
		type PickableFile,
		type StorageChoice,
		type TransferFilter,
	} from "$lib/storage-transfers";
	import { formatFileSize } from "$lib/utils/format";
	import type { StorageTransfer } from "$lib/types";

	let {
		open = $bindable(false),
		spaceId,
		choices,
		sourceId,
		files,
		filter,
		onStarted,
	}: {
		open?: boolean;
		/** The space whose files move, or null for the user's own. */
		spaceId: string | null;
		/** The owner's storages, the source among them. */
		choices: StorageChoice[];
		sourceId: string;
		/** The files that move, as the source lists them. */
		files: PickableFile[];
		/** How the transfer takes them from the source. */
		filter: TransferFilter;
		/** Called once the transfer is created. */
		onStarted?: (t: StorageTransfer) => void;
	} = $props();

	const source = $derived(choices.find((c) => c.id === sourceId) ?? null);
	const targets = $derived(choices.filter((c) => c.id !== sourceId));
	const totalBytes = $derived(files.reduce((sum, f) => sum + f.size_bytes, 0));

	let targetId = $state("");
	let keepSource = $state(false);
	let makeActive = $state(false);
	let starting = $state(false);
	let error = $state<string | null>(null);

	// Each time it opens: the active storage as the target when it isn't the source, the first one otherwise,
	// and "Make active" checked when every file of the source moves.
	$effect(() => {
		if (!open) return;
		untrack(() => {
			targetId = (targets.find((t) => t.active) ?? targets[0])?.id ?? "";
			keepSource = false;
			makeActive = takesAll(filter);
			error = null;
		});
	});

	const target = $derived(targets.find((t) => t.id === targetId) ?? null);
	const room = $derived(target ? targetRoom(target, files) : null);
	const canStart = $derived(source !== null && room !== null && room.files > 0 && room.fits);

	async function start() {
		if (!source || !target || !canStart || starting) return;
		const to = target;
		starting = true;
		error = null;
		try {
			const transfer = await transferRoutes(spaceId).create({
				source: source.id,
				target: to.id,
				...filter,
				...(source.isBucket && keepSource ? { keep_source: true } : {}),
			});
			storageTransfers.set(transfer);
			open = false;
			// Moving doesn't change which storage gets new uploads: the box does, now that it started.
			if (makeActive && !to.active) {
				try {
					await activateStorage(spaceId, to, choices);
				} catch (err) {
					toast(
						`The files are moving, but ${to.name} couldn't be made active: ${getApiError(err, "unknown error")}`,
						"error",
					);
				}
			}
			onStarted?.(transfer);
		} catch (err) {
			error = transferStartError(err);
		} finally {
			starting = false;
		}
	}
</script>

<Dialog.Root
	bind:open={
		() => open,
		(v) => {
			if (!starting) open = v;
		}
	}
>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-600 bg-black/60 backdrop-blur-sm" />
		<Dialog.Content class="fixed inset-0 z-601 flex items-center justify-center p-4">
			<div class="rounded-card border-duvet-line bg-duvet-bg text-duvet-ink shadow-duvet-float w-full max-w-md border">
				<div class="border-duvet-line flex items-start justify-between gap-4 border-b px-5 py-4">
					<div class="min-w-0">
						<Dialog.Title class="text-duvet-ink text-sm font-semibold">Move {countFiles(files.length)}</Dialog.Title>
						<Dialog.Description class="text-duvet-ink2 mt-0.5 truncate text-xs">
							From {source?.name ?? "this storage"} · {formatFileSize(totalBytes)}
						</Dialog.Description>
					</div>
					<Dialog.Close
						class="text-duvet-ink2 hover:bg-duvet-card hover:text-duvet-ink flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors"
						aria-label="Close"
						disabled={starting}
					>
						<XIcon class="size-4" />
					</Dialog.Close>
				</div>

				<div class="space-y-4 px-5 py-4">
					{#if targets.length === 0}
						<p class="text-duvet-ink2 text-sm">There's no other storage to move these files to. Add a bucket first.</p>
					{:else}
						<div>
							<label for="move-target" class="text-duvet-ink2 mb-1 block text-[13px] font-bold">To</label>
							<select
								id="move-target"
								bind:value={targetId}
								disabled={starting}
								class="bg-duvet-sunk text-duvet-ink shadow-duvet-press focus-visible:outline-duvet-accent h-10 w-full rounded-xl px-3 text-sm focus-visible:outline-2"
							>
								{#each targets as choice (choice.id)}
									<option value={choice.id}>{choice.name}{choice.active ? " (active)" : ""}</option>
								{/each}
							</select>
							{#if target && room}
								<div class="mt-1.5 space-y-1 text-xs">
									{#if room.files === 0}
										<p class="text-duvet-danger">
											None of these files is within {target.name}'s per-file limit of {formatFileSize(
												target.fileLimit ?? 0,
											)}.
										</p>
									{:else if room.free === null}
										<p class="text-duvet-ink2">{formatFileSize(room.bytes)} to move · no size limit</p>
									{:else if room.fits}
										<p class="text-duvet-ink2">
											{formatFileSize(room.bytes)} to move · {formatFileSize(room.free)} free
										</p>
									{:else}
										<p class="text-duvet-danger">
											Doesn't fit: {formatFileSize(room.bytes)} to move, {formatFileSize(room.free)} free
										</p>
									{/if}
									{#if room.skipped > 0 && room.files > 0}
										<p class="text-duvet-warn/90">
											{countFiles(room.skipped)} over its per-file limit of {formatFileSize(target.fileLimit ?? 0)}
											{room.skipped === 1 ? "stays" : "stay"} in {source?.name ?? "the source"}.
										</p>
									{/if}
								</div>
							{/if}
						</div>

						{#if source?.isBucket}
							<label class="flex cursor-pointer items-start gap-2">
								<input
									type="checkbox"
									bind:checked={keepSource}
									disabled={starting}
									class="border-duvet-line bg-duvet-card accent-duvet-accent mt-0.5 size-4 shrink-0 rounded"
								/>
								<span class="text-duvet-ink text-xs">
									Keep the originals in {source.name}
									<span class="text-duvet-ink2 block"
										>Duvet stops using them; they stay there until you delete them.</span
									>
								</span>
							</label>
						{/if}

						{#if target && !target.active}
							<label class="flex cursor-pointer items-start gap-2">
								<input
									type="checkbox"
									bind:checked={makeActive}
									disabled={starting}
									class="border-duvet-line bg-duvet-card accent-duvet-accent mt-0.5 size-4 shrink-0 rounded"
								/>
								<span class="text-duvet-ink text-xs">
									Make {target.name} active
									<span class="text-duvet-ink2 block">New uploads go there.</span>
								</span>
							</label>
						{/if}

						{#if source?.isBucket}
							<p class="text-xxs text-duvet-ink2">
								Each byte leaves {source.name} once: providers other than R2 may charge for that egress.
							</p>
						{/if}
					{/if}

					{#if error}
						<p class="bg-duvet-danger/10 text-duvet-danger rounded-md px-3 py-2 text-sm">{error}</p>
					{/if}
				</div>

				<div class="border-duvet-line flex justify-end gap-2 border-t px-5 py-3">
					<Dialog.Close
						class="text-duvet-ink hover:bg-duvet-card rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
						disabled={starting}
					>
						Cancel
					</Dialog.Close>
					{#if targets.length > 0}
						<button
							class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised flex min-w-24 items-center justify-center gap-1.5 rounded-xl px-4 py-1.5 text-sm font-bold transition-colors hover:brightness-110 disabled:opacity-50"
							disabled={!canStart || starting}
							onclick={start}
						>
							{#if starting}
								<div
									class="border-fixed-white/30 border-t-fixed-white size-3.5 animate-spin rounded-full border-2"
								></div>
								Starting…
							{:else}
								Move {countFiles(room?.files ?? 0)}
							{/if}
						</button>
					{/if}
				</div>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
