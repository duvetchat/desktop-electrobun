<script lang="ts">
import { toast } from "$lib/stores/toast.svelte";
import { confirmAction } from "$lib/stores/confirm.svelte";
import {
	GripVertical as DotsSixVerticalIcon,
	Shield as ShieldStarIcon,
	Users as UsersThreeIcon,
	Settings as GearSixIcon,
	Smile as SmileIcon,
	Database as DatabaseIcon,
	X as XIcon,
	Pencil as PencilIcon,
	Trash2 as TrashIcon,
	Upload as UploadIcon,
	Check as CheckIcon,
	Plus as PlusIcon,
} from "@lucide/svelte";
import { Checkbox, Dialog } from "bits-ui";
import { createRole, updateRole, deleteRole } from "$lib/api/roles";
import { listEmojis, createEmoji, updateEmoji, deleteEmoji } from "$lib/api/emojis";
import { getSpaceBuckets, createSpaceBucket, updateSpaceBucket, deleteSpaceBucket, activateSpaceBucket, deactivateSpaceBucket } from "$lib/api/space-buckets";
import { currentUser } from "$lib/stores.svelte";
import { Permission, ALL_PERMISSIONS } from "$lib/permissions";
import UserAvatar from "$lib/components/UserAvatar.svelte";

import type { GatewaySpace, SpaceEmoji } from "$lib/types";
import type { StorageBucket, CreateBucketPayload } from "$lib/api/user";
import { getHostURL } from "$lib/common/common";

const attachmentHost = getHostURL();

let {
	space = null,
	spaceId = null,
	open = $bindable(false),
}: {
	space?: GatewaySpace | null;
	spaceId?: string | null;
	open?: boolean;
} = $props();

type Section = "overview" | "members" | "roles" | "emojis" | "storage";
let activeSection = $state<Section>("roles");

const PERMISSIONS = ALL_PERMISSIONS;

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
let selectedMemberUserId = $state<string | null>(null);

// ── emoji state ─────────────────────────────────────────────
let spaceEmojis = $state<SpaceEmoji[]>([]);
let emojisLoading = $state(false);
let newEmojiName = $state("");
let newEmojiFile = $state<File | null>(null);
let isUploadingEmoji = $state(false);
let editingEmojiId = $state<string | null>(null);
let editingEmojiName = $state("");
let isDeletingEmoji = $state<Record<string, boolean>>({});

// ── space bucket state ──────────────────────────────────────
let spaceBuckets = $state<StorageBucket[]>([]);
let spaceBucketsLoading = $state(false);
let spaceBucketsError = $state<string | null>(null);
let showSpaceBucketForm = $state(false);
let editingSpaceBucket = $state<StorageBucket | null>(null);
let spaceBucketSaving = $state(false);
let sbName = $state(""); let sbEndpoint = $state(""); let sbRegion = $state("auto");
let sbBucketName = $state(""); let sbAccessKey = $state(""); let sbSecretKey = $state("");
let sbUsePathStyle = $state(false);
let togglingSpaceBucketId = $state<string | null>(null);

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
		toast(`${err}`, "error");
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
		toast(`${err}`, "error");
	} finally {
		isCreating = false;
	}
}

async function handleDeleteRole(roleId: string) {
	const roleName = sortedRoles.find((r) => r.id === roleId)?.name ?? "this role";
	if (!spaceId) return;
	const sid = spaceId;
	await confirmAction(`Delete "${roleName}"? This can't be undone.`, "Deleting", async () => {
		await deleteRole(sid, roleId);
		if (editingRoleId === roleId) {
			editingRoleId = null;
		}
	});
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
	selectedMemberUserId = null;
}

$effect(() => {
	if (activeSection !== "members") {
		selectedMemberUserId = null;
	}
});

// ── emoji handlers ──────────────────────────────────────────
async function loadEmojis() {
	if (!spaceId) return;
	emojisLoading = true;
	try {
		spaceEmojis = await listEmojis(spaceId);
	} catch (err) {
		console.error("Failed to load emojis:", err);
		toast(`${err}`, "error");
	} finally {
		emojisLoading = false;
	}
}

