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
			<div class="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-100 shadow-2xl">
				<div class="flex items-start justify-between gap-4 border-b border-zinc-800 px-5 py-4">
					<div class="min-w-0">
						<Dialog.Title class="text-sm font-semibold text-white">Move {countFiles(files.length)}</Dialog.Title>
						<Dialog.Description class="mt-0.5 truncate text-xs text-zinc-400">
							From {source?.name ?? "this storage"} · {formatFileSize(totalBytes)}
						</Dialog.Description>
					</div>
					<Dialog.Close
						class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
						aria-label="Close"
						disabled={starting}
					>
						<XIcon class="size-4" />
					</Dialog.Close>
				</div>

				<div class="space-y-4 px-5 py-4">
					{#if targets.length === 0}
						<p class="text-sm text-zinc-400">There's no other storage to move these files to. Add a bucket first.</p>
					{:else}
						<div>
							<label for="move-target" class="mb-1 block text-xs font-semibold tracking-wide text-zinc-400 uppercase"
								>To</label
							>
							<select
								id="move-target"
								bind:value={targetId}
								disabled={starting}
								class="h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white outline-none focus:ring-1 focus:ring-stone-500"
							>
								{#each targets as choice (choice.id)}
									<option value={choice.id}>{choice.name}{choice.active ? " (active)" : ""}</option>
								{/each}
							</select>
							{#if target && room}
								<div class="mt-1.5 space-y-1 text-xs">
									{#if room.files === 0}
										<p class="text-red-400">
											None of these files is within {target.name}'s per-file limit of {formatFileSize(
												target.fileLimit ?? 0,
											)}.
										</p>
									{:else if room.free === null}
										<p class="text-zinc-500">{formatFileSize(room.bytes)} to move · no size limit</p>
									{:else if room.fits}
										<p class="text-zinc-500">
											{formatFileSize(room.bytes)} to move · {formatFileSize(room.free)} free
										</p>
									{:else}
										<p class="text-red-400">
											Doesn't fit: {formatFileSize(room.bytes)} to move, {formatFileSize(room.free)} free
										</p>
									{/if}
									{#if room.skipped > 0 && room.files > 0}
										<p class="text-amber-400/90">
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
									class="mt-0.5 size-4 shrink-0 rounded border-zinc-600 bg-zinc-800 accent-stone-500"
								/>
								<span class="text-xs text-zinc-300">
									Keep the originals in {source.name}
									<span class="block text-zinc-500">Duvet stops using them; they stay there until you delete them.</span
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
									class="mt-0.5 size-4 shrink-0 rounded border-zinc-600 bg-zinc-800 accent-stone-500"
								/>
								<span class="text-xs text-zinc-300">
									Make {target.name} active
									<span class="block text-zinc-500">New uploads go there.</span>
								</span>
							</label>
						{/if}

						{#if source?.isBucket}
							<p class="text-xxs text-zinc-500">
								Each byte leaves {source.name} once: providers other than R2 may charge for that egress.
							</p>
						{/if}
					{/if}

					{#if error}
						<p class="rounded-md bg-red-400/10 px-3 py-2 text-sm text-red-400">{error}</p>
					{/if}
				</div>

				<div class="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
					<Dialog.Close
						class="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-50"
						disabled={starting}
					>
						Cancel
					</Dialog.Close>
					{#if targets.length > 0}
						<button
							class="flex min-w-24 items-center justify-center gap-1.5 rounded-md bg-stone-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-stone-500 disabled:opacity-50"
							disabled={!canStart || starting}
							onclick={start}
						>
							{#if starting}
								<div class="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
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
