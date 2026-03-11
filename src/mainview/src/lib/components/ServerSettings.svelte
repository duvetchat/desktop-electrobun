<script lang="ts">
import {
	GripVertical as DotsSixVerticalIcon,
	Shield as ShieldStarIcon,
	Users as UsersThreeIcon,
	Settings as GearSixIcon,
	X as XIcon,
} from "lucide-svelte";
import { Checkbox, Dialog } from "bits-ui";
import { createRole, updateRole, deleteRole } from "$lib/api/roles";
import { currentUser } from "$lib/stores.svelte";
import { Permission } from "$lib/permissions";

import type { GatewaySpace } from "$lib/types";

let {
	space = null,
	spaceId = null,
	open = $bindable(false),
}: {
	space?: GatewaySpace | null;
	spaceId?: string | null;
	open?: boolean;
} = $props();

type Section = "overview" | "members" | "roles";
let activeSection = $state<Section>("roles");

const PERMISSIONS = [
	{ flag: Permission.ViewChannels, name: "View Channels" },
	{ flag: Permission.SendMessages, name: "Send Messages" },
	{ flag: Permission.ManageMessages, name: "Manage Messages" },
	{ flag: Permission.ManageChannels, name: "Manage Channels" },
	{ flag: Permission.ChangeNickname, name: "Change Nickname" },
	{ flag: Permission.JoinVoice, name: "Join Voice" },
	{ flag: Permission.SpeakInVoice, name: "Speak in Voice" },
	{ flag: Permission.ManageRoles, name: "Manage Roles" },
];

// ── color helpers ────────────────────────────────────────────
function intToHex(n: undefined | number | null): string {
	if (n == null) {
		return "#6366f1";
	}
	return `#${(n >>> 0).toString(16).padStart(6, "0")}`;
}
function hexToInt(hex: string): number {
	return parseInt(hex.replace("#", ""), 16);
}
function roleGradientStyle(role: {
	color_from: number | null;
	color_via: number | null;
	color_to: number | null;
}): string {
	if (role.color_from == null) {
		return "background: var(--color-zinc-600)";
	}
	const from = intToHex(role.color_from);
	if (role.color_to == null) {
		return `background: ${from}`;
	}
	const to = intToHex(role.color_to);
	if (role.color_via != null) {
		const via = intToHex(role.color_via);
		return `background: linear-gradient(90deg, ${from}, ${via}, ${to})`;
	}
	return `background: linear-gradient(90deg, ${from}, ${to})`;
}

// ── create state ─────────────────────────────────────────────
let newRoleName = $state("");
let newRolePermissions = $state<number[]>([]);
let newRoleHoisted = $state(false);
let newRoleColorFrom = $state("#6366f1");
let newRoleColorVia = $state("");
let newRoleColorTo = $state("");
let newRoleUseGradient = $state(false);

// ── edit state ───────────────────────────────────────────────
let editingRoleId = $state<string | null>(null);
let editingRoleName = $state("");
let editingRolePermissions = $state(0);
let editingRoleHoisted = $state(false);
let editingRoleColorFrom = $state("#6366f1");
let editingRoleColorVia = $state("");
let editingRoleColorTo = $state("");
let editingRoleUseGradient = $state(false);
let editingRoleClearColors = $state(false);

let isCreating = $state(false);
let isDeleting = $state<Record<string, boolean>>({});
const numberFormatter = new Intl.NumberFormat(
	typeof navigator !== "undefined" ? navigator.language : "en-US",
);

function formatCount(value: number) {
	return numberFormatter.format(value);
}

// ── drag-and-drop ────────────────────────────────────────────
let sortedRoles = $state<any[]>([]);
let isDragging = $state(false);
let dragIndex = $state(-1);
let draggedRole: any = null;

$effect(() => {
	if (space && !isDragging) {
		sortedRoles = [...space.roles].sort((a, b) => b.position - a.position);
	}
});

function onDragStart(i: number) {
	draggedRole = sortedRoles[i];
	dragIndex = i;
	isDragging = true;
}

function onDragOver(e: DragEvent, i: number) {
	e.preventDefault();
	if (dragIndex === i) {
		return;
	}
	const items = [...sortedRoles];
	const [dragged] = items.splice(dragIndex, 1);
	items.splice(i, 0, dragged);
	sortedRoles = items;
	dragIndex = i;
}

