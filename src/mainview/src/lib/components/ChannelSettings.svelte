<script lang="ts">
	import {
		X as XIcon,
		Settings as GearSixIcon,
		Shield as ShieldIcon,
		Hash as HashIcon,
		Volume2 as SpeakerIcon,
		Trash2 as TrashIcon,
		Plus as PlusIcon,
		Check as CheckIcon,
		Minus as MinusIcon,
		Link2 as WebhookIcon,
		Copy as CopyIcon,
		Pencil as PencilIcon,
		Upload as UploadIcon,
		Camera as CameraIcon,
	} from "@lucide/svelte";
	import { fly } from "svelte/transition";
	import { cubicOut } from "svelte/easing";
	import { untrack } from "svelte";
	import { Dialog } from "bits-ui";
	import { Permission } from "$lib/permissions";
	import { getApiError } from "$lib/api/api";
	import { updateRoom, upsertRoomOverwrite, deleteRoomOverwrite } from "$lib/api/rooms";
	import {
		listWebhooks,
		createWebhook,
		updateWebhook,
		deleteWebhook,
		resetWebhookToken,
		type Webhook,
	} from "$lib/api/webhooks";
	import { toast } from "$lib/stores/toast.svelte";
	import { confirmAction } from "$lib/stores/confirm.svelte";
	import { currentUser } from "$lib/stores.svelte";
	import { getHostURL, DUVET_DOMAIN } from "$lib/common/common";
	import type { GatewaySpace, GatewayRoom, GatewayRoomOverwrite } from "$lib/types";

	let {
		space,
		room,
		open = $bindable(false),
		onDelete,
	}: {
		space: GatewaySpace;
		room: GatewayRoom;
		open?: boolean;
		onDelete?: () => void;
	} = $props();

	type Section = "overview" | "permissions" | "webhooks";
	let activeSection = $state<Section>("overview");

	// ── overview state ────────────────────────────────────────────
	let editName = $state("");
	let editDescription = $state("");
	let overviewSaving = $state(false);
	let overviewError = $state("");

	$effect(() => {
		editName = room.name;
		editDescription = room.description ?? "";
	});

	async function saveOverview() {
		if (!editName.trim()) return;
		overviewSaving = true;
		overviewError = "";
		try {
			const payload: { name?: string; description?: string | null; clear_description?: boolean } = {};
			if (editName.trim() !== room.name) payload.name = editName.trim();
			if (editDescription !== (room.description ?? "")) {
				if (editDescription === "") {
					payload.clear_description = true;
				} else {
					payload.description = editDescription;
				}
			}
			if (Object.keys(payload).length > 0) {
				await updateRoom(space.id, room.id, payload);
			}
		} catch (e) {
			overviewError = getApiError(e, "Failed to save");
		} finally {
			overviewSaving = false;
		}
	}

	// ── permissions state ─────────────────────────────────────────
	const PERMISSION_GROUPS = [
		{
			label: "General Channel Permissions",
			perms: [
				{ flag: Permission.ViewChannels, name: "View Channel", description: "Allows members to view this channel." },
				{
					flag: Permission.ManageChannels,
					name: "Manage Channel",
					description: "Allows members to change this channel's name and description.",
				},
				{
					flag: Permission.ManageRoles,
					name: "Manage Permissions",
					description: "Allows members to change this channel's permissions.",
				},
			],
		},
		{
			label: "Text Channel Permissions",
			perms: [
				{
					flag: Permission.SendMessages,
					name: "Send Messages",
					description: "Allows members to send messages in this channel.",
				},
				{
					flag: Permission.ManageMessages,
					name: "Manage Messages",
					description: "Allows members to delete or edit any message in this channel.",
				},
			],
		},
		{
			label: "Voice Channel Permissions",
			perms: [
				{ flag: Permission.JoinVoice, name: "Join Voice", description: "Allows members to join voice channels." },
				{
					flag: Permission.SpeakInVoice,
					name: "Speak in Voice",
					description: "Allows members to speak in voice channels.",
				},
			],
		},
	];

	type PendingOW = { target_id: string; target_type: number; allow_flags: number; deny_flags: number };

	// server-side overwrites for this room
	let roomOverwrites = $derived(space.room_overwrites.filter((o) => o.room_id === room.id));

	// local pending state (unsaved edits)
	let pendingOverwrites = $state<PendingOW[]>([]);

	// initialize pending state only when room changes (not on every WS update)
	$effect(() => {
		const id = room.id;
		untrack(() => {
			pendingOverwrites = space.room_overwrites
				.filter((o) => o.room_id === id)
				.map((ow) => ({
					target_id: ow.target_id,
					target_type: ow.target_type,
					allow_flags: ow.allow_flags,
					deny_flags: ow.deny_flags,
				}));
			selectedTargetId = null;
		});
	});

	// selected overwrite target (role or member id)
	let selectedTargetId = $state<string | null>(null);
	let selectedPending = $derived(
		selectedTargetId ? (pendingOverwrites.find((o) => o.target_id === selectedTargetId) ?? null) : null,
	);

	$effect(() => {
		// auto-select first overwrite if none selected
		if (!selectedTargetId && pendingOverwrites.length > 0) {
			selectedTargetId = pendingOverwrites[0].target_id;
		}
		// deselect if the selected target was removed
		if (selectedTargetId && !pendingOverwrites.find((o) => o.target_id === selectedTargetId)) {
			selectedTargetId = pendingOverwrites.length > 0 ? pendingOverwrites[0].target_id : null;
		}
	});

	// role/member display helpers
	function getRoleName(targetId: string): string {
		const role = space.roles.find((r) => r.id === targetId);
		if (role) return role.name;
		if (targetId === space.id) return "@everyone";
		return targetId.slice(0, 8) + "…";
	}

	function getMemberName(targetId: string): string {
		const user = space.users.find((u) => u.id === targetId);
		if (user) return user.alias ?? user.username;
		const member = space.members.find((m) => m.user_id === targetId);
		if (member?.alias) return member.alias;
		return targetId.slice(0, 8) + "…";
	}

	function getTargetLabel(ow: PendingOW): string {
		if (ow.target_type === 0) return getRoleName(ow.target_id);
		return getMemberName(ow.target_id);
	}

	// permission state: 1 = allow, 0 = inherit, -1 = deny (reads from pending)
	function getPermState(flag: number): 1 | 0 | -1 {
		if (!selectedPending) return 0;
		if ((selectedPending.allow_flags & flag) !== 0) return 1;
		if ((selectedPending.deny_flags & flag) !== 0) return -1;
		return 0;
	}

	// update local pending state only — no API call
	function setPermState(flag: number, state: 1 | 0 | -1) {
		if (!selectedTargetId) return;
		const idx = pendingOverwrites.findIndex((o) => o.target_id === selectedTargetId);
		if (idx === -1) return;

		let allow = pendingOverwrites[idx].allow_flags;
		let deny = pendingOverwrites[idx].deny_flags;

		allow &= ~flag;
		deny &= ~flag;

		if (state === 1) allow |= flag;
		else if (state === -1) deny |= flag;

		pendingOverwrites[idx].allow_flags = allow;
		pendingOverwrites[idx].deny_flags = deny;
	}

	// add a new overwrite to pending (no API call)
	let showAddMenu = $state(false);

	function addRoleOverwrite(roleId: string) {
		showAddMenu = false;
		pendingOverwrites = [...pendingOverwrites, { target_id: roleId, target_type: 0, allow_flags: 0, deny_flags: 0 }];
		selectedTargetId = roleId;
	}

	// remove overwrite from pending (no API call)
	function removeOverwrite() {
		if (!selectedTargetId) return;
		pendingOverwrites = pendingOverwrites.filter((o) => o.target_id !== selectedTargetId);
		selectedTargetId = null;
	}

	// roles not yet in pending
	let availableRoles = $derived(
		space.roles.filter((r) => !pendingOverwrites.some((o) => o.target_id === r.id && o.target_type === 0)),
	);

	// detect unsaved changes by comparing pending vs server
	let hasChanges = $derived(
		(() => {
			if (pendingOverwrites.length !== roomOverwrites.length) return true;
			for (const po of pendingOverwrites) {
				const server = roomOverwrites.find((o) => o.target_id === po.target_id);
				if (!server) return true;
				if (server.allow_flags !== po.allow_flags || server.deny_flags !== po.deny_flags) return true;
			}
			return false;
		})(),
	);

	// bulk save: diff and apply all changes at once
	let isSaving = $state(false);
	let saveError = $state("");

	async function saveAll() {
		isSaving = true;
		saveError = "";
		try {
			const toDelete = roomOverwrites.filter((so) => !pendingOverwrites.find((p) => p.target_id === so.target_id));
			const toUpsert = pendingOverwrites.filter((po) => {
				const server = roomOverwrites.find((s) => s.target_id === po.target_id);
				if (!server) return true;
				return server.allow_flags !== po.allow_flags || server.deny_flags !== po.deny_flags;
			});

			await Promise.all([
				...toDelete.map((ow) => deleteRoomOverwrite(space.id, room.id, ow.target_id)),
				...toUpsert.map((po) =>
					upsertRoomOverwrite(space.id, room.id, po.target_id, po.target_type, po.allow_flags, po.deny_flags),
				),
			]);
		} catch (e) {
			saveError = getApiError(e, "Failed to save");
			console.error("Failed to save overwrites:", e);
		} finally {
			isSaving = false;
		}
	}

	function resetPending() {
		pendingOverwrites = roomOverwrites.map((ow) => ({
			target_id: ow.target_id,
			target_type: ow.target_type,
			allow_flags: ow.allow_flags,
			deny_flags: ow.deny_flags,
		}));
		if (selectedTargetId && !pendingOverwrites.find((o) => o.target_id === selectedTargetId)) {
			selectedTargetId = pendingOverwrites.length > 0 ? pendingOverwrites[0].target_id : null;
		}
	}

	// ── webhook state ───────────────────────────────────────────
	const attachmentHost = getHostURL();
	let webhooksLoading = $state(false);
	let roomWebhooks = $state<Webhook[]>([]);
	let newWebhookName = $state("");
	let newWebhookAvatar = $state<File | null>(null);
	let newWebhookAvatarPreview = $state<string | null>(null);

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

	async function loadWebhooks() {
		webhooksLoading = true;
		try {
			roomWebhooks = await listWebhooks(space.id, room.id);
		} catch (err) {
			console.error("Failed to load webhooks:", err);
			toast(getApiError(err, "Failed to load webhooks"), "error");
		} finally {
			webhooksLoading = false;
		}
	}

	$effect(() => {
		if (activeSection === "webhooks") {
			loadWebhooks();
		}
	});

	async function handleCreateWebhook() {
		if (!newWebhookName.trim()) return;
		isCreatingWebhook = true;
		createdWebhookToken = null;
		createdWebhookId = null;
		try {
			const result = await createWebhook(space.id, room.id, newWebhookName.trim(), newWebhookAvatar ?? undefined);
			createdWebhookToken = result.token;
			createdWebhookId = result.webhook.id;
			newWebhookName = "";
			clearNewWebhookAvatar();
			await loadWebhooks();
		} catch (err) {
			console.error("Failed to create webhook:", err);
			toast(getApiError(err, "Failed to create webhook"), "error");
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

	async function handleUpdateWebhook() {
		if (!editingWebhookId || !editingWebhookName.trim()) return;
		try {
			await updateWebhook(space.id, room.id, editingWebhookId, {
				username: editingWebhookName.trim(),
				avatar: editingWebhookAvatar instanceof File ? editingWebhookAvatar : undefined,
				remove_avatar: editingWebhookAvatar === "remove",
			});
			cancelWebhookEdit();
			await loadWebhooks();
		} catch (err) {
			console.error("Failed to update webhook:", err);
			toast(getApiError(err, "Failed to update webhook"), "error");
		}
	}

	async function handleDeleteWebhook(webhookId: string) {
		const wh = roomWebhooks.find((w) => w.id === webhookId);
		if (!wh) return;
		const whName = wh.username;
		await confirmAction(`Delete webhook "${whName}"? This can't be undone.`, "Deleting", async () => {
			isDeletingWebhook = { ...isDeletingWebhook, [webhookId]: true };
			try {
				await deleteWebhook(space.id, room.id, webhookId);
				await loadWebhooks();
			} finally {
				isDeletingWebhook = { ...isDeletingWebhook, [webhookId]: false };
			}
		});
	}

	async function handleResetWebhookToken(webhookId: string) {
		await confirmAction("Reset this webhook's token? The old token will stop working immediately.", "Reset Token", async () => {
			try {
				const newToken = await resetWebhookToken(space.id, room.id, webhookId);
				createdWebhookToken = newToken;
				createdWebhookId = webhookId;
				toast("Token reset successfully", "success");
			} catch (err) {
				console.error("Failed to reset webhook token:", err);
				toast(getApiError(err, "Failed to reset token"), "error");
			}
		});
	}

	function copyWebhookUrl(webhookId: string, token: string) {
		const url = `${DUVET_DOMAIN}/api/webhooks/${webhookId}/${token}`;
		navigator.clipboard.writeText(url);
		toast("Webhook URL copied to clipboard", "success");
	}

	// delete channel
	let confirmDelete = $state(false);

	function handleClose() {
		activeSection = "overview";
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-500 bg-black/70 backdrop-blur-sm" />
		<Dialog.Content class="fixed inset-0 z-501 flex items-center justify-center p-4">
			<div
				class="flex h-[85vh] max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-100 shadow-2xl"
			>
				<!-- Left sidebar -->
				<aside class="flex w-56 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 py-6">
					<div class="mb-4 px-4">
						<div class="mb-1 flex items-center gap-1.5 px-2">
							{#if room.type === 3}
								<GearSixIcon class="size-3.5 shrink-0 text-zinc-400" />
							{:else if room.type === 1}
								<HashIcon class="size-3.5 shrink-0 text-zinc-400" />
							{:else}
								<SpeakerIcon class="size-3.5 shrink-0 text-zinc-400" />
							{/if}
							<p class="text-xxs truncate font-bold tracking-widest text-zinc-400 uppercase">
								{room.name}
							</p>
						</div>
					</div>

					<nav class="flex flex-1 flex-col gap-0.5 px-2">
						<button
							class="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-100
								{activeSection === 'overview' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
							onclick={() => (activeSection = "overview")}
						>
							<GearSixIcon class="size-4" />
							Overview
						</button>

						{#if room.type !== 3}
							<button
								class="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-100
									{activeSection === 'permissions' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
								onclick={() => (activeSection = "permissions")}
							>
								<ShieldIcon class="size-4" />
								Permissions
							</button>
						{/if}

						{#if room.type === 1}
							<button
								class="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-100
									{activeSection === 'webhooks' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
								onclick={() => (activeSection = "webhooks")}
							>
								<WebhookIcon class="size-4" />
								Webhooks
							</button>
						{/if}

						<div class="mx-1 mt-auto border-t border-zinc-800 pt-4">
							{#if !confirmDelete}
								<button
									class="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-red-400 transition-colors duration-100 hover:bg-zinc-800/60 hover:text-red-300"
									onclick={() => (confirmDelete = true)}
								>
									<TrashIcon class="size-4" />
									Delete {room.type === 3 ? "Category" : "Channel"}
								</button>
							{:else}
								<div class="px-3 py-2 text-xs text-zinc-400">
									<p class="mb-2 font-medium text-red-400">Delete this {room.type === 3 ? "category" : "channel"}?</p>
									<div class="flex gap-2">
										<button
											class="flex-1 rounded bg-red-600 px-2 py-1 text-xs text-white transition-colors hover:bg-red-500"
											onclick={() => {
												onDelete?.();
												handleClose();
											}}
										>
											Delete
										</button>
										<button
											class="flex-1 rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-100 transition-colors hover:bg-zinc-600"
											onclick={() => (confirmDelete = false)}
										>
											Cancel
										</button>
									</div>
								</div>
							{/if}
						</div>
					</nav>
				</aside>

				<!-- Content area -->
				<div class="relative flex min-w-0 flex-1 flex-col">
					<!-- Header -->
					<div class="flex shrink-0 items-center justify-between border-b border-zinc-800 px-6 py-4">
						<h2 class="text-base font-semibold text-white capitalize">
							{activeSection === "overview"
									? "Overview"
									: activeSection === "permissions"
										? "Permissions"
										: "Webhooks"}
						</h2>
						<button
							class="rounded-lg p-1.5 text-zinc-400 transition-colors duration-150 hover:bg-zinc-800 hover:text-white"
							onclick={handleClose}
							aria-label="Close"
						>
							<XIcon class="size-5" />
						</button>
					</div>

					<!-- Scrollable body -->
					<div class="flex-1 overflow-y-auto" class:pb-14={activeSection === "permissions" && hasChanges}>
						{#if activeSection === "overview"}
							<div class="max-w-xl space-y-5 px-6 py-6">
								<div class="space-y-1.5">
									<label for="ch-name" class="block text-xs font-semibold tracking-wide text-zinc-400 uppercase">
										{room.type === 3 ? "Category Name" : "Channel Name"}
									</label>
									<input
										id="ch-name"
										type="text"
										bind:value={editName}
										class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:ring-2 focus:ring-indigo-500/60 focus:outline-none"
										placeholder={room.type === 3 ? "category-name" : "channel-name"}
										maxlength="64"
									/>
								</div>

								{#if room.type !== 3}
									<div class="space-y-1.5">
										<label for="ch-desc" class="block text-xs font-semibold tracking-wide text-zinc-400 uppercase">
											Description
										</label>
										<textarea
											id="ch-desc"
											bind:value={editDescription}
											rows="3"
											class="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:ring-2 focus:ring-indigo-500/60 focus:outline-none"
											placeholder="Optional description…"
											maxlength="256"
										></textarea>
									</div>
								{/if}

								{#if overviewError}
									<p class="text-sm text-red-400">{overviewError}</p>
								{/if}

								<div class="flex gap-3 pt-1">
									<button
										class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
										disabled={overviewSaving || !editName.trim()}
										onclick={saveOverview}
									>
										{overviewSaving ? "Saving…" : "Save Changes"}
									</button>
									<button
										class="rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-600"
										onclick={() => {
											editName = room.name;
											editDescription = room.description ?? "";
											overviewError = "";
										}}
									>
										Reset
									</button>
								</div>
							</div>
						{:else if activeSection === "permissions"}
							<div class="flex h-full">
								<!-- Roles/Members list -->
								<div class="flex w-52 shrink-0 flex-col border-r border-zinc-800 py-4">
									<div class="flex items-center justify-between px-3 pb-2">
										<span class="text-xxs font-bold tracking-widest text-zinc-500 uppercase"> Roles / Members </span>
										<div class="relative">
											<button
												class="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
												onclick={() => (showAddMenu = !showAddMenu)}
												title="Add overwrite"
											>
												<PlusIcon class="size-3.5" />
											</button>
											{#if showAddMenu}
												<div
													class="absolute top-full right-0 z-10 mt-1 max-h-48 w-48 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-800 py-1 shadow-2xl"
												>
													{#if availableRoles.length === 0}
														<p class="px-3 py-2 text-xs text-zinc-500">All roles added</p>
													{:else}
														{#each availableRoles as role (role.id)}
															<button
																class="w-full px-3 py-2 text-left text-sm text-zinc-200 transition-colors hover:bg-zinc-700"
																onclick={() => addRoleOverwrite(role.id)}
															>
																{role.name}
															</button>
														{/each}
													{/if}
												</div>
											{/if}
										</div>
									</div>

									<div class="flex-1 overflow-y-auto">
										{#each pendingOverwrites as ow (ow.target_id)}
											<button
												class="w-full px-3 py-2 text-left text-sm transition-colors
													{selectedTargetId === ow.target_id ? 'bg-zinc-700 text-white' : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'}"
												onclick={() => (selectedTargetId = ow.target_id)}
											>
												{getTargetLabel(ow)}
											</button>
										{/each}

										{#if pendingOverwrites.length === 0}
											<p class="px-3 py-3 text-xs text-zinc-500">No overwrites yet. Add a role with the + button.</p>
										{/if}
									</div>
								</div>

								<!-- Permission toggles -->
								<div class="flex-1 overflow-y-auto px-6 py-4">
									{#if !selectedTargetId || !selectedPending}
										<p class="mt-8 text-center text-sm text-zinc-500">Select a role or member to edit permissions.</p>
									{:else}
										<div class="mb-5 flex items-center justify-between">
											<h3 class="text-sm font-semibold text-zinc-200">
												{getTargetLabel(selectedPending)}
											</h3>
											<button
												class="rounded px-2 py-1 text-xs text-red-400 transition-colors hover:bg-zinc-800 hover:text-red-300"
												onclick={removeOverwrite}
											>
												Remove
											</button>
										</div>

										{#each PERMISSION_GROUPS as group (group.label)}
											<div class="mb-6">
												<p class="mb-3 text-xs font-bold tracking-widest text-zinc-500 uppercase">
													{group.label}
												</p>
												<div class="space-y-3">
													{#each group.perms as perm (perm.flag)}
														{@const state = getPermState(perm.flag)}
														<div class="flex items-start justify-between gap-4 py-2">
															<div class="min-w-0 flex-1">
																<p class="text-sm font-medium text-zinc-200">{perm.name}</p>
																<p class="mt-0.5 text-xs text-zinc-500">{perm.description}</p>
															</div>
															<div class="flex shrink-0 items-center gap-1">
																<!-- Deny -->
																<button
																	class="flex size-7 items-center justify-center rounded transition-colors
																		{state === -1 ? 'bg-red-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'}"
																	onclick={() => setPermState(perm.flag, state === -1 ? 0 : -1)}
																	title="Deny"
																>
																	<XIcon class="size-3.5" />
																</button>
																<!-- Inherit -->
																<button
																	class="flex size-7 items-center justify-center rounded transition-colors
																		{state === 0 ? 'bg-zinc-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'}"
																	onclick={() => setPermState(perm.flag, 0)}
																	title="Inherit"
																>
																	<MinusIcon class="size-3.5" />
																</button>
																<!-- Allow -->
																<button
																	class="flex size-7 items-center justify-center rounded transition-colors
																		{state === 1 ? 'bg-green-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'}"
																	onclick={() => setPermState(perm.flag, state === 1 ? 0 : 1)}
																	title="Allow"
																>
																	<CheckIcon class="size-3.5" />
																</button>
															</div>
														</div>
													{/each}
												</div>
											</div>
										{/each}
									{/if}
								</div>
							</div>
						{:else if activeSection === "webhooks"}
							{#if webhooksLoading}
								<p class="px-6 py-6 text-sm text-zinc-400">Loading webhooks...</p>
							{:else}
								<div class="max-w-xl space-y-5 px-6 py-6">
									<!-- Create new webhook -->
									<div class="space-y-4 rounded-xl border border-zinc-700 bg-zinc-900 p-5">
										<div class="space-y-1">
											<h3 class="text-sm font-semibold tracking-wide text-white">Create Webhook</h3>
											<p class="text-xs text-zinc-400">
												Webhooks allow external services to send messages to this channel.
											</p>
										</div>

										<div class="space-y-3">
											<label class="block space-y-1.5">
												<span class="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">Username</span>
												<input
													type="text"
													class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
													placeholder="Webhook Bot"
													bind:value={newWebhookName}
												/>
											</label>

											<div class="space-y-1.5">
												<span class="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">Avatar (optional)</span>
												<div class="flex items-center gap-3">
													<div class="group relative size-14 shrink-0 overflow-hidden rounded-full bg-zinc-700">
														{#if newWebhookAvatarPreview}
															<img src={newWebhookAvatarPreview} alt="Preview" class="size-full object-cover" />
														{:else}
															<div class="flex size-full items-center justify-center">
																<WebhookIcon class="size-6 text-zinc-500" />
															</div>
														{/if}
														<div class="absolute inset-0 flex items-center justify-center gap-1 bg-black/0 transition-colors group-hover:bg-black/50">
															<button
																type="button"
																class="flex size-6 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
																title="Change avatar"
																onclick={pickNewWebhookAvatar}
															>
																<CameraIcon class="size-3" />
															</button>
															{#if newWebhookAvatarPreview}
																<button
																	type="button"
																	class="flex size-6 cursor-pointer items-center justify-center rounded-full bg-black/60 text-red-400 opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
																	title="Remove avatar"
																	onclick={clearNewWebhookAvatar}
																>
																	<TrashIcon class="size-3" />
																</button>
															{/if}
														</div>
													</div>
													<p class="text-xs text-zinc-500">Click to upload an avatar</p>
												</div>
											</div>

											<button
												class="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
												onclick={handleCreateWebhook}
												disabled={isCreatingWebhook || !newWebhookName.trim()}
											>
												<PlusIcon class="size-4" />
												{isCreatingWebhook ? "Creating..." : "Create"}
											</button>
										</div>
									</div>

									<!-- Token reveal box -->
									{#if createdWebhookToken && createdWebhookId}
										<div class="overflow-hidden rounded-xl border border-amber-600/30 bg-amber-950/20 p-4">
											<p class="mb-2 text-xs font-semibold text-amber-300">
												Webhook Token (shown only once)
											</p>
											<div class="flex items-center gap-2">
												<code class="min-w-0 flex-1 truncate rounded-md bg-zinc-800 px-3 py-2 text-xs text-zinc-200">
													{createdWebhookToken}
												</code>
												<button
													class="flex shrink-0 items-center gap-1.5 rounded-md bg-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-600"
													onclick={() => copyWebhookUrl(createdWebhookId!, createdWebhookToken!)}
													title="Copy Webhook URL"
												>
													<CopyIcon class="size-3.5" />
													Copy URL
												</button>
											</div>
											<p class="mt-2 truncate text-[11px] text-amber-400/70" title="{DUVET_DOMAIN}/api/webhooks/{createdWebhookId}/{createdWebhookToken}">
												Webhook URL: {DUVET_DOMAIN}/api/webhooks/{createdWebhookId}/{createdWebhookToken}
											</p>
											<button
												class="mt-2 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
												onclick={() => { createdWebhookToken = null; createdWebhookId = null; }}
											>
												Dismiss
											</button>
										</div>
									{/if}

									<!-- Webhook list -->
									{#if roomWebhooks.length === 0}
										<div class="flex flex-col items-center justify-center py-12 text-center">
											<WebhookIcon class="mb-3 size-10 text-zinc-600" />
											<p class="text-sm text-zinc-400">No webhooks yet.</p>
											<p class="mt-1 text-xs text-zinc-500">Create one above to get started.</p>
										</div>
									{:else}
										<div class="space-y-1">
											{#each roomWebhooks as wh (wh.id)}
												<div
													class="group flex items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5"
												>
													<!-- Avatar -->
													{#if wh.avatar}
														<img
															src="{attachmentHost}/attachments/{wh.avatar}"
															alt={wh.username}
															class="size-8 shrink-0 rounded-full object-cover"
														/>
													{:else}
														<div class="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-700">
															<WebhookIcon class="size-4 text-zinc-400" />
														</div>
													{/if}

													{#if editingWebhookId === wh.id}
														<div class="group/edit relative size-10 shrink-0 overflow-hidden rounded-full bg-zinc-700">
															{#if editingWebhookAvatarPreview}
																<img src={editingWebhookAvatarPreview} alt="Preview" class="size-full object-cover" />
															{:else}
																<div class="flex size-full items-center justify-center">
																	<WebhookIcon class="size-4 text-zinc-500" />
																</div>
															{/if}
															<div class="absolute inset-0 flex items-center justify-center gap-0.5 bg-black/0 transition-colors group-hover/edit:bg-black/50">
																<button
																	type="button"
																	class="flex size-5 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover/edit:opacity-100"
																	title="Change avatar"
																	onclick={pickEditWebhookAvatar}
																>
																	<CameraIcon class="size-2.5" />
																</button>
																{#if editingWebhookAvatarPreview}
																	<button
																		type="button"
																		class="flex size-5 cursor-pointer items-center justify-center rounded-full bg-black/60 text-red-400 opacity-0 transition-opacity hover:bg-black/80 group-hover/edit:opacity-100"
																		title="Remove avatar"
																		onclick={removeEditWebhookAvatar}
																	>
																		<TrashIcon class="size-2.5" />
																	</button>
																{/if}
															</div>
														</div>
														<div class="flex min-w-0 flex-1 flex-col gap-2">
															<input
																type="text"
																class="w-full rounded-md border border-zinc-600 bg-zinc-700 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-zinc-500"
																bind:value={editingWebhookName}
																onkeydown={(e) => {
																	if (e.key === "Enter") handleUpdateWebhook();
																	if (e.key === "Escape") cancelWebhookEdit();
																}}
															/>
														</div>
														<button
															class="rounded p-1.5 text-green-400 transition-colors hover:bg-zinc-700"
															onclick={handleUpdateWebhook}
															title="Save"
														>
															<CheckIcon class="size-4" />
														</button>
														<button
															class="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-700"
															onclick={cancelWebhookEdit}
															title="Cancel"
														>
															<XIcon class="size-4" />
														</button>
													{:else}
														<div class="min-w-0 flex-1">
															<p class="truncate text-sm font-medium text-zinc-200">{wh.username}</p>
															<p class="truncate text-xs text-zinc-500">
																Created {new Date(wh.created_at).toLocaleDateString()}
															</p>
														</div>

														<button
															class="rounded p-1.5 text-zinc-400 opacity-0 transition-all group-hover:opacity-100 hover:bg-zinc-700 hover:text-zinc-200"
															onclick={() => startWebhookEdit(wh)}
															title="Rename"
														>
															<PencilIcon class="size-4" />
														</button>
														<button
															class="rounded p-1.5 text-zinc-400 opacity-0 transition-all group-hover:opacity-100 hover:bg-zinc-700 hover:text-amber-400"
															onclick={() => handleResetWebhookToken(wh.id)}
															title="Reset Token"
														>
															<WebhookIcon class="size-4" />
														</button>
														<button
															class="rounded p-1.5 text-zinc-400 opacity-0 transition-all group-hover:opacity-100 hover:bg-zinc-700 hover:text-red-400"
															onclick={() => handleDeleteWebhook(wh.id)}
															disabled={isDeletingWebhook[wh.id]}
															title="Delete"
														>
															<TrashIcon class="size-4" />
														</button>
													{/if}
												</div>
											{/each}
										</div>
									{/if}
								</div>
							{/if}
						{/if}
					</div>

					<!-- Bulk save bar — slides in from bottom when there are unsaved changes -->
					{#if activeSection === "permissions" && hasChanges}
						<div
							transition:fly={{ y: 60, duration: 250, easing: cubicOut }}
							class="absolute right-0 bottom-0 left-0 flex items-center justify-between border-t border-zinc-700 bg-zinc-800/95 px-6 py-3 backdrop-blur-sm"
						>
							<span class="text-sm {saveError ? 'text-red-400' : 'text-zinc-400'}">
								{saveError || "You have unsaved changes"}
							</span>
							<div class="flex items-center gap-2">
								<button
									class="rounded px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-50"
									onclick={resetPending}
									disabled={isSaving}
								>
									Reset
								</button>
								<button
									class="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
									onclick={saveAll}
									disabled={isSaving}
								>
									{isSaving ? "Saving…" : "Save Changes"}
								</button>
							</div>
						</div>
					{/if}
				</div>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
