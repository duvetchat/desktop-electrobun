<script lang="ts">
	import { onDestroy, untrack } from "svelte";
	import { toast } from "$lib/stores/toast.svelte";
	import { confirmAction } from "$lib/stores/confirm.svelte";
	import { getApiError } from "$lib/api/api";
	import SmileIcon from "$lib/components/ui/icons/Smile.svelte";
	import {
		GripVertical as DotsSixVerticalIcon,
		Shield as ShieldStarIcon,
		Users as UsersThreeIcon,
		Settings as GearSixIcon,
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
		Webhook as WebhookIcon,
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
	import Webhooks from "$lib/components/Webhooks.svelte";
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
	import { settingsSections, webhookRooms, type SettingsSection } from "$lib/space-settings";

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

	// The settings' own thin scrollbars, where they scroll: a section's content and the description.
	const thinScrollbar =
		"[&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-[3px] [&::-webkit-scrollbar-thumb]:bg-duvet-ink/25 [&::-webkit-scrollbar-thumb:hover]:bg-duvet-ink2";
	// A role colour's input: the browser's colour well, its swatch filling it with no padding, border or corners but
	// its own.
	const colorSwatch =
		"[&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-[4px] [&::-webkit-color-swatch]:border-none size-7 cursor-pointer rounded-md border-2 border-duvet-line bg-none p-0";

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
	// What members are notified of until they choose: every message (0) or only mentions (1), the API's default.
	let ovDefaultNotifications = $state<0 | 1>(1);
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
	// Unsaved, the pending images' previews go with Settings: nothing else lets go of them (#325).
	onDestroy(() => {
		for (const url of [pendingIconPreview, pendingBannerPreview]) if (url) URL.revokeObjectURL(url);
	});

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
				ovDefaultNotifications !== (space.default_notifications ?? 1) ||
				pendingIcon !== null ||
				pendingBanner !== null),
	);

	// The form takes the Space's values as it opens and for another Space, not with every new object of the Space: each
	// presence update makes one (USER_STATUS_UPDATE), which wiped what the owner was typing or choosing.
	const formSpaceId = $derived(open ? (space?.id ?? null) : null);
	$effect(() => {
		if (!formSpaceId) return;
		untrack(() => {
			if (!space) return;
			ovName = space.name ?? "";
			ovDescription = space.description ?? "";
			ovLocale = space.locale ?? "";
			ovDefaultNotifications = space.default_notifications === 0 ? 0 : 1;
		});
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
					// Only when changed: a gateway from before it leaves the field out, read as only mentions, and saving the
					// name alone mustn't overwrite a stored «every message».
					default_notifications:
						ovDefaultNotifications !== (space?.default_notifications ?? 1) ? ovDefaultNotifications : undefined,
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
								default_notifications: updated.default_notifications ?? s.default_notifications,
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
			return "#7b83f5";
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
			return "background: var(--duvet-ink2)";
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
	let newRoleColorFrom = $state("#7b83f5");
	let newRoleColorVia = $state("");
	let newRoleColorTo = $state("");
	let newRoleUseGradient = $state(false);

	// ── edit state ───────────────────────────────────────────────
	let editingRoleId = $state<string | null>(null);
	let editingRoleName = $state("");
	let editingRolePermissions = $state(0);
	let editingRoleHoisted = $state(false);
	let editingRoleColorFrom = $state("#7b83f5");
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
		if (!sections.includes(activeSection)) activeSection = sections[0]!;
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
			newRoleColorFrom = "#7b83f5";
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
		editingRoleColorFrom = "#7b83f5";
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
				"You are about to connect external storage credentials to this Space. Make sure you own and trust these credentials. The bucket owner can read, modify, or delete all emojis, and stickers, and revoke access at any time.",
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
				class="rounded-card border-duvet-line bg-duvet-bg text-duvet-ink shadow-duvet-float flex h-[85vh] max-h-[85vh] w-full max-w-4xl overflow-hidden border"
			>
				<!-- Left sidebar -->
				<aside class="border-duvet-line bg-duvet-sunk flex w-56 shrink-0 flex-col border-r py-6">
					<div class="mb-4 px-4">
						<p class="text-duvet-ink2 mb-1 px-2 text-xs font-bold">
							{space?.name ?? "Space"} Settings
						</p>
					</div>

					<nav class="flex flex-col gap-0.5 px-2">
						{#if sections.includes("overview")}
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
						{/if}

						{#if sections.includes("roles")}
							<button
								class="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-100
                            {activeSection === 'roles'
									? 'bg-duvet-card text-duvet-ink'
									: 'text-duvet-ink2 hover:bg-duvet-card/60 hover:text-duvet-ink'}"
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
									? 'bg-duvet-card text-duvet-ink'
									: 'text-duvet-ink2 hover:bg-duvet-card/60 hover:text-duvet-ink'}"
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
									? 'bg-duvet-card text-duvet-ink'
									: 'text-duvet-ink2 hover:bg-duvet-card/60 hover:text-duvet-ink'}"
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
									? 'bg-duvet-card text-duvet-ink'
									: 'text-duvet-ink2 hover:bg-duvet-card/60 hover:text-duvet-ink'}"
								onclick={() => (activeSection = "bans")}
							>
								<BanIcon class="size-4" />
								Bans
							</button>
						{/if}

						<button
							class="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-100
                            {activeSection === 'emojis'
								? 'bg-duvet-card text-duvet-ink'
								: 'text-duvet-ink2 hover:bg-duvet-card/60 hover:text-duvet-ink'}"
							onclick={() => (activeSection = "emojis")}
						>
							<SmileIcon class="size-4" />
							Emojis
						</button>

						<button
							class="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-100
                            {activeSection === 'stickers'
								? 'bg-duvet-card text-duvet-ink'
								: 'text-duvet-ink2 hover:bg-duvet-card/60 hover:text-duvet-ink'}"
							onclick={() => (activeSection = "stickers")}
						>
							<StickerIcon class="size-4" />
							Stickers
						</button>

						{#if sections.includes("webhooks")}
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

						{#if sections.includes("storage")}
							<button
								class="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-100
                            {activeSection === 'storage'
									? 'bg-duvet-card text-duvet-ink'
									: 'text-duvet-ink2 hover:bg-duvet-card/60 hover:text-duvet-ink'}"
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
									? 'bg-duvet-card text-duvet-ink'
									: 'text-duvet-ink2 hover:bg-duvet-card/60 hover:text-duvet-ink'}"
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
					<div class="border-duvet-line flex shrink-0 items-center justify-between border-b px-6 py-4">
						<h2 class="text-duvet-ink text-base font-semibold capitalize">
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
													: activeSection === "webhooks"
														? "Webhooks"
														: activeSection === "storage"
															? "Storage"
															: activeSection === "attachments"
																? "Attachments"
																: "Members"}
						</h2>
						<Dialog.Close
							class="text-duvet-ink2 hover:bg-duvet-card hover:text-duvet-ink rounded-lg p-1.5 transition-colors duration-150"
							aria-label="Close"
						>
							<XIcon class="size-5" />
						</Dialog.Close>
					</div>

					<!-- Scrollable content -->
					<div class="flex-1 space-y-5 overflow-y-auto p-6 {thinScrollbar}">
						{#if activeSection === "overview"}
							<div class="space-y-5">
								<!-- Banner -->
								<div>
									<span class="text-duvet-ink2 mb-1.5 block text-[13px] font-bold">Banner</span>
									<div class="group bg-duvet-card relative h-24 w-60 overflow-hidden rounded-lg">
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
													class="hover:bg-fixed-white/20 text-duvet-danger rounded p-1.5"
													onclick={() => {
														if (pendingBannerPreview) URL.revokeObjectURL(pendingBannerPreview);
														pendingBanner = null;
														pendingBannerPreview = null;
													}}><XIcon class="size-4" /></button
												>
											</div>
										{:else if pendingBanner === "remove"}
											<div class="text-duvet-ink2/60 flex h-full items-center justify-center">No banner</div>
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
													class="hover:bg-fixed-white/20 text-duvet-danger rounded p-1.5"
													onclick={() => {
														pendingBanner = "remove";
													}}><TrashIcon class="size-4" /></button
												>
											</div>
										{:else}
											<button
												class="text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink flex h-full w-full items-center justify-center transition-colors"
												onclick={() => (showSpaceBannerCrop = true)}
											>
												<PlusIcon class="mr-1.5 size-4" /> Set banner
											</button>
										{/if}
									</div>
								</div>

								<!-- Icon -->
								<div>
									<span class="text-duvet-ink2 mb-1.5 block text-[13px] font-bold">Icon</span>
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
													class="hover:bg-fixed-white/20 text-duvet-danger rounded p-1"
													onclick={() => {
														if (pendingIconPreview) URL.revokeObjectURL(pendingIconPreview);
														pendingIcon = null;
														pendingIconPreview = null;
													}}><XIcon class="size-3.5" /></button
												>
											</div>
										{:else if pendingIcon === "remove"}
											<div
												class="bg-duvet-card text-duvet-ink2/60 flex h-full w-full items-center justify-center rounded-2xl"
											>
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
													class="hover:bg-fixed-white/20 text-duvet-danger rounded p-1"
													onclick={() => {
														pendingIcon = "remove";
													}}><TrashIcon class="size-3.5" /></button
												>
											</div>
										{:else}
											<button
												class="bg-duvet-card text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink flex h-full w-full items-center justify-center rounded-2xl transition-colors"
												onclick={() => (showSpaceIconCrop = true)}
											>
												<PlusIcon class="size-5" />
											</button>
										{/if}
									</div>
								</div>

								<p class="text-xxs text-duvet-ink2">Space ID: {spaceId}</p>

								<!-- Name -->
								<label class="block space-y-1.5">
									<span class="text-duvet-ink2 text-[13px] font-bold">Space Name</span>
									<input
										type="text"
										bind:value={ovName}
										placeholder="Space name"
										maxlength={64}
										class="bg-duvet-sunk text-duvet-ink shadow-duvet-press focus-visible:outline-duvet-accent h-10 w-full rounded-xl px-3 text-sm focus-visible:outline-2"
									/>
								</label>

								<!-- Description -->
								<label class="block space-y-1.5">
									<span class="text-duvet-ink2 text-[13px] font-bold">Description</span>
									<textarea
										bind:value={ovDescription}
										placeholder="What is this Space about?"
										rows="3"
										maxlength={256}
										class="text-duvet-ink w-full resize-none px-3 py-2 text-sm {thinScrollbar} bg-duvet-sunk shadow-duvet-press focus-visible:outline-duvet-accent rounded-xl focus-visible:outline-2"
									></textarea>
								</label>

								<!-- Locale -->
								<label class="block space-y-1.5">
									<span class="text-duvet-ink2 text-[13px] font-bold">Locale</span>
									<input
										type="text"
										bind:value={ovLocale}
										placeholder="en"
										maxlength={4}
										class="bg-duvet-sunk text-duvet-ink shadow-duvet-press focus-visible:outline-duvet-accent h-10 w-full rounded-xl px-3 text-sm focus-visible:outline-2"
									/>
								</label>

								<!-- What members are notified of until they choose, in the Space's menu -->
								<label class="block space-y-1.5">
									<span class="text-duvet-ink2 text-[13px] font-bold">Default Notifications</span>
									<select
										bind:value={ovDefaultNotifications}
										class="bg-duvet-sunk text-duvet-ink shadow-duvet-press focus-visible:outline-duvet-accent h-10 w-full rounded-xl px-3 text-sm focus-visible:outline-2"
									>
										<option value={0}>All messages</option>
										<option value={1}>Only mentions</option>
									</select>
									<span class="text-duvet-ink2 block text-xs"
										>Members are notified of this until they choose for themselves.</span
									>
								</label>

								<!-- Save -->
								{#if ovHasChanges}
									<button
										onclick={handleSaveOverview}
										disabled={ovSaving}
										class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised rounded-xl px-4 py-2 text-sm font-bold tabular-nums transition-colors hover:brightness-110 disabled:opacity-50"
									>
										{ovSaving ? (ovUploadPercent === null ? "Saving..." : uploadNote(ovUploadPercent)) : "Save Changes"}
									</button>
								{/if}

								<!-- Delete: the owner's alone, confirmed by typing the space's name -->
								{#if isOwner && space}
									<div class="border-duvet-danger/60 bg-duvet-danger/10 mt-8 rounded-lg border p-4">
										<h3 class="text-duvet-danger text-sm font-semibold">Delete Space</h3>
										<p class="text-duvet-ink2 mt-1 text-xs">
											It goes for everyone in it, with its rooms and messages. This can't be undone.
										</p>
										{#if !confirmingDelete}
											<button
												onclick={() => (confirmingDelete = true)}
												class="text-duvet-on-accent rounded-row bg-duvet-danger hover:bg-duvet-danger/85 mt-3 px-3 py-1.5 text-sm font-semibold transition-colors"
											>
												Delete Space
											</button>
										{:else}
											<label class="mt-3 block space-y-1.5">
												<span class="text-duvet-ink text-xs">
													Type <strong class="text-duvet-ink font-semibold">{space.name}</strong> to delete it.
												</span>
												<input
													type="text"
													bind:value={deleteConfirm}
													placeholder={space.name}
													disabled={deletingSpace}
													onkeydown={(e) => {
														if (e.key === "Enter") void handleDeleteSpace();
													}}
													class="bg-duvet-sunk text-duvet-ink shadow-duvet-press focus-visible:outline-duvet-accent h-10 w-full rounded-xl px-3 text-sm focus-visible:outline-2 disabled:opacity-50"
												/>
											</label>
											{#if deleteError}
												<p class="text-duvet-danger mt-2 text-sm">{deleteError}</p>
											{/if}
											<div class="mt-3 flex gap-2">
												<button
													onclick={handleDeleteSpace}
													disabled={!deleteNameMatches || deletingSpace}
													class="text-duvet-on-accent rounded-row bg-duvet-danger hover:bg-duvet-danger/85 px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
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
													class="text-duvet-ink hover:text-duvet-ink rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
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
								<div class="border-duvet-line bg-duvet-bg space-y-4 rounded-xl border p-5">
									<div class="space-y-1">
										<h3 class="text-duvet-ink text-sm font-bold">Create New Role</h3>
										<p class="text-duvet-ink2 text-xs">Set role identity, color, and permissions.</p>
									</div>

									<!-- Name -->
									<label class="block space-y-1.5">
										<span class="text-duvet-ink2 text-[13px] font-bold">Role name</span>
										<input
											type="text"
											placeholder="Role name"
											bind:value={newRoleName}
											maxlength={64}
											class="bg-duvet-sunk text-duvet-ink shadow-duvet-press focus-visible:outline-duvet-accent h-10 w-full rounded-xl px-3 text-sm focus-visible:outline-2"
										/>
									</label>

									<!-- Color -->
									<div class="rounded-card border-duvet-line bg-duvet-card/40 space-y-2 border p-3">
										<div class="flex items-center justify-between">
											<span class="text-duvet-ink2 text-xs font-medium">Color</span>
											<label class="text-duvet-ink2 flex cursor-pointer items-center gap-1.5 text-xs">
												<input
													type="checkbox"
													bind:checked={newRoleUseGradient}
													class="accent-duvet-accent cursor-pointer"
												/>
												Gradient
											</label>
										</div>
										<div class="flex flex-wrap items-center gap-3">
											<div class="flex items-center gap-1.5">
												<input type="color" bind:value={newRoleColorFrom} class={colorSwatch} title="Color from" />
												<span class="text-xxs text-duvet-ink2">From</span>
											</div>
											{#if newRoleUseGradient}
												<div class="flex items-center gap-1.5">
													<input
														type="color"
														bind:value={newRoleColorVia}
														class={colorSwatch}
														title="Color via (middle)"
													/>
													<span class="text-xxs text-duvet-ink2">Via</span>
												</div>
												<div class="flex items-center gap-1.5">
													<input type="color" bind:value={newRoleColorTo} class={colorSwatch} title="Color to" />
													<span class="text-xxs text-duvet-ink2">To</span>
												</div>
											{/if}
											<!-- Preview swatch -->
											<div
												class="border-duvet-line ml-auto h-7 w-16 rounded-md border"
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
										class="border-duvet-line bg-duvet-card/40 text-duvet-ink hover:text-duvet-ink flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-xs"
									>
										<Checkbox.Root
											bind:checked={newRoleHoisted}
											class="text-xxs data-[state=checked]:bg-duvet-accent data-[state=checked]:text-duvet-on-accent border-duvet-line bg-duvet-bg data-[state=checked]:border-duvet-accent flex size-4 items-center justify-center rounded border text-transparent"
											>✓</Checkbox.Root
										>
										Display role members separately in sidebar
									</label>

									<!-- Permissions -->
									<div>
										<p class="text-duvet-ink2 mb-1.5 text-xs font-medium">Permissions</p>
										<div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
											{#each PERMISSIONS as perm}
												{@const settable = canSetPermission(spacePermissions, 0, perm.flag)}
												<label
													class="border-duvet-line bg-duvet-card/70 text-duvet-ink flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs {settable
														? 'hover:text-duvet-ink cursor-pointer'
														: 'cursor-not-allowed opacity-50'}"
													title={settable ? undefined : "You can only grant permissions you have"}
												>
													<Checkbox.Root
														checked={newRolePermissions.includes(perm.flag)}
														disabled={!settable}
														onCheckedChange={() => {
															togglePermission(perm.flag, false);
														}}
														class="text-xxs data-[state=checked]:bg-duvet-accent data-[state=checked]:text-duvet-on-accent border-duvet-line bg-duvet-bg data-[state=checked]:border-duvet-accent flex size-4 shrink-0 items-center justify-center rounded border text-transparent"
														>✓</Checkbox.Root
													>
													<span class="min-w-0">
														<span class="block leading-4">{perm.name}</span>
														<span class="text-xxs text-duvet-ink2 mt-0.5 block leading-snug">{perm.description}</span>
													</span>
												</label>
											{/each}
										</div>
									</div>

									<button
										class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised h-10 w-full rounded-xl px-3 text-sm font-bold transition-colors hover:brightness-110 disabled:opacity-50"
										onclick={handleCreateRole}
										disabled={isCreating || !newRoleName.trim()}
									>
										{isCreating ? "Creating…" : "Create Role"}
									</button>
								</div>

								<!-- Existing roles -->
								<div class="space-y-2">
									<h3 class="text-duvet-ink text-sm font-semibold">Existing Roles</h3>
									<p class="text-duvet-ink2 text-xs">Drag to reorder. Edit or delete using actions on the right.</p>
									{#each sortedRoles as role, i}
										{@const manageable = canManageRoleAt(space, role.position)}
										<div
											class="border-duvet-line bg-duvet-bg overflow-hidden rounded-xl border transition-opacity duration-100"
											class:opacity-40={isDragging && dragIndex !== i}
											class:ring-2={isDragging && dragIndex === i}
											class:ring-duvet-accent={isDragging && dragIndex === i}
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
															class="text-duvet-ink bg-duvet-sunk shadow-duvet-press focus-visible:outline-duvet-accent w-full rounded-xl p-2 text-sm focus-visible:outline-2"
														/>

														<!-- Color -->
														<div class="space-y-1.5">
															<div class="flex items-center justify-between">
																<span class="text-duvet-ink2 text-xs font-medium">Color</span>
																<div class="flex items-center gap-2">
																	<button
																		type="button"
																		onclick={() => {
																			editingRoleClearColors = !editingRoleClearColors;
																		}}
																		class="text-xxs rounded px-1.5 py-0.5 transition-colors {editingRoleClearColors
																			? 'text-duvet-on-accent bg-duvet-danger'
																			: 'bg-duvet-ink/10 text-duvet-ink hover:text-duvet-ink'}">Clear color</button
																	>
																	{#if !editingRoleClearColors}
																		<label class="text-duvet-ink2 flex cursor-pointer items-center gap-1.5 text-xs">
																			<input
																				type="checkbox"
																				bind:checked={editingRoleUseGradient}
																				class="accent-duvet-accent cursor-pointer"
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
																			class={colorSwatch}
																			title="Color from"
																		/>
																		<span class="text-xxs text-duvet-ink2">From</span>
																	</div>
																	{#if editingRoleUseGradient}
																		<div class="flex items-center gap-1.5">
																			<input
																				type="color"
																				bind:value={editingRoleColorVia}
																				class={colorSwatch}
																				title="Via"
																			/>
																			<span class="text-xxs text-duvet-ink2">Via</span>
																		</div>
																		<div class="flex items-center gap-1.5">
																			<input
																				type="color"
																				bind:value={editingRoleColorTo}
																				class={colorSwatch}
																				title="To"
																			/>
																			<span class="text-xxs text-duvet-ink2">To</span>
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
															class="text-duvet-ink hover:text-duvet-ink flex cursor-pointer items-center gap-2 text-xs"
														>
															<Checkbox.Root
																bind:checked={editingRoleHoisted}
																class="text-xxs data-[state=checked]:bg-duvet-accent data-[state=checked]:text-duvet-on-accent border-duvet-line bg-duvet-bg data-[state=checked]:border-duvet-accent flex size-4 items-center justify-center rounded border text-transparent"
																>✓</Checkbox.Root
															>
															Display role members separately in sidebar
														</label>

														<!-- Permissions -->
														<div>
															<p class="text-duvet-ink2 mb-1.5 text-xs font-medium">Permissions</p>
															<div class="grid grid-cols-2 gap-x-3 gap-y-2.5">
																{#each PERMISSIONS as perm}
																	{@const settable = canSetPermission(spacePermissions, editingRoleSaved, perm.flag)}
																	<label
																		class="text-duvet-ink flex items-start gap-2 text-xs {settable
																			? 'hover:text-duvet-ink cursor-pointer'
																			: 'cursor-not-allowed opacity-50'}"
																		title={settable ? undefined : "You can only grant permissions you have"}
																	>
																		<Checkbox.Root
																			checked={(editingRolePermissions & perm.flag) === perm.flag}
																			disabled={!settable}
																			onCheckedChange={() => {
																				togglePermission(perm.flag, true);
																			}}
																			class="text-xxs data-[state=checked]:bg-duvet-accent data-[state=checked]:text-duvet-on-accent border-duvet-line bg-duvet-bg data-[state=checked]:border-duvet-accent flex size-4 shrink-0 items-center justify-center rounded border text-transparent"
																			>✓</Checkbox.Root
																		>
																		<span class="min-w-0">
																			<span class="block leading-4">{perm.name}</span>
																			<span class="text-xxs text-duvet-ink2 mt-0.5 block leading-snug"
																				>{perm.description}</span
																			>
																		</span>
																	</label>
																{/each}
															</div>
														</div>

														<div class="flex gap-2">
															<button
																class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised flex-1 rounded-xl px-2 py-1.5 text-xs font-bold transition-colors hover:brightness-110 disabled:opacity-50"
																onclick={handleUpdateRole}
																disabled={isCreating}>Save</button
															>
															<button
																class="rounded-row bg-duvet-ink/10 text-duvet-ink hover:bg-duvet-ink/15 flex-1 px-2 py-1.5 text-xs transition-colors"
																onclick={cancelEdit}>Cancel</button
															>
														</div>
													</div>
												{:else}
													<div class="flex items-center gap-2">
														<DotsSixVerticalIcon
															class="text-duvet-ink2 size-4 shrink-0 cursor-grab active:cursor-grabbing"
														/>
														<div class="min-w-0 flex-1">
															<div class="mb-0.5 flex items-center gap-2">
																<span class="text-duvet-ink text-sm font-medium">{role.name}</span>
																{#if role.hoisted}
																	<span class="text-xxs bg-duvet-ink/10 text-duvet-ink rounded px-1.5 py-0.5"
																		>hoisted</span
																	>
																{/if}
															</div>
															<p class="text-duvet-ink2 truncate text-xs">
																{getPermissionNames(role.permissions)}
															</p>
														</div>
														<!-- Only a role below the user's highest one, as the API's checkRoleHierarchy allows -->
														<div
															class="ml-1 flex shrink-0 gap-1.5"
															title={manageable ? undefined : "Only roles below your highest role can be managed"}
														>
															<button
																class="rounded-row bg-duvet-ink/10 text-duvet-ink hover:bg-duvet-ink/15 h-7 px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
																disabled={!manageable}
																onclick={() => {
																	startEdit(role);
																}}>Edit</button
															>
															<!-- everyone (its ID is the space's) can be edited, not deleted -->
															{#if role.id !== spaceId}
																<button
																	class="text-duvet-danger bg-duvet-danger/10 hover:bg-duvet-danger/20 h-7 rounded-md px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
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
										<p class="text-duvet-ink2 py-4 text-center text-sm">
											No roles yet. Create one to start assigning permissions.
										</p>
									{/if}
								</div>
							{:else}
								<p class="text-duvet-ink2 text-sm">You don't have permission to manage roles.</p>
							{/if}
						{:else if activeSection === "members"}
							{#if space}
								<div class="space-y-3">
									<h3 class="text-duvet-ink text-sm font-semibold">
										Members ({formatCount(space.members?.length ?? 0)})
									</h3>
									{#each space.members ?? [] as member}
										{@const user = space.users.find((u) => u.id === member.user_id)}
										<button
											type="button"
											class="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors {selectedMemberUserId ===
											member.user_id
												? 'border-duvet-ink2/40 bg-duvet-ink/8'
												: 'hover:bg-duvet-card border-duvet-line bg-duvet-card'}"
											onclick={() => (selectedMemberUserId = member.user_id)}
										>
											<UserAvatar
												src={getAvatarURL(member.user_id, user?.avatar)}
												name={user?.username ?? "Unknown"}
												size={32}
											/>
											<div class="min-w-0 flex-1">
												<p class="text-duvet-ink truncate text-sm font-medium">
													{member.alias ?? user?.username ?? "Unknown member"}
												</p>
												<p class="text-duvet-ink2 truncate text-xs">
													{(space.member_roles[member.user_id] ?? [])
														.map((rid) => space.roles.find((r) => r.id === rid)?.name)
														.filter(Boolean)
														.join(", ") || "No roles assigned"}
												</p>
											</div>
										</button>
									{/each}

									{#if selectedSettingsMember && selectedSettingsUser}
										<div class="bg-duvet-bg border-duvet-line rounded-xl border p-4">
											<div class="mb-3 flex items-center justify-between">
												<h4 class="text-duvet-ink2 text-[13px] font-bold">Member Details</h4>
												<button
													type="button"
													class="text-duvet-ink2 hover:bg-duvet-card hover:text-duvet-ink rounded px-2 py-1 text-xs transition-colors"
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
													<p class="text-duvet-ink truncate text-sm font-semibold">
														{selectedSettingsMember.alias ?? selectedSettingsUser.username}
													</p>
													<p class="text-duvet-ink2 truncate text-xs">@{selectedSettingsUser.username}</p>
													<p class="text-duvet-ink2 truncate text-[11px]">User ID: {selectedSettingsUser.id}</p>
												</div>
											</div>
											<div class="mt-3">
												<p class="text-duvet-ink2 mb-2 text-[13px] font-bold">Roles</p>
												{#if selectedSettingsRoles.length > 0}
													<div class="flex flex-wrap gap-1.5">
														{#each selectedSettingsRoles as role}
															<span
																class="border-duvet-line bg-duvet-card text-duvet-ink rounded-md border px-2 py-1 text-xs"
																>{role.name}</span
															>
														{/each}
													</div>
												{:else}
													<p class="text-duvet-ink2 text-xs">No roles assigned</p>
												{/if}
											</div>
											{#if selectedSettingsModeration}
												<div class="border-duvet-line mt-4 flex gap-2 border-t pt-3">
													{#if selectedSettingsModeration.kick}
														<button
															type="button"
															class="bg-duvet-danger/15 text-duvet-danger hover:bg-duvet-danger/25 flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors"
															onclick={() => void kickFromSpace(selectedSettingsModeration.target)}
														>
															<UserMinusIcon class="size-3.5" />
															Kick
														</button>
													{/if}
													{#if selectedSettingsModeration.ban}
														<button
															type="button"
															class="bg-duvet-danger/15 text-duvet-danger hover:bg-duvet-danger/25 flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors"
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
								<p class="text-duvet-ink2 text-sm">Loading emojis...</p>
							{:else}
								{#if canManageEmojis}
									<!-- Upload new emoji -->
									<div class="border-duvet-line bg-duvet-bg space-y-4 rounded-xl border p-5">
										<div class="space-y-1">
											<h3 class="text-duvet-ink text-sm font-bold">Upload Emoji</h3>
											<p class="text-duvet-ink2 text-xs">
												Custom emojis require a storage bucket configured for this Space.
											</p>
										</div>

										<div class="flex flex-wrap items-end gap-3">
											<label class="block min-w-40 flex-1 space-y-1.5">
												<span class="text-duvet-ink2 text-[13px] font-bold">Name</span>
												<input
													type="text"
													class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent w-full rounded-xl px-3 py-2 text-sm focus-visible:outline-2"
													placeholder="emoji_name"
													bind:value={newEmojiName}
												/>
											</label>

											<label class="block space-y-1.5">
												<span class="text-duvet-ink2 text-[13px] font-bold">Image</span>
												<button
													type="button"
													class="border-duvet-line bg-duvet-card text-duvet-ink2 hover:border-duvet-ink2/40 hover:text-duvet-ink flex size-9.5 items-center justify-center overflow-hidden rounded-lg border border-dashed transition-colors"
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
												class="text-duvet-on-accent rounded-row bg-duvet-accent hover:bg-duvet-accent/85 flex items-center gap-2 px-4 py-2 text-sm font-medium tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-50"
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
										<SmileIcon class="text-duvet-ink2/60 mb-3 size-10" />
										<p class="text-duvet-ink2 text-sm">No custom emojis yet.</p>
										{#if canManageEmojis}
											<p class="text-duvet-ink2 mt-1 text-xs">Upload one above to get started.</p>
										{/if}
									</div>
								{:else}
									<div class="space-y-1">
										{#each spaceEmojis as emoji (emoji.id)}
											<div
												class="group rounded-card border-duvet-line bg-duvet-card flex items-center gap-3 border px-3 py-2.5"
											>
												<img
													src="{attachmentHost}/attachments/{emoji.attachment_id}"
													alt=":{emoji.name}:"
													class="size-8 rounded object-contain"
												/>

												{#if editingEmojiId === emoji.id}
													<input
														type="text"
														class="text-duvet-ink bg-duvet-sunk shadow-duvet-press focus-visible:outline-duvet-accent flex-1 rounded-xl px-2 py-1 text-sm focus-visible:outline-2"
														bind:value={editingEmojiName}
														onkeydown={(e) => {
															if (e.key === "Enter") handleUpdateEmoji();
															if (e.key === "Escape") cancelEmojiEdit();
														}}
													/>
													<button
														class="text-duvet-alive hover:bg-duvet-ink/10 rounded p-1.5 transition-colors"
														onclick={handleUpdateEmoji}
														title="Save"
													>
														<CheckIcon class="size-4" />
													</button>
													<button
														class="text-duvet-ink2 hover:bg-duvet-ink/10 rounded p-1.5 transition-colors"
														onclick={cancelEmojiEdit}
														title="Cancel"
													>
														<XIcon class="size-4" />
													</button>
												{:else}
													<div class="min-w-0 flex-1">
														<p class="text-duvet-ink truncate text-sm font-medium">:{emoji.name}:</p>
													</div>

													{#if canManageEmojis}
														<button
															class="text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink rounded p-1.5 opacity-0 transition-all group-hover:opacity-100"
															onclick={() => startEmojiEdit(emoji)}
															title="Rename"
														>
															<PencilIcon class="size-4" />
														</button>
														<button
															class="text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-danger rounded p-1.5 opacity-0 transition-all group-hover:opacity-100"
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
								<p class="text-duvet-ink2 text-sm">Loading stickers...</p>
							{:else}
								{#if canManageStickers}
									<!-- Upload new sticker -->
									<div class="border-duvet-line bg-duvet-bg space-y-4 rounded-xl border p-5">
										<div class="space-y-1">
											<h3 class="text-duvet-ink text-sm font-bold">Upload Sticker</h3>
											<p class="text-duvet-ink2 text-xs">
												Custom stickers require a storage bucket configured for this Space.
											</p>
										</div>

										<div class="flex flex-wrap items-end gap-3">
											<label class="block min-w-40 flex-1 space-y-1.5">
												<span class="text-duvet-ink2 text-[13px] font-bold">Name</span>
												<input
													type="text"
													class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent w-full rounded-xl px-3 py-2 text-sm focus-visible:outline-2"
													placeholder="sticker_name"
													bind:value={newStickerName}
												/>
											</label>

											<label class="block space-y-1.5">
												<span class="text-duvet-ink2 text-[13px] font-bold">Image</span>
												<button
													type="button"
													class="border-duvet-line bg-duvet-card text-duvet-ink2 hover:border-duvet-ink2/40 hover:text-duvet-ink flex size-9.5 items-center justify-center overflow-hidden rounded-lg border border-dashed transition-colors"
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
												class="text-duvet-on-accent rounded-row bg-duvet-accent hover:bg-duvet-accent/85 flex items-center gap-2 px-4 py-2 text-sm font-medium tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-50"
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
										<StickerIcon class="text-duvet-ink2/60 mb-3 size-10" />
										<p class="text-duvet-ink2 text-sm">No custom stickers yet.</p>
										{#if canManageStickers}
											<p class="text-duvet-ink2 mt-1 text-xs">Upload one above to get started.</p>
										{/if}
									</div>
								{:else}
									<div class="space-y-1">
										{#each spaceStickers as sticker (sticker.id)}
											<div
												class="group rounded-card border-duvet-line bg-duvet-card flex items-center gap-3 border px-3 py-2.5"
											>
												<img
													src="{attachmentHost}/attachments/{sticker.attachment_id}"
													alt={sticker.name}
													class="size-12 rounded object-contain"
												/>

												{#if editingStickerReact === sticker.id}
													<input
														type="text"
														class="text-duvet-ink bg-duvet-sunk shadow-duvet-press focus-visible:outline-duvet-accent flex-1 rounded-xl px-2 py-1 text-sm focus-visible:outline-2"
														bind:value={editingStickerName}
														onkeydown={(e) => {
															if (e.key === "Enter") handleUpdateSticker();
															if (e.key === "Escape") cancelStickerEdit();
														}}
													/>
													<button
														class="text-duvet-alive hover:bg-duvet-ink/10 rounded p-1.5 transition-colors"
														onclick={handleUpdateSticker}
														title="Save"
													>
														<CheckIcon class="size-4" />
													</button>
													<button
														class="text-duvet-ink2 hover:bg-duvet-ink/10 rounded p-1.5 transition-colors"
														onclick={cancelStickerEdit}
														title="Cancel"
													>
														<XIcon class="size-4" />
													</button>
												{:else}
													<div class="min-w-0 flex-1">
														<p class="text-duvet-ink truncate text-sm font-medium">{sticker.name}</p>
													</div>

													{#if canManageStickers}
														<button
															class="text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink rounded p-1.5 opacity-0 transition-all group-hover:opacity-100"
															onclick={() => startStickerEdit(sticker)}
															title="Rename"
														>
															<PencilIcon class="size-4" />
														</button>
														<button
															class="text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-danger rounded p-1.5 opacity-0 transition-all group-hover:opacity-100"
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
								<p class="text-duvet-ink2 mb-4 text-xs">
									Connect an S3-compatible bucket for this Space's storage. When a bucket is active, uploads go to your
									bucket.
								</p>

								{#if !spaceBucketsLoading}
									<div class="border-duvet-warn/30 bg-duvet-warn/10 mb-4 flex gap-3 rounded-lg border px-4 py-3">
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
											class="text-duvet-warn mt-0.5 shrink-0"
											><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path
												d="M12 9v4"
											/><path d="M12 17h.01" /></svg
										>
										<div class="text-duvet-warn/80 space-y-1 text-xs">
											<p class="text-duvet-warn font-semibold">Before adding a bucket</p>
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
													Space.
												</li>
												<li>
													All uploaded files may be <strong>logged, monitored, or shared</strong> by the bucket owner.
												</li>
											</ul>
										</div>
									</div>
								{/if}

								{#if spaceBucketsError}
									<p class="bg-duvet-danger/10 text-duvet-danger mb-4 rounded-md px-3 py-2 text-sm">
										{spaceBucketsError}
									</p>
								{/if}

								<!-- Create / Edit form -->
								{#if showSpaceBucketForm}
									<div class="rounded-card border-duvet-line bg-duvet-card/40 mb-4 space-y-3 border p-4">
										<h3 class="text-duvet-ink text-sm font-semibold">
											{editingSpaceBucket ? "Edit Bucket" : "New Bucket"}
										</h3>
										<div class="grid grid-cols-2 gap-3">
											<div>
												<label for="sb-name" class="text-duvet-ink2 mb-1 block text-[13px] font-bold">Name</label>
												<input
													id="sb-name"
													type="text"
													bind:value={sbName}
													placeholder="My R2"
													class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent h-9 w-full rounded-xl px-3 text-sm focus-visible:outline-2"
												/>
											</div>
											<div>
												<label for="sb-region" class="text-duvet-ink2 mb-1 block text-[13px] font-bold">Region</label>
												<input
													id="sb-region"
													type="text"
													bind:value={sbRegion}
													placeholder="auto"
													class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent h-9 w-full rounded-xl px-3 text-sm focus-visible:outline-2"
												/>
											</div>
										</div>
										<div>
											<label for="sb-endpoint" class="text-duvet-ink2 mb-1 block text-[13px] font-bold">Endpoint</label>
											<input
												id="sb-endpoint"
												type="text"
												bind:value={sbEndpoint}
												placeholder="https://account-id.r2.cloudflarestorage.com"
												class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent h-9 w-full rounded-xl px-3 text-sm focus-visible:outline-2"
											/>
										</div>
										<div>
											<label for="sb-bucket-name" class="text-duvet-ink2 mb-1 block text-[13px] font-bold"
												>Bucket Name</label
											>
											<input
												id="sb-bucket-name"
												type="text"
												bind:value={sbBucketName}
												placeholder="my-bucket"
												class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent h-9 w-full rounded-xl px-3 text-sm focus-visible:outline-2"
											/>
										</div>
										<div class="grid grid-cols-2 gap-3">
											<div>
												<label for="sb-access-key" class="text-duvet-ink2 mb-1 block text-[13px] font-bold"
													>Access Key ID</label
												>
												<input
													id="sb-access-key"
													type="text"
													bind:value={sbAccessKey}
													placeholder="access key"
													class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent h-9 w-full rounded-xl px-3 text-sm focus-visible:outline-2"
												/>
											</div>
											<div>
												<label for="sb-secret-key" class="text-duvet-ink2 mb-1 block text-[13px] font-bold"
													>Secret Access Key</label
												>
												<input
													id="sb-secret-key"
													type="password"
													bind:value={sbSecretKey}
													placeholder={editingSpaceBucket ? "leave empty to keep current" : "secret key"}
													class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent h-9 w-full rounded-xl px-3 text-sm focus-visible:outline-2"
												/>
											</div>
										</div>
										<label class="flex cursor-pointer items-center gap-2">
											<input
												type="checkbox"
												bind:checked={sbUsePathStyle}
												class="border-duvet-line bg-duvet-card accent-duvet-accent size-4 rounded"
											/>
											<span class="text-duvet-ink2 text-xs"
												>Use path-style addressing <span class="text-duvet-ink2/60"
													>(required for MinIO, RustFS, etc.)</span
												></span
											>
										</label>
										<div class="grid grid-cols-2 gap-3">
											<div>
												<label for="sb-max-bytes" class="text-duvet-ink2 mb-1 block text-[13px] font-bold"
													>Total Limit (MB)</label
												>
												<input
													id="sb-max-bytes"
													type="number"
													min="0"
													step="1"
													bind:value={sbMaxBytesMB}
													placeholder="No limit"
													class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent h-9 w-full rounded-xl px-3 text-sm focus-visible:outline-2"
												/>
											</div>
											<div>
												<label for="sb-upload-limit" class="text-duvet-ink2 mb-1 block text-[13px] font-bold"
													>Per-file Limit (MB)</label
												>
												<input
													id="sb-upload-limit"
													type="number"
													min="0"
													step="1"
													bind:value={sbUploadLimitMB}
													placeholder="No limit"
													class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent h-9 w-full rounded-xl px-3 text-sm focus-visible:outline-2"
												/>
											</div>
										</div>
										<p class="text-xxs text-duvet-ink2/60">
											Leave empty to remove limits. When a total limit is set, oldest files are recycled automatically
											when full.
										</p>
										<div class="flex justify-end gap-2 pt-1">
											<button
												class="text-duvet-ink hover:bg-duvet-card rounded-md px-3 py-1.5 text-sm transition-colors"
												onclick={resetSpaceBucketForm}>Cancel</button
											>
											<button
												class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised rounded-xl px-4 py-1.5 text-sm font-bold transition-colors hover:brightness-110 disabled:opacity-50"
												disabled={spaceBucketSaving}
												onclick={handleSaveSpaceBucket}
											>
												{spaceBucketSaving ? "Saving..." : editingSpaceBucket ? "Update" : "Create"}
											</button>
										</div>
									</div>
								{:else}
									<button
										class="bg-duvet-ink/5 text-duvet-ink hover:bg-duvet-ink/6 mb-4 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors"
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
											<div class="bg-duvet-card/40 h-16 animate-pulse rounded-lg"></div>
										{/each}
									</div>
								{:else if spaceBuckets.length === 0}
									<div class="text-duvet-ink2 flex flex-col items-center justify-center py-12">
										<DatabaseIcon class="mb-3 size-10" />
										<p class="text-sm">No buckets configured</p>
										<p class="text-duvet-ink2/60 mt-1 text-xs">Add a bucket to enable custom emoji uploads.</p>
									</div>
								{:else}
									<div class="space-y-2">
										{#each spaceBuckets as bucket (bucket.id)}
											<div
												class="group rounded-card border-duvet-line bg-duvet-card/30 hover:bg-duvet-card/50 flex items-center gap-3 border px-4 py-3 transition-colors"
											>
												<div class="min-w-0 flex-1">
													<div class="flex items-center gap-2">
														<span class="text-duvet-ink text-sm font-medium">{bucket.name}</span>
														{#if bucket.is_active}
															<span
																class="text-xxs bg-duvet-alive/20 text-duvet-alive rounded px-1.5 py-0.5 font-semibold"
																>ACTIVE</span
															>
														{:else}
															<span class="text-xxs bg-duvet-ink/5 text-duvet-ink2 rounded px-1.5 py-0.5 font-semibold"
																>INACTIVE</span
															>
														{/if}
													</div>
													<p class="text-duvet-ink2 mt-0.5 truncate text-xs">
														{bucket.bucket_name} · {bucket.endpoint}
													</p>
													{#if bucket.max_bytes}
														{@const pct = Math.min(Math.round((bucket.used_bytes / bucket.max_bytes) * 100), 100)}
														<div class="mt-1.5 space-y-1">
															<div class="text-xxs text-duvet-ink2 flex items-center justify-between">
																<span
																	>{(bucket.used_bytes / 1024 / 1024).toFixed(1)} MB / {(
																		bucket.max_bytes /
																		1024 /
																		1024
																	).toFixed(0)} MB</span
																>
																<span>{pct}%</span>
															</div>
															<div class="bg-duvet-ink/10 h-1.5 w-full overflow-hidden rounded-full">
																<div
																	class="h-full rounded-full transition-all duration-300 {pct > 90
																		? 'bg-duvet-danger'
																		: pct > 70
																			? 'bg-duvet-warn'
																			: 'bg-duvet-ink2'}"
																	style="width: {pct}%"
																></div>
															</div>
															{#if bucket.upload_limit_bytes}
																<p class="text-xxs text-duvet-ink2/60">
																	Per-file: {(bucket.upload_limit_bytes / 1024 / 1024).toFixed(0)} MB
																</p>
															{/if}
														</div>
													{:else if bucket.upload_limit_bytes}
														<p class="text-xxs text-duvet-ink2/60 mt-0.5">
															Per-file: {(bucket.upload_limit_bytes / 1024 / 1024).toFixed(0)} MB
														</p>
													{/if}
												</div>
												<div
													class="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
												>
													<button
														class="text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink flex h-8 w-8 items-center justify-center rounded-md transition-all disabled:opacity-50"
														title={bucket.is_active ? "Deactivate" : "Activate"}
														onclick={() => handleToggleSpaceBucket(bucket)}
														disabled={togglingSpaceBucketId === bucket.id}
													>
														{#if togglingSpaceBucketId === bucket.id}
															<div
																class="border-duvet-ink2/40 size-4 animate-spin rounded-full border-2 border-t-transparent"
															></div>
														{:else if bucket.is_active}
															<XIcon class="size-4" />
														{:else}
															<CheckIcon class="size-4" />
														{/if}
													</button>
													{#if canMoveSpaceFiles}
														<button
															class="text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink flex h-8 w-8 items-center justify-center rounded-md transition-all disabled:opacity-50"
															title={spaceTransfer ? "Wait for the transfer under way to end" : "Move files…"}
															onclick={() => openMoveSpaceBucket(bucket)}
															disabled={movingSpaceBucketId === bucket.id || spaceTransfer !== null}
														>
															{#if movingSpaceBucketId === bucket.id}
																<div
																	class="border-duvet-ink2/40 size-4 animate-spin rounded-full border-2 border-t-transparent"
																></div>
															{:else}
																<MoveIcon class="size-4" />
															{/if}
														</button>
													{/if}
													<button
														class="text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink flex h-8 w-8 items-center justify-center rounded-md transition-all"
														title="Edit"
														onclick={() => startEditSpaceBucket(bucket)}
													>
														<PencilIcon class="size-4" />
													</button>
													<button
														class="text-duvet-ink2 hover:bg-duvet-danger/20 hover:text-duvet-danger flex h-8 w-8 items-center justify-center rounded-md transition-all"
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
								<p class="text-duvet-ink2 text-sm">You don't have permission to manage storage for this Space.</p>
							{/if}
						{:else if activeSection === "invites"}
							<p class="text-duvet-ink2 mb-3 text-sm">
								The invite links that still work. Revoking one makes it stop working for everyone.
							</p>
							{#if spaceInvitesLoading}
								<div class="space-y-2">
									{#each Array(3) as _}
										<div class="bg-duvet-card/40 h-14 animate-pulse rounded-lg"></div>
									{/each}
								</div>
							{:else if spaceInvites.length === 0}
								<div class="text-duvet-ink2 flex flex-col items-center justify-center py-16">
									<LinkIcon class="mb-3 size-10" />
									<p class="text-sm">No invites</p>
								</div>
							{:else}
								<div class="space-y-1">
									{#each spaceInvites as invite (invite.id)}
										{@const room = space?.rooms.find((r) => r.id === invite.room_id)}
										<div
											class="group rounded-card border-duvet-line bg-duvet-card/30 hover:bg-duvet-card/50 flex items-center gap-3 border px-3 py-2.5 transition-colors"
										>
											<div class="min-w-0 flex-1">
												<p class="text-duvet-ink truncate font-mono text-sm select-text">{invite.code}</p>
												<p class="text-duvet-ink2 text-xs">
													#{room?.name ?? "deleted room"}
													<span class="text-duvet-ink2/60 mx-1">&middot;</span>
													{inviteCreator(invite.created_by)}
													<span class="text-duvet-ink2/60 mx-1">&middot;</span>
													{invite.expires_at
														? `Expires ${new Date(invite.expires_at).toLocaleString()}`
														: "Never expires"}
												</p>
											</div>
											<button
												onclick={() => handleRevokeInvite(invite)}
												class="text-duvet-ink2 hover:bg-duvet-danger/20 hover:text-duvet-danger flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium opacity-0 transition-all group-hover:opacity-100"
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
						{:else if activeSection === "webhooks"}
							{#if space}
								<Webhooks {space} rooms={webhookRooms(space)} />
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
								class="rounded-card border-duvet-line bg-duvet-card/40 flex items-center justify-between gap-3 border px-4 py-3"
							>
								<div class="text-duvet-ink text-sm">
									{#if spaceListedHere}
										<span class="text-duvet-ink font-semibold">{spaceAttachments.length}</span>
										file{spaceAttachments.length !== 1 ? "s" : ""}
										<span class="text-duvet-ink2/60 mx-1">&middot;</span>
										{formatFileSize(spaceAttachmentsLocation === "all" ? spaceStorageUsed : spaceLocationBytes)}
									{/if}
								</div>
								<div class="flex items-center gap-2">
									{#if canManageBuckets && (spaceBuckets.length > 0 || spaceAttachmentsLocation !== "all")}
										<label class="text-duvet-ink2 flex items-center gap-2 text-xs">
											Location
											<select
												value={spaceAttachmentsLocation}
												onchange={(e) => setSpaceAttachmentsLocation(e.currentTarget.value)}
												class="text-duvet-ink bg-duvet-sunk shadow-duvet-press focus-visible:outline-duvet-accent max-w-40 rounded-xl px-2 py-1 text-xs focus-visible:outline-2"
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
											class="bg-duvet-danger/20 text-duvet-danger hover:bg-duvet-danger/30 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors"
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
										<div class="bg-duvet-card/40 h-14 animate-pulse rounded-lg"></div>
									{/each}
								</div>
							{:else if !spaceListedHere}
								<!-- The location's files didn't load (a toast said why): the list is another's. -->
								<div class="text-duvet-ink2 flex flex-col items-center justify-center py-16">
									<p class="text-sm">Couldn't load the files here</p>
								</div>
							{:else if spaceAttachments.length === 0}
								<div class="text-duvet-ink2 flex flex-col items-center justify-center py-16">
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
											class="group border-duvet-line bg-duvet-card/30 hover:bg-duvet-card/50 rounded-lg border transition-colors"
										>
											<div class="flex items-center gap-3 px-3 py-2.5">
												{#if spacePicking}
													<input
														type="checkbox"
														checked={spacePicker.picked.has(att.id)}
														onchange={() => spacePicker.toggle(att.id)}
														aria-label="Select {att.filename}"
														class="border-duvet-line bg-duvet-card accent-duvet-accent size-4 shrink-0 rounded"
													/>
												{/if}
												{#if isImage}
													<img
														src="{attachmentHost}{att.url ?? `/attachments/${att.id}`}"
														alt=""
														class="bg-duvet-ink/10 h-10 w-10 shrink-0 rounded object-cover"
													/>
												{:else if isAudio}
													<div class="bg-duvet-ink/10 flex h-10 w-10 shrink-0 items-center justify-center rounded">
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
															class="text-duvet-ink2"
															><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path
																d="M19 10v2a7 7 0 0 1-14 0v-2"
															/><line x1="12" x2="12" y1="19" y2="22" /></svg
														>
													</div>
												{:else}
													<div class="bg-duvet-ink/10 flex h-10 w-10 shrink-0 items-center justify-center rounded">
														<PaperclipIcon class="text-duvet-ink2 size-4" />
													</div>
												{/if}
												<div class="min-w-0 flex-1">
													<p class="text-duvet-ink truncate text-sm">{att.filename}</p>
													<p class="text-duvet-ink2 text-xs">
														{formatFileSize(att.size_bytes)}
														<span class="text-duvet-ink2/60 mx-1">&middot;</span>
														{new Date(att.created_at).toLocaleDateString()}
													</p>
												</div>
												<a
													href="{attachmentHost}{att.url ?? `/attachments/${att.id}`}"
													download={att.filename}
													class="text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink flex h-8 w-8 shrink-0 items-center justify-center rounded-md opacity-0 transition-all group-hover:opacity-100"
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
														class="text-duvet-ink2 hover:bg-duvet-danger/20 hover:text-duvet-danger flex h-8 w-8 shrink-0 items-center justify-center rounded-md opacity-0 transition-all group-hover:opacity-100"
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
							class="border-duvet-line bg-duvet-bg/80 flex shrink-0 items-center justify-between gap-4 border-t px-6 py-3"
						>
							<p class="text-duvet-ink2 min-w-0 truncate text-sm">
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
									class="text-duvet-ink hover:text-duvet-ink rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
								>
									Clear
								</button>
								<button
									onclick={openMoveSpacePicked}
									disabled={spaceTransfer !== null || tooMany}
									class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-sm font-bold transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
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
