<script lang="ts">
	import {
		X as XIcon,
		Trash2 as TrashIcon,
		Plus as PlusIcon,
		Check as CheckIcon,
		Link2 as WebhookIcon,
		Copy as CopyIcon,
		Pencil as PencilIcon,
		Camera as CameraIcon,
	} from "@lucide/svelte";
	import { untrack } from "svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import IconButton from "$lib/components/ui/IconButton.svelte";
	import SettingsGroup from "$lib/components/settings/SettingsGroup.svelte";
	import { calloutClass, CARD, FIELD, FIELD_SM, LABEL, SELECT } from "$lib/components/settings/recipes";
	import { getApiError } from "$lib/api/api";
	import { t, type MessageKey } from "$lib/i18n";
	import { formatDate } from "$lib/i18n/format";
	import Rich from "$lib/components/Rich.svelte";
	import {
		listWebhooks,
		createWebhook,
		updateWebhook,
		deleteWebhook,
		resetWebhookToken,
		webhookUrls,
		type Webhook,
	} from "$lib/api/webhooks";
	import { toast } from "$lib/stores/toast.svelte";
	import { confirmAction } from "$lib/stores/confirm.svelte";
	import { getHostURL } from "$lib/common/common";
	import type { GatewaySpace, GatewayRoom } from "$lib/types";

	// The webhooks of a space's text rooms, for whoever may manage them (ManageSpaceWebhooks, which the API checks along
	// with ViewChannels in each room): a room's settings show its own, the space's settings those of every text room the
	// user can view (webhookRooms). With several rooms, a new one is made in the room picked, and each says where it posts.
	let { space, rooms }: { space: GatewaySpace; rooms: GatewayRoom[] } = $props();

	const attachmentHost = getHostURL();
	const several = $derived(rooms.length > 1);
	const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? null;

	let webhooksLoading = $state(false);
	let loadFailed = $state(false);
	let roomWebhooks = $state<Webhook[]>([]);
	let newWebhookName = $state("");
	let newWebhookRoomId = $state("");
	let newWebhookAvatar = $state<File | null>(null);
	let newWebhookAvatarPreview = $state<string | null>(null);

	// The room a new webhook goes to: the first one until another is picked, and again if the one picked goes.
	$effect.pre(() => {
		if (!rooms.some((r) => r.id === newWebhookRoomId)) newWebhookRoomId = rooms[0]?.id ?? "";
	});

	function pickNewWebhookAvatar() {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "image/*";
		input.onchange = () => {
			const file = input.files?.[0];
			if (!file) return;
			if (newWebhookAvatarPreview) URL.revokeObjectURL(newWebhookAvatarPreview);
			newWebhookAvatar = file;
			newWebhookAvatarPreview = URL.createObjectURL(file);
		};
		input.click();
	}

	function clearNewWebhookAvatar() {
		if (newWebhookAvatarPreview) URL.revokeObjectURL(newWebhookAvatarPreview);
		newWebhookAvatar = null;
		newWebhookAvatarPreview = null;
	}
	let createdWebhookToken = $state<string | null>(null);
	let createdWebhookId = $state<string | null>(null);
	let editingWebhookId = $state<string | null>(null);
	let editingWebhookName = $state("");
	let editingWebhookAvatar = $state<File | "remove" | null>(null);
	let editingWebhookAvatarPreview = $state<string | null>(null);

	function pickEditWebhookAvatar() {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "image/*";
		input.onchange = () => {
			const file = input.files?.[0];
			if (!file) return;
			if (editingWebhookAvatarPreview) URL.revokeObjectURL(editingWebhookAvatarPreview);
			editingWebhookAvatar = file;
			editingWebhookAvatarPreview = URL.createObjectURL(file);
		};
		input.click();
	}

	function removeEditWebhookAvatar() {
		if (editingWebhookAvatarPreview) URL.revokeObjectURL(editingWebhookAvatarPreview);
		editingWebhookAvatar = "remove";
		editingWebhookAvatarPreview = null;
	}
	let isDeletingWebhook = $state<Record<string, boolean>>({});
	let isCreatingWebhook = $state(false);

	// Each room's list, all of them together, by name as the mobile app lists them. Only the latest load's answer shows:
	// one asked for earlier (before a change, or for rooms that changed since) may answer after it.
	let loads = 0;
	async function loadWebhooks() {
		const load = ++loads;
		webhooksLoading = true;
		try {
			const lists = await Promise.all(rooms.map((r) => listWebhooks(space.id, r.id)));
			if (load !== loads) return;
			roomWebhooks = lists
				.flat()
				.sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: "base" }));
			loadFailed = false;
		} catch (err) {
			if (load !== loads) return;
			console.error("Failed to load webhooks:", err);
			toast(getApiError(err, t("room_webhooks_load_failed")), "error");
			loadFailed = true;
		} finally {
			if (load === loads) webhooksLoading = false;
		}
	}

	// Once shown, and for another space or other rooms: the space changes with every presence, its rooms seldom.
	const spaceId = $derived(space.id);
	const roomIds = $derived(rooms.map((r) => r.id).join(","));
	$effect(() => {
		void spaceId;
		void roomIds;
		untrack(() => void loadWebhooks());
	});

	async function handleCreateWebhook() {
		const roomId = newWebhookRoomId;
		if (!newWebhookName.trim() || !roomId) return;
		isCreatingWebhook = true;
		createdWebhookToken = null;
		createdWebhookId = null;
		try {
			const result = await createWebhook(space.id, roomId, newWebhookName.trim(), newWebhookAvatar ?? undefined);
			createdWebhookToken = result.token;
			createdWebhookId = result.webhook.id;
			newWebhookName = "";
			clearNewWebhookAvatar();
			await loadWebhooks();
		} catch (err) {
			console.error("Failed to create webhook:", err);
			toast(getApiError(err, t("room_webhook_create_failed")), "error");
		} finally {
			isCreatingWebhook = false;
		}
	}

	function startWebhookEdit(wh: Webhook) {
		editingWebhookId = wh.id;
		editingWebhookName = wh.username;
		editingWebhookAvatar = null;
		editingWebhookAvatarPreview = wh.avatar ? `${attachmentHost}/attachments/${wh.avatar}` : null;
	}

	function cancelWebhookEdit() {
		editingWebhookId = null;
		editingWebhookName = "";
		editingWebhookAvatarPreview = null;
		editingWebhookAvatar = null;
	}

	async function handleUpdateWebhook(wh: Webhook) {
		if (!editingWebhookName.trim()) return;
		try {
			await updateWebhook(space.id, wh.room_id, wh.id, {
				username: editingWebhookName.trim(),
				avatar: editingWebhookAvatar instanceof File ? editingWebhookAvatar : undefined,
				remove_avatar: editingWebhookAvatar === "remove",
			});
			cancelWebhookEdit();
			await loadWebhooks();
		} catch (err) {
			console.error("Failed to update webhook:", err);
			toast(getApiError(err, t("room_webhook_update_failed")), "error");
		}
	}

	async function handleDeleteWebhook(wh: Webhook) {
		await confirmAction(
			t("room_webhook_delete_confirm", { name: wh.username }),
			t("room_webhook_delete"),
			async () => {
				isDeletingWebhook = { ...isDeletingWebhook, [wh.id]: true };
				try {
					await deleteWebhook(space.id, wh.room_id, wh.id);
					await loadWebhooks();
				} finally {
					isDeletingWebhook = { ...isDeletingWebhook, [wh.id]: false };
				}
			},
			t("room_webhook_delete_busy"),
		);
	}

	async function handleResetWebhookToken(wh: Webhook) {
		await confirmAction(
			t("room_webhook_reset_token_confirm"),
			t("room_webhook_reset_token"),
			async () => {
				try {
					const newToken = await resetWebhookToken(space.id, wh.room_id, wh.id);
					createdWebhookToken = newToken;
					createdWebhookId = wh.id;
					toast(t("room_webhook_token_reset_done"), "success");
				} catch (err) {
					console.error("Failed to reset webhook token:", err);
					toast(getApiError(err, t("room_webhook_reset_token_failed")), "error");
				}
			},
			t("room_webhook_reset_token_busy"),
		);
	}

	/** When a webhook was made, as a date in the app's language. */
	const created = (wh: Webhook) => formatDate(new Date(wh.created_at));

	/** Copies one of a new webhook's URLs, and says which (`copied`: the notice's key). */
	function copyWebhookUrl(url: string, copied: MessageKey) {
		navigator.clipboard.writeText(url);
		toast(t(copied), "success");
	}