async function onDragEnd() {
	isDragging = false;
	const role = draggedRole;
	// index 0 = top of list = highest hierarchy → highest position value
	const newPos = sortedRoles.length - 1 - dragIndex;
	dragIndex = -1;
	draggedRole = null;
	if (!spaceId || !role) {
		return;
	}
	try {
		await updateRole(spaceId, role.id, { position: newPos });
	} catch (err) {
		console.error("Failed to reorder role:", err);
	}
}

const canManageRoles = $derived(checkCanManageRoles());

function checkCanManageRoles(): boolean {
	if (!$currentUser || !space) {
		return false;
	}
	if ($currentUser.id === space.owner_id) {
		return true;
	}
	const member = space.member;
	const userRoleIds = space.member_roles[member?.user_id ?? ""] ?? [];
	let combinedPermissions = 0;
	for (const role of space.roles) {
		if (userRoleIds.includes(role.id)) {
			combinedPermissions |= role.permissions;
		}
	}
	return (
		(combinedPermissions & Permission.ManageRoles) === Permission.ManageRoles
	);
}

function permissionsToFlags(permissions: number[]): number {
	return permissions.reduce((acc, perm) => acc | perm, 0);
}

function getPermissionNames(flags: number): string {
	const perms = PERMISSIONS.filter((p) => (flags & p.flag) === p.flag).map(
		(p) => p.name,
	);
	return perms.length > 0 ? perms.join(", ") : "No permissions assigned";
}

function togglePermission(flag: number, isEdit = false) {
	if (isEdit) {
		editingRolePermissions =
			(editingRolePermissions & flag) === flag
				? editingRolePermissions & ~flag
				: editingRolePermissions | flag;
	} else if (newRolePermissions.includes(flag)) {
		newRolePermissions = newRolePermissions.filter((p) => p !== flag);
	} else {
		newRolePermissions = [...newRolePermissions, flag];
	}
}

async function handleCreateRole() {
	if (!newRoleName.trim() || !spaceId) {
		return;
	}
	isCreating = true;
	try {
		await createRole(spaceId, {
			name: newRoleName.trim(),
			permissions: permissionsToFlags(newRolePermissions),
			hoisted: newRoleHoisted,
			color_from: hexToInt(newRoleColorFrom),
			color_via:
				newRoleUseGradient && newRoleColorVia
					? hexToInt(newRoleColorVia)
					: null,
			color_to:
				newRoleUseGradient && newRoleColorTo ? hexToInt(newRoleColorTo) : null,
		});
		newRoleName = "";
		newRolePermissions = [];
		newRoleHoisted = false;
		newRoleColorFrom = "#6366f1";
		newRoleColorVia = "";
		newRoleColorTo = "";
		newRoleUseGradient = false;
	} catch (err) {
		console.error("Failed to create role:", err);
		alert(`Error: ${err}`);
	} finally {
		isCreating = false;
	}
}

async function handleUpdateRole() {
	if (!editingRoleName.trim() || !editingRoleId || !spaceId) {
		return;
	}
	isCreating = true;
	try {
		await updateRole(spaceId, editingRoleId, {
			name: editingRoleName.trim(),
			permissions: editingRolePermissions,
			hoisted: editingRoleHoisted,
			color_from: editingRoleClearColors
				? null
				: hexToInt(editingRoleColorFrom),
			color_via: editingRoleClearColors
				? null
				: editingRoleUseGradient && editingRoleColorVia
					? hexToInt(editingRoleColorVia)
					: null,
			color_to: editingRoleClearColors
				? null
				: editingRoleUseGradient && editingRoleColorTo
					? hexToInt(editingRoleColorTo)
					: null,
			clear_colors: true,
		});
		editingRoleId = null;
	} catch (err) {
		console.error("Failed to update role:", err);
		alert(`Error: ${err}`);
	} finally {
		isCreating = false;
	}
}

