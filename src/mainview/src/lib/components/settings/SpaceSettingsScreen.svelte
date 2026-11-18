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
		Webhook as WebhookIcon,
		Mic as MicIcon,
		Download as DownloadIcon,
		TriangleAlert as WarningIcon,
	} from "@lucide/svelte";
	import { slide } from "svelte/transition";
	import { motionMs } from "$lib/motion";
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
	import SpaceBans from "$lib/components/SpaceBans.svelte";
	import SpaceMembers from "$lib/components/SpaceMembers.svelte";
	import Webhooks from "$lib/components/Webhooks.svelte";
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
	import { listSpaceInvites, revokeInvite, type InviteLink } from "$lib/api/invites";

	const attachmentHost = getHostURL();

	// The settings' own thin scrollbars, where they scroll: a section's content and the description.
	const thinScrollbar =
		"[&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-[3px] [&::-webkit-scrollbar-thumb]:bg-duvet-ink/25 [&::-webkit-scrollbar-thumb:hover]:bg-duvet-ink2";
	// A role colour's input: the browser's colour well, its swatch filling it with no padding, border or corners but
	// its own.
	const colorSwatch =
		"[&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-[4px] [&::-webkit-color-swatch]:border-none size-7 cursor-pointer rounded-md border-2 border-duvet-line bg-none p-0";

	import SettingsFrame from "./SettingsFrame.svelte";
	import SettingsGroup from "./SettingsGroup.svelte";
	import SettingsRow from "./SettingsRow.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import IconButton from "$lib/components/ui/IconButton.svelte";
	import SpaceIconMark from "$lib/components/ui/SpaceIcon.svelte";
	import Toggle from "$lib/components/ui/Toggle.svelte";
	import { iconButtonClass } from "$lib/components/ui/recipes";
	import {
		calloutClass,
		CARD,
		CHECKBOX,
		FIELD,
		FIELD_AREA,
		FIELD_SM,
		GROUP_TITLE,
		LABEL,
		listFileSize,
		NOTE,
		SELECT,
		SKELETON,
		TAG,
		usagePercent,
		usageTone,
		type SettingsNavGroup,
		type SettingsNavItem,
	} from "./recipes";
	import type { Shell } from "$lib/platform";
	import { pageSettingsHost, type SettingsHost } from "$lib/settings-host";
	import { spaceScope } from "$lib/staged-images";

	// A Space's settings (#357, DESIGN-MAP.md S-58 to S-67): the app's own sections, each shown to those whose
	// permissions its controls need. On the web it is a sheet of the app's page; in the desktop app it fills a window
	// of its own, one per Space, which has the Space as the main window mirrors it and reaches the app through `host`.
	let {
		space = null,
		spaceId = null,
		open = $bindable(false),
		mode = "sheet",
		chrome = "web",
		host = pageSettingsHost,
		section = undefined,
		asked = null,
	}: {
		space?: GatewaySpace | null;
		spaceId?: string | null;
		open?: boolean;
		mode?: "sheet" | "window";
		chrome?: Shell["chrome"];
		host?: SettingsHost;
		/** The section to open on. */
		section?: SettingsSection;
		/** A section asked of the open window, each time it is: `at` tells one asking from the next. */
		asked?: { section?: SettingsSection; at: number } | null;
	} = $props();

	let activeSection = $state<SettingsSection>(untrack(() => section ?? "overview"));
	$effect(() => {
		const next = asked?.section;
		if (next) untrack(() => (activeSection = next));
	});

	const PERMISSIONS = ALL_PERMISSIONS;

	// Overview form state. A screen that mounts open, a window of its own, starts with the Space's values: filled only
	// by the effect below, after the first render, the form differed from the Space for that render, and the save bar
	// was drawn and slid away each time the window opened.
	const opensOn = untrack(() => (open ? space : null));
	let ovName = $state(opensOn?.name ?? "");
	let ovDescription = $state(opensOn?.description ?? "");
	let ovLocale = $state(opensOn?.locale ?? "");
	// What members are notified of until they choose: every message (0) or only mentions (1), the API's default.
	let ovDefaultNotifications = $state<0 | 1>(opensOn?.default_notifications === 0 ? 0 : 1);
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

	// In a window of its own this screen ends with the window, and what was picked with it: the host keeps each pick
	// for the next time, as the web's sheet does by staying mounted (lib/staged-images.ts). What was kept for the
	// Space is read as its window opens; from then on the host is told each pick, and that it is gone once saved or
	// dropped. `stagesOf` is the Space whose picks are known.
	let stagesOf = $state<string | null>(null);
	$effect(() => {
		const of = mode === "window" ? spaceId : null;
		if (!of || untrack(() => stagesOf) === of) return;
		void host.stagedImages(spaceScope(of)).then((kept) => {
			// What was picked while this was read stands.
			if (pendingIcon === null && kept.icon) {
				if (kept.icon === "remove") pendingIcon = "remove";
				else onSpaceIconCrop(kept.icon);
			}
			if (pendingBanner === null && kept.banner) {
				if (kept.banner === "remove") pendingBanner = "remove";
				else onSpaceBannerCrop(kept.banner);
			}
			stagesOf = of;
		});
	});
	$effect(() => {
		const picked = pendingIcon;
		if (stagesOf) host.stageImage(spaceScope(stagesOf), "icon", picked);
	});
	$effect(() => {
		const picked = pendingBanner;
		if (stagesOf) host.stageImage(spaceScope(stagesOf), "banner", picked);
	});

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
			// The new name, icon and the rest show in the app at once.
			host.spaceSaved(spaceId, {
				name: updated.name,
				description: updated.description,
				locale: updated.locale,
				banner: updated.banner,
				icon: updated.icon,
				default_notifications: updated.default_notifications,
			});
			toast("Space updated", "success");
		} catch (e) {
			toast(getApiError(e, "Couldn't update"), "error");
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
			// It goes from the app at once, which says so (lib/settings-host.ts).
			host.spaceDeleted(id, name);
		} catch (e) {
			deleteError = getApiError(e, "Couldn't delete the Space");
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
			console.error("Couldn't reorder role:", err);
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
	// Each section's place in the side panel: the app's own sections, in their fixed order.
	const SECTION_ITEMS: Record<SettingsSection, Omit<SettingsNavItem<SettingsSection>, "id">> = {
		overview: { label: "Overview", icon: GearSixIcon, tile: "#5e6380" },
		roles: { label: "Roles", icon: ShieldStarIcon, tile: "#7c5cff" },
		members: { label: "Members", icon: UsersThreeIcon, tile: "#0e8fd6" },
		invites: { label: "Invites", icon: LinkIcon, tile: "#2f9e62" },
		bans: { label: "Bans", icon: BanIcon, tile: "#b0443b" },
		emojis: { label: "Emojis", icon: SmileIcon, tile: "#f59e0b" },
		stickers: { label: "Stickers", icon: StickerIcon, tile: "#f97316" },
		webhooks: { label: "Webhooks", icon: WebhookIcon, tile: "#e44fcb" },
		storage: { label: "Storage", icon: DatabaseIcon, tile: "#0b6fe8" },
		attachments: { label: "Attachments", icon: PaperclipIcon, tile: "#5f45b5" },
	};
	const sectionGroups = $derived<SettingsNavGroup<SettingsSection>[]>([
		{ items: sections.map((id) => ({ id, ...SECTION_ITEMS[id] })) },
	]);
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
			console.error("Couldn't create role:", err);
			toast(getApiError(err, "Couldn't create role"), "error");
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
			console.error("Couldn't update role:", err);
			toast(getApiError(err, "Couldn't update role"), "error");
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
	}

	// ── emoji handlers ──────────────────────────────────────────
	async function loadEmojis() {
		if (!spaceId) return;
		emojisLoading = true;
		try {
			spaceEmojis = await listEmojis(spaceId);
		} catch (err) {
			console.error("Couldn't load emojis:", err);
			toast(getApiError(err, "Couldn't load emojis"), "error");
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
			console.error("Couldn't upload emoji:", err);
			toast(getApiError(err, "Couldn't upload emoji"), "error");
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
			console.error("Couldn't update emoji:", err);
			toast(getApiError(err, "Couldn't update emoji"), "error");
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
			console.error("Couldn't load stickers:", err);
			toast(getApiError(err, "Couldn't load stickers"), "error");
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
			console.error("Couldn't upload sticker:", err);
			toast(getApiError(err, "Couldn't upload sticker"), "error");
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
			console.error("Couldn't update sticker:", err);
			toast(getApiError(err, "Couldn't update sticker"), "error");
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
			spaceBucketsError = getApiError(e, "Couldn't load");
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

	const formatFileSize = listFileSize;

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
			if (loadId === spaceAttachmentsLoadId) toast(getApiError(e, "Couldn't load attachments"), "error");
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
			toast(getApiError(err, "Couldn't load the bucket's files"), "error");
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
			"Delete all attachments in this Space? Its emojis and stickers go with them. This cannot be undone.",
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
			toast(getApiError(e, "Couldn't load invites"), "error");
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
				spaceBucketsError = getApiError(e, "Couldn't save");
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
		// Gone already (deleted elsewhere): there is nothing to name, or to delete.
		if (!b) return;
		await confirmAction(`Delete bucket "${b.name}"?`, "Delete", async () => {
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
			toast(getApiError(e, "Couldn't toggle bucket"), "error");
		} finally {
			togglingSpaceBucketId = null;
		}
	}
</script>

{#snippet spinner()}
	<span class="border-duvet-ink2/40 block size-4 animate-spin rounded-full border-2 border-t-transparent"></span>
{/snippet}

{#snippet usageBar(percent: number)}
	<div class="bg-duvet-toggle-off h-1.5 w-full overflow-hidden rounded-full">
		<div
			class="h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none {usageTone(percent)}"
			style="width: {percent}%"
		></div>
	</div>
{/snippet}

{#snippet transferCard()}
	{#if spaceTransfer}
		<StorageTransferCard
			transfer={spaceTransfer}
			source={spaceStorageLabel(spaceTransfer.source_bucket_id)}
			target={spaceStorageLabel(spaceTransfer.target_bucket_id)}
			startedBy={spaceTransfer.started_by === $currentUser?.id ? null : inviteCreator(spaceTransfer.started_by)}
		/>
	{/if}
{/snippet}

<!-- A role's colour: the wells (From, and Via and To for a gradient) and what they make. -->
{#snippet colorWells(
	gradient: boolean,
	from: string,
	via: string,
	to: string,
	set: (stop: "from" | "via" | "to", value: string) => void,
)}
	<div class="flex flex-wrap items-center gap-3">
		<label class="text-duvet-ink2 flex items-center gap-1.5 text-[11px]">
			<input
				type="color"
				value={from}
				oninput={(e) => set("from", e.currentTarget.value)}
				class={colorSwatch}
				title="Color from"
			/>
			From
		</label>
		{#if gradient}
			<label class="text-duvet-ink2 flex items-center gap-1.5 text-[11px]">
				<input
					type="color"
					value={via}
					oninput={(e) => set("via", e.currentTarget.value)}
					class={colorSwatch}
					title="Color via (middle)"
				/>
				Via
			</label>
			<label class="text-duvet-ink2 flex items-center gap-1.5 text-[11px]">
				<input
					type="color"
					value={to}
					oninput={(e) => set("to", e.currentTarget.value)}
					class={colorSwatch}
					title="Color to"
				/>
				To
			</label>
		{/if}
		<!-- Preview swatch -->
		<div
			class="ring-duvet-line ml-auto h-7 w-16 rounded-lg ring-1"
			style={roleGradientStyle({
				color_from: hexToInt(from),
				color_via: gradient && via ? hexToInt(via) : null,
				color_to: gradient && to ? hexToInt(to) : null,
			})}
		></div>
	</div>
{/snippet}

<!-- The permissions a role grants, a switch each; the ones the user can't grant are off limits. -->
{#snippet permissionSwitches(granted: (flag: number) => boolean, saved: number, isEdit: boolean)}
	<div class="divide-duvet-line ring-duvet-line divide-y rounded-xl ring-1">
		{#each PERMISSIONS as perm (perm.flag)}
			{@const settable = canSetPermission(spacePermissions, saved, perm.flag)}
			<div
				class="flex items-center gap-3 px-3 py-2 {settable ? '' : 'opacity-50'}"
				title={settable ? undefined : "You can only grant permissions you have"}
			>
				<div class="min-w-0 flex-1">
					<p class="text-[13px] leading-[1.3] font-medium">{perm.name}</p>
					<p class="text-duvet-ink2 mt-0.5 text-[11.5px] leading-snug">{perm.description}</p>
				</div>
				<Toggle
					label={perm.name}
					checked={granted(perm.flag)}
					disabled={!settable}
					onCheckedChange={() => togglePermission(perm.flag, isEdit)}
				/>
			</div>
		{/each}
	</div>
{/snippet}

{#snippet bucketForm()}
	<SettingsGroup title={editingSpaceBucket ? "Edit bucket" : "New bucket"} plain class="flex flex-col gap-3">
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label for="sb-name" class={LABEL}>Name</label>
				<input id="sb-name" type="text" bind:value={sbName} placeholder="My R2" class={FIELD} />
			</div>
			<div>
				<label for="sb-region" class={LABEL}>Region</label>
				<input id="sb-region" type="text" bind:value={sbRegion} placeholder="auto" class={FIELD} />
			</div>
		</div>
		<div>
			<label for="sb-endpoint" class={LABEL}>Endpoint</label>
			<input
				id="sb-endpoint"
				type="text"
				bind:value={sbEndpoint}
				placeholder="https://account-id.r2.cloudflarestorage.com"
				class={FIELD}
			/>
		</div>
		<div>
			<label for="sb-bucket-name" class={LABEL}>Bucket name</label>
			<input id="sb-bucket-name" type="text" bind:value={sbBucketName} placeholder="my-bucket" class={FIELD} />
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label for="sb-access-key" class={LABEL}>Access key ID</label>
				<input id="sb-access-key" type="text" bind:value={sbAccessKey} placeholder="access key" class={FIELD} />
			</div>
			<div>
				<label for="sb-secret-key" class={LABEL}>Secret access key</label>
				<input
					id="sb-secret-key"
					type="password"
					bind:value={sbSecretKey}
					placeholder={editingSpaceBucket ? "leave empty to keep current" : "secret key"}
					class={FIELD}
				/>
			</div>
		</div>
		<label class="flex cursor-pointer items-center gap-2">
			<input type="checkbox" bind:checked={sbUsePathStyle} class={CHECKBOX} />
			<span class="text-duvet-ink text-xs"
				>Use path-style addressing <span class="text-duvet-ink2">(required for MinIO, RustFS, etc.)</span></span
			>
		</label>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label for="sb-max-bytes" class={LABEL}>Total limit (MB)</label>
				<input
					id="sb-max-bytes"
					type="number"
					min="0"
					step="1"
					bind:value={sbMaxBytesMB}
					placeholder="No limit"
					class={FIELD}
				/>
			</div>
			<div>
				<label for="sb-upload-limit" class={LABEL}>Per-file limit (MB)</label>
				<input
					id="sb-upload-limit"
					type="number"
					min="0"
					step="1"
					bind:value={sbUploadLimitMB}
					placeholder="No limit"
					class={FIELD}
				/>
			</div>
		</div>
		<p class="text-duvet-ink2 text-xs">
			Leave empty to remove limits. When a total limit is set, oldest files are recycled automatically when full.
		</p>
		<div class="flex justify-end gap-2 pt-1">
			<Button variant="quiet" onclick={resetSpaceBucketForm}>Cancel</Button>
			<Button disabled={spaceBucketSaving} onclick={handleSaveSpaceBucket}>
				{spaceBucketSaving ? "Saving…" : editingSpaceBucket ? "Update" : "Create"}
			</Button>
		</div>
	</SettingsGroup>
{/snippet}

<!-- An image slot of the overview: the banner or the icon, as saved, as picked, or marked to go. -->
{#snippet imageSlot(
	kind: "banner" | "icon",
	preview: string | null,
	pending: File | "remove" | null,
	saved: string | null,
	edit: () => void,
	discard: () => void,
	remove: () => void,
	undo: () => void,
)}
	{@const shape = kind === "banner" ? "h-24 w-60 rounded-2xl" : "size-20 rounded-[22px]"}
	<div class="group bg-duvet-secondary-fill relative overflow-hidden {shape}">
		{#if preview}
			<img src={preview} alt={kind} class="size-full object-cover" />
			<div
				class="bg-duvet-media-scrim absolute inset-0 flex items-center justify-center gap-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
			>
				<button class="text-fixed-white hover:bg-fixed-white/20 rounded-md p-1.5" title="Edit" onclick={edit}
					><PencilIcon class="size-4" /></button
				>
				<button
					class="hover:bg-fixed-white/20 text-duvet-call-red-ink rounded-md p-1.5"
					title="Discard"
					onclick={discard}><XIcon class="size-4" /></button
				>
			</div>
		{:else if pending === "remove"}
			<div class="text-duvet-ink2 flex size-full items-center justify-center text-xs">
				{#if kind === "banner"}No banner{:else}<XIcon class="size-5" />{/if}
			</div>
			<div
				class="bg-duvet-media-scrim absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
			>
				<button class="text-fixed-white text-xs font-medium" onclick={undo}>Undo</button>
			</div>
		{:else if saved}
			<img src={saved} alt={kind} class="size-full object-cover" />
			<div
				class="bg-duvet-media-scrim absolute inset-0 flex items-center justify-center gap-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
			>
				<button class="text-fixed-white hover:bg-fixed-white/20 rounded-md p-1.5" title="Edit" onclick={edit}
					><PencilIcon class="size-4" /></button
				>
				<button class="hover:bg-fixed-white/20 text-duvet-call-red-ink rounded-md p-1.5" title="Remove" onclick={remove}
					><TrashIcon class="size-4" /></button
				>
			</div>
		{:else}
			<button
				class="text-duvet-accent-text hover:bg-duvet-hover-strong flex size-full items-center justify-center gap-1.5 text-[13px] font-medium transition-colors motion-reduce:transition-none"
				title={kind === "banner" ? "Set banner" : "Set icon"}
				onclick={edit}
			>
				<PlusIcon class={kind === "banner" ? "size-4" : "size-5"} />
				{#if kind === "banner"}Set banner{/if}
			</button>
		{/if}
	</div>
{/snippet}

<SettingsFrame
	{mode}
	{chrome}
	bind:open
	name="{space?.name ?? 'Space'} · Space settings"
	groups={sectionGroups}
	bind:active={activeSection}
	wide={activeSection === "roles"}
>
	{#snippet head()}
		<div class="flex shrink-0 items-center gap-2.5 p-2">
			<SpaceIconMark src={space?.icon ? getAvatarURL(space.id, space.icon) : null} name={space?.name ?? ""} size={34} />
			<span class="min-w-0 flex-1">
				<span class="font-serif-sm block truncate text-[15px] font-medium">{space?.name ?? "Space"}</span>
				<span class="text-duvet-ink2 block truncate text-[11.5px]">Space settings</span>
			</span>
		</div>
	{/snippet}

	{#snippet bars()}
		<!-- Move bar (appears while files of a bucket are picked) -->
		{#if activeSection === "attachments" && spacePicking && spacePicker.pickedFiles.length > 0}
			{@const pickedCount = spacePicker.pickedFiles.length}
			{@const tooMany = (spacePicker.filter.attachment_ids?.length ?? 0) > MAX_PICKED_FILES}
			<div
				transition:slide={{ duration: motionMs(200) }}
				class="bg-duvet-card shadow-duvet-lifted mx-[26px] mb-3 flex items-center justify-between gap-4 rounded-2xl py-2.5 pr-2.5 pl-4 text-[13px] font-medium"
			>
				<p class="text-duvet-ink2 min-w-0 truncate">
					{#if spaceTransfer}
						Wait for the transfer under way to end.
					{:else if tooMany}
						Pick {MAX_PICKED_FILES} files at most, or Select all.
					{:else}
						{countFiles(pickedCount)} selected
					{/if}
				</p>
				<div class="flex shrink-0 items-center gap-2">
					<Button variant="quiet" onclick={() => spacePicker.picked.clear()}>Clear</Button>
					<Button onclick={openMoveSpacePicked} disabled={spaceTransfer !== null || tooMany}>
						<MoveIcon size={15} />
						Move {countFiles(pickedCount)} ({formatFileSize(spacePicker.pickedBytes)}) to…
					</Button>
				</div>
			</div>
		{/if}
	{/snippet}

	{#if activeSection === "overview"}
		<SettingsGroup title="Banner and icon" plain class="flex flex-wrap items-end gap-5">
			<div>
				<span class={LABEL}>Banner</span>
				{@render imageSlot(
					"banner",
					pendingBannerPreview,
					pendingBanner,
					space?.banner ? getAvatarURL(space.id, space.banner) : null,
					() => (showSpaceBannerCrop = true),
					() => {
						if (pendingBannerPreview) URL.revokeObjectURL(pendingBannerPreview);
						pendingBanner = null;
						pendingBannerPreview = null;
					},
					() => (pendingBanner = "remove"),
					() => (pendingBanner = null),
				)}
			</div>
			<div>
				<span class={LABEL}>Icon</span>
				{@render imageSlot(
					"icon",
					pendingIconPreview,
					pendingIcon,
					space?.icon ? getAvatarURL(space.id, space.icon) : null,
					() => (showSpaceIconCrop = true),
					() => {
						if (pendingIconPreview) URL.revokeObjectURL(pendingIconPreview);
						pendingIcon = null;
						pendingIconPreview = null;
					},
					() => (pendingIcon = "remove"),
					() => (pendingIcon = null),
				)}
			</div>
			<p class="text-duvet-ink2 w-full text-[11px] select-text">Space ID: {spaceId}</p>
		</SettingsGroup>

		<SettingsGroup title="About" plain class="flex flex-col gap-4">
			<label class="block">
				<span class={LABEL}>Space name</span>
				<input type="text" bind:value={ovName} placeholder="Space name" maxlength={64} class={FIELD} />
			</label>
			<label class="block">
				<span class={LABEL}>Description</span>
				<textarea
					bind:value={ovDescription}
					placeholder="What is this Space about?"
					rows="3"
					maxlength={256}
					class="{FIELD_AREA} {thinScrollbar}"
				></textarea>
			</label>
			<label class="block">
				<span class={LABEL}>Locale</span>
				<input type="text" bind:value={ovLocale} placeholder="en" maxlength={4} class={FIELD} />
			</label>
		</SettingsGroup>

		<!-- What members are notified of until they choose, in the Space's menu -->
		<SettingsGroup title="New members">
			<SettingsRow
				label="Default notifications"
				line="Members are notified of this until they choose for themselves."
				labelFor="ov-default-notifications"
			>
				<select id="ov-default-notifications" bind:value={ovDefaultNotifications} class={SELECT}>
					<option value={0}>All messages</option>
					<option value={1}>Only mentions</option>
				</select>
			</SettingsRow>
		</SettingsGroup>

		<!-- Save -->
		{#if ovHasChanges}
			<div>
				<Button onclick={handleSaveOverview} disabled={ovSaving} class="tabular-nums">
					{ovSaving ? (ovUploadPercent === null ? "Saving…" : uploadNote(ovUploadPercent)) : "Save changes"}
				</Button>
			</div>
		{/if}

		<!-- Delete: the owner's alone, confirmed by typing the space's name -->
		{#if isOwner && space}
			<SettingsGroup plain class="ring-duvet-danger/40 ring-1">
				<h3 class="text-duvet-danger text-[13.5px] font-medium">Delete Space</h3>
				<p class="text-duvet-ink2 mt-0.5 text-xs">
					It goes for everyone in it, with its rooms and messages. This can't be undone.
				</p>
				{#if !confirmingDelete}
					<Button variant="danger" size="sm" class="mt-3" onclick={() => (confirmingDelete = true)}>Delete Space</Button
					>
				{:else}
					<label class="mt-3 block">
						<span class="mb-1.5 block text-xs">
							Type <strong class="font-semibold">{space.name}</strong> to delete it.
						</span>
						<input
							type="text"
							bind:value={deleteConfirm}
							placeholder={space.name}
							disabled={deletingSpace}
							onkeydown={(e) => {
								if (e.key === "Enter") void handleDeleteSpace();
							}}
							class={FIELD}
						/>
					</label>
					{#if deleteError}
						<p class="text-duvet-danger mt-2 text-[13px]" role="alert">{deleteError}</p>
					{/if}
					<div class="mt-3 flex gap-2">
						<Button variant="danger" onclick={handleDeleteSpace} disabled={!deleteNameMatches || deletingSpace}>
							{deletingSpace ? "Deleting…" : "Delete Space"}
						</Button>
						<Button
							variant="quiet"
							onclick={() => {
								confirmingDelete = false;
								deleteConfirm = "";
								deleteError = null;
							}}
							disabled={deletingSpace}
						>
							Cancel
						</Button>
					</div>
				{/if}
			</SettingsGroup>
		{/if}
	{:else if activeSection === "roles"}
		{#if canManageRoles && space}
			<!-- Create new role -->
			<SettingsGroup
				title="Create new role"
				plain
				class="flex flex-col gap-4"
				note="Set role identity, color, and permissions."
			>
				<label class="block">
					<span class={LABEL}>Role name</span>
					<input type="text" placeholder="Role name" bind:value={newRoleName} maxlength={64} class={FIELD} />
				</label>

				<!-- Color -->
				<div class="flex flex-col gap-2">
					<div class="flex items-center justify-between">
						<span class="{LABEL} mb-0!">Color</span>
						<label class="text-duvet-ink2 flex cursor-pointer items-center gap-1.5 text-xs">
							<input type="checkbox" bind:checked={newRoleUseGradient} class={CHECKBOX} />
							Gradient
						</label>
					</div>
					{@render colorWells(newRoleUseGradient, newRoleColorFrom, newRoleColorVia, newRoleColorTo, (stop, value) => {
						if (stop === "from") newRoleColorFrom = value;
						else if (stop === "via") newRoleColorVia = value;
						else newRoleColorTo = value;
					})}
				</div>

				<!-- Hoisted -->
				<div class="flex items-center justify-between gap-3">
					<span class="text-[13px] font-medium">List this role's members separately</span>
					<Toggle label="List this role's members separately" bind:checked={newRoleHoisted} />
				</div>

				<!-- Permissions -->
				<div>
					<p class={LABEL}>Permissions</p>
					{@render permissionSwitches((flag) => newRolePermissions.includes(flag), 0, false)}
				</div>

				<Button onclick={handleCreateRole} disabled={isCreating || !newRoleName.trim()}>
					{isCreating ? "Creating…" : "Create role"}
				</Button>
			</SettingsGroup>

			<!-- Existing roles -->
			<section class="flex flex-col gap-2">
				<h3 class={GROUP_TITLE}>Existing roles</h3>
				<p class={NOTE}>Drag to reorder. Edit or delete using actions on the right.</p>
				<div class="flex flex-col gap-2" role="list">
					{#each sortedRoles as role, i (role.id)}
						{@const manageable = canManageRoleAt(space, role.position)}
						<div
							class="{CARD} transition-opacity duration-100 motion-reduce:transition-none"
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
									<div class="flex flex-col gap-3">
										<input
											type="text"
											bind:value={editingRoleName}
											placeholder="Role name"
											aria-label="Role name"
											maxlength={64}
											class={FIELD}
										/>

										<!-- Color -->
										<div class="flex flex-col gap-2">
											<div class="flex items-center justify-between">
												<span class="{LABEL} mb-0!">Color</span>
												<div class="flex items-center gap-2">
													<button
														type="button"
														aria-pressed={editingRoleClearColors}
														onclick={() => {
															editingRoleClearColors = !editingRoleClearColors;
														}}
														class="{TAG} py-1! transition-colors motion-reduce:transition-none {editingRoleClearColors
															? 'bg-duvet-danger text-duvet-on-danger'
															: 'bg-duvet-secondary-fill text-duvet-ink'}">Clear color</button
													>
													{#if !editingRoleClearColors}
														<label class="text-duvet-ink2 flex cursor-pointer items-center gap-1.5 text-xs">
															<input type="checkbox" bind:checked={editingRoleUseGradient} class={CHECKBOX} />
															Gradient
														</label>
													{/if}
												</div>
											</div>
											{#if !editingRoleClearColors}
												{@render colorWells(
													editingRoleUseGradient,
													editingRoleColorFrom,
													editingRoleColorVia,
													editingRoleColorTo,
													(stop, value) => {
														if (stop === "from") editingRoleColorFrom = value;
														else if (stop === "via") editingRoleColorVia = value;
														else editingRoleColorTo = value;
													},
												)}
											{/if}
										</div>

										<!-- Hoisted -->
										<div class="flex items-center justify-between gap-3">
											<span class="text-[13px] font-medium">List this role's members separately</span>
											<Toggle label="List this role's members separately" bind:checked={editingRoleHoisted} />
										</div>

										<!-- Permissions -->
										<div>
											<p class={LABEL}>Permissions</p>
											{@render permissionSwitches(
												(flag) => (editingRolePermissions & flag) === flag,
												editingRoleSaved,
												true,
											)}
										</div>

										<div class="flex gap-2">
											<Button class="flex-1" onclick={handleUpdateRole} disabled={isCreating}>Save</Button>
											<Button variant="secondary" class="flex-1" onclick={cancelEdit}>Cancel</Button>
										</div>
									</div>
								{:else}
									<div class="flex items-center gap-2">
										<DotsSixVerticalIcon
											class="text-duvet-ink2 size-4 shrink-0 cursor-grab opacity-55 active:cursor-grabbing"
										/>
										<div class="min-w-0 flex-1">
											<div class="mb-0.5 flex items-center gap-2">
												<span class="truncate text-[13.5px] font-medium">{role.name}</span>
												{#if role.hoisted}
													<span class="{TAG} bg-duvet-secondary-fill text-duvet-ink2">Listed separately</span>
												{/if}
											</div>
											<p class="text-duvet-ink2 truncate text-xs">{getPermissionNames(role.permissions)}</p>
										</div>
										<!-- Only a role below the user's highest one, as the API's checkRoleHierarchy allows -->
										<div
											class="ml-1 flex shrink-0 gap-1.5"
											title={manageable ? undefined : "Only roles below your highest role can be managed"}
										>
											<Button
												variant="secondary"
												size="sm"
												disabled={!manageable}
												onclick={() => {
													startEdit(role);
												}}>Edit</Button
											>
											<!-- everyone (its ID is the space's) can be edited, not deleted -->
											{#if role.id !== spaceId}
												<Button
													variant="quiet"
													size="sm"
													class="text-duvet-danger! hover:bg-duvet-danger/15!"
													disabled={!manageable}
													onclick={() => handleDeleteRole(role.id)}>Delete</Button
												>
											{/if}
										</div>
									</div>
								{/if}
							</div>
						</div>
					{/each}
				</div>
				{#if space.roles.length === 0}
					<p class="text-duvet-ink2 py-4 text-center text-sm">
						No roles yet. Create one to start assigning permissions.
					</p>
				{/if}
			</section>
		{:else}
			<p class="text-duvet-ink2 px-1.5 text-sm">You don't have permission to manage roles.</p>
		{/if}
	{:else if activeSection === "members"}
		{#if space}
			<!-- A window's Space is the main window's, which it replaces at each change: it lists what the main window has. -->
			<SpaceMembers {space} paging={mode === "sheet"} />
		{/if}
	{:else if activeSection === "emojis" || activeSection === "stickers"}
		{@const emojis = activeSection === "emojis"}
		{@const loading = emojis ? emojisLoading : stickersLoading}
		{@const canManage = emojis ? canManageEmojis : canManageStickers}
		{#if loading}
			<p class="text-duvet-ink2 px-1.5 text-sm">{emojis ? "Loading emojis…" : "Loading stickers…"}</p>
		{:else}
			{#if canManage}
				{@const preview = emojis ? newEmojiPreview : newStickerPreview}
				{@const uploading = emojis ? isUploadingEmoji : isUploadingSticker}
				{@const percent = emojis ? emojiUploadPercent : stickerUploadPercent}
				<SettingsGroup
					title={emojis ? "Upload emoji" : "Upload sticker"}
					plain
					note={emojis
						? "Custom emojis require a storage bucket configured for this Space."
						: "Custom stickers require a storage bucket configured for this Space."}
				>
					<div class="flex flex-wrap items-end gap-3">
						<label class="block min-w-40 flex-1">
							<span class={LABEL}>Name</span>
							{#if emojis}
								<input type="text" class={FIELD} placeholder="emoji_name" bind:value={newEmojiName} />
							{:else}
								<input type="text" class={FIELD} placeholder="sticker_name" bind:value={newStickerName} />
							{/if}
						</label>
						<div>
							<span class={LABEL}>Image</span>
							<button
								type="button"
								class="bg-duvet-secondary-fill text-duvet-accent-text hover:bg-duvet-hover-strong flex size-[38px] items-center justify-center overflow-hidden rounded-[11px] transition-colors motion-reduce:transition-none"
								title={preview ? "Change image" : "Choose image"}
								aria-label={preview ? "Change image" : "Choose image"}
								onclick={() => (emojis ? (showEmojiCrop = true) : (showStickerCrop = true))}
							>
								{#if preview}
									<img src={preview} alt="" class="size-full object-contain" />
								{:else}
									<ImagePlusIcon class="size-4" />
								{/if}
							</button>
						</div>
						<Button
							class="h-[38px]! tabular-nums"
							onclick={emojis ? handleUploadEmoji : handleUploadSticker}
							disabled={emojis
								? isUploadingEmoji || !newEmojiName.trim() || !newEmojiFile
								: isUploadingSticker || !newStickerName.trim() || !newStickerFile}
						>
							<UploadIcon size={15} />
							{uploading ? (percent === null ? "Uploading…" : uploadNote(percent)) : "Upload"}
						</Button>
					</div>
				</SettingsGroup>
			{/if}

			{#if (emojis ? spaceEmojis.length : spaceStickers.length) === 0}
				<div class="flex flex-col items-center justify-center py-12 text-center">
					{#if emojis}
						<SmileIcon class="text-duvet-ink2 mb-3 size-9" />
						<p class="text-duvet-ink2 text-sm">No custom emojis yet.</p>
					{:else}
						<StickerIcon class="text-duvet-ink2 mb-3 size-9" />
						<p class="text-duvet-ink2 text-sm">No custom stickers yet.</p>
					{/if}
					{#if canManage}
						<p class="text-duvet-ink2 mt-1 text-xs">Upload one above to get started.</p>
					{/if}
				</div>
			{:else if emojis}
				<div class="{CARD} divide-duvet-line divide-y">
					{#each spaceEmojis as emoji (emoji.id)}
						<div class="group flex min-h-[52px] items-center gap-3 px-3.5 py-2">
							<img
								src="{attachmentHost}/attachments/{emoji.attachment_id}"
								alt=":{emoji.name}:"
								class="size-8 rounded-md object-contain"
							/>
							{#if editingEmojiId === emoji.id}
								<input
									type="text"
									aria-label="Emoji name"
									class="{FIELD_SM} flex-1"
									bind:value={editingEmojiName}
									onkeydown={(e) => {
										if (e.key === "Enter") handleUpdateEmoji();
										if (e.key === "Escape") {
											e.stopPropagation();
											cancelEmojiEdit();
										}
									}}
								/>
								<IconButton label="Save" title="Save" class="text-duvet-alive-text!" onclick={handleUpdateEmoji}>
									<CheckIcon size={16} />
								</IconButton>
								<IconButton label="Cancel" title="Cancel" onclick={cancelEmojiEdit}>
									<XIcon size={16} />
								</IconButton>
							{:else}
								<p class="min-w-0 flex-1 truncate text-[13.5px] font-medium">:{emoji.name}:</p>
								{#if canManageEmojis}
									<div
										class="flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
									>
										<IconButton label="Rename" title="Rename" onclick={() => startEmojiEdit(emoji)}>
											<PencilIcon size={16} />
										</IconButton>
										<IconButton
											label="Delete"
											title="Delete"
											class="hover:bg-duvet-danger/15! hover:text-duvet-danger!"
											onclick={() => handleDeleteEmoji(emoji.id)}
											disabled={isDeletingEmoji[emoji.id]}
										>
											<TrashIcon size={16} />
										</IconButton>
									</div>
								{/if}
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<div class="{CARD} divide-duvet-line divide-y">
					{#each spaceStickers as sticker (sticker.id)}
						<div class="group flex min-h-[68px] items-center gap-3 px-3.5 py-2">
							<img
								src="{attachmentHost}/attachments/{sticker.attachment_id}"
								alt={sticker.name}
								class="size-12 rounded-md object-contain"
							/>
							{#if editingStickerReact === sticker.id}
								<input
									type="text"
									aria-label="Sticker name"
									class="{FIELD_SM} flex-1"
									bind:value={editingStickerName}
									onkeydown={(e) => {
										if (e.key === "Enter") handleUpdateSticker();
										if (e.key === "Escape") {
											e.stopPropagation();
											cancelStickerEdit();
										}
									}}
								/>
								<IconButton label="Save" title="Save" class="text-duvet-alive-text!" onclick={handleUpdateSticker}>
									<CheckIcon size={16} />
								</IconButton>
								<IconButton label="Cancel" title="Cancel" onclick={cancelStickerEdit}>
									<XIcon size={16} />
								</IconButton>
							{:else}
								<p class="min-w-0 flex-1 truncate text-[13.5px] font-medium">{sticker.name}</p>
								{#if canManageStickers}
									<div
										class="flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
									>
										<IconButton label="Rename" title="Rename" onclick={() => startStickerEdit(sticker)}>
											<PencilIcon size={16} />
										</IconButton>
										<IconButton
											label="Delete"
											title="Delete"
											class="hover:bg-duvet-danger/15! hover:text-duvet-danger!"
											onclick={() => handleDeleteSticker(sticker.id)}
											disabled={isDeletingSticker[sticker.id]}
										>
											<TrashIcon size={16} />
										</IconButton>
									</div>
								{/if}
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	{:else if activeSection === "storage"}
		{#if canManageBuckets}
			{@render transferCard()}
			<p class={NOTE}>
				Connect an S3-compatible bucket for this Space's storage. When a bucket is active, uploads go to your bucket.
			</p>

			{#if !spaceBucketsLoading}
				<div class={calloutClass("warn")}>
					<WarningIcon size={18} class="mt-0.5 shrink-0" />
					<div class="space-y-1">
						<p class="font-semibold">Before adding a bucket</p>
						<p>
							Only enter credentials that <strong>you own and control</strong>. If someone shared credentials with you,
							be aware that:
						</p>
						<ul class="list-disc space-y-0.5 pl-4">
							<li>
								The bucket owner can <strong>read, modify, or delete</strong> all emojis, and stickers files.
							</li>
							<li>
								They can <strong>revoke access</strong> without warning, breaking emojis, and stickers across the Space.
							</li>
							<li>
								All uploaded files may be <strong>logged, monitored, or shared</strong> by the bucket owner.
							</li>
						</ul>
					</div>
				</div>
			{/if}

			{#if spaceBucketsError}
				<p class={calloutClass("danger")} role="alert">{spaceBucketsError}</p>
			{/if}

			<!-- Create / Edit form -->
			{#if showSpaceBucketForm}
				{@render bucketForm()}
			{:else}
				<div>
					<Button
						variant="secondary"
						onclick={() => {
							resetSpaceBucketForm();
							showSpaceBucketForm = true;
						}}
					>
						<PlusIcon size={15} /> Add bucket
					</Button>
				</div>
			{/if}

			<!-- Bucket list -->
			{#if spaceBucketsLoading}
				<div class="flex flex-col gap-2">
					{#each Array(3) as _, index (index)}
						<div class="{SKELETON} h-16"></div>
					{/each}
				</div>
			{:else if spaceBuckets.length === 0}
				<div class="text-duvet-ink2 flex flex-col items-center justify-center py-12">
					<DatabaseIcon class="mb-3 size-9" />
					<p class="text-sm">No buckets configured</p>
					<p class="mt-1 text-xs">Add a bucket to enable custom emoji uploads.</p>
				</div>
			{:else}
				<div class="{CARD} divide-duvet-line divide-y">
					{#each spaceBuckets as bucket (bucket.id)}
						<div
							class="group hover:bg-duvet-hover-soft flex items-center gap-3 px-3.5 py-3 transition-colors motion-reduce:transition-none"
						>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<span class="truncate text-[13.5px] font-medium">{bucket.name}</span>
									{#if bucket.is_active}
										<span class="{TAG} bg-duvet-alive/20 text-duvet-alive-text uppercase">Active</span>
									{:else}
										<span class="{TAG} bg-duvet-secondary-fill text-duvet-ink2 uppercase">Inactive</span>
									{/if}
								</div>
								<p class="text-duvet-ink2 mt-0.5 truncate text-xs">{bucket.bucket_name} · {bucket.endpoint}</p>
								{#if bucket.max_bytes}
									{@const pct = usagePercent(bucket.used_bytes, bucket.max_bytes)}
									<div class="mt-1.5 space-y-1">
										<div class="text-duvet-ink2 flex items-center justify-between text-[11px] tabular-nums">
											<span
												>{(bucket.used_bytes / 1024 / 1024).toFixed(1)} MB / {(bucket.max_bytes / 1024 / 1024).toFixed(
													0,
												)} MB</span
											>
											<span>{pct}%</span>
										</div>
										{@render usageBar(pct)}
										{#if bucket.upload_limit_bytes}
											<p class="text-duvet-ink2 text-[11px]">
												Per-file: {(bucket.upload_limit_bytes / 1024 / 1024).toFixed(0)} MB
											</p>
										{/if}
									</div>
								{:else if bucket.upload_limit_bytes}
									<p class="text-duvet-ink2 mt-0.5 text-[11px]">
										Per-file: {(bucket.upload_limit_bytes / 1024 / 1024).toFixed(0)} MB
									</p>
								{/if}
							</div>
							<div
								class="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
							>
								<IconButton
									label={bucket.is_active ? "Deactivate" : "Activate"}
									title={bucket.is_active ? "Deactivate" : "Activate"}
									onclick={() => handleToggleSpaceBucket(bucket)}
									disabled={togglingSpaceBucketId === bucket.id}
								>
									{#if togglingSpaceBucketId === bucket.id}
										{@render spinner()}
									{:else if bucket.is_active}
										<XIcon size={16} />
									{:else}
										<CheckIcon size={16} />
									{/if}
								</IconButton>
								{#if canMoveSpaceFiles}
									<IconButton
										label="Move files…"
										title={spaceTransfer ? "Wait for the transfer under way to end" : "Move files…"}
										onclick={() => openMoveSpaceBucket(bucket)}
										disabled={movingSpaceBucketId === bucket.id || spaceTransfer !== null}
									>
										{#if movingSpaceBucketId === bucket.id}
											{@render spinner()}
										{:else}
											<MoveIcon size={16} />
										{/if}
									</IconButton>
								{/if}
								<IconButton label="Edit" title="Edit" onclick={() => startEditSpaceBucket(bucket)}>
									<PencilIcon size={16} />
								</IconButton>
								<IconButton
									label="Delete"
									title="Delete"
									class="hover:bg-duvet-danger/15! hover:text-duvet-danger!"
									onclick={() => handleDeleteSpaceBucket(bucket.id)}
								>
									<TrashIcon size={16} />
								</IconButton>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{:else}
			<p class="text-duvet-ink2 px-1.5 text-sm">You don't have permission to manage storage for this Space.</p>
		{/if}
	{:else if activeSection === "invites"}
		<p class={NOTE}>The invite links that still work. Revoking one makes it stop working for everyone.</p>
		{#if spaceInvitesLoading}
			<div class="flex flex-col gap-2">
				{#each Array(3) as _, index (index)}
					<div class="{SKELETON} h-14"></div>
				{/each}
			</div>
		{:else if spaceInvites.length === 0}
			<div class="text-duvet-ink2 flex flex-col items-center justify-center py-14">
				<LinkIcon class="mb-3 size-9" />
				<p class="text-sm">No invites</p>
			</div>
		{:else}
			<div class="{CARD} divide-duvet-line divide-y">
				{#each spaceInvites as invite (invite.id)}
					{@const room = space?.rooms.find((r) => r.id === invite.room_id)}
					<div
						class="group hover:bg-duvet-hover-soft flex items-center gap-3 px-3.5 py-2.5 transition-colors motion-reduce:transition-none"
					>
						<div class="min-w-0 flex-1">
							<p class="truncate font-mono text-[13px] select-text">{invite.code}</p>
							<p class="text-duvet-ink2 text-xs">
								#{room?.name ?? "deleted room"}
								<span class="mx-1 opacity-60">&middot;</span>
								{inviteCreator(invite.created_by)}
								<span class="mx-1 opacity-60">&middot;</span>
								{invite.expires_at ? `Expires ${new Date(invite.expires_at).toLocaleString()}` : "Never expires"}
							</p>
						</div>
						<Button
							variant="quiet"
							size="sm"
							class="hover:text-duvet-danger! hover:bg-duvet-danger/15! opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
							title="Revoke"
							onclick={() => handleRevokeInvite(invite)}
						>
							<TrashIcon size={14} />
							Revoke
						</Button>
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
		{@render transferCard()}
		<div class="flex min-h-[30px] items-center justify-between gap-3 px-1.5">
			<div class="text-duvet-ink2 text-[13px]">
				{#if spaceListedHere}
					<span class="text-duvet-ink font-semibold tabular-nums">{spaceAttachments.length}</span>
					file{spaceAttachments.length !== 1 ? "s" : ""}
					<span class="mx-1 opacity-60">&middot;</span>
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
							class={SELECT}
						>
							<option value="all">All</option>
							{#each spaceBuckets as b (b.id)}
								<option value={b.id}>{b.name}</option>
							{/each}
						</select>
					</label>
				{/if}
				{#if spaceAttachments.length > 0 && canManageAttachments && spaceAttachmentsLocation === "all"}
					<Button variant="danger" size="sm" onclick={handleDeleteAllSpaceAttachments}>
						<TrashIcon size={13} />
						Delete all
					</Button>
				{/if}
			</div>
		</div>

		{#if spaceAttachmentsLoading}
			<div class="flex flex-col gap-2">
				{#each Array(5) as _, index (index)}
					<div class="{SKELETON} h-14"></div>
				{/each}
			</div>
		{:else if !spaceListedHere}
			<!-- The location's files didn't load (a toast said why): the list is another's. -->
			<div class="text-duvet-ink2 flex flex-col items-center justify-center py-14">
				<p class="text-sm">Couldn't load the files here</p>
			</div>
		{:else if spaceAttachments.length === 0}
			<div class="text-duvet-ink2 flex flex-col items-center justify-center py-14">
				<PaperclipIcon class="mb-3 size-9" />
				<p class="text-sm">
					{spaceAttachmentsLocation === "all" ? "No attachments in this Space" : "No files here"}
				</p>
			</div>
		{:else}
			<div class="flex flex-col gap-2">
				{#if spacePicking}
					<FilePickerBar picker={spacePicker} />
				{/if}
				<div class="{CARD} divide-duvet-line divide-y">
					{#each spacePicker.shown as att (att.id)}
						{@const isImage = att.content_type.startsWith("image/")}
						{@const isAudio = att.content_type.startsWith("audio/")}
						<div
							class="group hover:bg-duvet-hover-soft flex items-center gap-3 px-3.5 py-2.5 transition-colors motion-reduce:transition-none"
						>
							{#if spacePicking}
								<input
									type="checkbox"
									checked={spacePicker.picked.has(att.id)}
									onchange={() => spacePicker.toggle(att.id)}
									aria-label="Select {att.filename}"
									class={CHECKBOX}
								/>
							{/if}
							{#if isImage}
								<img
									src="{attachmentHost}{att.url ?? `/attachments/${att.id}`}"
									alt=""
									class="bg-duvet-secondary-fill size-10 shrink-0 rounded-[9px] object-cover"
								/>
							{:else}
								<div
									class="bg-duvet-secondary-fill text-duvet-ink2 grid size-10 shrink-0 place-items-center rounded-[9px]"
								>
									{#if isAudio}<MicIcon size={16} />{:else}<PaperclipIcon size={16} />{/if}
								</div>
							{/if}
							<div class="min-w-0 flex-1">
								<p class="truncate text-[13.5px] font-medium">{att.filename}</p>
								<p class="text-duvet-ink2 text-xs">
									{formatFileSize(att.size_bytes)}
									<span class="mx-1 opacity-60">&middot;</span>
									{new Date(att.created_at).toLocaleDateString()}
								</p>
							</div>
							<div
								class="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
							>
								<a
									href="{attachmentHost}{att.url ?? `/attachments/${att.id}`}"
									download={att.filename}
									class={iconButtonClass()}
									title="Download"
									aria-label="Download {att.filename}"
								>
									<DownloadIcon size={16} />
								</a>
								{#if canManageAttachments}
									<IconButton
										label="Delete"
										title="Delete"
										class="hover:bg-duvet-danger/15! hover:text-duvet-danger!"
										onclick={() => handleDeleteSpaceAttachment(att)}
									>
										<TrashIcon size={16} />
									</IconButton>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	{/if}
</SettingsFrame>

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
	title="Change icon"
	aspect={1}
	round
	targetWidth={256}
	targetHeight={256}
	onConfirm={(f) => onSpaceIconCrop(f)}
/>
<ImageCropModal
	bind:open={showSpaceBannerCrop}
	title="Change banner"
	aspect={5 / 2}
	targetWidth={600}
	targetHeight={240}
	onConfirm={(f) => onSpaceBannerCrop(f)}
/>
<ImageCropModal
	bind:open={showEmojiCrop}
	title="Emoji image"
	aspect={1}
	targetWidth={128}
	targetHeight={128}
	onConfirm={(f) => setNewEmojiFile(f)}
/>
<ImageCropModal
	bind:open={showStickerCrop}
	title="Sticker image"
	aspect={1}
	targetWidth={320}
	targetHeight={320}
	onConfirm={(f) => setNewStickerFile(f)}
/>
