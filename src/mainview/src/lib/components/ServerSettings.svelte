<script lang="ts">
	import { toast } from "$lib/stores/toast.svelte";
	import { confirmAction } from "$lib/stores/confirm.svelte";
	import { getApiError } from "$lib/api/api";
	import {
		GripVertical as DotsSixVerticalIcon,
		Shield as ShieldStarIcon,
		Users as UsersThreeIcon,
		Settings as GearSixIcon,
		Smile as SmileIcon,
		Sticker as StickerIcon,
		Database as DatabaseIcon,
		Paperclip as PaperclipIcon,
		Link2 as LinkIcon,
		X as XIcon,
		Pencil as PencilIcon,
		Trash2 as TrashIcon,
		Upload as UploadIcon,
		Check as CheckIcon,
		Plus as PlusIcon,
		ImagePlus as ImagePlusIcon,
		ArrowRightLeft as MoveIcon,
		Ban as BanIcon,
		UserMinus as UserMinusIcon,
	} from "@lucide/svelte";
	import { Checkbox, Dialog } from "bits-ui";
	import { slide } from "svelte/transition";
	import ImageCropModal from "$lib/components/ImageCropModal.svelte";
	import StorageTransferCard from "$lib/components/StorageTransferCard.svelte";
	import MoveFilesDialog from "$lib/components/MoveFilesDialog.svelte";
	import BucketFilesDialog from "$lib/components/BucketFilesDialog.svelte";
	import FilePickerBar from "$lib/components/FilePickerBar.svelte";
	import { FilePicker } from "$lib/file-picker.svelte";
	import { storageTransfers, bucketFilesCount } from "$lib/stores/storage-transfers.svelte";
	import {
		bucketChoice,
		countFiles,
		MAX_PICKED_FILES,
		type PickableFile,
		type TransferFilter,
	} from "$lib/storage-transfers";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import SpaceBanner from "$lib/components/SpaceBanner.svelte";
	import SpaceIcon from "$lib/components/SpaceIcon.svelte";
	import SpaceBans from "$lib/components/SpaceBans.svelte";
	import { banRequest, kickFromSpace, moderationOf } from "$lib/moderation";
	import { createRole, updateRole, deleteRole } from "$lib/api/roles";
	import { listEmojis, createEmoji, updateEmoji, deleteEmoji } from "$lib/api/emojis";
	import { listStickers, createSticker, updateSticker, deleteSticker } from "$lib/api/stickers";
	import { uploadNote, uploadPercent } from "$lib/uploads";
	import {
		getSpaceBuckets,
		createSpaceBucket,
		updateSpaceBucket,
		deleteSpaceBucket,
		activateSpaceBucket,
		deactivateSpaceBucket,
	} from "$lib/api/space-buckets";
	import { currentUser } from "$lib/stores.svelte";
	import {
		Permission,
		ALL_PERMISSIONS,
		canManageRoleAt,
		canSetPermission,
		computeSpacePermissions,
	} from "$lib/permissions";
	import { settingsSections, type SettingsSection } from "$lib/space-settings";

	import type { GatewaySpace, SpaceEmoji, SpaceSticker } from "$lib/types";
	import type { StorageBucket, CreateBucketPayload } from "$lib/api/user";
	import {
		getSpaceAttachments,
		getSpaceStorageUsed,
		deleteSpaceAttachment,
		deleteAllSpaceAttachments,
		updateSpace,
		deleteSpace,
		type SpaceAttachment,
	} from "$lib/api/spaces";
	import { getHostURL, getAvatarURL } from "$lib/common/common";
	import { gatewaySpaces } from "$lib/stores.svelte";
	import { listSpaceInvites, revokeInvite, type InviteLink } from "$lib/api/invites";

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

	let activeSection = $state<SettingsSection>("overview");

	const PERMISSIONS = ALL_PERMISSIONS;

	// Overview form state
	let ovName = $state("");
	let ovDescription = $state("");
	let ovLocale = $state("");
	let ovSaving = $state(false);
	// How far a new icon or banner has gone up while the overview saves, in percent, which Save says: null until its
	// first progress, and while nothing new goes up.
	let ovUploadPercent = $state<number | null>(null);
	let showSpaceIconCrop = $state(false);
	let showSpaceBannerCrop = $state(false);
	let pendingIcon = $state<File | "remove" | null>(null);
	let pendingBanner = $state<File | "remove" | null>(null);
	let pendingIconPreview = $state<string | null>(null);
	let pendingBannerPreview = $state<string | null>(null);

	function onSpaceIconCrop(file: File) {
		pendingIcon = file;
		if (pendingIconPreview) URL.revokeObjectURL(pendingIconPreview);
		pendingIconPreview = URL.createObjectURL(file);
	}

	function onSpaceBannerCrop(file: File) {
		pendingBanner = file;
		if (pendingBannerPreview) URL.revokeObjectURL(pendingBannerPreview);
		pendingBannerPreview = URL.createObjectURL(file);
	}

	let ovHasChanges = $derived(
		space !== null &&
			(ovName !== (space.name ?? "") ||
				ovDescription !== (space.description ?? "") ||
				ovLocale !== (space.locale ?? "") ||
				pendingIcon !== null ||
				pendingBanner !== null),
	);

	$effect(() => {
		if (open && space) {
			ovName = space.name ?? "";
			ovDescription = space.description ?? "";
			ovLocale = space.locale ?? "";
		}
	});

	async function handleSaveOverview() {
		if (!spaceId || !ovHasChanges) return;
		ovSaving = true;
		try {
			const uploading = pendingBanner instanceof File || pendingIcon instanceof File;
			const updated = await updateSpace(
				spaceId,
				{
					name: ovName.trim() || undefined,
					description: ovDescription.trim() || null,
					locale: ovLocale.trim() || null,
					banner: pendingBanner instanceof File ? pendingBanner : undefined,
					icon: pendingIcon instanceof File ? pendingIcon : undefined,
					remove_banner: pendingBanner === "remove",
					remove_icon: pendingIcon === "remove",
				},
				uploading ? { onUploadProgress: (sent, total) => (ovUploadPercent = uploadPercent(sent, total)) } : undefined,
			);
			// Clean up previews
			if (pendingIconPreview) {
				URL.revokeObjectURL(pendingIconPreview);
				pendingIconPreview = null;
			}
			if (pendingBannerPreview) {
				URL.revokeObjectURL(pendingBannerPreview);
				pendingBannerPreview = null;
			}
			pendingIcon = null;
			pendingBanner = null;
			// Update the local store
			gatewaySpaces.update((spaces) =>
				spaces.map((s) =>
					s.id === spaceId
						? {
								...s,
								name: updated.name,
								description: updated.description,
								locale: updated.locale,
								banner: updated.banner,
								icon: updated.icon,
							}
						: s,
				),
			);
			toast("Space updated!", "success");
		} catch (e) {
			toast(getApiError(e, "Failed to update"), "error");
		} finally {
			ovSaving = false;
			ovUploadPercent = null;
		}
	}

	// ── deleting the space (its owner alone, after typing its name) ──
	const isOwner = $derived(!!$currentUser && !!space && $currentUser.id === space.owner_id);
	let confirmingDelete = $state(false);
	let deleteConfirm = $state("");
	let deletingSpace = $state(false);
	let deleteError = $state<string | null>(null);
	const deleteNameMatches = $derived(!!space && deleteConfirm.trim() === space.name.trim());

	// Each opening, and each space, starts it over.
	$effect(() => {
		if (open && spaceId) {
			confirmingDelete = false;
			deleteConfirm = "";
			deleteError = null;
		}
	});

	async function handleDeleteSpace() {
		if (!spaceId || !space || !deleteNameMatches || deletingSpace) return;
		const id = spaceId;
		const name = space.name;
		deletingSpace = true;
		deleteError = null;
		try {
			await deleteSpace(id);
			open = false;
			// SPACE_DELETE follows; the space goes at once, and with it its panes and its voice room.
			gatewaySpaces.update((spaces) => spaces.filter((s) => s.id !== id));
			toast(`${name} was deleted`, "success");
		} catch (e) {
			deleteError = getApiError(e, "Failed to delete the space");
		} finally {
			deletingSpace = false;
		}
	}

	// ── color helpers ────────────────────────────────────────────
	function intToHex(n: undefined | number | null): string {
		if (n === null || n === undefined) {
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
		if (role.color_from === null || role.color_from === undefined) {
			return "background: var(--color-zinc-600)";
		}
		const from = intToHex(role.color_from);
		if (role.color_to === null || role.color_to === undefined) {
			return `background: ${from}`;
		}
		const to = intToHex(role.color_to);
		if (role.color_via !== null && role.color_via !== undefined) {
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
	let newEmojiPreview = $state<string | null>(null);
	let showEmojiCrop = $state(false);
	let isUploadingEmoji = $state(false);
	// How far the new emoji's image has gone up, in percent, which Upload says: null until its first progress.
	let emojiUploadPercent = $state<number | null>(null);
	let editingEmojiId = $state<string | null>(null);
	let editingEmojiName = $state("");
	let isDeletingEmoji = $state<Record<string, boolean>>({});

	// ── sticker state ───────────────────────────────────────────
	let spaceStickers = $state<SpaceSticker[]>([]);
	let stickersLoading = $state(false);
	let newStickerName = $state("");
	let newStickerFile = $state<File | null>(null);
	let newStickerPreview = $state<string | null>(null);
	let showStickerCrop = $state(false);
	let isUploadingSticker = $state(false);
	// As emojiUploadPercent, for the new sticker's image.
	let stickerUploadPercent = $state<number | null>(null);
	let editingStickerReact = $state<string | null>(null);
	let editingStickerName = $state("");
	let isDeletingSticker = $state<Record<string, boolean>>({});

	// ── space bucket state ──────────────────────────────────────
	let spaceBuckets = $state<StorageBucket[]>([]);
	let spaceBucketsLoading = $state(false);
	let spaceBucketsError = $state<string | null>(null);
	let showSpaceBucketForm = $state(false);
	let editingSpaceBucket = $state<StorageBucket | null>(null);
	let spaceBucketSaving = $state(false);
	let sbName = $state("");
	let sbEndpoint = $state("");
	let sbRegion = $state("auto");
	let sbBucketName = $state("");
	let sbAccessKey = $state("");
	let sbSecretKey = $state("");
	let sbUsePathStyle = $state(false);
	let sbMaxBytesMB = $state("");
	let sbUploadLimitMB = $state("");
	let togglingSpaceBucketId = $state<string | null>(null);

	const numberFormatter = new Intl.NumberFormat(typeof navigator !== "undefined" ? navigator.language : "en-US");

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

	// A role moves only where the API lets the user put it, below their highest role (checkRoleHierarchy, which counts
	// the bottom place, @everyone's, as 1). @everyone's own place never changes, whatever the list shows.
	function canMoveRoleTo(role: { id: string }, index: number): boolean {
		if (!space || role.id === space.id) return true;
		return canManageRoleAt(space, Math.max(sortedRoles.length - 1 - index, 1));
	}

	function onDragOver(e: DragEvent, i: number) {
		e.preventDefault();
		if (dragIndex === i || !draggedRole || !canMoveRoleTo(draggedRole, i)) {
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

	// What the user may do in the space, as the API's checks compute it.
	const spacePermissions = $derived(space ? computeSpacePermissions(space) : 0);

	function hasSpacePermission(flag: number): boolean {
		return (spacePermissions & flag) === flag;
	}

	// The sections whose controls the API lets the user use; without any of those permissions, only the emoji and
	// sticker lists, read-only.
	const sections = $derived(settingsSections(spacePermissions));
	// One they can't open (another space's settings, or a permission gone) gives way to the first they can, before it
	// shows.
	$effect.pre(() => {
		if (!sections.includes(activeSection)) activeSection = sections[0];
	});

	const canManageRoles = $derived(hasSpacePermission(Permission.ManageRoles));
	// The permissions of the role being edited as saved: the edit may keep or remove them, but add only ones the user
	// has (canSetPermission), as the API checks.
	const editingRoleSaved = $derived(space?.roles.find((r) => r.id === editingRoleId)?.permissions ?? 0);

	function permissionsToFlags(permissions: number[]): number {
		return permissions.reduce((acc, perm) => acc | perm, 0);
	}

	function getPermissionNames(flags: number): string {
		const perms = PERMISSIONS.filter((p) => (flags & p.flag) === p.flag).map((p) => p.name);
		return perms.length > 0 ? perms.join(", ") : "No permissions assigned";
	}

	function togglePermission(flag: number, isEdit = false) {
		if (isEdit) {
			editingRolePermissions =
				(editingRolePermissions & flag) === flag ? editingRolePermissions & ~flag : editingRolePermissions | flag;
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
				color_via: newRoleUseGradient && newRoleColorVia ? hexToInt(newRoleColorVia) : null,
				color_to: newRoleUseGradient && newRoleColorTo ? hexToInt(newRoleColorTo) : null,
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
			toast(getApiError(err, "Failed to create role"), "error");
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
				color_from: editingRoleClearColors ? null : hexToInt(editingRoleColorFrom),
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
			toast(getApiError(err, "Failed to update role"), "error");
		} finally {
			isCreating = false;
		}
	}

	async function handleDeleteRole(roleId: string) {
		const roleName = sortedRoles.find((r) => r.id === roleId)?.name ?? "this role";
		if (!spaceId) return;
		const sid = spaceId;
		await confirmAction(`Delete "${roleName}"? This can't be undone.`, "Delete", async () => {
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
		editingRoleColorVia = role.color_via !== null && role.color_via !== undefined ? intToHex(role.color_via) : "";
		editingRoleColorTo = role.color_to !== null && role.color_to !== undefined ? intToHex(role.color_to) : "";
		editingRoleUseGradient = role.color_to !== null && role.color_to !== undefined;
		editingRoleClearColors = role.color_from === null || role.color_from === undefined;
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
			toast(getApiError(err, "Failed to load emojis"), "error");
		} finally {
			emojisLoading = false;
		}
	}

	// A section loads only while the settings are open: they stay mounted when closed, where each space switch would
	// load the section picked, and a failure would show its toast to nobody who asked.
	$effect(() => {
		if (open && activeSection === "emojis" && spaceId) {
			loadEmojis();
		}
	});

	// The new emoji's image, as the image editor made it, and its preview.
	function setNewEmojiFile(file: File | null) {
		newEmojiFile = file;
		if (newEmojiPreview) URL.revokeObjectURL(newEmojiPreview);
		newEmojiPreview = file ? URL.createObjectURL(file) : null;
	}

	async function handleUploadEmoji() {
		if (!newEmojiName.trim() || !newEmojiFile || !spaceId) return;
		isUploadingEmoji = true;
		try {
			await createEmoji(spaceId, newEmojiName.trim(), newEmojiFile, {
				onUploadProgress: (sent, total) => (emojiUploadPercent = uploadPercent(sent, total)),
			});
			// Up and saved: what follows is the list read again.
			emojiUploadPercent = null;
			newEmojiName = "";
			setNewEmojiFile(null);
			await loadEmojis();
		} catch (err) {
			console.error("Failed to upload emoji:", err);
			toast(getApiError(err, "Failed to upload emoji"), "error");
		} finally {
			isUploadingEmoji = false;
			emojiUploadPercent = null;
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
			toast(getApiError(err, "Failed to update emoji"), "error");
		}
	}

	async function handleDeleteEmoji(emojiId: string) {
		if (!spaceId) return;
		const sid = spaceId;
		const emojiName = spaceEmojis.find((e) => e.id === emojiId)?.name ?? "this emoji";
		await confirmAction(`Delete ":${emojiName}:"? This can't be undone.`, "Delete", async () => {
			isDeletingEmoji = { ...isDeletingEmoji, [emojiId]: true };
			try {
				await deleteEmoji(sid, emojiId);
				await loadEmojis();
			} finally {
				isDeletingEmoji = { ...isDeletingEmoji, [emojiId]: false };
			}
		});
	}

	const canManageEmojis = $derived(hasSpacePermission(Permission.ManageSpaceEmojis));
	const canManageStickers = $derived(hasSpacePermission(Permission.ManageSpaceStickers));
	const canManageBuckets = $derived(hasSpacePermission(Permission.ManageSpaceBuckets));
	const canManageAttachments = $derived(hasSpacePermission(Permission.ManageSpaceAttachments));
	// ── sticker handlers ────────────────────────────────────────
	async function loadStickers() {
		if (!spaceId) return;
		stickersLoading = true;
		try {
			spaceStickers = await listStickers(spaceId);
		} catch (err) {
			console.error("Failed to load stickers:", err);
			toast(getApiError(err, "Failed to load stickers"), "error");
		} finally {
			stickersLoading = false;
		}
	}

	$effect(() => {
		if (open && activeSection === "stickers" && spaceId) {
			loadStickers();
		}
	});

	// The new sticker's image, as the image editor made it, and its preview.
	function setNewStickerFile(file: File | null) {
		newStickerFile = file;
		if (newStickerPreview) URL.revokeObjectURL(newStickerPreview);
		newStickerPreview = file ? URL.createObjectURL(file) : null;
	}

	async function handleUploadSticker() {
		if (!newStickerName.trim() || !newStickerFile || !spaceId) return;
		isUploadingSticker = true;
		try {
			await createSticker(spaceId, newStickerName.trim(), newStickerFile, {
				onUploadProgress: (sent, total) => (stickerUploadPercent = uploadPercent(sent, total)),
			});
			// Up and saved: what follows is the list read again.
			stickerUploadPercent = null;
			newStickerName = "";
			setNewStickerFile(null);
			await loadStickers();
		} catch (err) {
			console.error("Failed to upload sticker:", err);
			toast(getApiError(err, "Failed to upload sticker"), "error");
		} finally {
			isUploadingSticker = false;
			stickerUploadPercent = null;
		}
	}

	function startStickerEdit(s: SpaceSticker) {
		editingStickerReact = s.id;
		editingStickerName = s.name;
	}

	function cancelStickerEdit() {
		editingStickerReact = null;
		editingStickerName = "";
	}

	async function handleUpdateSticker() {
		if (!editingStickerReact || !editingStickerName.trim() || !spaceId) return;
		try {
			await updateSticker(spaceId, editingStickerReact, editingStickerName.trim());
			editingStickerReact = null;
			editingStickerName = "";
			await loadStickers();
		} catch (err) {
			console.error("Failed to update sticker:", err);
			toast(getApiError(err, "Failed to update sticker"), "error");
		}
	}

	async function handleDeleteSticker(stickerId: string) {
		if (!spaceId) return;
		const sid = spaceId;
		const stickerName = spaceStickers.find((s) => s.id === stickerId)?.name ?? "this sticker";
		await confirmAction(`Delete "${stickerName}"? This can't be undone.`, "Delete", async () => {
			isDeletingSticker = { ...isDeletingSticker, [stickerId]: true };
			try {
				await deleteSticker(sid, stickerId);
				await loadStickers();
			} finally {
				isDeletingSticker = { ...isDeletingSticker, [stickerId]: false };
			}
		});
	}

	// ── space bucket handlers ───────────────────────────────────
	async function loadSpaceBuckets() {
		if (!spaceId) return;
		spaceBucketsLoading = true;
		spaceBucketsError = null;
		try {
			spaceBuckets = await getSpaceBuckets(spaceId);
			storageTransfers.nameBuckets(spaceBuckets);
		} catch (e) {
			spaceBucketsError = getApiError(e, "Failed to load");
		} finally {
			spaceBucketsLoading = false;
		}
	}

	// Attachments lists the buckets as its locations.
	$effect(() => {
		if (open && (activeSection === "storage" || (activeSection === "attachments" && canManageBuckets)) && spaceId) {
			loadSpaceBuckets();
		}
	});

	// Space attachments
	let spaceAttachments = $state<SpaceAttachment[]>([]);
	let spaceStorageUsed = $state(0);
	let spaceAttachmentsLoading = $state(false);
	// The bucket the list shows ("all" or a bucket ID). Picking files to move needs one.
	let spaceAttachmentsLocation = $state("all");
	// The space and location whose files `spaceAttachments` are, set with them (these settings stay mounted from
	// one space to the next). Until a load for the location picked succeeds, they're another's, which mustn't show
	// or be picked as its: "Select all" would move every file of the one picked.
	let spaceAttachmentsListed = $state<{ spaceId: string; location: string } | null>(null);
	const spaceListedHere = $derived(
		spaceAttachmentsListed?.spaceId === spaceId && spaceAttachmentsListed?.location === spaceAttachmentsLocation,
	);
	// Moving a space's files ends with their originals deleted, so the API asks for ManageSpaceAttachments too, as
	// deleting them does.
	const canMoveSpaceFiles = $derived(canManageBuckets && canManageAttachments);
	const spacePicker = new FilePicker(() => spaceAttachments);
	const spacePicking = $derived(canMoveSpaceFiles && spaceListedHere && spaceAttachmentsLocation !== "all");
	const spaceLocationBytes = $derived(spaceAttachments.reduce((sum, a) => sum + a.size_bytes, 0));
	let spaceAttachmentsLoadId = 0;

	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	async function loadSpaceAttachments(location = spaceAttachmentsLocation) {
		if (!spaceId) return;
		const sid = spaceId;
		// Only the last load counts: the location can change while one is on its way.
		const loadId = ++spaceAttachmentsLoadId;
		spaceAttachmentsLoading = true;
		try {
			const [list, used] = await Promise.all([
				getSpaceAttachments(sid, location === "all" ? undefined : location),
				getSpaceStorageUsed(sid),
			]);
			if (loadId !== spaceAttachmentsLoadId) return;
			spaceAttachments = list;
			spaceAttachmentsListed = { spaceId: sid, location };
			spaceStorageUsed = used.total_size;
			spacePicker.prune();
		} catch (e) {
			if (loadId === spaceAttachmentsLoadId) toast(getApiError(e, "Failed to load attachments"), "error");
		} finally {
			if (loadId === spaceAttachmentsLoadId) spaceAttachmentsLoading = false;
		}
	}

	/** Shows another bucket's files. Its picks and kind filters start over. */
	function setSpaceAttachmentsLocation(location: string) {
		spacePicker.clear();
		spaceAttachmentsLocation = location;
	}

	// A location is one space's bucket, and these settings stay mounted from one space to the next: another space's
	// list starts on all its files. This runs before the load, which would otherwise ask the new space for the old
	// one's bucket.
	let locationSpaceId: string | null | undefined;
	$effect.pre(() => {
		if (locationSpaceId !== undefined && spaceId !== locationSpaceId) setSpaceAttachmentsLocation("all");
		locationSpaceId = spaceId;
	});

	// ── Moving files between the space's buckets ────────────────────────────
	const spaceTransfer = $derived(canManageBuckets && spaceId ? storageTransfers.active(spaceId) : null);
	const spaceStorageChoices = $derived(spaceBuckets.map(bucketChoice));
	let spaceMoveOpen = $state(false);
	let spaceMoveSourceId = $state("");
	let spaceMoveFiles = $state.raw<PickableFile[]>([]);
	let spaceMoveFilter = $state.raw<TransferFilter>({});
	// The bucket whose "Move files…" is loading its files.
	let movingSpaceBucketId = $state<string | null>(null);
	let spaceBucketFilesRequest = $state<{ bucket: StorageBucket; files: number } | null>(null);

	function spaceStorageLabel(bucketId: string | null): string {
		if (bucketId === null) return "Default storage";
		return (
			spaceBuckets.find((b) => b.id === bucketId)?.name ?? storageTransfers.storageName(bucketId) ?? "another bucket"
		);
	}

	function openMoveSpacePicked() {
		// From the bucket the picked files were listed in.
		const listed = spaceAttachmentsListed;
		if (!spacePicking || listed === null) return;
		spaceMoveSourceId = listed.location;
		spaceMoveFiles = spacePicker.pickedFiles;
		spaceMoveFilter = spacePicker.filter;
		spaceMoveOpen = true;
	}

	/** Opens the move of all of a bucket's files, with fresh numbers for the room left in each bucket. */
	async function openMoveSpaceBucket(bucket: StorageBucket) {
		if (!spaceId || !canMoveSpaceFiles) return;
		const sid = spaceId;
		movingSpaceBucketId = bucket.id;
		try {
			const [files, bucketList] = await Promise.all([getSpaceAttachments(sid, bucket.id), getSpaceBuckets(sid)]);
			spaceBuckets = bucketList;
			storageTransfers.nameBuckets(bucketList);
			if (files.length === 0) {
				toast(`"${bucket.name}" has no files.`, "info");
				return;
			}
			spaceMoveSourceId = bucket.id;
			spaceMoveFiles = files;
			spaceMoveFilter = {};
			spaceMoveOpen = true;
		} catch (err) {
			toast(getApiError(err, "Failed to load the bucket's files"), "error");
		} finally {
			movingSpaceBucketId = null;
		}
	}

	function onSpaceMoveStarted() {
		spacePicker.picked.clear();
		// "Make … active" may have changed the active bucket.
		void loadSpaceBuckets();
	}

	// The transfer under way, if any, shows in Storage and Attachments: loaded on opening one (only who
	// started it gets its events, so other admins see it this way), then kept fresh.
	$effect(() => {
		if (open && canManageBuckets && spaceId && (activeSection === "storage" || activeSection === "attachments")) {
			return storageTransfers.watch(spaceId);
		}
	});

	// When one of the space's transfers ends, files have moved: reload what the open section shows.
	$effect(() =>
		storageTransfers.onEnd((t) => {
			if (!open || t.owner_id !== spaceId) return;
			if (activeSection === "storage") void loadSpaceBuckets();
			else if (activeSection === "attachments") {
				void loadSpaceAttachments();
				void loadSpaceBuckets();
			}
		}),
	);

	async function handleDeleteSpaceAttachment(att: SpaceAttachment) {
		if (!spaceId) return;
		const sid = spaceId;
		await confirmAction(
			`Delete "${att.filename}"? Emojis and stickers made from it are deleted too.`,
			"Delete",
			async () => {
				await deleteSpaceAttachment(sid, att.id);
				spaceAttachments = spaceAttachments.filter((a) => a.id !== att.id);
				spaceStorageUsed -= att.size_bytes;
			},
		);
	}

	async function handleDeleteAllSpaceAttachments() {
		if (!spaceId) return;
		const sid = spaceId;
		await confirmAction(
			"Delete all attachments in this space? Its emojis and stickers go with them. This cannot be undone.",
			"Delete",
			async () => {
				await deleteAllSpaceAttachments(sid);
				spaceAttachments = [];
				spaceStorageUsed = 0;
			},
		);
	}

	// Load the attachments on opening the section, and again for each location picked
	$effect(() => {
		if (open && activeSection === "attachments" && spaceId) {
			void loadSpaceAttachments(spaceAttachmentsLocation);
		}
	});

	// Invites: the ones that still work, and revoking them.
	let spaceInvites = $state<InviteLink[]>([]);
	let spaceInvitesLoading = $state(false);

	async function loadSpaceInvites() {
		if (!spaceId) return;
		spaceInvitesLoading = true;
		try {
			spaceInvites = await listSpaceInvites(spaceId);
		} catch (e) {
			toast(getApiError(e, "Failed to load invites"), "error");
		} finally {
			spaceInvitesLoading = false;
		}
	}

	async function handleRevokeInvite(invite: InviteLink) {
		if (!spaceId) return;
		const sid = spaceId;
		await confirmAction("Revoke this invite? Its link stops working.", "Revoke", async () => {
			await revokeInvite(sid, invite.id);
			spaceInvites = spaceInvites.filter((i) => i.id !== invite.id);
		});
	}

	function inviteCreator(userId: string): string {
		const user = space?.users.find((u) => u.id === userId);
		return user ? (user.alias ?? user.username) : "Unknown user";
	}

	$effect(() => {
		if (open && activeSection === "invites" && spaceId) {
			void loadSpaceInvites();
		}
	});

	function resetSpaceBucketForm() {
		sbName = "";
		sbEndpoint = "";
		sbRegion = "auto";
		sbBucketName = "";
		sbAccessKey = "";
		sbSecretKey = "";
		sbUsePathStyle = false;
		sbMaxBytesMB = "";
		sbUploadLimitMB = "";
		editingSpaceBucket = null;
		showSpaceBucketForm = false;
	}

	function startEditSpaceBucket(b: StorageBucket) {
		editingSpaceBucket = b;
		showSpaceBucketForm = true;
		sbName = b.name;
		sbEndpoint = b.endpoint;
		sbRegion = b.region;
		sbBucketName = b.bucket_name;
		sbAccessKey = b.access_key_id;
		sbSecretKey = "";
		sbUsePathStyle = b.use_path_style;
		sbMaxBytesMB = b.max_bytes ? String(b.max_bytes / 1024 / 1024) : "";
		sbUploadLimitMB = b.upload_limit_bytes ? String(b.upload_limit_bytes / 1024 / 1024) : "";
	}

	async function handleSaveSpaceBucket() {
		if (!sbName.trim() || !sbEndpoint.trim() || !sbBucketName.trim() || !sbAccessKey.trim() || !spaceId) return;
		const sid = spaceId;

		const doSave = async () => {
			spaceBucketSaving = true;
			spaceBucketsError = null;
			try {
				const maxMB = parseFloat(sbMaxBytesMB);
				const uploadMB = parseFloat(sbUploadLimitMB);
				const payload: CreateBucketPayload = {
					name: sbName.trim(),
					endpoint: sbEndpoint.trim(),
					region: sbRegion.trim() || "auto",
					bucket_name: sbBucketName.trim(),
					access_key_id: sbAccessKey.trim(),
					secret_access_key: sbSecretKey.trim(),
					use_path_style: sbUsePathStyle,
					// Sent on an edit too: null removes a limit.
					max_bytes: maxMB > 0 ? Math.round(maxMB * 1024 * 1024) : null,
					upload_limit_bytes: uploadMB > 0 ? Math.round(uploadMB * 1024 * 1024) : null,
				};
				if (editingSpaceBucket) {
					await updateSpaceBucket(sid, editingSpaceBucket.id, payload);
				} else {
					await createSpaceBucket(sid, payload);
				}
				resetSpaceBucketForm();
				await loadSpaceBuckets();
			} catch (e) {
				spaceBucketsError = getApiError(e, "Failed to save");
			} finally {
				spaceBucketSaving = false;
			}
		};

		if (editingSpaceBucket) {
			await doSave();
		} else {
			await confirmAction(
				"You are about to connect external storage credentials to this server. Make sure you own and trust these credentials. The bucket owner can read, modify, or delete all emojis, and stickers, and revoke access at any time.",
				"Yes, add bucket",
				doSave,
			);
		}
	}

	async function handleDeleteSpaceBucket(id: string) {
		if (!spaceId) return;
		const sid = spaceId;
		const b = spaceBuckets.find((x) => x.id === id);
		await confirmAction(`Delete bucket "${b?.name}"?`, "Delete", async () => {
			try {
				await deleteSpaceBucket(sid, id);
			} catch (err) {
				// Deleting it would break its files: offer to move them or delete them with it, which both take
				// ManageSpaceAttachments too.
				const files = bucketFilesCount(err);
				if (files === null || !b) throw err;
				if (!canManageAttachments) {
					const them = files === 1 ? "it" : "them";
					throw new Error(
						`This bucket has ${countFiles(files)}. Moving or deleting ${them} takes the Manage Attachments permission.`,
						{ cause: err },
					);
				}
				spaceBucketFilesRequest = { bucket: b, files };
				return;
			}
			await afterSpaceBucketDeleted(id);
		});
	}

	async function deleteSpaceBucketWithFiles(bucket: StorageBucket) {
		if (!spaceId) return;
		await deleteSpaceBucket(spaceId, bucket.id, true);
		await afterSpaceBucketDeleted(bucket.id);
	}

	async function afterSpaceBucketDeleted(id: string) {
		if (spaceAttachmentsLocation === id) setSpaceAttachmentsLocation("all");
		await loadSpaceBuckets();
	}

	async function handleToggleSpaceBucket(b: StorageBucket) {
		if (!spaceId) return;
		togglingSpaceBucketId = b.id;
		try {
			if (b.is_active) {
				await deactivateSpaceBucket(spaceId, b.id);
			} else {
				await activateSpaceBucket(spaceId, b.id);
			}
			await loadSpaceBuckets();
		} catch (e) {
			toast(getApiError(e, "Failed to toggle bucket"), "error");
		} finally {
			togglingSpaceBucketId = null;
		}
	}

	const selectedSettingsMember = $derived(
		space && selectedMemberUserId
			? ((space.members ?? []).find((m) => m.user_id === selectedMemberUserId) ?? null)
			: null,
	);

	const selectedSettingsUser = $derived(
		space && selectedMemberUserId ? (space.users.find((u) => u.id === selectedMemberUserId) ?? null) : null,
	);

	// Kick and Ban for the member picked, when the API would let the user act on them (moderationOf).
	const selectedSettingsModeration = $derived(
		selectedSettingsMember && selectedSettingsUser
			? moderationOf(space, {
					id: selectedSettingsUser.id,
					member_id: selectedSettingsMember.id,
					username: selectedSettingsMember.alias ?? selectedSettingsUser.alias ?? selectedSettingsUser.username,
				})
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
			<div
				class="flex h-[85vh] max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-100 shadow-2xl"
			>
				<!-- Left sidebar -->
				<aside class="flex w-56 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 py-6">
					<div class="mb-4 px-4">
						<p class="text-xxs mb-1 px-2 font-bold tracking-widest text-zinc-400 uppercase">
							{space?.name ?? "Server"} Settings
						</p>
					</div>

					<nav class="flex flex-col gap-0.5 px-2">
						{#if sections.includes("overview")}
							<button
								class="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-100
                            {activeSection === 'overview'
									? 'bg-zinc-800 text-white'
									: 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
								onclick={() => (activeSection = "overview")}
							>
								<GearSixIcon class="size-4" />
								Overview
							</button>
						{/if}

						{#if sections.includes("roles")}
							<button
								class="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-100
                            {activeSection === 'roles'
									? 'bg-zinc-800 text-white'
									: 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
								onclick={() => (activeSection = "roles")}
							>
								<ShieldStarIcon class="size-4" />
								Roles
							</button>
						{/if}

						{#if sections.includes("members")}
							<button
								class="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-100
                            {activeSection === 'members'
									? 'bg-zinc-800 text-white'
									: 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
								onclick={() => (activeSection = "members")}
							>
								<UsersThreeIcon class="size-4" />
								Members
							</button>
						{/if}

						{#if sections.includes("invites")}
							<button
								class="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-100
                            {activeSection === 'invites'
									? 'bg-zinc-800 text-white'
									: 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
								onclick={() => (activeSection = "invites")}
							>
								<LinkIcon class="size-4" />
								Invites
							</button>
						{/if}

						{#if sections.includes("bans")}
							<button
								class="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-100
                            {activeSection === 'bans'
									? 'bg-zinc-800 text-white'
									: 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
								onclick={() => (activeSection = "bans")}
							>
								<BanIcon class="size-4" />
								Bans
							</button>
						{/if}

						<button
							class="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-100
                            {activeSection === 'emojis'
								? 'bg-zinc-800 text-white'
								: 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
							onclick={() => (activeSection = "emojis")}
						>
							<SmileIcon class="size-4" />
							Emojis
						</button>

						<button
							class="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-100
                            {activeSection === 'stickers'
								? 'bg-zinc-800 text-white'
								: 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
							onclick={() => (activeSection = "stickers")}
						>
							<StickerIcon class="size-4" />
							Stickers
						</button>

						{#if sections.includes("storage")}
							<button
								class="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-100
                            {activeSection === 'storage'
									? 'bg-zinc-800 text-white'
									: 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
								onclick={() => (activeSection = "storage")}
							>
								<DatabaseIcon class="size-4" />
								Storage
							</button>
						{/if}
						{#if sections.includes("attachments")}
							<button
								class="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-100
                            {activeSection === 'attachments'
									? 'bg-zinc-800 text-white'
									: 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
								onclick={() => (activeSection = "attachments")}
							>
								<PaperclipIcon class="size-4" />
								Attachments
							</button>
						{/if}
					</nav>
				</aside>

				<!-- Content area -->
				<div class="flex min-w-0 flex-1 flex-col">
					<!-- Header -->
					<div class="flex shrink-0 items-center justify-between border-b border-zinc-800 px-6 py-4">
						<h2 class="text-base font-semibold text-white capitalize">
							{activeSection === "overview"
								? "Overview"
								: activeSection === "roles"
									? "Roles"
									: activeSection === "invites"
										? "Invites"
										: activeSection === "bans"
											? "Bans"
											: activeSection === "emojis"
												? "Emojis"
												: activeSection === "stickers"
													? "Stickers"
													: activeSection === "storage"
														? "Storage"
														: activeSection === "attachments"
															? "Attachments"
															: "Members"}
						</h2>
						<Dialog.Close
							class="rounded-lg p-1.5 text-zinc-400 transition-colors duration-150 hover:bg-zinc-800 hover:text-white"
							aria-label="Close"
						>
							<XIcon class="size-5" />
						</Dialog.Close>
					</div>

					<!-- Scrollable content -->
					<div class="flex-1 space-y-5 overflow-y-auto p-6">
						{#if activeSection === "overview"}
							<div class="space-y-5">
								<!-- Banner -->
								<div>
									<span class="mb-1.5 block text-xs font-semibold tracking-wide text-zinc-400 uppercase">Banner</span>
									<div class="group relative h-24 w-60 overflow-hidden rounded-lg bg-zinc-800">
										{#if pendingBannerPreview}
											<img src={pendingBannerPreview} alt="banner" class="h-full w-full object-cover" />
											<div
												class="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100"
											>
												<button
													class="text-fixed-white hover:bg-fixed-white/20 rounded p-1.5"
													onclick={() => (showSpaceBannerCrop = true)}><PencilIcon class="size-4" /></button
												>
												<button
													class="hover:bg-fixed-white/20 rounded p-1.5 text-red-400"
													onclick={() => {
														if (pendingBannerPreview) URL.revokeObjectURL(pendingBannerPreview);
														pendingBanner = null;
														pendingBannerPreview = null;
													}}><XIcon class="size-4" /></button
												>
											</div>
										{:else if pendingBanner === "remove"}
											<div class="flex h-full items-center justify-center text-zinc-600">No banner</div>
											<div
												class="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100"
											>
												<button
													class="text-fixed-white text-xs"
													onclick={() => {
														pendingBanner = null;
													}}>Undo</button
												>
											</div>
										{:else if space?.banner}
											<img src={getAvatarURL(space.id, space.banner)} alt="banner" class="h-full w-full object-cover" />
											<div
												class="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100"
											>
												<button
													class="text-fixed-white hover:bg-fixed-white/20 rounded p-1.5"
													onclick={() => (showSpaceBannerCrop = true)}><PencilIcon class="size-4" /></button
												>
												<button
													class="hover:bg-fixed-white/20 rounded p-1.5 text-red-400"
													onclick={() => {
														pendingBanner = "remove";
													}}><TrashIcon class="size-4" /></button
												>
											</div>
										{:else}
											<button
												class="flex h-full w-full items-center justify-center text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-zinc-300"
												onclick={() => (showSpaceBannerCrop = true)}
											>
												<PlusIcon class="mr-1.5 size-4" /> Set banner
											</button>
										{/if}
									</div>
								</div>

								<!-- Icon -->
								<div>
									<span class="mb-1.5 block text-xs font-semibold tracking-wide text-zinc-400 uppercase">Icon</span>
									<div class="group relative h-20 w-20">
										{#if pendingIconPreview}
											<img src={pendingIconPreview} alt="icon" class="h-full w-full rounded-2xl object-cover" />
											<div
												class="absolute inset-0 flex items-center justify-center gap-1 rounded-2xl bg-black/60 opacity-0 transition-opacity group-hover:opacity-100"
											>
												<button
													class="text-fixed-white hover:bg-fixed-white/20 rounded p-1"
													onclick={() => (showSpaceIconCrop = true)}><PencilIcon class="size-3.5" /></button
												>
												<button
													class="hover:bg-fixed-white/20 rounded p-1 text-red-400"
													onclick={() => {
														if (pendingIconPreview) URL.revokeObjectURL(pendingIconPreview);
														pendingIcon = null;
														pendingIconPreview = null;
													}}><XIcon class="size-3.5" /></button
												>
											</div>
										{:else if pendingIcon === "remove"}
											<div class="flex h-full w-full items-center justify-center rounded-2xl bg-zinc-800 text-zinc-600">
												<XIcon class="size-5" />
											</div>
											<div
												class="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/60 opacity-0 transition-opacity group-hover:opacity-100"
											>
												<button
													class="text-fixed-white text-xs"
													onclick={() => {
														pendingIcon = null;
													}}>Undo</button
												>
											</div>
										{:else if space?.icon}
											<img
												src={getAvatarURL(space.id, space.icon)}
												alt="icon"
												class="h-full w-full rounded-2xl object-cover"
											/>
											<div
												class="absolute inset-0 flex items-center justify-center gap-1 rounded-2xl bg-black/60 opacity-0 transition-opacity group-hover:opacity-100"
											>
												<button
													class="text-fixed-white hover:bg-fixed-white/20 rounded p-1"
													onclick={() => (showSpaceIconCrop = true)}><PencilIcon class="size-3.5" /></button
												>
												<button
													class="hover:bg-fixed-white/20 rounded p-1 text-red-400"
													onclick={() => {
														pendingIcon = "remove";
													}}><TrashIcon class="size-3.5" /></button
												>
											</div>
										{:else}
											<button
												class="flex h-full w-full items-center justify-center rounded-2xl bg-zinc-800 text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-zinc-300"
												onclick={() => (showSpaceIconCrop = true)}
											>
												<PlusIcon class="size-5" />
											</button>
										{/if}
									</div>
								</div>

								<p class="text-xxs text-zinc-500">Server ID: {spaceId}</p>

								<!-- Name -->
								<label class="block space-y-1.5">
									<span class="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Server Name</span>
									<input
										type="text"
										bind:value={ovName}
										placeholder="Server name"
										maxlength={64}
										class="h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-stone-500"
									/>
								</label>

								<!-- Description -->
								<label class="block space-y-1.5">
									<span class="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Description</span>
									<textarea
										bind:value={ovDescription}
										placeholder="What is this server about?"
										rows="3"
										maxlength={256}
										class="w-full resize-none rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-stone-500"
									></textarea>
								</label>

								<!-- Locale -->
								<label class="block space-y-1.5">
									<span class="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Locale</span>
									<input
										type="text"
										bind:value={ovLocale}
										placeholder="en"
										maxlength={4}
										class="h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-stone-500"
									/>
								</label>

								<!-- Save -->
								{#if ovHasChanges}
									<button
										onclick={handleSaveOverview}
										disabled={ovSaving}
										class="bg-fill-600 text-fixed-white hover:bg-fill-500 rounded-md px-4 py-2 text-sm font-medium tabular-nums transition-colors disabled:opacity-50"
									>
										{ovSaving ? (ovUploadPercent === null ? "Saving..." : uploadNote(ovUploadPercent)) : "Save Changes"}
									</button>
								{/if}

								<!-- Delete: the owner's alone, confirmed by typing the space's name -->
								{#if isOwner && space}
									<div class="mt-8 rounded-lg border border-red-900/60 bg-red-950/20 p-4">
										<h3 class="text-sm font-semibold text-red-300">Delete Space</h3>
										<p class="mt-1 text-xs text-zinc-400">
											It goes for everyone in it, with its rooms and messages. This can't be undone.
										</p>
										{#if !confirmingDelete}
											<button
												onclick={() => (confirmingDelete = true)}
												class="text-fixed-white mt-3 rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-red-500"
											>
												Delete Space
											</button>
										{:else}
											<label class="mt-3 block space-y-1.5">
												<span class="text-xs text-zinc-300">
													Type <strong class="font-semibold text-zinc-100">{space.name}</strong> to delete it.
												</span>
												<input
													type="text"
													bind:value={deleteConfirm}
													placeholder={space.name}
													disabled={deletingSpace}
													onkeydown={(e) => {
														if (e.key === "Enter") void handleDeleteSpace();
													}}
													class="h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-red-500 disabled:opacity-50"
												/>
											</label>
											{#if deleteError}
												<p class="mt-2 text-sm text-red-400">{deleteError}</p>
											{/if}
											<div class="mt-3 flex gap-2">
												<button
													onclick={handleDeleteSpace}
													disabled={!deleteNameMatches || deletingSpace}
													class="text-fixed-white rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
												>
													{deletingSpace ? "Deleting…" : "Delete Space"}
												</button>
												<button
													onclick={() => {
														confirmingDelete = false;
														deleteConfirm = "";
														deleteError = null;
													}}
													disabled={deletingSpace}
													class="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:text-white disabled:opacity-50"
												>
													Cancel
												</button>
											</div>
										{/if}
									</div>
								{/if}
							</div>
						{:else if activeSection === "roles"}
							{#if canManageRoles && space}
								<!-- Create new role -->
								<div class="space-y-4 rounded-xl border border-zinc-700 bg-zinc-900 p-5">
									<div class="space-y-1">
										<h3 class="text-sm font-semibold tracking-wide text-white">Create New Role</h3>
										<p class="text-xs text-zinc-400">Set role identity, color, and permissions.</p>
									</div>

									<!-- Name -->
									<label class="block space-y-1.5">
										<span class="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">Role name</span>
										<input
											type="text"
											placeholder="Role name"
											bind:value={newRoleName}
											maxlength={64}
											class="h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-stone-500"
										/>
									</label>

									<!-- Color -->
									<div class="space-y-2 rounded-lg border border-zinc-800 bg-zinc-800/40 p-3">
										<div class="flex items-center justify-between">
											<span class="text-xs font-medium text-zinc-400">Color</span>
											<label class="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-400">
												<input
													type="checkbox"
													bind:checked={newRoleUseGradient}
													class="cursor-pointer accent-stone-500"
												/>
												Gradient
											</label>
										</div>
										<div class="flex flex-wrap items-center gap-3">
											<div class="flex items-center gap-1.5">
												<input
													type="color"
													bind:value={newRoleColorFrom}
													class="color-swatch size-7 cursor-pointer rounded-md border-2 border-zinc-600 bg-none p-0"
													title="Color from"
												/>
												<span class="text-xxs text-zinc-500">From</span>
											</div>
											{#if newRoleUseGradient}
												<div class="flex items-center gap-1.5">
													<input
														type="color"
														bind:value={newRoleColorVia}
														class="color-swatch size-7 cursor-pointer rounded-md border-2 border-zinc-600 bg-none p-0"
														title="Color via (middle)"
													/>
													<span class="text-xxs text-zinc-500">Via</span>
												</div>
												<div class="flex items-center gap-1.5">
													<input
														type="color"
														bind:value={newRoleColorTo}
														class="color-swatch size-7 cursor-pointer rounded-md border-2 border-zinc-600 bg-none p-0"
														title="Color to"
													/>
													<span class="text-xxs text-zinc-500">To</span>
												</div>
											{/if}
											<!-- Preview swatch -->
											<div
												class="ml-auto h-7 w-16 rounded-md border border-zinc-700"
												style={roleGradientStyle({
													color_from: hexToInt(newRoleColorFrom),
													color_via: newRoleUseGradient && newRoleColorVia ? hexToInt(newRoleColorVia) : null,
													color_to: newRoleUseGradient && newRoleColorTo ? hexToInt(newRoleColorTo) : null,
												})}
											></div>
										</div>
									</div>

									<!-- Hoisted -->
									<label
										class="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-800 bg-zinc-800/40 px-2.5 py-2 text-xs text-zinc-200 hover:text-white"
									>
										<Checkbox.Root
											bind:checked={newRoleHoisted}
											class="text-xxs data-[state=checked]:bg-fill-600 data-[state=checked]:text-fixed-white flex size-4 items-center justify-center rounded border border-zinc-600 bg-zinc-900 text-transparent data-[state=checked]:border-stone-600"
											>✓</Checkbox.Root
										>
										Display role members separately in sidebar
									</label>

									<!-- Permissions -->
									<div>
										<p class="mb-1.5 text-xs font-medium text-zinc-400">Permissions</p>
										<div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
											{#each PERMISSIONS as perm}
												{@const settable = canSetPermission(spacePermissions, 0, perm.flag)}
												<label
													class="flex items-start gap-2 rounded-md border border-zinc-800 bg-zinc-800/70 px-2.5 py-2 text-xs text-zinc-200 {settable
														? 'cursor-pointer hover:text-white'
														: 'cursor-not-allowed opacity-50'}"
													title={settable ? undefined : "You can only grant permissions you have"}
												>
													<Checkbox.Root
														checked={newRolePermissions.includes(perm.flag)}
														disabled={!settable}
														onCheckedChange={() => {
															togglePermission(perm.flag, false);
														}}
														class="text-xxs data-[state=checked]:bg-fill-600 data-[state=checked]:text-fixed-white flex size-4 shrink-0 items-center justify-center rounded border border-zinc-600 bg-zinc-900 text-transparent data-[state=checked]:border-stone-600"
														>✓</Checkbox.Root
													>
													<span class="min-w-0">
														<span class="block leading-4">{perm.name}</span>
														<span class="text-xxs mt-0.5 block leading-snug text-zinc-500">{perm.description}</span>
													</span>
												</label>
											{/each}
										</div>
									</div>

									<button
										class="bg-fill-600 text-fixed-white hover:bg-fill-500 h-10 w-full rounded-md px-3 text-sm font-medium transition-colors disabled:opacity-50"
										onclick={handleCreateRole}
										disabled={isCreating || !newRoleName.trim()}
									>
										{isCreating ? "Creating…" : "Create Role"}
									</button>
								</div>

								<!-- Existing roles -->
								<div class="space-y-2">
									<h3 class="text-sm font-semibold text-white">Existing Roles</h3>
									<p class="text-xs text-zinc-400">Drag to reorder. Edit or delete using actions on the right.</p>
									{#each sortedRoles as role, i}
										{@const manageable = canManageRoleAt(space, role.position)}
										<div
											class="overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 transition-opacity duration-100"
											class:opacity-40={isDragging && dragIndex !== i}
											class:ring-2={isDragging && dragIndex === i}
											class:ring-stone-500={isDragging && dragIndex === i}
											draggable={editingRoleId !== role.id && manageable}
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
											<div class="h-1 w-full" style={roleGradientStyle(role)}></div>
											<div class="p-3">
												{#if editingRoleId === role.id}
													<div class="space-y-3">
														<input
															type="text"
															bind:value={editingRoleName}
															placeholder="Role name"
															maxlength={64}
															class="w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-stone-500"
														/>

														<!-- Color -->
														<div class="space-y-1.5">
															<div class="flex items-center justify-between">
																<span class="text-xs font-medium text-zinc-400">Color</span>
																<div class="flex items-center gap-2">
																	<button
																		type="button"
																		onclick={() => {
																			editingRoleClearColors = !editingRoleClearColors;
																		}}
																		class="text-xxs rounded px-1.5 py-0.5 transition-colors {editingRoleClearColors
																			? 'text-fixed-white bg-red-500'
																			: 'bg-zinc-700 text-zinc-300 hover:text-zinc-100'}">Clear color</button
																	>
																	{#if !editingRoleClearColors}
																		<label class="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-400">
																			<input
																				type="checkbox"
																				bind:checked={editingRoleUseGradient}
																				class="cursor-pointer accent-stone-500"
																			/>
																			Gradient
																		</label>
																	{/if}
																</div>
															</div>
															{#if !editingRoleClearColors}
																<div class="flex flex-wrap items-center gap-2">
																	<div class="flex items-center gap-1.5">
																		<input
																			type="color"
																			bind:value={editingRoleColorFrom}
																			class="color-swatch size-7 cursor-pointer rounded-md border-2 border-zinc-600 bg-none p-0"
																			title="Color from"
																		/>
																		<span class="text-xxs text-zinc-500">From</span>
																	</div>
																	{#if editingRoleUseGradient}
																		<div class="flex items-center gap-1.5">
																			<input
																				type="color"
																				bind:value={editingRoleColorVia}
																				class="color-swatch size-7 cursor-pointer rounded-md border-2 border-zinc-600 bg-none p-0"
																				title="Via"
																			/>
																			<span class="text-xxs text-zinc-500">Via</span>
																		</div>
																		<div class="flex items-center gap-1.5">
																			<input
																				type="color"
																				bind:value={editingRoleColorTo}
																				class="color-swatch size-7 cursor-pointer rounded-md border-2 border-zinc-600 bg-none p-0"
																				title="To"
																			/>
																			<span class="text-xxs text-zinc-500">To</span>
																		</div>
																	{/if}
																	<div
																		class="ml-auto h-5 w-12 rounded-full"
																		style={roleGradientStyle({
																			color_from: hexToInt(editingRoleColorFrom),
																			color_via:
																				editingRoleUseGradient && editingRoleColorVia
																					? hexToInt(editingRoleColorVia)
																					: null,
																			color_to:
																				editingRoleUseGradient && editingRoleColorTo
																					? hexToInt(editingRoleColorTo)
																					: null,
																		})}
																	></div>
																</div>
															{/if}
														</div>

														<!-- Hoisted -->
														<label
															class="flex cursor-pointer items-center gap-2 text-xs text-zinc-200 hover:text-white"
														>
															<Checkbox.Root
																bind:checked={editingRoleHoisted}
																class="text-xxs data-[state=checked]:bg-fill-600 data-[state=checked]:text-fixed-white flex size-4 items-center justify-center rounded border border-zinc-600 bg-zinc-900 text-transparent data-[state=checked]:border-stone-600"
																>✓</Checkbox.Root
															>
															Display role members separately in sidebar
														</label>

														<!-- Permissions -->
														<div>
															<p class="mb-1.5 text-xs font-medium text-zinc-400">Permissions</p>
															<div class="grid grid-cols-2 gap-x-3 gap-y-2.5">
																{#each PERMISSIONS as perm}
																	{@const settable = canSetPermission(spacePermissions, editingRoleSaved, perm.flag)}
																	<label
																		class="flex items-start gap-2 text-xs text-zinc-200 {settable
																			? 'cursor-pointer hover:text-white'
																			: 'cursor-not-allowed opacity-50'}"
																		title={settable ? undefined : "You can only grant permissions you have"}
																	>
																		<Checkbox.Root
																			checked={(editingRolePermissions & perm.flag) === perm.flag}
																			disabled={!settable}
																			onCheckedChange={() => {
																				togglePermission(perm.flag, true);
																			}}
																			class="text-xxs data-[state=checked]:bg-fill-600 data-[state=checked]:text-fixed-white flex size-4 shrink-0 items-center justify-center rounded border border-zinc-600 bg-zinc-900 text-transparent data-[state=checked]:border-stone-600"
																			>✓</Checkbox.Root
																		>
																		<span class="min-w-0">
																			<span class="block leading-4">{perm.name}</span>
																			<span class="text-xxs mt-0.5 block leading-snug text-zinc-500"
																				>{perm.description}</span
																			>
																		</span>
																	</label>
																{/each}
															</div>
														</div>

														<div class="flex gap-2">
															<button
																class="bg-fill-600 text-fixed-white hover:bg-fill-500 flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
																onclick={handleUpdateRole}
																disabled={isCreating}>Save</button
															>
															<button
																class="flex-1 rounded-md bg-zinc-700 px-2 py-1.5 text-xs text-white transition-colors hover:bg-zinc-600"
																onclick={cancelEdit}>Cancel</button
															>
														</div>
													</div>
												{:else}
													<div class="flex items-center gap-2">
														<DotsSixVerticalIcon
															class="size-4 shrink-0 cursor-grab text-zinc-500 active:cursor-grabbing"
														/>
														<div class="min-w-0 flex-1">
															<div class="mb-0.5 flex items-center gap-2">
																<span class="text-sm font-medium text-zinc-200">{role.name}</span>
																{#if role.hoisted}
																	<span class="text-xxs rounded bg-zinc-700 px-1.5 py-0.5 text-zinc-300">hoisted</span>
																{/if}
															</div>
															<p class="truncate text-xs text-zinc-500">
																{getPermissionNames(role.permissions)}
															</p>
														</div>
														<!-- Only a role below the user's highest one, as the API's checkRoleHierarchy allows -->
														<div
															class="ml-1 flex shrink-0 gap-1.5"
															title={manageable ? undefined : "Only roles below your highest role can be managed"}
														>
															<button
																class="h-7 rounded-md bg-zinc-700 px-2.5 text-xs text-zinc-100 transition-colors hover:bg-zinc-600 disabled:cursor-not-allowed disabled:opacity-50"
																disabled={!manageable}
																onclick={() => {
																	startEdit(role);
																}}>Edit</button
															>
															<!-- everyone (its ID is the space's) can be edited, not deleted -->
															{#if role.id !== spaceId}
																<button
																	class="text-fixed-white h-7 rounded-md bg-red-800/70 px-2.5 text-xs transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
																	disabled={!manageable}
																	onclick={() => handleDeleteRole(role.id)}>Delete</button
																>
															{/if}
														</div>
													</div>
												{/if}
											</div>
										</div>
									{/each}
									{#if space.roles.length === 0}
										<p class="py-4 text-center text-sm text-zinc-400">
											No roles yet. Create one to start assigning permissions.
										</p>
									{/if}
								</div>
							{:else}
								<p class="text-sm text-zinc-400">You don't have permission to manage roles.</p>
							{/if}
						{:else if activeSection === "members"}
							{#if space}
								<div class="space-y-3">
									<h3 class="text-sm font-semibold text-white">
										Members ({formatCount(space.members?.length ?? 0)})
									</h3>
									{#each space.members ?? [] as member}
										{@const user = space.users.find((u) => u.id === member.user_id)}
										<button
											type="button"
											class="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors {selectedMemberUserId ===
											member.user_id
												? 'border-stone-500/50 bg-zinc-700/60'
												: 'hover:bg-zinc-750 border-zinc-700 bg-zinc-800'}"
											onclick={() => (selectedMemberUserId = member.user_id)}
										>
											<UserAvatar
												src={getAvatarURL(member.user_id, user?.avatar)}
												name={user?.username ?? "Unknown"}
												size={32}
											/>
											<div class="min-w-0 flex-1">
												<p class="truncate text-sm font-medium text-zinc-200">
													{member.alias ?? user?.username ?? "Unknown member"}
												</p>
												<p class="truncate text-xs text-zinc-400">
													{(space.member_roles[member.user_id] ?? [])
														.map((rid) => space.roles.find((r) => r.id === rid)?.name)
														.filter(Boolean)
														.join(", ") || "No roles assigned"}
												</p>
											</div>
										</button>
									{/each}

									{#if selectedSettingsMember && selectedSettingsUser}
										<div class="bg-zinc-850 rounded-xl border border-zinc-700 p-4">
											<div class="mb-3 flex items-center justify-between">
												<h4 class="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Member Details</h4>
												<button
													type="button"
													class="rounded px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
													onclick={() => (selectedMemberUserId = null)}>Close</button
												>
											</div>
											<div class="flex items-center gap-3">
												<UserAvatar
													src={getAvatarURL(selectedSettingsUser.id, selectedSettingsUser.avatar)}
													name={selectedSettingsUser.username}
													size={40}
												/>
												<div class="min-w-0">
													<p class="truncate text-sm font-semibold text-zinc-100">
														{selectedSettingsMember.alias ?? selectedSettingsUser.username}
													</p>
													<p class="truncate text-xs text-zinc-400">@{selectedSettingsUser.username}</p>
													<p class="truncate text-[11px] text-zinc-500">User ID: {selectedSettingsUser.id}</p>
												</div>
											</div>
											<div class="mt-3">
												<p class="mb-2 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">Roles</p>
												{#if selectedSettingsRoles.length > 0}
													<div class="flex flex-wrap gap-1.5">
														{#each selectedSettingsRoles as role}
															<span
																class="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200"
																>{role.name}</span
															>
														{/each}
													</div>
												{:else}
													<p class="text-xs text-zinc-500">No roles assigned</p>
												{/if}
											</div>
											{#if selectedSettingsModeration}
												<div class="mt-4 flex gap-2 border-t border-zinc-700 pt-3">
													{#if selectedSettingsModeration.kick}
														<button
															type="button"
															class="flex h-8 items-center gap-1.5 rounded-md bg-red-600/15 px-3 text-xs font-medium text-red-400 transition-colors hover:bg-red-600/25"
															onclick={() => void kickFromSpace(selectedSettingsModeration.target)}
														>
															<UserMinusIcon class="size-3.5" />
															Kick
														</button>
													{/if}
													{#if selectedSettingsModeration.ban}
														<button
															type="button"
															class="flex h-8 items-center gap-1.5 rounded-md bg-red-600/15 px-3 text-xs font-medium text-red-400 transition-colors hover:bg-red-600/25"
															onclick={() => banRequest.set(selectedSettingsModeration.target)}
														>
															<BanIcon class="size-3.5" />
															Ban
														</button>
													{/if}
												</div>
											{/if}
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

										<div class="flex flex-wrap items-end gap-3">
											<label class="block min-w-40 flex-1 space-y-1.5">
												<span class="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">Name</span>
												<input
													type="text"
													class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
													placeholder="emoji_name"
													bind:value={newEmojiName}
												/>
											</label>

											<label class="block space-y-1.5">
												<span class="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">Image</span>
												<button
													type="button"
													class="flex size-9.5 items-center justify-center overflow-hidden rounded-lg border border-dashed border-zinc-600 bg-zinc-800 text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-200"
													title={newEmojiPreview ? "Change image" : "Choose image"}
													onclick={() => (showEmojiCrop = true)}
												>
													{#if newEmojiPreview}
														<img src={newEmojiPreview} alt="" class="size-full object-contain" />
													{:else}
														<ImagePlusIcon class="size-4" />
													{/if}
												</button>
											</label>

											<button
												class="text-fixed-white flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium tabular-nums transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
												onclick={handleUploadEmoji}
												disabled={isUploadingEmoji || !newEmojiName.trim() || !newEmojiFile}
											>
												<UploadIcon class="size-4" />
												{isUploadingEmoji
													? emojiUploadPercent === null
														? "Uploading..."
														: uploadNote(emojiUploadPercent)
													: "Upload"}
											</button>
										</div>
									</div>
								{/if}

								<!-- Emoji list -->
								{#if spaceEmojis.length === 0}
									<div class="flex flex-col items-center justify-center py-12 text-center">
										<SmileIcon class="mb-3 size-10 text-zinc-600" />
										<p class="text-sm text-zinc-400">No custom emojis yet.</p>
										{#if canManageEmojis}
											<p class="mt-1 text-xs text-zinc-500">Upload one above to get started.</p>
										{/if}
									</div>
								{:else}
									<div class="space-y-1">
										{#each spaceEmojis as emoji (emoji.id)}
											<div
												class="group flex items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5"
											>
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
														onkeydown={(e) => {
															if (e.key === "Enter") handleUpdateEmoji();
															if (e.key === "Escape") cancelEmojiEdit();
														}}
													/>
													<button
														class="rounded p-1.5 text-green-400 transition-colors hover:bg-zinc-700"
														onclick={handleUpdateEmoji}
														title="Save"
													>
														<CheckIcon class="size-4" />
													</button>
													<button
														class="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-700"
														onclick={cancelEmojiEdit}
														title="Cancel"
													>
														<XIcon class="size-4" />
													</button>
												{:else}
													<div class="min-w-0 flex-1">
														<p class="truncate text-sm font-medium text-zinc-200">:{emoji.name}:</p>
													</div>

													{#if canManageEmojis}
														<button
															class="rounded p-1.5 text-zinc-400 opacity-0 transition-all group-hover:opacity-100 hover:bg-zinc-700 hover:text-zinc-200"
															onclick={() => startEmojiEdit(emoji)}
															title="Rename"
														>
															<PencilIcon class="size-4" />
														</button>
														<button
															class="rounded p-1.5 text-zinc-400 opacity-0 transition-all group-hover:opacity-100 hover:bg-zinc-700 hover:text-red-400"
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
						{:else if activeSection === "stickers"}
							{#if stickersLoading}
								<p class="text-sm text-zinc-400">Loading stickers...</p>
							{:else}
								{#if canManageStickers}
									<!-- Upload new sticker -->
									<div class="space-y-4 rounded-xl border border-zinc-700 bg-zinc-900 p-5">
										<div class="space-y-1">
											<h3 class="text-sm font-semibold tracking-wide text-white">Upload Sticker</h3>
											<p class="text-xs text-zinc-400">
												Custom stickers require a storage bucket configured for this server.
											</p>
										</div>

										<div class="flex flex-wrap items-end gap-3">
											<label class="block min-w-40 flex-1 space-y-1.5">
												<span class="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">Name</span>
												<input
													type="text"
													class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
													placeholder="sticker_name"
													bind:value={newStickerName}
												/>
											</label>

											<label class="block space-y-1.5">
												<span class="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">Image</span>
												<button
													type="button"
													class="flex size-9.5 items-center justify-center overflow-hidden rounded-lg border border-dashed border-zinc-600 bg-zinc-800 text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-200"
													title={newStickerPreview ? "Change image" : "Choose image"}
													onclick={() => (showStickerCrop = true)}
												>
													{#if newStickerPreview}
														<img src={newStickerPreview} alt="" class="size-full object-contain" />
													{:else}
														<ImagePlusIcon class="size-4" />
													{/if}
												</button>
											</label>

											<button
												class="text-fixed-white flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium tabular-nums transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
												onclick={handleUploadSticker}
												disabled={isUploadingSticker || !newStickerName.trim() || !newStickerFile}
											>
												<UploadIcon class="size-4" />
												{isUploadingSticker
													? stickerUploadPercent === null
														? "Uploading..."
														: uploadNote(stickerUploadPercent)
													: "Upload"}
											</button>
										</div>
									</div>
								{/if}

								<!-- Sticker list -->
								{#if spaceStickers.length === 0}
									<div class="flex flex-col items-center justify-center py-12 text-center">
										<StickerIcon class="mb-3 size-10 text-zinc-600" />
										<p class="text-sm text-zinc-400">No custom stickers yet.</p>
										{#if canManageStickers}
											<p class="mt-1 text-xs text-zinc-500">Upload one above to get started.</p>
										{/if}
									</div>
								{:else}
									<div class="space-y-1">
										{#each spaceStickers as sticker (sticker.id)}
											<div
												class="group flex items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5"
											>
												<img
													src="{attachmentHost}/attachments/{sticker.attachment_id}"
													alt={sticker.name}
													class="size-12 rounded object-contain"
												/>

												{#if editingStickerReact === sticker.id}
													<input
														type="text"
														class="flex-1 rounded-md border border-zinc-600 bg-zinc-700 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-zinc-500"
														bind:value={editingStickerName}
														onkeydown={(e) => {
															if (e.key === "Enter") handleUpdateSticker();
															if (e.key === "Escape") cancelStickerEdit();
														}}
													/>
													<button
														class="rounded p-1.5 text-green-400 transition-colors hover:bg-zinc-700"
														onclick={handleUpdateSticker}
														title="Save"
													>
														<CheckIcon class="size-4" />
													</button>
													<button
														class="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-700"
														onclick={cancelStickerEdit}
														title="Cancel"
													>
														<XIcon class="size-4" />
													</button>
												{:else}
													<div class="min-w-0 flex-1">
														<p class="truncate text-sm font-medium text-zinc-200">{sticker.name}</p>
													</div>

													{#if canManageStickers}
														<button
															class="rounded p-1.5 text-zinc-400 opacity-0 transition-all group-hover:opacity-100 hover:bg-zinc-700 hover:text-zinc-200"
															onclick={() => startStickerEdit(sticker)}
															title="Rename"
														>
															<PencilIcon class="size-4" />
														</button>
														<button
															class="rounded p-1.5 text-zinc-400 opacity-0 transition-all group-hover:opacity-100 hover:bg-zinc-700 hover:text-red-400"
															onclick={() => handleDeleteSticker(sticker.id)}
															disabled={isDeletingSticker[sticker.id]}
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
								{#if spaceTransfer}
									<StorageTransferCard
										transfer={spaceTransfer}
										source={spaceStorageLabel(spaceTransfer.source_bucket_id)}
										target={spaceStorageLabel(spaceTransfer.target_bucket_id)}
										startedBy={spaceTransfer.started_by === $currentUser?.id
											? null
											: inviteCreator(spaceTransfer.started_by)}
									/>
								{/if}
								<p class="mb-4 text-xs text-zinc-500">
									Connect an S3-compatible bucket for this server's storage. When a bucket is active, uploads go to your
									bucket.
								</p>

								{#if !spaceBucketsLoading}
									<div class="mb-4 flex gap-3 rounded-lg border border-amber-600/30 bg-amber-950/20 px-4 py-3">
										<svg
											xmlns="http://www.w3.org/2000/svg"
											width="20"
											height="20"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
											class="mt-0.5 shrink-0 text-amber-500"
											><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path
												d="M12 9v4"
											/><path d="M12 17h.01" /></svg
										>
										<div class="space-y-1 text-xs text-amber-300/80">
											<p class="font-semibold text-amber-300">Before adding a bucket</p>
											<p>
												Only enter credentials that <strong>you own and control</strong>. If someone shared credentials
												with you, be aware that:
											</p>
											<ul class="list-disc space-y-0.5 pl-4">
												<li>
													The bucket owner can <strong>read, modify, or delete</strong> all emojis, and stickers files.
												</li>
												<li>
													They can <strong>revoke access</strong> without warning, breaking emojis, and stickers across the
													server.
												</li>
												<li>
													All uploaded files may be <strong>logged, monitored, or shared</strong> by the bucket owner.
												</li>
											</ul>
										</div>
									</div>
								{/if}

								{#if spaceBucketsError}
									<p class="mb-4 rounded-md bg-red-400/10 px-3 py-2 text-sm text-red-400">{spaceBucketsError}</p>
								{/if}

								<!-- Create / Edit form -->
								{#if showSpaceBucketForm}
									<div class="mb-4 space-y-3 rounded-lg border border-zinc-800 bg-zinc-800/40 p-4">
										<h3 class="text-sm font-semibold text-white">
											{editingSpaceBucket ? "Edit Bucket" : "New Bucket"}
										</h3>
										<div class="grid grid-cols-2 gap-3">
											<div>
												<label for="sb-name" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase"
													>Name</label
												>
												<input
													id="sb-name"
													type="text"
													bind:value={sbName}
													placeholder="My R2"
													class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500"
												/>
											</div>
											<div>
												<label for="sb-region" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase"
													>Region</label
												>
												<input
													id="sb-region"
													type="text"
													bind:value={sbRegion}
													placeholder="auto"
													class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500"
												/>
											</div>
										</div>
										<div>
											<label for="sb-endpoint" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase"
												>Endpoint</label
											>
											<input
												id="sb-endpoint"
												type="text"
												bind:value={sbEndpoint}
												placeholder="https://account-id.r2.cloudflarestorage.com"
												class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500"
											/>
										</div>
										<div>
											<label for="sb-bucket-name" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase"
												>Bucket Name</label
											>
											<input
												id="sb-bucket-name"
												type="text"
												bind:value={sbBucketName}
												placeholder="my-bucket"
												class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500"
											/>
										</div>
										<div class="grid grid-cols-2 gap-3">
											<div>
												<label for="sb-access-key" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase"
													>Access Key ID</label
												>
												<input
													id="sb-access-key"
													type="text"
													bind:value={sbAccessKey}
													placeholder="access key"
													class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500"
												/>
											</div>
											<div>
												<label for="sb-secret-key" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase"
													>Secret Access Key</label
												>
												<input
													id="sb-secret-key"
													type="password"
													bind:value={sbSecretKey}
													placeholder={editingSpaceBucket ? "leave empty to keep current" : "secret key"}
													class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500"
												/>
											</div>
										</div>
										<label class="flex cursor-pointer items-center gap-2">
											<input
												type="checkbox"
												bind:checked={sbUsePathStyle}
												class="size-4 rounded border-zinc-600 bg-zinc-800 accent-stone-500"
											/>
											<span class="text-xs text-zinc-400"
												>Use path-style addressing <span class="text-zinc-600">(required for MinIO, RustFS, etc.)</span
												></span
											>
										</label>
										<div class="grid grid-cols-2 gap-3">
											<div>
												<label for="sb-max-bytes" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase"
													>Total Limit (MB)</label
												>
												<input
													id="sb-max-bytes"
													type="number"
													min="0"
													step="1"
													bind:value={sbMaxBytesMB}
													placeholder="No limit"
													class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500"
												/>
											</div>
											<div>
												<label for="sb-upload-limit" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase"
													>Per-file Limit (MB)</label
												>
												<input
													id="sb-upload-limit"
													type="number"
													min="0"
													step="1"
													bind:value={sbUploadLimitMB}
													placeholder="No limit"
													class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500"
												/>
											</div>
										</div>
										<p class="text-xxs text-zinc-600">
											Leave empty to remove limits. When a total limit is set, oldest files are recycled automatically
											when full.
										</p>
										<div class="flex justify-end gap-2 pt-1">
											<button
												class="rounded-md px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
												onclick={resetSpaceBucketForm}>Cancel</button
											>
											<button
												class="bg-fill-600 text-fixed-white hover:bg-fill-500 rounded-md px-4 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50"
												disabled={spaceBucketSaving}
												onclick={handleSaveSpaceBucket}
											>
												{spaceBucketSaving ? "Saving..." : editingSpaceBucket ? "Update" : "Create"}
											</button>
										</div>
									</div>
								{:else}
									<button
										class="mb-4 flex items-center gap-2 rounded-md bg-stone-600/20 px-3 py-2 text-sm font-medium text-stone-300 transition-colors hover:bg-stone-600/30"
										onclick={() => {
											resetSpaceBucketForm();
											showSpaceBucketForm = true;
										}}
									>
										<PlusIcon class="size-4" /> Add Bucket
									</button>
								{/if}

								<!-- Bucket list -->
								{#if spaceBucketsLoading}
									<div class="space-y-2">
										{#each Array(3) as _}
											<div class="h-16 animate-pulse rounded-lg bg-zinc-800/40"></div>
										{/each}
									</div>
								{:else if spaceBuckets.length === 0}
									<div class="flex flex-col items-center justify-center py-12 text-zinc-500">
										<DatabaseIcon class="mb-3 size-10" />
										<p class="text-sm">No buckets configured</p>
										<p class="mt-1 text-xs text-zinc-600">Add a bucket to enable custom emoji uploads.</p>
									</div>
								{:else}
									<div class="space-y-2">
										{#each spaceBuckets as bucket (bucket.id)}
											<div
												class="group flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-800/30 px-4 py-3 transition-colors hover:bg-zinc-800/50"
											>
												<div class="min-w-0 flex-1">
													<div class="flex items-center gap-2">
														<span class="text-sm font-medium text-zinc-200">{bucket.name}</span>
														{#if bucket.is_active}
															<span
																class="text-xxs rounded bg-emerald-600/20 px-1.5 py-0.5 font-semibold text-emerald-400"
																>ACTIVE</span
															>
														{:else}
															<span class="text-xxs rounded bg-zinc-600/20 px-1.5 py-0.5 font-semibold text-zinc-400"
																>INACTIVE</span
															>
														{/if}
													</div>
													<p class="mt-0.5 truncate text-xs text-zinc-500">{bucket.bucket_name} · {bucket.endpoint}</p>
													{#if bucket.max_bytes}
														{@const pct = Math.min(Math.round((bucket.used_bytes / bucket.max_bytes) * 100), 100)}
														<div class="mt-1.5 space-y-1">
															<div class="text-xxs flex items-center justify-between text-zinc-500">
																<span
																	>{(bucket.used_bytes / 1024 / 1024).toFixed(1)} MB / {(
																		bucket.max_bytes /
																		1024 /
																		1024
																	).toFixed(0)} MB</span
																>
																<span>{pct}%</span>
															</div>
															<div class="h-1.5 w-full overflow-hidden rounded-full bg-zinc-700">
																<div
																	class="h-full rounded-full transition-all duration-300 {pct > 90
																		? 'bg-red-500'
																		: pct > 70
																			? 'bg-yellow-500'
																			: 'bg-stone-500'}"
																	style="width: {pct}%"
																></div>
															</div>
															{#if bucket.upload_limit_bytes}
																<p class="text-xxs text-zinc-600">
																	Per-file: {(bucket.upload_limit_bytes / 1024 / 1024).toFixed(0)} MB
																</p>
															{/if}
														</div>
													{:else if bucket.upload_limit_bytes}
														<p class="text-xxs mt-0.5 text-zinc-600">
															Per-file: {(bucket.upload_limit_bytes / 1024 / 1024).toFixed(0)} MB
														</p>
													{/if}
												</div>
												<div
													class="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
												>
													<button
														class="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-all hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-50"
														title={bucket.is_active ? "Deactivate" : "Activate"}
														onclick={() => handleToggleSpaceBucket(bucket)}
														disabled={togglingSpaceBucketId === bucket.id}
													>
														{#if togglingSpaceBucketId === bucket.id}
															<div
																class="size-4 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent"
															></div>
														{:else if bucket.is_active}
															<XIcon class="size-4" />
														{:else}
															<CheckIcon class="size-4" />
														{/if}
													</button>
													{#if canMoveSpaceFiles}
														<button
															class="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-all hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-50"
															title={spaceTransfer ? "Wait for the transfer under way to end" : "Move files…"}
															onclick={() => openMoveSpaceBucket(bucket)}
															disabled={movingSpaceBucketId === bucket.id || spaceTransfer !== null}
														>
															{#if movingSpaceBucketId === bucket.id}
																<div
																	class="size-4 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent"
																></div>
															{:else}
																<MoveIcon class="size-4" />
															{/if}
														</button>
													{/if}
													<button
														class="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-all hover:bg-zinc-700 hover:text-zinc-200"
														title="Edit"
														onclick={() => startEditSpaceBucket(bucket)}
													>
														<PencilIcon class="size-4" />
													</button>
													<button
														class="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-all hover:bg-red-600/20 hover:text-red-400"
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
						{:else if activeSection === "invites"}
							<p class="mb-3 text-sm text-zinc-400">
								The invite links that still work. Revoking one makes it stop working for everyone.
							</p>
							{#if spaceInvitesLoading}
								<div class="space-y-2">
									{#each Array(3) as _}
										<div class="h-14 animate-pulse rounded-lg bg-zinc-800/40"></div>
									{/each}
								</div>
							{:else if spaceInvites.length === 0}
								<div class="flex flex-col items-center justify-center py-16 text-zinc-500">
									<LinkIcon class="mb-3 size-10" />
									<p class="text-sm">No invites</p>
								</div>
							{:else}
								<div class="space-y-1">
									{#each spaceInvites as invite (invite.id)}
										{@const room = space?.rooms.find((r) => r.id === invite.room_id)}
										<div
											class="group flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-800/30 px-3 py-2.5 transition-colors hover:bg-zinc-800/50"
										>
											<div class="min-w-0 flex-1">
												<p class="truncate font-mono text-sm text-zinc-200 select-text">{invite.code}</p>
												<p class="text-xs text-zinc-500">
													#{room?.name ?? "deleted channel"}
													<span class="mx-1 text-zinc-600">&middot;</span>
													{inviteCreator(invite.created_by)}
													<span class="mx-1 text-zinc-600">&middot;</span>
													{invite.expires_at
														? `Expires ${new Date(invite.expires_at).toLocaleString()}`
														: "Never expires"}
												</p>
											</div>
											<button
												onclick={() => handleRevokeInvite(invite)}
												class="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-zinc-500 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-600/20 hover:text-red-400"
												title="Revoke"
											>
												<TrashIcon class="size-4" />
												Revoke
											</button>
										</div>
									{/each}
								</div>
							{/if}
						{:else if activeSection === "bans"}
							{#if space}
								<SpaceBans {space} />
							{/if}
						{:else if activeSection === "attachments"}
							{#if spaceTransfer}
								<StorageTransferCard
									transfer={spaceTransfer}
									source={spaceStorageLabel(spaceTransfer.source_bucket_id)}
									target={spaceStorageLabel(spaceTransfer.target_bucket_id)}
									startedBy={spaceTransfer.started_by === $currentUser?.id
										? null
										: inviteCreator(spaceTransfer.started_by)}
								/>
							{/if}
							<div
								class="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-800/40 px-4 py-3"
							>
								<div class="text-sm text-zinc-300">
									{#if spaceListedHere}
										<span class="font-semibold text-white">{spaceAttachments.length}</span>
										file{spaceAttachments.length !== 1 ? "s" : ""}
										<span class="mx-1 text-zinc-600">&middot;</span>
										{formatFileSize(spaceAttachmentsLocation === "all" ? spaceStorageUsed : spaceLocationBytes)}
									{/if}
								</div>
								<div class="flex items-center gap-2">
									{#if canManageBuckets && (spaceBuckets.length > 0 || spaceAttachmentsLocation !== "all")}
										<label class="flex items-center gap-2 text-xs text-zinc-400">
											Location
											<select
												value={spaceAttachmentsLocation}
												onchange={(e) => setSpaceAttachmentsLocation(e.currentTarget.value)}
												class="max-w-40 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:ring-1 focus:ring-stone-500 focus:outline-none"
											>
												<option value="all">All</option>
												{#each spaceBuckets as b (b.id)}
													<option value={b.id}>{b.name}</option>
												{/each}
											</select>
										</label>
									{/if}
									{#if spaceAttachments.length > 0 && canManageAttachments && spaceAttachmentsLocation === "all"}
										<button
											onclick={handleDeleteAllSpaceAttachments}
											class="flex items-center gap-1.5 rounded-md bg-red-600/20 px-3 py-1.5 text-xs font-semibold text-red-400 transition-colors hover:bg-red-600/30"
										>
											<TrashIcon class="size-3.5" />
											Delete All
										</button>
									{/if}
								</div>
							</div>

							{#if spaceAttachmentsLoading}
								<div class="space-y-2">
									{#each Array(5) as _}
										<div class="h-14 animate-pulse rounded-lg bg-zinc-800/40"></div>
									{/each}
								</div>
							{:else if !spaceListedHere}
								<!-- The location's files didn't load (a toast said why): the list is another's. -->
								<div class="flex flex-col items-center justify-center py-16 text-zinc-500">
									<p class="text-sm">Couldn't load the files here</p>
								</div>
							{:else if spaceAttachments.length === 0}
								<div class="flex flex-col items-center justify-center py-16 text-zinc-500">
									<PaperclipIcon class="mb-3 size-10" />
									<p class="text-sm">
										{spaceAttachmentsLocation === "all" ? "No attachments in this space" : "No files here"}
									</p>
								</div>
							{:else}
								<div class="space-y-1">
									{#if spacePicking}
										<FilePickerBar picker={spacePicker} />
									{/if}
									{#each spacePicker.shown as att (att.id)}
										{@const isImage = att.content_type.startsWith("image/")}
										{@const isAudio = att.content_type.startsWith("audio/")}
										<div
											class="group rounded-lg border border-zinc-800 bg-zinc-800/30 transition-colors hover:bg-zinc-800/50"
										>
											<div class="flex items-center gap-3 px-3 py-2.5">
												{#if spacePicking}
													<input
														type="checkbox"
														checked={spacePicker.picked.has(att.id)}
														onchange={() => spacePicker.toggle(att.id)}
														aria-label="Select {att.filename}"
														class="size-4 shrink-0 rounded border-zinc-600 bg-zinc-800 accent-stone-500"
													/>
												{/if}
												{#if isImage}
													<img
														src="{attachmentHost}{att.url ?? `/attachments/${att.id}`}"
														alt=""
														class="h-10 w-10 shrink-0 rounded bg-zinc-700 object-cover"
													/>
												{:else if isAudio}
													<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-zinc-700">
														<svg
															xmlns="http://www.w3.org/2000/svg"
															width="16"
															height="16"
															viewBox="0 0 24 24"
															fill="none"
															stroke="currentColor"
															stroke-width="2"
															stroke-linecap="round"
															stroke-linejoin="round"
															class="text-zinc-400"
															><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path
																d="M19 10v2a7 7 0 0 1-14 0v-2"
															/><line x1="12" x2="12" y1="19" y2="22" /></svg
														>
													</div>
												{:else}
													<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-zinc-700">
														<PaperclipIcon class="size-4 text-zinc-400" />
													</div>
												{/if}
												<div class="min-w-0 flex-1">
													<p class="truncate text-sm text-zinc-200">{att.filename}</p>
													<p class="text-xs text-zinc-500">
														{formatFileSize(att.size_bytes)}
														<span class="mx-1 text-zinc-600">&middot;</span>
														{new Date(att.created_at).toLocaleDateString()}
													</p>
												</div>
												<a
													href="{attachmentHost}{att.url ?? `/attachments/${att.id}`}"
													download={att.filename}
													class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 opacity-0 transition-all group-hover:opacity-100 hover:bg-zinc-700 hover:text-zinc-200"
													title="Download"
												>
													<svg
														xmlns="http://www.w3.org/2000/svg"
														width="16"
														height="16"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														stroke-width="2"
														stroke-linecap="round"
														stroke-linejoin="round"
														><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline
															points="7 10 12 15 17 10"
														/><line x1="12" x2="12" y1="15" y2="3" /></svg
													>
												</a>
												{#if canManageAttachments}
													<button
														onclick={() => handleDeleteSpaceAttachment(att)}
														class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-600/20 hover:text-red-400"
														title="Delete"
													>
														<TrashIcon class="size-4" />
													</button>
												{/if}
											</div>
										</div>
									{/each}
								</div>
							{/if}
						{/if}
					</div>

					<!-- Move bar (appears while files of a bucket are picked) -->
					{#if activeSection === "attachments" && spacePicking && spacePicker.pickedFiles.length > 0}
						{@const pickedCount = spacePicker.pickedFiles.length}
						{@const tooMany = (spacePicker.filter.attachment_ids?.length ?? 0) > MAX_PICKED_FILES}
						<div
							transition:slide={{ duration: 200 }}
							class="flex shrink-0 items-center justify-between gap-4 border-t border-zinc-800 bg-zinc-900/80 px-6 py-3"
						>
							<p class="min-w-0 truncate text-sm text-zinc-400">
								{#if spaceTransfer}
									Wait for the transfer under way to end.
								{:else if tooMany}
									Pick {MAX_PICKED_FILES} files at most, or Select all.
								{:else}
									{countFiles(pickedCount)} selected
								{/if}
							</p>
							<div class="flex shrink-0 items-center gap-2">
								<button
									onclick={() => spacePicker.picked.clear()}
									class="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:text-white"
								>
									Clear
								</button>
								<button
									onclick={openMoveSpacePicked}
									disabled={spaceTransfer !== null || tooMany}
									class="bg-fill-600 text-fixed-white hover:bg-fill-500 flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
								>
									<MoveIcon class="size-4" />
									Move {countFiles(pickedCount)} ({formatFileSize(spacePicker.pickedBytes)}) to…
								</button>
							</div>
						</div>
					{/if}
				</div>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<!-- Only with a space: without one, the dialog would move the user's files. -->
{#if spaceId}
	<MoveFilesDialog
		bind:open={spaceMoveOpen}
		{spaceId}
		choices={spaceStorageChoices}
		sourceId={spaceMoveSourceId}
		files={spaceMoveFiles}
		filter={spaceMoveFilter}
		onStarted={onSpaceMoveStarted}
	/>
{/if}
<BucketFilesDialog
	bind:request={spaceBucketFilesRequest}
	inSpace
	onMove={(bucket) => openMoveSpaceBucket(bucket)}
	onDelete={deleteSpaceBucketWithFiles}
/>

<ImageCropModal
	bind:open={showSpaceIconCrop}
	title="Change Icon"
	aspect={1}
	round
	targetWidth={256}
	targetHeight={256}
	onConfirm={(f) => onSpaceIconCrop(f)}
/>
<ImageCropModal
	bind:open={showSpaceBannerCrop}
	title="Change Banner"
	aspect={5 / 2}
	targetWidth={600}
	targetHeight={240}
	onConfirm={(f) => onSpaceBannerCrop(f)}
/>
<ImageCropModal
	bind:open={showEmojiCrop}
	title="Emoji Image"
	aspect={1}
	targetWidth={128}
	targetHeight={128}
	onConfirm={(f) => setNewEmojiFile(f)}
/>
<ImageCropModal
	bind:open={showStickerCrop}
	title="Sticker Image"
	aspect={1}
	targetWidth={320}
	targetHeight={320}
	onConfirm={(f) => setNewStickerFile(f)}
/>

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