async function handleDeleteRole(roleId: string) {
	const roleName =
		sortedRoles.find((role) => role.id === roleId)?.name ?? "this role";
	if (
		!spaceId ||
		!confirm(`Delete \"${roleName}\"? This can't be undone.`)
	) {
		return;
	}
	isDeleting = { ...isDeleting, [roleId]: true };
	try {
		await deleteRole(spaceId, roleId);
		if (editingRoleId === roleId) {
			editingRoleId = null;
		}
	} catch (err) {
		console.error("Failed to delete role:", err);
		alert(`Error: ${err}`);
	} finally {
		isDeleting = { ...isDeleting, [roleId]: false };
	}
}

function startEdit(role: any) {
	editingRoleId = role.id;
	editingRoleName = role.name;
	editingRolePermissions = role.permissions;
	editingRoleHoisted = role.hoisted ?? false;
	editingRoleColorFrom = intToHex(role.color_from);
	editingRoleColorVia = role.color_via != null ? intToHex(role.color_via) : "";
	editingRoleColorTo = role.color_to != null ? intToHex(role.color_to) : "";
	editingRoleUseGradient = role.color_to != null;
	editingRoleClearColors = role.color_from == null;
}

function cancelEdit() {
	editingRoleId = null;
	editingRoleName = "";
	editingRolePermissions = 0;
	editingRoleHoisted = false;
	editingRoleColorFrom = "#6366f1";
	editingRoleColorVia = "";
	editingRoleColorTo = "";
	editingRoleUseGradient = false;
	editingRoleClearColors = false;
}

function close() {
	open = false;
	cancelEdit();
}
</script>