$effect(() => {
	if (activeSection === "emojis" && spaceId) {
		loadEmojis();
	}
});

function handleEmojiFileChange(e: Event) {
	const input = e.target as HTMLInputElement;
	newEmojiFile = input.files?.[0] ?? null;
}

async function handleUploadEmoji() {
	if (!newEmojiName.trim() || !newEmojiFile || !spaceId) return;
	isUploadingEmoji = true;
	try {
		await createEmoji(spaceId, newEmojiName.trim(), newEmojiFile);
		newEmojiName = "";
		newEmojiFile = null;
		await loadEmojis();
	} catch (err) {
		console.error("Failed to upload emoji:", err);
		toast(`${err}`, "error");
	} finally {
		isUploadingEmoji = false;
	}
}

function startEmojiEdit(emoji: SpaceEmoji) {
	editingEmojiId = emoji.id;
	editingEmojiName = emoji.name;
}

function cancelEmojiEdit() {
	editingEmojiId = null;
	editingEmojiName = "";
}

async function handleUpdateEmoji() {
	if (!editingEmojiId || !editingEmojiName.trim() || !spaceId) return;
	try {
		await updateEmoji(spaceId, editingEmojiId, editingEmojiName.trim());
		editingEmojiId = null;
		editingEmojiName = "";
		await loadEmojis();
	} catch (err) {
		console.error("Failed to update emoji:", err);
		toast(`${err}`, "error");
	}
}

async function handleDeleteEmoji(emojiId: string) {
	if (!spaceId) return;
	const sid = spaceId;
	const emojiName = spaceEmojis.find((e) => e.id === emojiId)?.name ?? "this emoji";
	await confirmAction(`Delete ":${emojiName}:"? This can't be undone.`, "Deleting", async () => {
		isDeletingEmoji = { ...isDeletingEmoji, [emojiId]: true };
		try {
			await deleteEmoji(sid, emojiId);
			await loadEmojis();
		} finally {
			isDeletingEmoji = { ...isDeletingEmoji, [emojiId]: false };
		}
	});
}

const canManageEmojis = $derived(checkCanManageEmojis());

function checkCanManageEmojis(): boolean {
	if (!$currentUser || !space) return false;
	if ($currentUser.id === space.owner_id) return true;
	const member = space.member;
	const userRoleIds = space.member_roles[member?.user_id ?? ""] ?? [];
	let combinedPermissions = 0;
	for (const role of space.roles) {
		if (userRoleIds.includes(role.id)) {
			combinedPermissions |= role.permissions;
		}
	}
	return (combinedPermissions & Permission.ManageSpaceEmojis) === Permission.ManageSpaceEmojis;
}

const canManageBuckets = $derived(checkCanManageBuckets());

function checkCanManageBuckets(): boolean {
	if (!$currentUser || !space) return false;
	if ($currentUser.id === space.owner_id) return true;
	const member = space.member;
	const userRoleIds = space.member_roles[member?.user_id ?? ""] ?? [];
	let combinedPermissions = 0;
	for (const role of space.roles) {
		if (userRoleIds.includes(role.id)) {
			combinedPermissions |= role.permissions;
		}
	}
	return (combinedPermissions & Permission.ManageSpaceBuckets) === Permission.ManageSpaceBuckets;
}

// ── space bucket handlers ───────────────────────────────────
async function loadSpaceBuckets() {
	if (!spaceId) return;
	spaceBucketsLoading = true; spaceBucketsError = null;
	try { spaceBuckets = await getSpaceBuckets(spaceId); }
	catch (e) { spaceBucketsError = e instanceof Error ? e.message : "Failed to load"; }
	finally { spaceBucketsLoading = false; }
}

$effect(() => {
	if (activeSection === "storage" && spaceId) {
		loadSpaceBuckets();
	}
});

function resetSpaceBucketForm() {
	sbName = ""; sbEndpoint = ""; sbRegion = "auto"; sbBucketName = ""; sbAccessKey = ""; sbSecretKey = ""; sbUsePathStyle = false;
	editingSpaceBucket = null; showSpaceBucketForm = false;
}

