<script lang="ts">
	import { claimLayer, layerStyle, releaseLayer } from "$lib/overlay-layers";
	import { buttonClass, GLASS_STRONG, SCRIM, iconButtonClass } from "$lib/components/ui/recipes";
	import { calloutClass, CHECKBOX, SELECT } from "$lib/components/settings/recipes";
	import { Dialog } from "bits-ui";
	import { untrack } from "svelte";
	import { X as XIcon } from "@lucide/svelte";
	import { getApiError } from "$lib/api/api";
	import { t } from "$lib/i18n";
	import {
		activateStorage,
		storageTransfers,
		transferRoutes,
		transferStartError,
	} from "$lib/stores/storage-transfers.svelte";
	import { toast } from "$lib/stores/toast.svelte";
	import {
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
		onStarted?: (transfer: StorageTransfer) => void;
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
			targetId = (targets.find((choice) => choice.active) ?? targets[0])?.id ?? "";
			keepSource = false;
			makeActive = takesAll(filter);
			error = null;
		});
	});

	const target = $derived(targets.find((choice) => choice.id === targetId) ?? null);
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
						t("storage_move_activate_failed", {
							to: to.isBucket ? "named" : "default",
							name: to.name,
							reason: getApiError(err, t("storage_move_activate_failed_unknown")),
						}),
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

	// What opens last is in front, whatever opened it (lib/overlay-layers.ts): this can open over a sheet.
	const layer = $derived(open ? claimLayer() : 0);
	$effect(() => {
		const mine = layer;
		if (mine) return () => releaseLayer(mine);
	});
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
		<Dialog.Overlay style={layerStyle(layer)} class={SCRIM} />
		<Dialog.Content style={layerStyle(layer)} class="fixed inset-0 z-[900] flex items-center justify-center p-4">
			<div class="{GLASS_STRONG} animate-sheet-in text-duvet-ink flex w-full max-w-md flex-col gap-3 rounded-3xl p-4">
				<div class="flex items-start justify-between gap-4">
					<div class="min-w-0">
						<Dialog.Title class="font-serif-lg text-[21px] leading-[1.2] font-normal tracking-[-0.01em]"
							>{t("storage_move_title", { count: files.length })}</Dialog.Title
						>
						<Dialog.Description class="text-duvet-ink2 mt-1 truncate text-[13px]">
							{source
								? t("storage_move_from", {
										from: source.isBucket ? "named" : "default",
										name: source.name,
										size: formatFileSize(totalBytes),
									})
								: t("storage_move_from_unknown", { size: formatFileSize(totalBytes) })}
						</Dialog.Description>
					</div>
					<Dialog.Close class={iconButtonClass()} aria-label={t("storage_close")} disabled={starting}>
						<XIcon class="size-4" />
					</Dialog.Close>
				</div>

				<div class="flex flex-col gap-4">
					{#if targets.length === 0}
						<p class="text-duvet-ink2 text-sm">{t("storage_move_no_target")}</p>
					{:else}
						<div>
							<label for="move-target" class="text-duvet-ink2 mb-1.5 block text-[13px] font-medium"
								>{t("storage_move_to_label")}</label
							>
							<select
								id="move-target"
								bind:value={targetId}
								disabled={starting}
								class="{SELECT} h-[38px]! w-full max-w-none!"
							>
								{#each targets as choice (choice.id)}
									<option value={choice.id}
										>{choice.active ? t("storage_move_target_active", { name: choice.name }) : choice.name}</option
									>
								{/each}
							</select>
							{#if target && room}
								<div class="mt-1.5 space-y-1 text-xs">
									{#if room.files === 0}
										<p class="text-duvet-danger">
											{t("storage_move_none_fit", {
												to: target.isBucket ? "named" : "default",
												name: target.name,
												limit: formatFileSize(target.fileLimit ?? 0),
											})}
										</p>
									{:else if room.free === null}
										<p class="text-duvet-ink2">
											{t("storage_move_size_no_limit", { size: formatFileSize(room.bytes) })}
										</p>
									{:else if room.fits}
										<p class="text-duvet-ink2">
											{t("storage_move_size_free", {
												size: formatFileSize(room.bytes),
												free: formatFileSize(room.free),
											})}
										</p>
									{:else}
										<p class="text-duvet-danger">
											{t("storage_move_size_too_big", {
												size: formatFileSize(room.bytes),
												free: formatFileSize(room.free),
											})}
										</p>
									{/if}
									{#if room.skipped > 0 && room.files > 0}
										{@const limit = formatFileSize(target.fileLimit ?? 0)}
										<p class="text-duvet-warn/90">
											{source
												? t("storage_move_skipped", {
														from: source.isBucket ? "named" : "default",
														count: room.skipped,
														limit,
														name: source.name,
													})
												: t("storage_move_skipped_unknown_source", { count: room.skipped, limit })}
										</p>
									{/if}
								</div>
							{/if}
						</div>

						{#if source?.isBucket}
							<label class="flex cursor-pointer items-start gap-2">
								<input type="checkbox" bind:checked={keepSource} disabled={starting} class="{CHECKBOX} mt-0.5" />
								<span class="text-duvet-ink text-xs">
									{t("storage_move_keep_originals", { name: source.name })}
									<span class="text-duvet-ink2 block">{t("storage_move_keep_originals_note")}</span>
								</span>
							</label>
						{/if}

						{#if target && !target.active}
							<label class="flex cursor-pointer items-start gap-2">
								<input type="checkbox" bind:checked={makeActive} disabled={starting} class="{CHECKBOX} mt-0.5" />
								<span class="text-duvet-ink text-xs">
									{t("storage_move_make_active", { to: target.isBucket ? "named" : "default", name: target.name })}
									<span class="text-duvet-ink2 block">{t("storage_move_make_active_note")}</span>
								</span>
							</label>
						{/if}

						{#if source?.isBucket}
							<p class="text-duvet-ink2 text-[11px]">
								{t("storage_move_egress_note", { name: source.name })}
							</p>
						{/if}
					{/if}

					{#if error}
						<p class={calloutClass("danger")} role="alert">{error}</p>
					{/if}
				</div>

				<div class="mt-1 flex justify-end gap-2">
					<Dialog.Close class={buttonClass("quiet")} disabled={starting}>{t("storage_cancel")}</Dialog.Close>
					{#if targets.length > 0}
						<button class="{buttonClass()} min-w-24" disabled={!canStart || starting} onclick={start}>
							{#if starting}
								<span class="size-3.5 animate-spin rounded-full border-2 border-current/30 border-t-current"></span>
								{t("storage_move_starting")}
							{:else}
								{t("storage_move_button", { count: room?.files ?? 0 })}
							{/if}
						</button>
					{/if}
				</div>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