<Dialog.Root bind:open>
    <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
        <Dialog.Content class="fixed z-51 inset-0 flex items-center justify-center p-4">
            <div class="w-full max-w-4xl max-h-[85vh] h-[85vh] bg-zinc-900 rounded-xl shadow-2xl flex overflow-hidden border border-zinc-700 text-zinc-100">
            <!-- Left sidebar -->
            <aside
                class="w-56 shrink-0 bg-zinc-950 flex flex-col py-6 border-r border-zinc-800"
            >
                <div class="px-4 mb-4">
                    <p
                        class="text-[10px] font-bold tracking-widest uppercase text-zinc-400 px-2 mb-1"
                    >
                        {space?.name ?? "Server"} Settings
                    </p>
                </div>

                <nav class="flex flex-col gap-0.5 px-2">
                    <button
                        class="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-100
                            {activeSection === 'overview'
                            ? 'bg-zinc-800 text-white'
                            : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
                        onclick={() => (activeSection = "overview")}
                    >
                        <GearSixIcon
                            class="size-4"
                        />
                        Overview
                    </button>

                    <button
                        class="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-100
                            {activeSection === 'roles'
                            ? 'bg-zinc-800 text-white'
                            : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
                        onclick={() => (activeSection = "roles")}
                    >
                        <ShieldStarIcon
                            class="size-4"
                        />
                        Roles
                    </button>

                    <button
                        class="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-100
                            {activeSection === 'members'
                            ? 'bg-zinc-800 text-white'
                            : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
                        onclick={() => (activeSection = "members")}
                    >
                        <UsersThreeIcon
                            class="size-4"
                        />
                        Members
                    </button>
                </nav>
            </aside>

            <!-- Content area -->
            <div class="flex-1 flex flex-col min-w-0">
                <!-- Header -->
                <div
                    class="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0"
                >
                    <h2 class="text-base font-semibold text-white capitalize">
                        {activeSection === "overview"
                            ? "Overview"
                            : activeSection === "roles"
                              ? "Roles"
                              : "Members"}
                    </h2>
                    <Dialog.Close
                        class="text-zinc-400 hover:text-white hover:bg-zinc-800 p-1.5 rounded-lg transition-colors duration-150"
                        aria-label="Close"
                    >
                        <XIcon class="size-5" />
                    </Dialog.Close>
                </div>

                <!-- Scrollable content -->
                <div class="flex-1 overflow-y-auto p-6 space-y-5">
                    {#if activeSection === "overview"}
                        <div class="text-zinc-300 text-sm">
                            <p class="text-white font-medium text-base mb-1">
                                {space?.name}
                            </p>
                            <p class="text-zinc-400 text-xs">
                                Server ID: {spaceId}
                            </p>
                        </div>
                    {:else if activeSection === "roles"}
                        {#if canManageRoles && space}
                            <!-- Create new role -->
							<div class="space-y-4 rounded-xl border border-zinc-700 bg-zinc-900 p-5">
								<div class="space-y-1">
									<h3 class="text-sm font-semibold tracking-wide text-white">
										Create New Role
									</h3>
									<p class="text-xs text-zinc-400">
										Set role identity, color, and permissions.
									</p>
								</div>

                                <!-- Name -->
                                <label class="space-y-1.5 block">
									<span class="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">Role name</span>
                                <input
                                    type="text"
                                    placeholder="Role name"
                                    bind:value={newRoleName}
									class="h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-stone-500"
                                />
								</label>

                                <!-- Color -->
                                <div class="space-y-2 rounded-lg border border-zinc-800 bg-zinc-800/40 p-3">
                                    <div
                                        class="flex items-center justify-between"
                                    >
									<span
										class="text-xs font-medium text-zinc-400"
										>Color</span
									>
									<label
										class="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer"
									>
                                            <input
                                                type="checkbox"
                                                bind:checked={
                                                    newRoleUseGradient
                                                }
                                                class="accent-stone-500 cursor-pointer"
                                            />
                                            Gradient
                                        </label>
                                    </div>
									<div class="flex flex-wrap items-center gap-3">
                                        <div class="flex items-center gap-1.5">
                                            <input
                                                type="color"
                                                bind:value={newRoleColorFrom}
                                                class="color-swatch cursor-pointer"
                                                title="Color from"
                                            />
                                            <span
												class="text-[10px] text-zinc-500"
                                                >From</span
                                            >
                                        </div>
                                        {#if newRoleUseGradient}
                                            <div
                                                class="flex items-center gap-1.5"
                                            >
                                                <input
                                                    type="color"
                                                    bind:value={newRoleColorVia}
                                                    class="color-swatch cursor-pointer"
                                                    title="Color via (middle)"
                                                />
                                                <span
													class="text-[10px] text-zinc-500"
                                                    >Via</span
                                                >
                                            </div>
                                            <div
                                                class="flex items-center gap-1.5"
                                            >
                                                <input
                                                    type="color"
                                                    bind:value={newRoleColorTo}
                                                    class="color-swatch cursor-pointer"
                                                    title="Color to"
                                                />
                                                <span
													class="text-[10px] text-zinc-500"
                                                    >To</span
                                                >
                                            </div>
                                        {/if}
                                        <!-- Preview swatch -->
										<div
											class="ml-auto h-7 w-16 rounded-md border border-zinc-700"
											style={roleGradientStyle({
                                                color_from:
                                                    hexToInt(newRoleColorFrom),
                                                color_via:
                                                    newRoleUseGradient &&
                                                    newRoleColorVia
                                                        ? hexToInt(
                                                              newRoleColorVia,
                                                          )
                                                        : null,
                                                color_to:
                                                    newRoleUseGradient &&
                                                    newRoleColorTo
                                                        ? hexToInt(
                                                              newRoleColorTo,
                                                          )
                                                        : null,
                                            })}
                                        ></div>
                                    </div>
                                </div>

                                <!-- Hoisted -->
                                <label class="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-800/40 px-2.5 py-2 cursor-pointer text-xs text-zinc-200 hover:text-white">
                                    <Checkbox.Root bind:checked={newRoleHoisted} class="size-4 rounded border border-zinc-600 bg-zinc-900 data-[state=checked]:bg-stone-600 data-[state=checked]:border-stone-600 flex items-center justify-center text-white text-[10px]">✓</Checkbox.Root>
                                    Display role members separately in sidebar
                                </label>

                                <!-- Permissions -->
                                <div>
									<p
										class="text-xs font-medium text-zinc-400 mb-1.5"
									>
                                        Permissions
                                    </p>
									<div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
										{#each PERMISSIONS as perm}
											<label class="flex h-9 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-800/70 px-2.5 cursor-pointer text-xs text-zinc-200 hover:text-white">
                                                <Checkbox.Root checked={newRolePermissions.includes(perm.flag)} onCheckedChange={() => {
                                                    togglePermission(perm.flag, false);
                                                }} class="size-4 rounded border border-zinc-600 bg-zinc-900 data-[state=checked]:bg-stone-600 data-[state=checked]:border-stone-600 flex items-center justify-center text-white text-[10px]">✓</Checkbox.Root>
                                                {perm.name}
                                            </label>
                                        {/each}
                                    </div>
                                </div>

                                <button
                                    class="h-10 w-full rounded-md bg-stone-600 px-3 text-sm font-medium text-white transition-colors hover:bg-stone-500 disabled:opacity-50"
                                    onclick={handleCreateRole}
                                    disabled={isCreating || !newRoleName.trim()}
                                >
                                    {isCreating ? "Creating…" : "Create Role"}
                                </button>
                            </div>

                            <!-- Existing roles -->
							<div class="space-y-2">
								<h3 class="text-sm font-semibold text-white">
									Existing Roles
								</h3>
								<p class="text-xs text-zinc-400">
									Drag to reorder. Edit or delete using actions on the right.
								</p>
								{#each sortedRoles as role, i}
									<div
										class="overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 transition-opacity duration-100"
                                        class:opacity-40={isDragging &&
                                            dragIndex !== i}
                                        class:ring-2={isDragging &&
                                            dragIndex === i}
                                        class:ring-stone-500={isDragging &&
                                            dragIndex === i}
                                        draggable={editingRoleId !== role.id}
                                        ondragstart={() => {
                                            onDragStart(i);
                                        }}
                                        ondragover={(e) => {
                                            onDragOver(e, i);
                                        }}
										ondragend={onDragEnd}
										role="listitem"
									>
                                        <!-- Color strip -->
                                        <div
                                            class="h-1 w-full"
                                            style={roleGradientStyle(role)}
                                        ></div>
                                        <div class="p-3">
                                            {#if editingRoleId === role.id}
                                                <div class="space-y-3">
                                                    <input
                                                        type="text"
                                                        bind:value={
                                                            editingRoleName
                                                        }
                                                        placeholder="Role name"
                                                        class="w-full bg-zinc-900 text-zinc-100 outline-none p-2 rounded-md focus:ring-1 focus:ring-stone-500 text-sm border border-zinc-700"
                                                    />

                                                    <!-- Color -->
                                                    <div class="space-y-1.5">
                                                        <div
                                                            class="flex items-center justify-between"
                                                        >
                                                            <span
															class="text-xs font-medium text-zinc-400"
															>Color</span
														>
                                                            <div
                                                                class="flex items-center gap-2"
                                                            >
                                                                <button
                                                                    type="button"
                                                                    onclick={() => {
                                                                        editingRoleClearColors =
                                                                            !editingRoleClearColors;
                                                                    }}
                                                                    class="text-[10px] px-1.5 py-0.5 rounded transition-colors {editingRoleClearColors
                                                                        ? 'bg-red-500 text-white'
									: 'bg-zinc-700 text-zinc-300 hover:text-zinc-100'}"
															>Clear color</button
														>
                                                                {#if !editingRoleClearColors}
                                                                    <label
															class="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer"
														>
                                                                        <input
                                                                            type="checkbox"
                                                                            bind:checked={
                                                                                editingRoleUseGradient
                                                                            }
                                                                            class="accent-stone-500 cursor-pointer"
                                                                        />
                                                                        Gradient
                                                                    </label>
                                                                {/if}
                                                            </div>
                                                        </div>
                                                        {#if !editingRoleClearColors}
                                                            <div
                                                                class="flex items-center gap-2 flex-wrap"
                                                            >
                                                                <div
                                                                    class="flex items-center gap-1.5"
                                                                >
                                                                    <input
                                                                        type="color"
                                                                        bind:value={
                                                                            editingRoleColorFrom
                                                                        }
                                                                        class="color-swatch cursor-pointer"
                                                                        title="Color from"
                                                                    />
                                                                    <span
																class="text-[10px] text-zinc-500"
                                                                        >From</span
                                                                    >
                                                                </div>
                                                                {#if editingRoleUseGradient}
                                                                    <div
                                                                        class="flex items-center gap-1.5"
                                                                    >
                                                                        <input
                                                                            type="color"
                                                                            bind:value={
                                                                                editingRoleColorVia
                                                                            }
                                                                            class="color-swatch cursor-pointer"
                                                                            title="Via"
                                                                        />
                                                                        <span
																	class="text-[10px] text-zinc-500"
                                                                            >Via</span
                                                                        >
                                                                    </div>
                                                                    <div
                                                                        class="flex items-center gap-1.5"
                                                                    >
                                                                        <input
                                                                            type="color"
                                                                            bind:value={
                                                                                editingRoleColorTo
                                                                            }
                                                                            class="color-swatch cursor-pointer"
                                                                            title="To"
                                                                        />
                                                                        <span
																	class="text-[10px] text-zinc-500"
                                                                            >To</span
                                                                        >
                                                                    </div>
                                                                {/if}
                                                                <div
                                                                    class="ml-auto h-5 w-12 rounded-full"
                                                                    style={roleGradientStyle(
                                                                        {
                                                                            color_from:
                                                                                hexToInt(
                                                                                    editingRoleColorFrom,
                                                                                ),
                                                                            color_via:
                                                                                editingRoleUseGradient &&
                                                                                editingRoleColorVia
                                                                                    ? hexToInt(
                                                                                          editingRoleColorVia,
                                                                                      )
                                                                                    : null,
                                                                            color_to:
                                                                                editingRoleUseGradient &&
                                                                                editingRoleColorTo
                                                                                    ? hexToInt(
                                                                                          editingRoleColorTo,
                                                                                      )
                                                                                    : null,
                                                                        },
                                                                    )}
                                                                ></div>
                                                            </div>
                                                        {/if}
                                                    </div>

                                                    <!-- Hoisted -->
                                                    <label class="flex items-center gap-2 cursor-pointer text-xs text-zinc-200 hover:text-white">
                                                        <Checkbox.Root bind:checked={editingRoleHoisted} class="size-4 rounded border border-zinc-600 bg-zinc-900 data-[state=checked]:bg-stone-600 data-[state=checked]:border-stone-600 flex items-center justify-center text-white text-[10px]">✓</Checkbox.Root>
                                                        Display role members separately
                                                        in sidebar
                                                    </label>

                                                    <!-- Permissions -->
                                                    <div>
                                                        <p
															class="text-xs font-medium text-zinc-400 mb-1.5"
														>
                                                            Permissions
                                                        </p>
                                                        <div
                                                            class="grid grid-cols-2 gap-1.5"
                                                        >
                                                            {#each PERMISSIONS as perm}
                                                                <label class="flex items-center gap-2 cursor-pointer text-xs text-zinc-200 hover:text-white">
                                                                    <Checkbox.Root checked={(editingRolePermissions & perm.flag) === perm.flag} onCheckedChange={() => {
                                                                        togglePermission(perm.flag, true);
                                                                    }} class="size-4 rounded border border-zinc-600 bg-zinc-900 data-[state=checked]:bg-stone-600 data-[state=checked]:border-stone-600 flex items-center justify-center text-white text-[10px]">✓</Checkbox.Root>
                                                                    {perm.name}
                                                                </label>
                                                            {/each}
                                                        </div>
                                                    </div>

                                                    <div class="flex gap-2">
                                                        <button
                                                            class="flex-1 px-2 py-1.5 bg-stone-600 hover:bg-stone-500 text-white rounded-md transition-colors disabled:opacity-50 text-xs font-medium"
                                                            onclick={handleUpdateRole}
                                                            disabled={isCreating}
                                                            >Save</button
                                                        >
                                                        <button
                                                            class="flex-1 px-2 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white rounded-md transition-colors text-xs"
                                                            onclick={cancelEdit}
                                                            >Cancel</button
                                                        >
                                                    </div>
                                                </div>
                                            {:else}
                                                <div
                                                    class="flex items-center gap-2"
                                                >
                                                    <DotsSixVerticalIcon
                                                        class="size-4 text-zinc-500 cursor-grab active:cursor-grabbing shrink-0"
                                                    />
                                                    <div class="flex-1 min-w-0">
                                                        <div
                                                            class="flex items-center gap-2 mb-0.5"
                                                        >
                                                            <span
															class="text-sm text-zinc-200 font-medium"
                                                                >{role.name}</span
                                                            >
                                                            {#if role.hoisted}
                                                                <span
                                                                    class="text-[10px] bg-zinc-700 text-zinc-300 px-1.5 py-0.5 rounded"
                                                                    >hoisted</span
                                                                >
                                                            {/if}
                                                        </div>
                                                        <p
															class="text-xs text-zinc-500 truncate"
                                                        >
                                                            {getPermissionNames(
                                                                role.permissions,
                                                            )}
                                                        </p>
                                                    </div>
                                                    <div class="ml-1 flex shrink-0 gap-1.5">
                                                        <button
                                                            class="h-7 rounded-md bg-zinc-700 px-2.5 text-xs text-zinc-100 transition-colors hover:bg-zinc-600"
                                                            onclick={() => {
                                                                startEdit(role);
                                                            }}>Edit</button
                                                        >
                                                        <button
                                                            class="h-7 rounded-md bg-red-800/70 px-2.5 text-xs text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                                                            onclick={() =>
                                                                handleDeleteRole(
                                                                    role.id,
                                                                )}
                                                            disabled={isDeleting[
                                                                role.id
                                                            ]}
                                                            >{isDeleting[
                                                                role.id
                                                            ]
                                                                ? "…"
                                                                : "Delete"}</button
                                                        >
                                                    </div>
                                                </div>
                                            {/if}
                                        </div>
                                    </div>
                                {/each}
                                {#if space.roles.length === 0}
                                    <p
                                        class="text-zinc-400 text-sm text-center py-4"
                                    >
										No roles yet. Create one to start assigning permissions.
                                    </p>
                                {/if}
                            </div>
                        {:else}
                            <p class="text-zinc-400 text-sm">
                                You don't have permission to manage roles.
                            </p>
                        {/if}
                    {:else if activeSection === "members"}
                        {#if space}
                            <div class="space-y-2">
                                <h3 class="text-sm font-semibold text-white">
                                    Members ({formatCount(space.members?.length ?? 0)})
                                </h3>
                                {#each space.members ?? [] as member}
                                    {@const user = space.users.find(
                                        (u) => u.id === member.user_id,
                                    )}
                                    <div
                                        class="flex items-center gap-3 bg-zinc-800 rounded-lg px-3 py-2.5 border border-zinc-700"
                                    >
                                        {#if user?.avatar}
                                            <img
                                                src={user.avatar}
                                                alt={user.username}
                                                class="w-8 h-8 rounded-full"
                                            />
                                        {:else}
                                            <div
                                                class="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-300"
                                            >
                                                {user?.username
                                                    ?.at(0)
                                                    ?.toUpperCase() ?? "?"}
                                            </div>
                                        {/if}
                                        <div class="flex-1 min-w-0">
                                            <p
														class="text-sm text-zinc-200 font-medium truncate"
                                            >
                                                {member.alias ??
                                                    user?.username ??
													"Unknown member"}
                                            </p>
                                            <p
                                                class="text-xs text-zinc-400 truncate"
                                            >
                                                {(
                                                    space.member_roles[
                                                        member.user_id
                                                    ] ?? []
                                                )
                                                    .map(
                                                        (rid) =>
                                                            space.roles.find(
                                                                (r) =>
                                                                    r.id ===
                                                                    rid,
                                                            )?.name,
                                                    )
                                                    .filter(Boolean)
													.join(", ") || "No roles assigned"}
                                            </p>
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    {/if}
                </div>
            </div>
        </div>
        </Dialog.Content>
    </Dialog.Portal>
</Dialog.Root>

<style>
    :global(.z-51) {
        z-index: 51;
    }

    .color-swatch {
        width: 28px;
        height: 28px;
        border-radius: 6px;
        border: 2px solid var(--color-zinc-600);
        padding: 0;
        background: none;
    }
    .color-swatch::-webkit-color-swatch-wrapper {
        padding: 0;
    }
    .color-swatch::-webkit-color-swatch {
        border: none;
        border-radius: 4px;
    }

    ::-webkit-scrollbar {
        width: 5px;
    }
    ::-webkit-scrollbar-track {
        background: transparent;
    }
    ::-webkit-scrollbar-thumb {
        background: var(--color-zinc-600);
        border-radius: 3px;
    }
    ::-webkit-scrollbar-thumb:hover {
        background: var(--color-zinc-500);
    }
</style>