</script>

{#snippet avatarSlot(preview: string | null, size: string, pick: () => void, remove: () => void)}
	<div class="group/avatar bg-duvet-secondary-fill relative shrink-0 overflow-hidden rounded-[28%] {size}">
		{#if preview}
			<img src={preview} alt="" class="size-full object-cover" />
		{:else}
			<div class="text-duvet-ink2 flex size-full items-center justify-center">
				<WebhookIcon class="size-1/2" />
			</div>
		{/if}
		<div
			class="group-hover/avatar:bg-duvet-media-scrim absolute inset-0 flex items-center justify-center gap-1 opacity-0 transition-opacity group-focus-within/avatar:opacity-100 group-hover/avatar:opacity-100 motion-reduce:transition-none"
		>
			<button
				type="button"
				class="text-fixed-white hover:bg-fixed-white/20 flex size-6 items-center justify-center rounded-md"
				title={t("room_webhook_avatar_change")}
				onclick={pick}
			>
				<CameraIcon class="size-3" />
			</button>
			{#if preview}
				<button
					type="button"
					class="text-duvet-call-red-ink hover:bg-fixed-white/20 flex size-6 items-center justify-center rounded-md"
					title={t("room_webhook_avatar_remove")}
					onclick={remove}
				>
					<TrashIcon class="size-3" />
				</button>
			{/if}
		</div>
	</div>
{/snippet}

{#snippet dot(text: string)}<span class="mx-1 opacity-60">{text}</span>{/snippet}

{#if webhooksLoading}
	<p class="text-duvet-ink2 px-1.5 text-sm">{t("room_webhooks_loading")}</p>
{:else}
	<div class="flex flex-col gap-5">
		<!-- Create new webhook -->
		{#if rooms.length > 0}
			<SettingsGroup
				title={t("room_webhook_create_title")}
				plain
				class="flex flex-col gap-3"
				note={several ? t("room_webhooks_note_any_room") : t("room_webhooks_note", { room: rooms[0]?.name ?? "" })}
			>
				<label class="block">
					<span class={LABEL}>{t("room_webhook_username_label")}</span>
					<input
						type="text"
						class={FIELD}
						placeholder={t("room_webhook_username_placeholder")}
						bind:value={newWebhookName}
					/>
				</label>

				{#if several}
					<label class="block">
						<span class={LABEL}>{t("room_webhook_room_label")}</span>
						<select class="{SELECT} h-[38px]! w-full max-w-none!" bind:value={newWebhookRoomId}>
							{#each rooms as r (r.id)}
								<option value={r.id}>#{r.name}</option>
							{/each}
						</select>
					</label>
				{/if}

				<div>
					<span class={LABEL}>{t("room_webhook_avatar_label")}</span>
					<div class="flex items-center gap-3">
						{@render avatarSlot(newWebhookAvatarPreview, "size-14", pickNewWebhookAvatar, clearNewWebhookAvatar)}
						<p class="text-duvet-ink2 text-xs">{t("room_webhook_avatar_hint")}</p>
					</div>
				</div>

				<div>
					<Button onclick={handleCreateWebhook} disabled={isCreatingWebhook || !newWebhookName.trim()}>
						<PlusIcon size={15} />
						{isCreatingWebhook ? t("room_webhook_creating") : t("room_webhook_create")}
					</Button>
				</div>
			</SettingsGroup>
		{/if}

		<!-- Token reveal box -->
		{#if createdWebhookToken && createdWebhookId}
			{@const urls = webhookUrls(attachmentHost, createdWebhookId, createdWebhookToken)}
			<div class="{calloutClass('warn')} flex-col gap-2! overflow-hidden">
				<p class="font-semibold">{t("room_webhook_token_title")}</p>
				<div class="flex items-center gap-2">
					<code
						class="bg-duvet-code-bg text-duvet-ink min-w-0 flex-1 truncate rounded-md px-3 py-2 font-mono text-xs select-text"
					>
						{createdWebhookToken}
					</code>
					<Button
						variant="secondary"
						size="sm"
						onclick={() => copyWebhookUrl(urls.url, "room_webhook_url_copied")}
						title={t("room_webhook_copy_url_tooltip")}
					>
						<CopyIcon size={13} />
						{t("room_webhook_copy_url")}
					</Button>
					<Button
						variant="secondary"
						size="sm"
						onclick={() => copyWebhookUrl(urls.github, "room_webhook_github_url_copied")}
						title={t("room_webhook_copy_github_url_tooltip")}
					>
						<CopyIcon size={13} />
						{t("room_webhook_copy_github_url")}
					</Button>
				</div>
				<p class="truncate text-[11px] opacity-80" title={urls.url}>{t("room_webhook_url", { url: urls.url })}</p>
				<p class="text-duvet-ink2 text-[11px]">{t("room_webhook_github_hint")}</p>
				<div>
					<Button
						variant="quiet"
						size="sm"
						onclick={() => {
							createdWebhookToken = null;
							createdWebhookId = null;
						}}
					>
						{t("room_webhook_token_dismiss")}
					</Button>
				</div>
			</div>
		{/if}

		<!-- Webhook list -->
		{#if loadFailed}
			<div class="flex flex-col items-center justify-center py-12 text-center">
				<WebhookIcon class="text-duvet-ink2 mb-3 size-9" />
				<p class="text-duvet-ink2 text-sm">{t("room_webhooks_load_failed_empty")}</p>
			</div>
		{:else if roomWebhooks.length === 0}
			<div class="flex flex-col items-center justify-center py-12 text-center">
				<WebhookIcon class="text-duvet-ink2 mb-3 size-9" />
				<p class="text-duvet-ink2 text-sm">{t("room_webhooks_empty")}</p>
				<p class="text-duvet-ink2 mt-1 text-xs">
					{rooms.length > 0 ? t("room_webhooks_empty_hint") : t("room_webhooks_no_rooms")}
				</p>
			</div>
		{:else}
			<div class="{CARD} divide-duvet-line divide-y">
				{#each roomWebhooks as wh (wh.id)}
					<div class="group flex min-h-[52px] items-center gap-3 px-3.5 py-2">
						{#if editingWebhookId === wh.id}
							{@render avatarSlot(
								editingWebhookAvatarPreview,
								"size-10",
								pickEditWebhookAvatar,
								removeEditWebhookAvatar,
							)}
							<input
								type="text"
								aria-label={t("room_webhook_name_label")}
								class="{FIELD_SM} min-w-0 flex-1"
								bind:value={editingWebhookName}
								onkeydown={(e) => {
									if (e.key === "Enter") handleUpdateWebhook(wh);
									if (e.key === "Escape") {
										e.stopPropagation();
										cancelWebhookEdit();
									}
								}}
							/>
							<IconButton
								label={t("room_webhook_save")}
								title={t("room_webhook_save")}
								class="text-duvet-alive-text!"
								onclick={() => handleUpdateWebhook(wh)}
							>
								<CheckIcon size={16} />
							</IconButton>
							<IconButton label={t("room_webhook_cancel")} title={t("room_webhook_cancel")} onclick={cancelWebhookEdit}>
								<XIcon size={16} />
							</IconButton>
						{:else}
							<!-- Avatar -->
							{#if wh.avatar}
								<img
									src="{attachmentHost}/attachments/{wh.avatar}"
									alt={wh.username}
									class="size-8 shrink-0 rounded-[28%] object-cover"
								/>
							{:else}
								<div
									class="bg-duvet-secondary-fill text-duvet-ink2 flex size-8 shrink-0 items-center justify-center rounded-[28%]"
								>
									<WebhookIcon class="size-4" />
								</div>
							{/if}
							<div class="min-w-0 flex-1">
								<p class="truncate text-[13.5px] font-medium">{wh.username}</p>
								<p class="text-duvet-ink2 truncate text-xs">
									{#if several}
										{@const room = roomName(wh.room_id)}
										<Rich
											key="room_webhook_details"
											values={{ place: room === null ? "gone" : "room", room: room ?? "", date: created(wh) }}
											tags={{ dot }}
										/>
									{:else}
										{t("room_webhook_created", { date: created(wh) })}
									{/if}
								</p>
							</div>
							<div
								class="flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
							>
								<IconButton
									label={t("room_webhook_rename")}
									title={t("room_webhook_rename")}
									onclick={() => startWebhookEdit(wh)}
								>
									<PencilIcon size={16} />
								</IconButton>
								<IconButton
									label={t("room_webhook_reset_token")}
									title={t("room_webhook_reset_token")}
									class="hover:text-duvet-warn!"
									onclick={() => handleResetWebhookToken(wh)}
								>
									<WebhookIcon size={16} />
								</IconButton>
								<IconButton
									label={t("room_webhook_delete")}
									title={t("room_webhook_delete")}
									class="hover:bg-duvet-danger/15! hover:text-duvet-danger!"
									onclick={() => handleDeleteWebhook(wh)}
									disabled={isDeletingWebhook[wh.id]}
								>
									<TrashIcon size={16} />
								</IconButton>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
