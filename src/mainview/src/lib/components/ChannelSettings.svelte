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
} from "@lucide/svelte";
import { fly } from "svelte/transition";
import { cubicOut } from "svelte/easing";
import { untrack } from "svelte";
import { Dialog } from "bits-ui";
import { Permission } from "$lib/permissions";
import { updateRoom, upsertRoomOverwrite, deleteRoomOverwrite } from "$lib/api/rooms";
import { currentUser } from "$lib/stores.svelte";
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

type Section = "overview" | "permissions";
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
		overviewError = e instanceof Error ? e.message : "Failed to save";
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
			{ flag: Permission.ManageChannels, name: "Manage Channel", description: "Allows members to change this channel's name and description." },
			{ flag: Permission.ManageRoles, name: "Manage Permissions", description: "Allows members to change this channel's permissions." },
		],
	},
	{
		label: "Text Channel Permissions",
		perms: [
			{ flag: Permission.SendMessages, name: "Send Messages", description: "Allows members to send messages in this channel." },
			{ flag: Permission.ManageMessages, name: "Manage Messages", description: "Allows members to delete or edit any message in this channel." },
		],
	},
	{
		label: "Voice Channel Permissions",
		perms: [
			{ flag: Permission.JoinVoice, name: "Join Voice", description: "Allows members to join voice channels." },
			{ flag: Permission.SpeakInVoice, name: "Speak in Voice", description: "Allows members to speak in voice channels." },
		],
	},
];

type PendingOW = { target_id: string; target_type: number; allow_flags: number; deny_flags: number };

// server-side overwrites for this room
let roomOverwrites = $derived(
	space.room_overwrites.filter((o) => o.room_id === room.id),
);

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
	selectedTargetId ? pendingOverwrites.find((o) => o.target_id === selectedTargetId) ?? null : null,
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
	pendingOverwrites = [
		...pendingOverwrites,
		{ target_id: roleId, target_type: 0, allow_flags: 0, deny_flags: 0 },
	];
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
let hasChanges = $derived((() => {
	if (pendingOverwrites.length !== roomOverwrites.length) return true;
	for (const po of pendingOverwrites) {
		const server = roomOverwrites.find((o) => o.target_id === po.target_id);
		if (!server) return true;
		if (server.allow_flags !== po.allow_flags || server.deny_flags !== po.deny_flags) return true;
	}
	return false;
})());

// bulk save: diff and apply all changes at once
let isSaving = $state(false);
let saveError = $state("");

