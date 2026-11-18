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
		if (!selectedTargetId && pendingOverwrites[0]) {
			selectedTargetId = pendingOverwrites[0].target_id;
		}
		// deselect if the selected target was removed
		if (selectedTargetId && !pendingOverwrites.find((o) => o.target_id === selectedTargetId)) {
			selectedTargetId = pendingOverwrites[0]?.target_id ?? null;
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
		const overwrite = pendingOverwrites.find((o) => o.target_id === selectedTargetId);
		if (!overwrite) return;

		let allow = overwrite.allow_flags;
		let deny = overwrite.deny_flags;

		allow &= ~flag;
		deny &= ~flag;

		if (state === 1) allow |= flag;
		else if (state === -1) deny |= flag;

		overwrite.allow_flags = allow;
		overwrite.deny_flags = deny;
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
			selectedTargetId = pendingOverwrites[0]?.target_id ?? null;
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
				class="rounded-card border-duvet-line bg-duvet-bg text-duvet-ink shadow-duvet-float flex h-[85vh] max-h-[85vh] w-full max-w-4xl overflow-hidden border"
			>
				<!-- Left sidebar -->
				<aside class="border-duvet-line bg-duvet-sunk flex w-56 shrink-0 flex-col border-r py-6">
					<div class="mb-4 px-4">
						<div class="mb-1 flex items-center gap-1.5 px-2">
							{#if room.type === 3}
								<GearSixIcon class="text-duvet-ink2 size-3.5 shrink-0" />
							{:else if room.type === 1}
								<HashIcon class="text-duvet-ink2 size-3.5 shrink-0" />
							{:else}
								<SpeakerIcon class="text-duvet-ink2 size-3.5 shrink-0" />
							{/if}
							<p class="text-duvet-ink2 truncate text-xs font-bold">
								{room.name}
							</p>
						</div>
					</div>

					<nav class="flex flex-1 flex-col gap-0.5 px-2">
						<button
							class="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-100
								{activeSection === 'overview'
								? 'bg-duvet-card text-duvet-ink'
								: 'text-duvet-ink2 hover:bg-duvet-card/60 hover:text-duvet-ink'}"
							onclick={() => (activeSection = "overview")}
						>
							<GearSixIcon class="size-4" />
							Overview
						</button>

						{#if room.type !== 3}
							<button
								class="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-100
									{activeSection === 'permissions'
									? 'bg-duvet-card text-duvet-ink'
									: 'text-duvet-ink2 hover:bg-duvet-card/60 hover:text-duvet-ink'}"
								onclick={() => (activeSection = "permissions")}
							>
								<ShieldIcon class="size-4" />
								Permissions
							</button>
						{/if}

						{#if room.type === 1 && canManageWebhooks}
							<button
								class="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-100
									{activeSection === 'webhooks'
									? 'bg-duvet-card text-duvet-ink'
									: 'text-duvet-ink2 hover:bg-duvet-card/60 hover:text-duvet-ink'}"
								onclick={() => (activeSection = "webhooks")}
							>
								<WebhookIcon class="size-4" />
								Webhooks
							</button>
						{/if}

						<div class="border-duvet-line mx-1 mt-auto border-t pt-4">
							{#if !confirmDelete}
								<button
									class="text-duvet-danger hover:bg-duvet-card/60 hover:text-duvet-danger flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-100"
									onclick={() => (confirmDelete = true)}
								>
									<TrashIcon class="size-4" />
									Delete {room.type === 3 ? "Category" : "Room"}
								</button>
							{:else}
								<div class="text-duvet-ink2 px-3 py-2 text-xs">
									<p class="text-duvet-danger mb-2 font-medium">Delete this {room.type === 3 ? "category" : "room"}?</p>
									<div class="flex gap-2">
										<button
											class="text-duvet-on-accent bg-duvet-danger hover:bg-duvet-danger/85 flex-1 rounded px-2 py-1 text-xs transition-colors"
											onclick={() => {
												onDelete?.();
												handleClose();
											}}
										>
											Delete
										</button>
										<button
											class="bg-duvet-ink/10 text-duvet-ink hover:bg-duvet-ink/15 flex-1 rounded px-2 py-1 text-xs transition-colors"
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
					<div class="border-duvet-line flex shrink-0 items-center justify-between border-b px-6 py-4">
						<h2 class="text-duvet-ink text-base font-semibold capitalize">
							{activeSection === "overview" ? "Overview" : activeSection === "permissions" ? "Permissions" : "Webhooks"}
						</h2>
						<button
							class="text-duvet-ink2 hover:bg-duvet-card hover:text-duvet-ink rounded-lg p-1.5 transition-colors duration-150"
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
									<label for="ch-name" class="text-duvet-ink2 block text-[13px] font-bold">
										{room.type === 3 ? "Category Name" : "Room Name"}
									</label>
									<input
										id="ch-name"
										type="text"
										bind:value={editName}
										class="text-duvet-ink placeholder:text-duvet-ink2 bg-duvet-sunk shadow-duvet-press focus-visible:outline-duvet-accent w-full rounded-xl px-3 py-2 text-sm focus-visible:outline-2"
										placeholder={room.type === 3 ? "category-name" : "room-name"}
										maxlength="64"
									/>
								</div>

								{#if room.type !== 3}
									<div class="space-y-1.5">
										<label for="ch-desc" class="text-duvet-ink2 block text-[13px] font-bold"> Description </label>
										<textarea
											id="ch-desc"
											bind:value={editDescription}
											rows="3"
											class="text-duvet-ink placeholder:text-duvet-ink2 bg-duvet-sunk shadow-duvet-press focus-visible:outline-duvet-accent w-full resize-none rounded-xl px-3 py-2 text-sm focus-visible:outline-2"
											placeholder="Optional description…"
											maxlength="256"
										></textarea>
									</div>
								{/if}

								{#if overviewError}
									<p class="text-duvet-danger text-sm">{overviewError}</p>
								{/if}

								<div class="flex gap-3 pt-1">
									<button
										class="text-duvet-on-accent rounded-row bg-duvet-accent hover:bg-duvet-accent/85 px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
										disabled={overviewSaving || !editName.trim()}
										onclick={saveOverview}
									>
										{overviewSaving ? "Saving…" : "Save Changes"}
									</button>
									<button
										class="rounded-row bg-duvet-ink/10 text-duvet-ink hover:bg-duvet-ink/15 px-4 py-2 text-sm font-medium transition-colors"
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
								<div class="border-duvet-line flex w-52 shrink-0 flex-col border-r py-4">
									<div class="flex items-center justify-between px-3 pb-2">
										<span class="text-duvet-ink2 text-xs font-bold"> Roles / Members </span>
										<div class="relative">
											<button
												class="text-duvet-ink2 hover:bg-duvet-card hover:text-duvet-ink rounded p-1 transition-colors"
												onclick={() => (showAddMenu = !showAddMenu)}
												title="Add overwrite"
											>
												<PlusIcon class="size-3.5" />
											</button>
											{#if showAddMenu}
												<div
													class="rounded-card border-duvet-line bg-duvet-card shadow-duvet-float absolute top-full right-0 z-10 mt-1 max-h-48 w-48 overflow-y-auto border py-1"
												>
													{#if availableRoles.length === 0}
														<p class="text-duvet-ink2 px-3 py-2 text-xs">All roles added</p>
													{:else}
														{#each availableRoles as role (role.id)}
															<button
																class="text-duvet-ink hover:bg-duvet-ink/10 w-full px-3 py-2 text-left text-sm transition-colors"
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
													{selectedTargetId === ow.target_id
													? 'bg-duvet-ink/10 text-duvet-ink'
													: 'text-duvet-ink hover:bg-duvet-card hover:text-duvet-ink'}"
												onclick={() => (selectedTargetId = ow.target_id)}
											>
												{getTargetLabel(ow)}
											</button>
										{/each}

										{#if pendingOverwrites.length === 0}
											<p class="text-duvet-ink2 px-3 py-3 text-xs">No overwrites yet. Add a role with the + button.</p>
										{/if}
									</div>
								</div>

								<!-- Permission toggles -->
								<div class="flex-1 overflow-y-auto px-6 py-4">
									{#if !selectedTargetId || !selectedPending}
										<p class="text-duvet-ink2 mt-8 text-center text-sm">Select a role or member to edit permissions.</p>
									{:else}
										<div class="mb-5 flex items-center justify-between">
											<h3 class="text-duvet-ink text-sm font-semibold">
												{getTargetLabel(selectedPending)}
											</h3>
											<button
												class="text-duvet-danger hover:bg-duvet-card hover:text-duvet-danger rounded px-2 py-1 text-xs transition-colors"
												onclick={removeOverwrite}
											>
												Remove
											</button>
										</div>

										{#each PERMISSION_GROUPS as group (group.label)}
											<div class="mb-6">
												<p class="text-duvet-ink2 mb-3 text-[13px] font-bold">
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
																<p class="text-duvet-ink text-sm font-medium">{perm.name}</p>
																<p class="text-duvet-ink2 mt-0.5 text-xs">{perm.description}</p>
															</div>
															<div class="flex shrink-0 items-center gap-1">
																<!-- Deny -->
																<button
																	class="flex size-7 items-center justify-center rounded transition-colors
																		{state === -1
																		? 'text-duvet-on-accent bg-duvet-danger'
																		: 'bg-duvet-card text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink'}"
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
																		{state === 0
																		? 'bg-duvet-ink/15 text-duvet-ink'
																		: 'bg-duvet-card text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink'}"
																	onclick={() => setPermState(perm.flag, 0)}
																	title="Inherit"
																>
																	<MinusIcon class="size-3.5" />
																</button>
																<!-- Allow -->
																<button
																	class="flex size-7 items-center justify-center rounded transition-colors
																		{state === 1
																		? 'text-duvet-on-accent bg-duvet-alive'
																		: 'bg-duvet-card text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink'}"
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
							class="border-duvet-line bg-duvet-card/95 absolute right-0 bottom-0 left-0 flex items-center justify-between border-t px-6 py-3 backdrop-blur-sm"
						>
							<span class="text-sm {saveError ? 'text-duvet-danger' : 'text-duvet-ink2'}">
								{saveError || "You have unsaved changes"}
							</span>
							<div class="flex items-center gap-2">
								<button
									class="text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink rounded px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
									onclick={resetPending}
									disabled={isSaving}
								>
									Reset
								</button>
								<button
									class="text-duvet-on-accent rounded-row bg-duvet-accent hover:bg-duvet-accent/85 px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
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