function startEditSpaceBucket(b: StorageBucket) {
	editingSpaceBucket = b; showSpaceBucketForm = true;
	sbName = b.name; sbEndpoint = b.endpoint; sbRegion = b.region;
	sbBucketName = b.bucket_name; sbAccessKey = b.access_key_id; sbSecretKey = b.secret_access_key;
	sbUsePathStyle = b.use_path_style;
}

async function handleSaveSpaceBucket() {
	if (!sbName.trim() || !sbEndpoint.trim() || !sbBucketName.trim() || !sbAccessKey.trim() || !spaceId) return;
	spaceBucketSaving = true; spaceBucketsError = null;
	try {
		const payload: CreateBucketPayload = {
			name: sbName.trim(), endpoint: sbEndpoint.trim(), region: sbRegion.trim() || "auto",
			bucket_name: sbBucketName.trim(), access_key_id: sbAccessKey.trim(),
			secret_access_key: sbSecretKey.trim(), use_path_style: sbUsePathStyle,
		};
		if (editingSpaceBucket) {
			await updateSpaceBucket(spaceId, editingSpaceBucket.id, payload);
		} else {
			await createSpaceBucket(spaceId, payload);
		}
		resetSpaceBucketForm();
		await loadSpaceBuckets();
	} catch (e) { spaceBucketsError = e instanceof Error ? e.message : "Failed to save"; }
	finally { spaceBucketSaving = false; }
}

async function handleDeleteSpaceBucket(id: string) {
	if (!spaceId) return;
	const sid = spaceId;
	const b = spaceBuckets.find((x) => x.id === id);
	await confirmAction(`Delete bucket "${b?.name}"?`, "Deleting", async () => {
		await deleteSpaceBucket(sid, id);
		await loadSpaceBuckets();
	});
}

async function handleToggleSpaceBucket(b: StorageBucket) {
	if (!spaceId) return;
	togglingSpaceBucketId = b.id;
	try {
		if (b.is_active) { await deactivateSpaceBucket(spaceId, b.id); }
		else { await activateSpaceBucket(spaceId, b.id); }
		await loadSpaceBuckets();
	} catch (e) {
		toast(e instanceof Error ? e.message : "Failed to toggle bucket", "error");
	} finally {
		togglingSpaceBucketId = null;
	}
}

const selectedSettingsMember = $derived(
	space && selectedMemberUserId
		? (space.members ?? []).find((m) => m.user_id === selectedMemberUserId) ?? null
		: null,
);

const selectedSettingsUser = $derived(
	space && selectedMemberUserId
		? space.users.find((u) => u.id === selectedMemberUserId) ?? null
		: null,
);

const selectedSettingsRoles = $derived(
	space && selectedMemberUserId
		? (space.member_roles[selectedMemberUserId] ?? [])
				.map((rid) => space.roles.find((r) => r.id === rid))
				.filter((role): role is NonNullable<typeof role> => Boolean(role))
		: [],
);
</script>

