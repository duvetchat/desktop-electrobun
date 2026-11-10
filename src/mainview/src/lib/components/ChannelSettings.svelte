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
		Upload as UploadIcon,
	} from "@lucide/svelte";
	import { fly } from "svelte/transition";
	import { cubicOut } from "svelte/easing";
	import { untrack } from "svelte";
	import { Dialog } from "bits-ui";
	import { Permission, canSetPermission, computeRoomPermissions, hasSpacePermission } from "$lib/permissions";
	import { getApiError } from "$lib/api/api";
	import { updateRoom, upsertRoomOverwrite, deleteRoomOverwrite } from "$lib/api/rooms";
	import Webhooks from "$lib/components/Webhooks.svelte";
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
	// The bits a room's overwrites can change something with. ManageRoles in a room changes nothing, so it has no row;
	// an overwrite that carries it keeps it, as an edit changes only the bit it toggles.
	const PERMISSION_GROUPS = [
		{
			label: "General Room Permissions",
			perms: [
				{ flag: Permission.ViewChannels, name: "View Room", description: "Allows members to view this room." },
				{
					flag: Permission.ManageChannels,
					name: "Manage Room",
					description: "Allows members to change this room's name and description.",
				},
				{
					flag: Permission.CreateInvites,
					name: "Create Invite",
					description: "Allows members to create invite links to this room.",
				},
			],
		},
		{
			label: "Text Room Permissions",
			perms: [
				{
					flag: Permission.SendMessages,
					name: "Send Messages",
					description: "Allows members to send messages in this room.",
				},
				{
					flag: Permission.ManageMessages,
					name: "Manage Messages",
					description: "Allows members to delete or edit any message in this room.",
				},
				{
					flag: Permission.PinMessages,
					name: "Pin Messages",
					description: "Allows members to pin and unpin messages in this room.",
				},
			],
		},
		{
			label: "Voice Room Permissions",
			perms: [
				{ flag: Permission.JoinVoice, name: "Join Voice", description: "Allows members to join voice rooms." },
				{
					flag: Permission.SpeakInVoice,
					name: "Speak in Voice",
					description: "Allows members to speak in voice rooms.",
				},
				{
					flag: Permission.Video,
					name: "Video",
					description: "Allows members to turn on their camera and share their screen in voice rooms.",
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
	// The API takes a flag newly allowed or denied only from someone who has it in this room (UpsertRoomOverwrite's
	// grantable mask); what the saved overwrite already allows or denies can be kept or removed by anyone.
	const roomGranted = $derived(computeRoomPermissions(space, room));
	const selectedSaved = $derived(roomOverwrites.find((o) => o.target_id === selectedTargetId));

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

	// Every webhook call takes ManageSpaceWebhooks in the space, as the API checks: without it there's no section.
	const canManageWebhooks = $derived(hasSpacePermission(space, Permission.ManageSpaceWebhooks));

	$effect(() => {
		if (activeSection === "webhooks" && !canManageWebhooks) activeSection = "overview";
	});

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

						{#if room.type === 1 && canManageWebhooks}
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
									Delete {room.type === 3 ? "Category" : "Room"}
								</button>
							{:else}
								<div class="px-3 py-2 text-xs text-zinc-400">
									<p class="mb-2 font-medium text-red-400">Delete this {room.type === 3 ? "category" : "room"}?</p>
									<div class="flex gap-2">
										<button
											class="text-fixed-white flex-1 rounded bg-red-600 px-2 py-1 text-xs transition-colors hover:bg-red-500"
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
							{activeSection === "overview" ? "Overview" : activeSection === "permissions" ? "Permissions" : "Webhooks"}
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
										{room.type === 3 ? "Category Name" : "Room Name"}
									</label>
									<input
										id="ch-name"
										type="text"
										bind:value={editName}
										class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:ring-2 focus:ring-indigo-500/60 focus:outline-none"
										placeholder={room.type === 3 ? "category-name" : "room-name"}
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
										class="text-fixed-white rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium transition-colors hover:bg-indigo-500 disabled:opacity-50"
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
														{@const canDeny =
															state === -1 || canSetPermission(roomGranted, selectedSaved?.deny_flags ?? 0, perm.flag)}
														{@const canAllow =
															state === 1 || canSetPermission(roomGranted, selectedSaved?.allow_flags ?? 0, perm.flag)}
														<div class="flex items-start justify-between gap-4 py-2">
															<div class="min-w-0 flex-1">
																<p class="text-sm font-medium text-zinc-200">{perm.name}</p>
																<p class="mt-0.5 text-xs text-zinc-500">{perm.description}</p>
															</div>
															<div class="flex shrink-0 items-center gap-1">
																<!-- Deny -->
																<button
																	class="flex size-7 items-center justify-center rounded transition-colors
																		{state === -1 ? 'text-fixed-white bg-red-600' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'}"
																	class:opacity-40={!canDeny}
																	class:cursor-not-allowed={!canDeny}
																	disabled={!canDeny}
																	onclick={() => setPermState(perm.flag, state === -1 ? 0 : -1)}
																	title={canDeny ? "Deny" : "You can only deny permissions you have in this room"}
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
																		{state === 1 ? 'text-fixed-white bg-green-600' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'}"
																	class:opacity-40={!canAllow}
																	class:cursor-not-allowed={!canAllow}
																	disabled={!canAllow}
																	onclick={() => setPermState(perm.flag, state === 1 ? 0 : 1)}
																	title={canAllow ? "Allow" : "You can only allow permissions you have in this room"}
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
							<div class="px-6 py-6">
								<Webhooks {space} rooms={[room]} />
							</div>
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
									class="text-fixed-white rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium transition-colors hover:bg-indigo-500 disabled:opacity-50"
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
