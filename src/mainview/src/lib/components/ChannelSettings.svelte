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
	import { slide } from "svelte/transition";
	import { untrack } from "svelte";
	import { Permission, canSetPermission, computeRoomPermissions, hasSpacePermission } from "$lib/permissions";
	import { getApiError } from "$lib/api/api";
	import { updateRoom, upsertRoomOverwrite, deleteRoomOverwrite } from "$lib/api/rooms";
	import Webhooks from "$lib/components/Webhooks.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import IconButton from "$lib/components/ui/IconButton.svelte";
	import SettingsFrame from "$lib/components/settings/SettingsFrame.svelte";
	import SettingsGroup from "$lib/components/settings/SettingsGroup.svelte";
	import { CARD, FIELD, FIELD_AREA, GROUP_TITLE, LABEL, type SettingsNavGroup } from "$lib/components/settings/recipes";
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

	// Closed, the settings come back on Overview next time.
	$effect(() => {
		if (!open) {
			activeSection = "overview";
			confirmDelete = false;
		}
	});

	// A room's sections: Permissions for rooms (not categories), Webhooks for text rooms whose webhooks the user manages.
	const sectionGroups = $derived<SettingsNavGroup<Section>[]>([
		{
			items: [
				{ id: "overview", label: "Overview", icon: GearSixIcon, tile: "#5e6380" },
				...(room.type !== 3
					? [{ id: "permissions" as const, label: "Permissions", icon: ShieldIcon, tile: "#7c5cff" }]
					: []),
				...(room.type === 1 && canManageWebhooks
					? [{ id: "webhooks" as const, label: "Webhooks", icon: WebhookIcon, tile: "#e44fcb" }]
					: []),
			],
		},
	]);
	const kind = $derived(room.type === 3 ? "category" : "room");
</script>

<!-- One of a permission's three states: Deny, Inherit or Allow. -->
{#snippet stateButton(
	on: boolean,
	tone: string,
	title: string,
	disabled: boolean,
	press: () => void,
	icon: typeof XIcon,
)}
	{@const Icon = icon}
	<button
		type="button"
		class="relative z-1 flex h-7 w-9 items-center justify-center rounded-lg transition-colors duration-[120ms] motion-reduce:transition-none {on
			? `bg-duvet-seg-thumb shadow-duvet-control ${tone}`
			: 'text-duvet-ink2 hover:text-duvet-ink'} {disabled ? 'cursor-not-allowed opacity-40' : ''}"
		aria-pressed={on}
		aria-label={title}
		{title}
		{disabled}
		onclick={press}
	>
		<Icon class="size-3.5" />
	</button>
{/snippet}

<SettingsFrame
	mode="sheet"
	bind:open
	name="{room.type === 3 ? '' : '#'}{room.name} · {room.type === 3 ? 'Category' : 'Room'} settings"
	groups={sectionGroups}
	bind:active={activeSection}
	wide={activeSection === "permissions"}