<Dialog.Root bind:open>
    <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-500 bg-black/70 backdrop-blur-sm" />
        <Dialog.Content class="fixed inset-0 z-501 flex items-center justify-center p-4">
            <div class="w-full max-w-4xl max-h-[85vh] h-[85vh] bg-zinc-900 rounded-xl shadow-2xl flex overflow-hidden border border-zinc-700 text-zinc-100">
            <!-- Left sidebar -->
            <aside
                class="w-56 shrink-0 bg-zinc-950 flex flex-col py-6 border-r border-zinc-800"
            >
                <div class="px-4 mb-4">
                    <p
                        class="text-xxs font-bold tracking-widest uppercase text-zinc-400 px-2 mb-1"
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

                    <button
                        class="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-100
                            {activeSection === 'emojis'
                            ? 'bg-zinc-800 text-white'
                            : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
                        onclick={() => (activeSection = "emojis")}
                    >
                        <SmileIcon
                            class="size-4"
                        />
                        Emojis
                    </button>

                    {#if canManageBuckets}
                    <button
                        class="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-100
                            {activeSection === 'storage'
                            ? 'bg-zinc-800 text-white'
                            : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
                        onclick={() => (activeSection = "storage")}
                    >
                        <DatabaseIcon
                            class="size-4"
                        />
                        Storage
                    </button>
                    {/if}
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
                              : activeSection === "emojis"
                                ? "Emojis"
                                : activeSection === "storage"
                                  ? "Storage"
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
                                                class="color-swatch size-7 rounded-md border-2 border-zinc-600 p-0 bg-none cursor-pointer"
                                                title="Color from"
                                            />
                                            <span
												class="text-xxs text-zinc-500"
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
                                                    class="color-swatch size-7 rounded-md border-2 border-zinc-600 p-0 bg-none cursor-pointer"
                                                    title="Color via (middle)"
                                                />
                                                <span
													class="text-xxs text-zinc-500"
                                                    >Via</span
                                                >
                                            </div>
                                            <div
                                                class="flex items-center gap-1.5"
                                            >
                                                <input
                                                    type="color"
                                                    bind:value={newRoleColorTo}
                                                    class="color-swatch size-7 rounded-md border-2 border-zinc-600 p-0 bg-none cursor-pointer"
                                                    title="Color to"
                                                />
                                                <span
													class="text-xxs text-zinc-500"
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
                                    <Checkbox.Root bind:checked={newRoleHoisted} class="size-4 rounded border border-zinc-600 bg-zinc-900 data-[state=checked]:bg-stone-600 data-[state=checked]:border-stone-600 flex items-center justify-center text-transparent data-[state=checked]:text-white text-xxs">✓</Checkbox.Root>
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
                                                }} class="size-4 rounded border border-zinc-600 bg-zinc-900 data-[state=checked]:bg-stone-600 data-[state=checked]:border-stone-600 flex items-center justify-center text-transparent data-[state=checked]:text-white text-xxs">✓</Checkbox.Root>
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
                                                                    class="text-xxs px-1.5 py-0.5 rounded transition-colors {editingRoleClearColors
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
                                                                        class="color-swatch size-7 rounded-md border-2 border-zinc-600 p-0 bg-none cursor-pointer"
                                                                        title="Color from"
                                                                    />
                                                                    <span
																class="text-xxs text-zinc-500"
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
                                                                            class="color-swatch size-7 rounded-md border-2 border-zinc-600 p-0 bg-none cursor-pointer"
                                                                            title="Via"
                                                                        />
                                                                        <span
																	class="text-xxs text-zinc-500"
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
                                                                            class="color-swatch size-7 rounded-md border-2 border-zinc-600 p-0 bg-none cursor-pointer"
                                                                            title="To"
                                                                        />
                                                                        <span
																	class="text-xxs text-zinc-500"
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
                                                        <Checkbox.Root bind:checked={editingRoleHoisted} class="size-4 rounded border border-zinc-600 bg-zinc-900 data-[state=checked]:bg-stone-600 data-[state=checked]:border-stone-600 flex items-center justify-center text-transparent data-[state=checked]:text-white text-xxs">✓</Checkbox.Root>
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
                                                                    }} class="size-4 rounded border border-zinc-600 bg-zinc-900 data-[state=checked]:bg-stone-600 data-[state=checked]:border-stone-600 flex items-center justify-center text-transparent data-[state=checked]:text-white text-xxs">✓</Checkbox.Root>
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
                                                                    class="text-xxs bg-zinc-700 text-zinc-300 px-1.5 py-0.5 rounded"
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
                                                            >Delete</button
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
							<div class="space-y-3">
								<h3 class="text-sm font-semibold text-white">
									Members ({formatCount(space.members?.length ?? 0)})
								</h3>
								{#each space.members ?? [] as member}
									{@const user = space.users.find(
										(u) => u.id === member.user_id,
									)}
									<button
										type="button"
										class="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors {selectedMemberUserId === member.user_id ? 'border-stone-500/50 bg-zinc-700/60' : 'border-zinc-700 bg-zinc-800 hover:bg-zinc-750'}"
										onclick={() => (selectedMemberUserId = member.user_id)}
									>
										<UserAvatar src={user?.avatar ?? null} name={user?.username ?? "Unknown"} size={32} />
										<div class="flex-1 min-w-0">
											<p class="truncate text-sm font-medium text-zinc-200">
												{member.alias ?? user?.username ?? "Unknown member"}
											</p>
											<p class="truncate text-xs text-zinc-400">
												{(
													space.member_roles[member.user_id] ?? []
												)
													.map((rid) => space.roles.find((r) => r.id === rid)?.name)
													.filter(Boolean)
													.join(", ") || "No roles assigned"}
											</p>
										</div>
									</button>
								{/each}

								{#if selectedSettingsMember && selectedSettingsUser}
									<div class="rounded-xl border border-zinc-700 bg-zinc-850 p-4">
										<div class="mb-3 flex items-center justify-between">
											<h4 class="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Member Details</h4>
											<button type="button" class="rounded px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200" onclick={() => (selectedMemberUserId = null)}>Close</button>
										</div>
										<div class="flex items-center gap-3">
											<UserAvatar src={selectedSettingsUser.avatar ?? null} name={selectedSettingsUser.username} size={40} />
											<div class="min-w-0">
												<p class="truncate text-sm font-semibold text-zinc-100">{selectedSettingsMember.alias ?? selectedSettingsUser.username}</p>
												<p class="truncate text-xs text-zinc-400">@{selectedSettingsUser.username}</p>
												<p class="truncate text-[11px] text-zinc-500">User ID: {selectedSettingsUser.id}</p>
											</div>
										</div>
										<div class="mt-3">
											<p class="mb-2 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">Roles</p>
											{#if selectedSettingsRoles.length > 0}
												<div class="flex flex-wrap gap-1.5">
													{#each selectedSettingsRoles as role}
														<span class="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200">{role.name}</span>
													{/each}
												</div>
											{:else}
												<p class="text-xs text-zinc-500">No roles assigned</p>
											{/if}
										</div>
									</div>
								{/if}
							</div>
						{/if}
					{:else if activeSection === "emojis"}
						{#if emojisLoading}
							<p class="text-sm text-zinc-400">Loading emojis...</p>
						{:else}
							{#if canManageEmojis}
								<!-- Upload new emoji -->
								<div class="space-y-4 rounded-xl border border-zinc-700 bg-zinc-900 p-5">
									<div class="space-y-1">
										<h3 class="text-sm font-semibold tracking-wide text-white">Upload Emoji</h3>
										<p class="text-xs text-zinc-400">
											Custom emojis require a storage bucket configured for this server.
										</p>
									</div>

									<div class="flex items-end gap-3">
										<label class="space-y-1.5 block flex-1">
											<span class="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">Name</span>
											<input
												type="text"
												class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
												placeholder="emoji_name"
												bind:value={newEmojiName}
											/>
										</label>

										<label class="space-y-1.5 block">
											<span class="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">Image</span>
											<input
												type="file"
												accept="image/*"
												class="block w-full text-sm text-zinc-400 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-700 file:px-3 file:py-2 file:text-sm file:font-medium file:text-zinc-200 hover:file:bg-zinc-600 file:cursor-pointer file:transition-colors"
												onchange={handleEmojiFileChange}
											/>
										</label>

										<button
											class="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
											onclick={handleUploadEmoji}
											disabled={isUploadingEmoji || !newEmojiName.trim() || !newEmojiFile}
										>
											<UploadIcon class="size-4" />
											{isUploadingEmoji ? "Uploading..." : "Upload"}
										</button>
									</div>
								</div>
							{/if}

							<!-- Emoji list -->
							{#if spaceEmojis.length === 0}
								<div class="flex flex-col items-center justify-center py-12 text-center">
									<SmileIcon class="size-10 text-zinc-600 mb-3" />
									<p class="text-sm text-zinc-400">No custom emojis yet.</p>
									{#if canManageEmojis}
										<p class="text-xs text-zinc-500 mt-1">Upload one above to get started.</p>
									{/if}
								</div>
							{:else}
								<div class="space-y-1">
									{#each spaceEmojis as emoji (emoji.id)}
										<div class="flex items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 group">
											<img
												src="{attachmentHost}/attachments/{emoji.attachment_id}"
												alt=":{emoji.name}:"
												class="size-8 rounded object-contain"
											/>

											{#if editingEmojiId === emoji.id}
												<input
													type="text"
													class="flex-1 rounded-md border border-zinc-600 bg-zinc-700 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-zinc-500"
													bind:value={editingEmojiName}
													onkeydown={(e) => { if (e.key === "Enter") handleUpdateEmoji(); if (e.key === "Escape") cancelEmojiEdit(); }}
												/>
												<button
													class="rounded p-1.5 text-green-400 hover:bg-zinc-700 transition-colors"
													onclick={handleUpdateEmoji}
													title="Save"
												>
													<CheckIcon class="size-4" />
												</button>
												<button
													class="rounded p-1.5 text-zinc-400 hover:bg-zinc-700 transition-colors"
													onclick={cancelEmojiEdit}
													title="Cancel"
												>
													<XIcon class="size-4" />
												</button>
											{:else}
												<div class="flex-1 min-w-0">
													<p class="text-sm font-medium text-zinc-200 truncate">:{emoji.name}:</p>
												</div>

												{#if canManageEmojis}
													<button
														class="rounded p-1.5 text-zinc-400 opacity-0 group-hover:opacity-100 hover:bg-zinc-700 hover:text-zinc-200 transition-all"
														onclick={() => startEmojiEdit(emoji)}
														title="Rename"
													>
														<PencilIcon class="size-4" />
													</button>
													<button
														class="rounded p-1.5 text-zinc-400 opacity-0 group-hover:opacity-100 hover:bg-zinc-700 hover:text-red-400 transition-all"
														onclick={() => handleDeleteEmoji(emoji.id)}
														disabled={isDeletingEmoji[emoji.id]}
														title="Delete"
													>
														<TrashIcon class="size-4" />
													</button>
												{/if}
											{/if}
										</div>
									{/each}
								</div>
							{/if}
						{/if}
					{:else if activeSection === "storage"}
						{#if canManageBuckets}
							<p class="text-xs text-zinc-500 mb-4">Connect an S3-compatible bucket for this server's storage. When a bucket is active, uploads go to your bucket.</p>

							{#if spaceBucketsError}
								<p class="text-sm text-red-400 bg-red-400/10 rounded-md px-3 py-2 mb-4">{spaceBucketsError}</p>
							{/if}

							<!-- Create / Edit form -->
							{#if showSpaceBucketForm}
								<div class="rounded-lg border border-zinc-800 bg-zinc-800/40 p-4 mb-4 space-y-3">
									<h3 class="text-sm font-semibold text-white">{editingSpaceBucket ? "Edit Bucket" : "New Bucket"}</h3>
									<div class="grid grid-cols-2 gap-3">
										<div>
											<label for="sb-name" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase">Name</label>
											<input id="sb-name" type="text" bind:value={sbName} placeholder="My R2" class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500" />
										</div>
										<div>
											<label for="sb-region" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase">Region</label>
											<input id="sb-region" type="text" bind:value={sbRegion} placeholder="auto" class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500" />
										</div>
									</div>
									<div>
										<label for="sb-endpoint" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase">Endpoint</label>
										<input id="sb-endpoint" type="text" bind:value={sbEndpoint} placeholder="https://account-id.r2.cloudflarestorage.com" class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500" />
									</div>
									<div>
										<label for="sb-bucket-name" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase">Bucket Name</label>
										<input id="sb-bucket-name" type="text" bind:value={sbBucketName} placeholder="my-bucket" class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500" />
									</div>
									<div class="grid grid-cols-2 gap-3">
										<div>
											<label for="sb-access-key" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase">Access Key ID</label>
											<input id="sb-access-key" type="text" bind:value={sbAccessKey} placeholder="access key" class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500" />
										</div>
										<div>
											<label for="sb-secret-key" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase">Secret Access Key</label>
											<input id="sb-secret-key" type="password" bind:value={sbSecretKey} placeholder={editingSpaceBucket ? "leave empty to keep current" : "secret key"} class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500" />
										</div>
									</div>
									<label class="flex items-center gap-2 cursor-pointer">
										<input type="checkbox" bind:checked={sbUsePathStyle} class="size-4 rounded border-zinc-600 bg-zinc-800 accent-stone-500" />
										<span class="text-xs text-zinc-400">Use path-style addressing <span class="text-zinc-600">(required for MinIO, RustFS, etc.)</span></span>
									</label>
									<div class="flex justify-end gap-2 pt-1">
										<button class="rounded-md px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors" onclick={resetSpaceBucketForm}>Cancel</button>
										<button class="rounded-md bg-stone-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-stone-500 transition-colors disabled:opacity-50" disabled={spaceBucketSaving} onclick={handleSaveSpaceBucket}>
											{spaceBucketSaving ? "Saving..." : editingSpaceBucket ? "Update" : "Create"}
										</button>
									</div>
								</div>
							{:else}
								<button class="flex items-center gap-2 rounded-md bg-stone-600/20 px-3 py-2 text-sm font-medium text-stone-300 hover:bg-stone-600/30 transition-colors mb-4" onclick={() => { resetSpaceBucketForm(); showSpaceBucketForm = true; }}>
									<PlusIcon class="size-4" /> Add Bucket
								</button>
							{/if}

							<!-- Bucket list -->
							{#if spaceBucketsLoading}
								<div class="space-y-2">
									{#each Array(3) as _}
										<div class="h-16 rounded-lg bg-zinc-800/40 animate-pulse"></div>
									{/each}
								</div>
							{:else if spaceBuckets.length === 0}
								<div class="flex flex-col items-center justify-center py-12 text-zinc-500">
									<DatabaseIcon class="size-10 mb-3" />
									<p class="text-sm">No buckets configured</p>
									<p class="text-xs text-zinc-600 mt-1">Add a bucket to enable custom emoji uploads.</p>
								</div>
							{:else}
								<div class="space-y-2">
									{#each spaceBuckets as bucket (bucket.id)}
										<div class="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-800/30 px-4 py-3 group hover:bg-zinc-800/50 transition-colors">
											<div class="flex-1 min-w-0">
												<div class="flex items-center gap-2">
													<span class="text-sm font-medium text-zinc-200">{bucket.name}</span>
													{#if bucket.is_active}
														<span class="text-xxs font-semibold px-1.5 py-0.5 rounded bg-emerald-600/20 text-emerald-400">ACTIVE</span>
													{/if}
												</div>
												<p class="text-xs text-zinc-500 truncate mt-0.5">{bucket.bucket_name} · {bucket.endpoint}</p>
											</div>
											<div class="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
												<button
													class="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200 transition-all disabled:opacity-50"
													title={bucket.is_active ? "Deactivate" : "Activate"}
													onclick={() => handleToggleSpaceBucket(bucket)}
													disabled={togglingSpaceBucketId === bucket.id}
												>
													{#if togglingSpaceBucketId === bucket.id}
														<div class="size-4 rounded-full border-2 border-zinc-500 border-t-transparent animate-spin"></div>
													{:else if bucket.is_active}
														<XIcon class="size-4" />
													{:else}
														<CheckIcon class="size-4" />
													{/if}
												</button>
												<button
													class="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200 transition-all"
													title="Edit"
													onclick={() => startEditSpaceBucket(bucket)}
												>
													<PencilIcon class="size-4" />
												</button>
												<button
													class="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-red-600/20 hover:text-red-400 transition-all"
													title="Delete"
													onclick={() => handleDeleteSpaceBucket(bucket.id)}
												>
													<TrashIcon class="size-4" />
												</button>
											</div>
										</div>
									{/each}
								</div>
							{/if}
						{:else}
							<p class="text-sm text-zinc-400">You don't have permission to manage storage for this server.</p>
						{/if}
					{/if}
                </div>
            </div>
        </div>
        </Dialog.Content>
    </Dialog.Portal>
</Dialog.Root>
<style>
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