async function saveAll() {
	isSaving = true;
	saveError = "";
	try {
		const toDelete = roomOverwrites.filter(
			(so) => !pendingOverwrites.find((p) => p.target_id === so.target_id),
		);
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
		saveError = e instanceof Error ? e.message : "Failed to save";
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
			<div class="w-full max-w-4xl max-h-[85vh] h-[85vh] bg-zinc-900 rounded-xl shadow-2xl flex overflow-hidden border border-zinc-700 text-zinc-100">

				<!-- Left sidebar -->
				<aside class="w-56 shrink-0 bg-zinc-950 flex flex-col py-6 border-r border-zinc-800">
					<div class="px-4 mb-4">
						<div class="flex items-center gap-1.5 px-2 mb-1">
							{#if room.type === 1}
								<HashIcon class="size-3.5 text-zinc-400 shrink-0" />
							{:else}
								<SpeakerIcon class="size-3.5 text-zinc-400 shrink-0" />
							{/if}
							<p class="text-xxs font-bold tracking-widest uppercase text-zinc-400 truncate">
								{room.name}
							</p>
						</div>
					</div>

					<nav class="flex flex-col gap-0.5 px-2 flex-1">
						<button
							class="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-100
								{activeSection === 'overview' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
							onclick={() => (activeSection = "overview")}
						>
							<GearSixIcon class="size-4" />
							Overview
						</button>

						<button
							class="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-100
								{activeSection === 'permissions' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
							onclick={() => (activeSection = "permissions")}
						>
							<ShieldIcon class="size-4" />
							Permissions
						</button>

						<div class="mt-auto pt-4 border-t border-zinc-800 mx-1">
							{#if !confirmDelete}
								<button
									class="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium w-full text-red-400 hover:bg-zinc-800/60 hover:text-red-300 transition-colors duration-100"
									onclick={() => (confirmDelete = true)}
								>
									<TrashIcon class="size-4" />
									Delete Channel
								</button>
							{:else}
								<div class="px-3 py-2 text-xs text-zinc-400">
									<p class="mb-2 text-red-400 font-medium">Delete this channel?</p>
									<div class="flex gap-2">
										<button
											class="flex-1 bg-red-600 hover:bg-red-500 text-white rounded px-2 py-1 text-xs transition-colors"
											onclick={() => { onDelete?.(); handleClose(); }}
										>
											Delete
										</button>
										<button
											class="flex-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded px-2 py-1 text-xs transition-colors"
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
				<div class="flex-1 flex flex-col min-w-0 relative">
					<!-- Header -->
					<div class="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
						<h2 class="text-base font-semibold text-white capitalize">
							{activeSection === "overview" ? "Overview" : "Permissions"}
						</h2>
						<button
							class="text-zinc-400 hover:text-white hover:bg-zinc-800 p-1.5 rounded-lg transition-colors duration-150"
							onclick={handleClose}
							aria-label="Close"
						>
							<XIcon class="size-5" />
						</button>
					</div>

					<!-- Scrollable body -->
					<div
						class="flex-1 overflow-y-auto"
						class:pb-14={activeSection === "permissions" && hasChanges}
					>

						{#if activeSection === "overview"}
							<div class="px-6 py-6 max-w-xl space-y-5">
								<div class="space-y-1.5">
									<label for="ch-name" class="block text-xs font-semibold uppercase tracking-wide text-zinc-400">
										Channel Name
									</label>
									<input
										id="ch-name"
										type="text"
										bind:value={editName}
										class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 placeholder:text-zinc-500"
										placeholder="channel-name"
										maxlength="64"
									/>
								</div>

								<div class="space-y-1.5">
									<label for="ch-desc" class="block text-xs font-semibold uppercase tracking-wide text-zinc-400">
										Description
									</label>
									<textarea
										id="ch-desc"
										bind:value={editDescription}
										rows="3"
										class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 placeholder:text-zinc-500 resize-none"
										placeholder="Optional description…"
										maxlength="256"
									></textarea>
								</div>

								{#if overviewError}
									<p class="text-sm text-red-400">{overviewError}</p>
								{/if}

								<div class="flex gap-3 pt-1">
									<button
										class="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
										disabled={overviewSaving || !editName.trim()}
										onclick={saveOverview}
									>
										{overviewSaving ? "Saving…" : "Save Changes"}
									</button>
									<button
										class="bg-zinc-700 hover:bg-zinc-600 text-zinc-100 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
										onclick={() => { editName = room.name; editDescription = room.description ?? ""; overviewError = ""; }}
									>
										Reset
									</button>
								</div>
							</div>

						{:else if activeSection === "permissions"}
							<div class="flex h-full">
								<!-- Roles/Members list -->
								<div class="w-52 shrink-0 border-r border-zinc-800 py-4 flex flex-col">
									<div class="px-3 pb-2 flex items-center justify-between">
										<span class="text-xxs font-bold uppercase tracking-widest text-zinc-500">
											Roles / Members
										</span>
										<div class="relative">
											<button
												class="text-zinc-400 hover:text-white hover:bg-zinc-800 p-1 rounded transition-colors"
												onclick={() => (showAddMenu = !showAddMenu)}
												title="Add overwrite"
											>
												<PlusIcon class="size-3.5" />
											</button>
											{#if showAddMenu}
												<div class="absolute right-0 top-full mt-1 w-48 bg-zinc-800 border border-zinc-700 rounded-lg shadow-2xl py-1 z-10 max-h-48 overflow-y-auto">
													{#if availableRoles.length === 0}
														<p class="px-3 py-2 text-xs text-zinc-500">All roles added</p>
													{:else}
														{#each availableRoles as role (role.id)}
															<button
																class="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700 transition-colors"
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
												class="w-full text-left px-3 py-2 text-sm transition-colors
													{selectedTargetId === ow.target_id
														? 'bg-zinc-700 text-white'
														: 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'}"
												onclick={() => (selectedTargetId = ow.target_id)}
											>
												{getTargetLabel(ow)}
											</button>
										{/each}

										{#if pendingOverwrites.length === 0}
											<p class="px-3 py-3 text-xs text-zinc-500">
												No overwrites yet. Add a role with the + button.
											</p>
										{/if}
									</div>
								</div>

								<!-- Permission toggles -->
								<div class="flex-1 overflow-y-auto py-4 px-6">
									{#if !selectedTargetId || !selectedPending}
										<p class="text-sm text-zinc-500 mt-8 text-center">
											Select a role or member to edit permissions.
										</p>
									{:else}
										<div class="flex items-center justify-between mb-5">
											<h3 class="text-sm font-semibold text-zinc-200">
												{getTargetLabel(selectedPending)}
											</h3>
											<button
												class="text-xs text-red-400 hover:text-red-300 hover:bg-zinc-800 px-2 py-1 rounded transition-colors"
												onclick={removeOverwrite}
											>
												Remove
											</button>
										</div>

										{#each PERMISSION_GROUPS as group (group.label)}
											<div class="mb-6">
												<p class="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-3">
													{group.label}
												</p>
												<div class="space-y-3">
													{#each group.perms as perm (perm.flag)}
														{@const state = getPermState(perm.flag)}
														<div class="flex items-start justify-between gap-4 py-2">
															<div class="flex-1 min-w-0">
																<p class="text-sm font-medium text-zinc-200">{perm.name}</p>
																<p class="text-xs text-zinc-500 mt-0.5">{perm.description}</p>
															</div>
															<div class="flex items-center gap-1 shrink-0">
																<!-- Deny -->
																<button
																	class="size-7 flex items-center justify-center rounded transition-colors
																		{state === -1
																			? 'bg-red-600 text-white'
																			: 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'}"
																	onclick={() => setPermState(perm.flag, state === -1 ? 0 : -1)}
																	title="Deny"
																>
																	<XIcon class="size-3.5" />
																</button>
																<!-- Inherit -->
																<button
																	class="size-7 flex items-center justify-center rounded transition-colors
																		{state === 0
																			? 'bg-zinc-600 text-white'
																			: 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'}"
																	onclick={() => setPermState(perm.flag, 0)}
																	title="Inherit"
																>
																	<MinusIcon class="size-3.5" />
																</button>
																<!-- Allow -->
																<button
																	class="size-7 flex items-center justify-center rounded transition-colors
																		{state === 1
																			? 'bg-green-600 text-white'
																			: 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'}"
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
						{/if}
					</div>

					<!-- Bulk save bar — slides in from bottom when there are unsaved changes -->
					{#if activeSection === "permissions" && hasChanges}
						<div
							transition:fly={{ y: 60, duration: 250, easing: cubicOut }}
							class="absolute bottom-0 left-0 right-0 bg-zinc-800/95 backdrop-blur-sm border-t border-zinc-700 px-6 py-3 flex items-center justify-between"
						>
							<span class="text-sm {saveError ? 'text-red-400' : 'text-zinc-400'}">
								{saveError || "You have unsaved changes"}
							</span>
							<div class="flex items-center gap-2">
								<button
									class="text-sm text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded transition-colors hover:bg-zinc-700 disabled:opacity-50"
									onclick={resetPending}
									disabled={isSaving}
								>
									Reset
								</button>
								<button
									class="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
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