>
	{#snippet head()}
		<div class="flex shrink-0 items-center gap-2.5 p-2">
			<span
				class="bg-duvet-secondary-fill text-duvet-accent-text grid size-[34px] shrink-0 place-items-center rounded-[10px]"
			>
				{#if room.type === 3}
					<GearSixIcon class="size-4" />
				{:else if room.type === 1}
					<HashIcon class="size-4" />
				{:else}
					<SpeakerIcon class="size-4" />
				{/if}
			</span>
			<span class="min-w-0 flex-1">
				<span class="font-serif-sm block truncate text-[15px] font-medium">{room.name}</span>
				<span class="text-duvet-ink2 block truncate text-[11.5px]">
					{room.type === 3 ? "Category settings" : "Room settings"}
				</span>
			</span>
		</div>
	{/snippet}

	{#snippet foot()}
		{#if !confirmDelete}
			<button
				type="button"
				class="text-duvet-danger hover:bg-duvet-danger/10 flex h-8 w-full items-center gap-[9px] rounded-[9px] px-2 text-left text-[13px] font-medium transition-colors duration-[120ms] motion-reduce:transition-none"
				onclick={() => (confirmDelete = true)}
			>
				<span class="grid size-[22px] shrink-0 place-items-center"><TrashIcon class="size-[15px]" /></span>
				Delete {kind}
			</button>
		{:else}
			<div class="px-2 py-1 text-xs">
				<p class="text-duvet-danger mb-2 font-medium">Delete this {kind}?</p>
				<div class="flex gap-2">
					<Button
						variant="danger"
						size="sm"
						class="flex-1"
						onclick={() => {
							onDelete?.();
							handleClose();
						}}
					>
						Delete
					</Button>
					<Button variant="secondary" size="sm" class="flex-1" onclick={() => (confirmDelete = false)}>Cancel</Button>
				</div>
			</div>
		{/if}
	{/snippet}

	{#snippet bars()}
		<!-- Bulk save bar: slides in when there are unsaved changes -->
		{#if activeSection === "permissions" && hasChanges}
			<div
				transition:slide={{ duration: 200 }}
				class="bg-duvet-card shadow-duvet-lifted mx-[26px] mb-3 flex items-center justify-between gap-4 rounded-2xl py-2.5 pr-2.5 pl-4 text-[13px] font-medium"
			>
				<span class={saveError ? "text-duvet-danger" : "text-duvet-ink2"} role={saveError ? "alert" : undefined}>
					{saveError || "You have unsaved changes"}
				</span>
				<div class="flex items-center gap-2">
					<Button variant="quiet" onclick={resetPending} disabled={isSaving}>Reset</Button>
					<Button onclick={saveAll} disabled={isSaving}>{isSaving ? "Saving…" : "Save changes"}</Button>
				</div>
			</div>
		{/if}
	{/snippet}

	{#if activeSection === "overview"}
		<SettingsGroup title="About" plain class="flex flex-col gap-4">
			<div>
				<label for="ch-name" class={LABEL}>{room.type === 3 ? "Category name" : "Room name"}</label>
				<input
					id="ch-name"
					type="text"
					bind:value={editName}
					class={FIELD}
					placeholder={room.type === 3 ? "category-name" : "room-name"}
					maxlength="64"
				/>
			</div>

			{#if room.type !== 3}
				<div>
					<label for="ch-desc" class={LABEL}>Description</label>
					<textarea
						id="ch-desc"
						bind:value={editDescription}
						rows="3"
						class={FIELD_AREA}
						placeholder="Optional description…"
						maxlength="256"
					></textarea>
				</div>
			{/if}

			{#if overviewError}
				<p class="text-duvet-danger text-[13px]" role="alert">{overviewError}</p>
			{/if}

			<div class="flex gap-2 pt-1">
				<Button disabled={overviewSaving || !editName.trim()} onclick={saveOverview}>
					{overviewSaving ? "Saving…" : "Save changes"}
				</Button>
				<Button
					variant="secondary"
					onclick={() => {
						editName = room.name;
						editDescription = room.description ?? "";
						overviewError = "";
					}}
				>
					Reset
				</Button>
			</div>
		</SettingsGroup>
	{:else if activeSection === "permissions"}
		<div class="grid grid-cols-[200px_minmax(0,1fr)] items-start gap-5">
			<!-- Roles/Members list -->
			<div class="flex flex-col gap-2">
				<div class="flex items-center justify-between">
					<span class={GROUP_TITLE}>Roles / Members</span>
					<div class="relative">
						<IconButton
							label="Add overwrite"
							title="Add overwrite"
							size="sm"
							aria-expanded={showAddMenu}
							onclick={() => (showAddMenu = !showAddMenu)}
						>
							<PlusIcon class="size-3.5" />
						</IconButton>
						{#if showAddMenu}
							<div
								class="bg-duvet-glass shadow-duvet-glass animate-float-in absolute top-full right-0 z-10 mt-1 max-h-48 w-48 overflow-y-auto rounded-[14px] p-1.5 backdrop-blur-[32px]"
							>
								{#if availableRoles.length === 0}
									<p class="text-duvet-ink2 px-2 py-1.5 text-xs">All roles added</p>
								{:else}
									{#each availableRoles as role (role.id)}
										<button
											class="hover:bg-duvet-accent-tint w-full rounded-[9px] px-2 py-1.5 text-left text-[13px] font-medium transition-colors"
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

				<div class="flex flex-col gap-px">
					{#each pendingOverwrites as ow (ow.target_id)}
						<button
							class="h-[34px] w-full truncate rounded-[10px] px-2.5 text-left text-[13px] font-medium transition-colors motion-reduce:transition-none {selectedTargetId ===
							ow.target_id
								? 'bg-duvet-accent-tint'
								: 'hover:bg-duvet-hover'}"
							aria-pressed={selectedTargetId === ow.target_id}
							onclick={() => (selectedTargetId = ow.target_id)}
						>
							{getTargetLabel(ow)}
						</button>
					{/each}

					{#if pendingOverwrites.length === 0}
						<p class="text-duvet-ink2 px-1.5 py-2 text-xs">No overwrites yet. Add a role with the + button.</p>
					{/if}
				</div>
			</div>

			<!-- Permission toggles -->
			<div class="flex min-w-0 flex-col gap-4">
				{#if !selectedTargetId || !selectedPending}
					<p class="text-duvet-ink2 mt-8 text-center text-sm">Select a role or member to edit permissions.</p>
				{:else}
					<div class="flex items-center justify-between gap-3">
						<h3 class="min-w-0 truncate font-serif text-lg font-medium">{getTargetLabel(selectedPending)}</h3>
						<Button
							variant="quiet"
							size="sm"
							class="text-duvet-danger! hover:bg-duvet-danger/15!"
							onclick={removeOverwrite}
						>
							Remove
						</Button>
					</div>

					{#each PERMISSION_GROUPS as group (group.label)}
						<section class="flex flex-col gap-2">
							<h4 class={GROUP_TITLE}>{group.label}</h4>
							<div class="{CARD} divide-duvet-line divide-y">
								{#each group.perms as perm (perm.flag)}
									{@const state = getPermState(perm.flag)}
									{@const canDeny =
										state === -1 || canSetPermission(roomGranted, selectedSaved?.deny_flags ?? 0, perm.flag)}
									{@const canAllow =
										state === 1 || canSetPermission(roomGranted, selectedSaved?.allow_flags ?? 0, perm.flag)}
									<div class="flex min-h-[50px] items-center justify-between gap-4 px-3.5 py-2">
										<div class="min-w-0 flex-1">
											<p class="text-[13.5px] leading-[1.3] font-medium">{perm.name}</p>
											<p class="text-duvet-ink2 mt-0.5 text-xs">{perm.description}</p>
										</div>
										<div class="bg-duvet-seg-track flex shrink-0 items-center rounded-[11px] p-[3px]" role="group">
											{@render stateButton(
												state === -1,
												"text-duvet-danger",
												canDeny ? "Deny" : "You can only deny permissions you have in this room",
												!canDeny,
												() => setPermState(perm.flag, state === -1 ? 0 : -1),
												XIcon,
											)}
											{@render stateButton(
												state === 0,
												"text-duvet-ink",
												"Inherit",
												false,
												() => setPermState(perm.flag, 0),
												MinusIcon,
											)}
											{@render stateButton(
												state === 1,
												"text-duvet-alive",
												canAllow ? "Allow" : "You can only allow permissions you have in this room",
												!canAllow,
												() => setPermState(perm.flag, state === 1 ? 0 : 1),
												CheckIcon,
											)}
										</div>
									</div>
								{/each}
							</div>
						</section>
					{/each}
				{/if}
			</div>
		</div>
	{:else if activeSection === "webhooks"}
		<Webhooks {space} rooms={[room]} />
	{/if}
</SettingsFrame>
