<script lang="ts">
	import { onDestroy } from "svelte";
	import {
		User as UserIcon,
		Paperclip as PaperclipIcon,
		Database as DatabaseIcon,
		X as XIcon,
		Check as CheckIcon,
		Trash2 as TrashIcon,
		Plus as PlusIcon,
		Pencil as PencilIcon,
		Shield as ShieldIcon,
		LogOut as LogOutIcon,
		Volume2 as VolumeIcon,
		Square as StopIcon,
		Code as CodeIcon,
		Copy as CopyIcon,
		Bot as BotIcon,
		UserPlus as UserPlusIcon,
		RotateCw as RotateIcon,
		ChevronLeft as ChevronLeftIcon,
		Eye as EyeIcon,
		EyeOff as EyeOffIcon,
		Globe as GlobeIcon,
		Lock as LockIcon,
		Palette as PaletteIcon,
		Activity as ActivityIcon,
		ArrowRightLeft as MoveIcon,
	} from "@lucide/svelte";
	import { Dialog } from "bits-ui";
	import { slide } from "svelte/transition";
	import { currentUser, channelMessages, gatewaySpaces, dmMessages, conversations } from "$lib/stores.svelte";
	import MemberProfileCard from "$lib/components/MemberProfileCard.svelte";
	import ImageCropModal from "$lib/components/ImageCropModal.svelte";
	import api, { getApiError } from "$lib/api/api";
	import { uploadNote, uploadPercent } from "$lib/uploads";
	import {
		updateUser,
		getMyAttachments,
		getMyStorageStatus,
		deleteMyAttachment,
		deleteAllMyAttachments,
		getMyBuckets,
		createMyBucket,
		updateMyBucket,
		deleteMyBucket,
		activateMyBucket,
		deactivateMyBucket,
		type UserAttachment,
		type StorageStatus,
		type StorageBucket,
		type CreateBucketPayload,
		BIO_MAX_LENGTH,
	} from "$lib/api/user";
	import { getHostURL, getAvatarURL, route, DUVET_DOMAIN } from "$lib/common/common";
	import { confirmAction } from "$lib/stores/confirm.svelte";
	import { toast } from "$lib/stores/toast.svelte";
	import { sendVerificationEmail, sendResetPasswordEmail, sendChangeEmail, logout } from "$lib/api/auth";
	import { audioStore, type SoundEvent } from "$lib/stores/audio.svelte";
	import VoiceNotePlayer from "$lib/components/VoiceNotePlayer.svelte";
	import { loadCustomTheme, resetTheme, getThemeUrl, renderMarkdown } from "$lib/markdown";
	import {
		listTeams,
		createTeam,
		updateTeam,
		deleteTeam,
		listTeamMembers,
		inviteToTeam,
		removeTeamMember,
		listApplications,
		createApplication,
		updateApplication,
		deleteApplication,
		createBot,
		resetBotToken,
		deleteBot,
		updateBot,
		getBotUser,
		type BotUser,
		TeamRole,
		type Team,
		type TeamMember,
		type Application,
	} from "$lib/api/developer";
	import { pendingTeamInvites, myBuckets, voiceFaces, shareSpotify } from "$lib/stores.svelte";
	import { layoutPrefs } from "$lib/layout-prefs.svelte";
	import { BUSY_ROOM_ONLINE } from "$lib/members";
	import { setThemePref, theme } from "$lib/theme.svelte";
	import { parseThemePref } from "$lib/theme";
	import { isElectrobunWindow } from "$lib/electrobun-rpc";
	import { chosenStatus } from "$lib/status";
	import { ownMobileOnly } from "$lib/api/ws/connection";
	import { answerTeamInvite } from "$lib/team-invites";
	import { userStatusToString } from "$lib/types";
	import StorageTransferCard from "$lib/components/StorageTransferCard.svelte";
	import MoveFilesDialog from "$lib/components/MoveFilesDialog.svelte";
	import BucketFilesDialog from "$lib/components/BucketFilesDialog.svelte";
	import FilePickerBar from "$lib/components/FilePickerBar.svelte";
	import { FilePicker } from "$lib/file-picker.svelte";
	import { storageTransfers, bucketFilesCount } from "$lib/stores/storage-transfers.svelte";
	import {
		bucketChoice,
		countFiles,
		defaultStorageChoice,
		DEFAULT_STORAGE,
		MAX_PICKED_FILES,
		type PickableFile,
		type StorageChoice,
		type TransferFilter,
	} from "$lib/storage-transfers";

	let {
		open = $bindable(false),
	}: {
		open?: boolean;
	} = $props();

	type Section = "account" | "security" | "audio" | "appearance" | "activity" | "attachments" | "buckets" | "developer";
	// Only the desktop app reads what this computer plays.
	const desktopApp = isElectrobunWindow();
	let activeSection = $state<Section>("account");
	// The sidebar's sections, in order; Developer sits apart, after a line.
	const settingsSections = [
		{ id: "account", label: "My Account", icon: UserIcon },
		{ id: "attachments", label: "Attachments", icon: PaperclipIcon },
		{ id: "security", label: "Security", icon: ShieldIcon },
		{ id: "audio", label: "Audio", icon: VolumeIcon },
		{ id: "appearance", label: "Appearance", icon: PaletteIcon },
		...(desktopApp ? [{ id: "activity", label: "Activity Privacy", icon: ActivityIcon } as const] : []),
		{ id: "buckets", label: "S3 Buckets", icon: DatabaseIcon },
		{ id: "developer", label: "Developer", icon: CodeIcon },
	] as const satisfies readonly { id: Section; label: string; icon: unknown }[];

	// Attachments state
	const attachmentHost = getHostURL();
	let attachments = $state<UserAttachment[]>([]);
	let attachmentsLoading = $state(false);
	let attachmentsError = $state<string | null>(null);
	let storageStatus = $state<StorageStatus | null>(null);
	// The storage the list shows: "all", DEFAULT_STORAGE or a bucket ID. Picking files to move needs one.
	let attachmentsLocation = $state("all");
	// The location whose files `attachments` are, set with them. Until a load for the one picked succeeds, they're
	// another's, which mustn't show or be picked as its: "Select all" would move every file of the one picked.
	let attachmentsListed = $state<string | null>(null);
	const listedHere = $derived(attachmentsListed === attachmentsLocation);
	const picking = $derived(listedHere && attachmentsLocation !== "all");
	const picker = new FilePicker(() => attachments);
	let attachmentsLoadId = 0;

	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	async function loadAttachments(location = attachmentsLocation) {
		// Only the last load counts: the location can change while one is on its way.
		const loadId = ++attachmentsLoadId;
		attachmentsLoading = true;
		attachmentsError = null;
		try {
			const [list, status, bucketList] = await Promise.all([
				getMyAttachments(location === "all" ? undefined : location),
				getMyStorageStatus(),
				getMyBuckets(),
			]);
			if (loadId !== attachmentsLoadId) return;
			[attachments, attachmentsListed, storageStatus, buckets] = [list, location, status, bucketList];
			storageTransfers.nameBuckets(bucketList);
			picker.prune();
		} catch (err) {
			if (loadId === attachmentsLoadId) attachmentsError = getApiError(err, "Failed to load");
		} finally {
			if (loadId === attachmentsLoadId) attachmentsLoading = false;
		}
	}

	/** Shows another storage's files. Its picks and kind filters start over. */
	function setAttachmentsLocation(location: string) {
		picker.clear();
		attachmentsLocation = location;
	}

	const locationBytes = $derived(attachments.reduce((sum, a) => sum + a.size_bytes, 0));

	async function refreshStorageStatus() {
		try {
			storageStatus = await getMyStorageStatus();
		} catch {}
	}

	async function handleDeleteAttachment(id: string) {
		const att = attachments.find((a) => a.id === id);
		const name = att?.filename ?? "this file";
		await confirmAction(`Delete "${name}"?`, "Delete", async () => {
			await deleteMyAttachment(id);
			attachments = attachments.filter((a) => a.id !== id);
			await refreshStorageStatus();
		});
	}

	async function handleDeleteAll() {
		await confirmAction("Delete all your attachments? This cannot be undone.", "Delete", async () => {
			await deleteAllMyAttachments();
			attachments = [];
			await refreshStorageStatus();
		});
	}

	// Buckets state
	let buckets = $state<StorageBucket[]>([]);
	const hasActiveBucket = $derived($myBuckets.some((b) => b.is_active));
	let bucketsLoading = $state(false);
	let bucketsError = $state<string | null>(null);
	let showBucketForm = $state(false);
	let editingBucket = $state<StorageBucket | null>(null);
	let bucketSaving = $state(false);
	let bName = $state("");
	let bEndpoint = $state("");
	let bRegion = $state("auto");
	let bBucketName = $state("");
	let bAccessKey = $state("");
	let bSecretKey = $state("");
	let bUsePathStyle = $state(false);
	let bMaxBytesMB = $state("");
	let bUploadLimitMB = $state("");

	async function loadBuckets() {
		bucketsLoading = true;
		bucketsError = null;
		try {
			buckets = await getMyBuckets();
			myBuckets.set(buckets);
		} catch (e) {
			bucketsError = getApiError(e, "Failed to load");
		} finally {
			bucketsLoading = false;
		}
	}

	function resetBucketForm() {
		bName = "";
		bEndpoint = "";
		bRegion = "auto";
		bBucketName = "";
		bAccessKey = "";
		bSecretKey = "";
		bUsePathStyle = false;
		bMaxBytesMB = "";
		bUploadLimitMB = "";
		editingBucket = null;
		showBucketForm = false;
	}

	function startEditBucket(b: StorageBucket) {
		editingBucket = b;
		showBucketForm = true;
		bName = b.name;
		bEndpoint = b.endpoint;
		bRegion = b.region;
		bBucketName = b.bucket_name;
		bAccessKey = b.access_key_id;
		bSecretKey = "";
		bUsePathStyle = b.use_path_style;
		bMaxBytesMB = b.max_bytes ? String(b.max_bytes / 1024 / 1024) : "";
		bUploadLimitMB = b.upload_limit_bytes ? String(b.upload_limit_bytes / 1024 / 1024) : "";
	}

	async function handleSaveBucket() {
		if (!bName.trim() || !bEndpoint.trim() || !bBucketName.trim() || !bAccessKey.trim()) return;

		const doSave = async () => {
			bucketSaving = true;
			bucketsError = null;
			try {
				const maxMB = parseFloat(bMaxBytesMB);
				const uploadMB = parseFloat(bUploadLimitMB);
				const payload: CreateBucketPayload = {
					name: bName.trim(),
					endpoint: bEndpoint.trim(),
					region: bRegion.trim() || "auto",
					bucket_name: bBucketName.trim(),
					access_key_id: bAccessKey.trim(),
					secret_access_key: bSecretKey.trim(),
					use_path_style: bUsePathStyle,
					max_bytes: maxMB > 0 ? Math.round(maxMB * 1024 * 1024) : null,
					upload_limit_bytes: uploadMB > 0 ? Math.round(uploadMB * 1024 * 1024) : null,
				};
				if (editingBucket) {
					await updateMyBucket(editingBucket.id, payload);
				} else {
					await createMyBucket(payload);
				}
				resetBucketForm();
				await loadBuckets();
			} catch (e) {
				bucketsError = getApiError(e, "Failed to save");
			} finally {
				bucketSaving = false;
			}
		};

		if (editingBucket) {
			await doSave();
		} else {
			await confirmAction(
				"You are about to connect external storage credentials. Make sure you own and trust these credentials. The bucket owner can read, modify, or delete your files and revoke access at any time.",
				"Yes, add bucket",
				doSave,
			);
		}
	}

	async function handleDeleteBucket(id: string) {
		const b = buckets.find((x) => x.id === id);
		await confirmAction(`Delete bucket "${b?.name}"?`, "Delete", async () => {
			try {
				await deleteMyBucket(id);
			} catch (err) {
				// Deleting it would break its files: offer to move them or delete them with it.
				const files = bucketFilesCount(err);
				if (files === null || !b) throw err;
				bucketFilesRequest = { bucket: b, files };
				return;
			}
			await afterBucketDeleted(id);
		});
	}

	async function deleteBucketWithFiles(bucket: StorageBucket) {
		await deleteMyBucket(bucket.id, true);
		await afterBucketDeleted(bucket.id);
	}

	async function afterBucketDeleted(id: string) {
		if (attachmentsLocation === id) setAttachmentsLocation("all");
		await loadBuckets();
	}

	let togglingBucketId = $state<string | null>(null);

	async function handleToggleActive(b: StorageBucket) {
		togglingBucketId = b.id;
		try {
			if (b.is_active) {
				await deactivateMyBucket(b.id);
			} else {
				await activateMyBucket(b.id);
			}
			await loadBuckets();
		} catch (e) {
			toast(getApiError(e, "Failed to toggle bucket"), "error");
		} finally {
			togglingBucketId = null;
		}
	}

	// ── Moving files between your storages ──────────────────────────────────
	const myTransfer = $derived(storageTransfers.active($currentUser?.id));
	// Your default storage is one of them once its status is loaded (Attachments loads it, and so does a move).
	const myStorageChoices = $derived<StorageChoice[]>([
		...(storageStatus ? [defaultStorageChoice(storageStatus, buckets)] : []),
		...buckets.map(bucketChoice),
	]);
	let moveOpen = $state(false);
	let moveSourceId = $state("");
	let moveFiles = $state.raw<PickableFile[]>([]);
	let moveFilter = $state.raw<TransferFilter>({});
	// The bucket whose "Move files…" is loading its files.
	let movingBucketId = $state<string | null>(null);
	let bucketFilesRequest = $state<{ bucket: StorageBucket; files: number } | null>(null);

	function storageLabel(bucketId: string | null): string {
		if (bucketId === null) return "Default storage";
		return buckets.find((b) => b.id === bucketId)?.name ?? storageTransfers.storageName(bucketId) ?? "another bucket";
	}

	function openMovePicked() {
		// From the storage the picked files were listed in.
		const source = attachmentsListed;
		if (!picking || source === null) return;
		moveSourceId = source;
		moveFiles = picker.pickedFiles;
		moveFilter = picker.filter;
		moveOpen = true;
	}

	/** Opens the move of all of a bucket's files, with fresh numbers for the room left in each storage. */
	async function openMoveBucket(bucket: StorageBucket) {
		movingBucketId = bucket.id;
		try {
			const [files, status, bucketList] = await Promise.all([
				getMyAttachments(bucket.id),
				getMyStorageStatus(),
				getMyBuckets(),
			]);
			storageStatus = status;
			buckets = bucketList;
			myBuckets.set(bucketList);
			storageTransfers.nameBuckets(bucketList);
			if (files.length === 0) {
				toast(`"${bucket.name}" has no files.`, "info");
				return;
			}
			moveSourceId = bucket.id;
			moveFiles = files;
			moveFilter = {};
			moveOpen = true;
		} catch (err) {
			toast(getApiError(err, "Failed to load the bucket's files"), "error");
		} finally {
			movingBucketId = null;
		}
	}

	function onMoveStarted() {
		picker.picked.clear();
		// "Make … active" may have changed the active bucket.
		void loadBuckets();
	}

	// The transfer under way, if any, shows in both storage sections: loaded on opening one, then kept fresh.
	$effect(() => {
		if (open && (activeSection === "attachments" || activeSection === "buckets")) return storageTransfers.watch(null);
	});

	// When one of your transfers ends, files have moved: reload what the open section shows.
	$effect(() =>
		storageTransfers.onEnd((t) => {
			if (!open || t.owner_id !== $currentUser?.id) return;
			if (activeSection === "attachments") void loadAttachments();
			else if (activeSection === "buckets") void loadBuckets();
		}),
	);

	// Verification state
	let sendingVerification = $state(false);

	async function handleSendVerification() {
		sendingVerification = true;
		try {
			await sendVerificationEmail();
			toast("Verification email sent! Check your inbox.", "success");
		} catch (err) {
			toast(getApiError(err, "Failed to send verification email"), "error");
		} finally {
			sendingVerification = false;
		}
	}

	// Reset password state
	let sendingReset = $state(false);

	async function handleSendResetPassword() {
		sendingReset = true;
		try {
			await sendResetPasswordEmail();
			toast("Reset password email sent! Check your inbox.", "success");
		} catch (err) {
			toast(getApiError(err, "Failed to send reset password email"), "error");
		} finally {
			sendingReset = false;
		}
	}

	// Audio preview state
	let previewingSound = $state<SoundEvent | null>(null);
	let previewAudio = $state<HTMLAudioElement | null>(null);

	function togglePreview(event: SoundEvent) {
		if (previewingSound === event) {
			previewAudio?.pause();
			previewAudio = null;
			previewingSound = null;
			return;
		}
		previewAudio?.pause();
		previewingSound = event;
		const audio = audioStore.play(event);
		if (audio) {
			previewAudio = audio;
			audio.onended = () => {
				if (previewingSound === event) {
					previewAudio = null;
					previewingSound = null;
				}
			};
		} else {
			previewingSound = null;
		}
	}

	// Appearance state
	let codeThemeUrl = $state(getThemeUrl());
	let savingTheme = $state(false);
	let themeVersion = $state(0);

	async function handleSaveTheme() {
		const url = codeThemeUrl.trim();
		savingTheme = true;
		try {
			if (!url) {
				await resetTheme();
				toast("Theme reset to default", "success");
			} else {
				await loadCustomTheme(url);
				toast("Code theme applied!", "success");
			}
			themeVersion++;
		} catch (e) {
			toast(getApiError(e, "Failed to load theme"), "error");
		} finally {
			savingTheme = false;
		}
	}

	// Change email state
	let newEmail = $state("");
	let sendingEmailChange = $state(false);

	async function handleSendChangeEmail() {
		if (!newEmail.trim()) return;
		sendingEmailChange = true;
		try {
			await sendChangeEmail(newEmail.trim());
			toast("Verification email sent to your new address. Check your inbox.", "success");
			newEmail = "";
		} catch (err) {
			toast(getApiError(err, "Failed to send email change request"), "error");
		} finally {
			sendingEmailChange = false;
		}
	}

	// Image upload (avatar & banner) — staged locally, uploaded on save
	let showAvatarCrop = $state(false);
	let showBannerCrop = $state(false);

	// Pending changes: File for upload, "remove" to clear, null for no change
	let pendingAvatar = $state<File | "remove" | null>(null);
	let pendingBanner = $state<File | "remove" | null>(null);

	// Blob URLs for local preview
	let pendingAvatarPreview = $state<string | null>(null);
	let pendingBannerPreview = $state<string | null>(null);

	function handleImageCropStage(kind: "avatar" | "banner", file: File) {
		const url = URL.createObjectURL(file);
		if (kind === "avatar") {
			if (pendingAvatarPreview) URL.revokeObjectURL(pendingAvatarPreview);
			pendingAvatar = file;
			pendingAvatarPreview = url;
		} else {
			if (pendingBannerPreview) URL.revokeObjectURL(pendingBannerPreview);
			pendingBanner = file;
			pendingBannerPreview = url;
		}
	}

	function handleRemoveImageStage(kind: "avatar" | "banner") {
		if (kind === "avatar") {
			if (pendingAvatarPreview) URL.revokeObjectURL(pendingAvatarPreview);
			pendingAvatar = "remove";
			pendingAvatarPreview = null;
		} else {
			if (pendingBannerPreview) URL.revokeObjectURL(pendingBannerPreview);
			pendingBanner = "remove";
			pendingBannerPreview = null;
		}
	}

	function resetImageStages() {
		if (pendingAvatarPreview) URL.revokeObjectURL(pendingAvatarPreview);
		if (pendingBannerPreview) URL.revokeObjectURL(pendingBannerPreview);
		pendingAvatar = null;
		pendingBanner = null;
		pendingAvatarPreview = null;
		pendingBannerPreview = null;
	}

	const hasImageChanges = $derived(pendingAvatar !== null || pendingBanner !== null);

	// Form state
	let username = $state("");
	let alias = $state("");
	let bio = $state("");
	let saving = $state(false);
	// How far a new avatar or banner has gone up while the profile saves, in percent, which Save says: null until its
	// first progress, and while nothing new goes up.
	let profileUploadPercent = $state<number | null>(null);
	let saveError = $state<string | null>(null);
	let saveSuccess = $state(false);
	// Characters as the API counts them (code points), not the UTF-16 units maxlength would: an emoji is one.
	const bioLength = $derived([...bio.trim()].length);
	const bioTooLong = $derived(bioLength > BIO_MAX_LENGTH);

	// Sync from currentUser when modal opens
	$effect(() => {
		if (open && $currentUser) {
			username = $currentUser.username ?? "";
			alias = $currentUser.alias ?? "";
			bio = $currentUser.custom ?? "";
			saveError = null;
			saveSuccess = false;
		}
	});

	// Load attachments when switching to that section, and again for each location picked
	$effect(() => {
		if (open && activeSection === "attachments") {
			void loadAttachments(attachmentsLocation);
		}
	});

	$effect(() => {
		if (open && activeSection === "buckets") {
			void loadBuckets();
		}
	});

	// Developer state
	let devTeams = $state<Team[]>([]);
	let devLoading = $state(false);
	let devSelectedTeam = $state<Team | null>(null);
	let devApps = $state<Application[]>([]);
	let devMembers = $state<TeamMember[]>([]);
	let devAppsLoading = $state(false);
	let devNewTeamName = $state("");
	let devCreatingTeam = $state(false);
	let devNewAppName = $state("");
	let devNewAppDesc = $state("");
	let devCreatingApp = $state(false);
	let devInviteEmail = $state("");
	let devInviting = $state(false);
	let devBotToken = $state<string | null>(null);
	let devShowToken = $state(false);
	let devEditingTeam = $state<Team | null>(null);
	let devEditTeamName = $state("");
	let devEditingApp = $state<Application | null>(null);
	let devEditAppName = $state("");
	let devEditAppDesc = $state("");
	let showBotAvatarCrop = $state(false);
	let showBotBannerCrop = $state(false);
	let botCropTargetApp = $state<Application | null>(null);
	let botAvatarPreview = $state<string | null>(null);
	let botBannerPreview = $state<string | null>(null);
	// Unsaved, the pending images' previews go with Settings: nothing else lets go of them (#325).
	onDestroy(() => {
		for (const url of [pendingAvatarPreview, pendingBannerPreview, botAvatarPreview, botBannerPreview])
			if (url) URL.revokeObjectURL(url);
	});

	let pendingBotAvatar = $state<File | "remove" | null>(null);
	let pendingBotBanner = $state<File | "remove" | null>(null);
	let savingBotProfile = $state(false);
	// As profileUploadPercent, for the bot's new avatar or banner.
	let botUploadPercent = $state<number | null>(null);
	let botUsers = $state<Record<string, BotUser>>({});
	let botEditUsername = $state("");
	let botEditAlias = $state("");
	let botEditingAppId = $state<string | null>(null);

	function startBotEdit(app: Application) {
		const bu = app.bot_user_id ? botUsers[app.bot_user_id] : null;
		botEditUsername = bu?.username ?? "";
		botEditAlias = bu?.alias ?? "";
		botEditingAppId = app.id;
	}

	const hasBotProfileChanges = $derived(
		pendingBotAvatar !== null ||
			pendingBotBanner !== null ||
			(botEditingAppId !== null &&
				(() => {
					const app = devApps.find((a) => a.id === botEditingAppId);
					const bu = app?.bot_user_id ? botUsers[app.bot_user_id] : null;
					return botEditUsername !== (bu?.username ?? "") || botEditAlias !== (bu?.alias ?? "");
				})()),
	);

	function onBotAvatarCrop(file: File) {
		pendingBotAvatar = file;
		if (botAvatarPreview) URL.revokeObjectURL(botAvatarPreview);
		botAvatarPreview = URL.createObjectURL(file);
	}

	function onBotBannerCrop(file: File) {
		pendingBotBanner = file;
		if (botBannerPreview) URL.revokeObjectURL(botBannerPreview);
		botBannerPreview = URL.createObjectURL(file);
	}

	function clearBotAvatar() {
		if (botAvatarPreview) URL.revokeObjectURL(botAvatarPreview);
		pendingBotAvatar = null;
		botAvatarPreview = null;
	}

	function clearBotBanner() {
		if (botBannerPreview) URL.revokeObjectURL(botBannerPreview);
		pendingBotBanner = null;
		botBannerPreview = null;
	}

	function removeBotAvatar() {
		if (botAvatarPreview) URL.revokeObjectURL(botAvatarPreview);
		botAvatarPreview = null;
		pendingBotAvatar = "remove";
	}

	function removeBotBanner() {
		if (botBannerPreview) URL.revokeObjectURL(botBannerPreview);
		botBannerPreview = null;
		pendingBotBanner = "remove";
	}

	async function handleSaveBotProfile(app: Application) {
		if (!devSelectedTeam || !app.bot_user_id) return;
		savingBotProfile = true;
		try {
			const bu = app.bot_user_id ? botUsers[app.bot_user_id] : null;
			const uploading = pendingBotAvatar instanceof File || pendingBotBanner instanceof File;
			await updateBot(
				devSelectedTeam.id,
				app.id,
				{
					username: botEditUsername.trim() && botEditUsername !== bu?.username ? botEditUsername.trim() : undefined,
					alias: botEditAlias.trim() || (bu?.alias ? null : undefined),
					avatar: pendingBotAvatar instanceof File ? pendingBotAvatar : undefined,
					banner: pendingBotBanner instanceof File ? pendingBotBanner : undefined,
					remove_avatar: pendingBotAvatar === "remove",
					remove_banner: pendingBotBanner === "remove",
				},
				uploading ? { onUploadProgress: (sent, total) => (botUploadPercent = uploadPercent(sent, total)) } : undefined,
			);
			// Up and saved: what follows is the bot's profile read again.
			botUploadPercent = null;
			clearBotAvatar();
			clearBotBanner();
			pendingBotAvatar = null;
			pendingBotBanner = null;
			toast("Bot profile updated!", "success");
			// Refresh bot user data
			if (app.bot_user_id) {
				const fresh = await getBotUser(app.bot_user_id).catch(() => null);
				if (fresh) botUsers = { ...botUsers, [app.bot_user_id]: fresh };
			}
		} catch (e) {
			toast(getApiError(e, "Failed to update bot"), "error");
		} finally {
			savingBotProfile = false;
			botUploadPercent = null;
		}
	}

	async function loadDevTeams() {
		devLoading = true;
		try {
			devTeams = await listTeams();
		} catch (e) {
			toast(getApiError(e, "Failed to load teams"), "error");
		} finally {
			devLoading = false;
		}
	}

	async function selectTeam(team: Team) {
		devSelectedTeam = team;
		devAppsLoading = true;
		devBotToken = null;
		botUsers = {};
		try {
			[devApps, devMembers] = await Promise.all([listApplications(team.id), listTeamMembers(team.id)]);
			// Fetch bot user data for apps with bots
			const botApps = devApps.filter((a) => a.bot_user_id);
			const fetched = await Promise.all(botApps.map((a) => getBotUser(a.bot_user_id!).catch(() => null)));
			const map: Record<string, BotUser> = {};
			botApps.forEach((a, i) => {
				if (fetched[i]) map[a.bot_user_id!] = fetched[i]!;
			});
			botUsers = map;
		} catch (e) {
			toast(getApiError(e, "Failed to load team details"), "error");
		} finally {
			devAppsLoading = false;
		}
	}

	async function handleCreateTeam() {
		if (!devNewTeamName.trim()) return;
		devCreatingTeam = true;
		try {
			const team = await createTeam(devNewTeamName.trim());
			devTeams = [...devTeams, team];
			devNewTeamName = "";
			await selectTeam(team);
		} catch (e) {
			toast(getApiError(e, "Failed to create team"), "error");
		} finally {
			devCreatingTeam = false;
		}
	}

	async function handleDeleteTeam(team: Team) {
		await confirmAction(`Delete team "${team.name}"? All applications will be deleted.`, "Delete", async () => {
			await deleteTeam(team.id);
			devTeams = devTeams.filter((t) => t.id !== team.id);
			if (devSelectedTeam?.id === team.id) {
				devSelectedTeam = null;
				devApps = [];
				devMembers = [];
			}
		});
	}

	async function handleSaveTeamEdit() {
		if (!devEditingTeam || !devEditTeamName.trim()) return;
		try {
			const updated = await updateTeam(devEditingTeam.id, devEditTeamName.trim());
			devTeams = devTeams.map((t) => (t.id === updated.id ? updated : t));
			if (devSelectedTeam?.id === updated.id) devSelectedTeam = updated;
			devEditingTeam = null;
		} catch (e) {
			toast(getApiError(e, "Failed to update team"), "error");
		}
	}

	async function handleInviteMember() {
		if (!devSelectedTeam || !devInviteEmail.trim()) return;
		devInviting = true;
		try {
			await inviteToTeam(devSelectedTeam.id, devInviteEmail.trim());
			toast("Invite sent!", "success");
			devInviteEmail = "";
		} catch (e) {
			toast(getApiError(e, "Failed to invite"), "error");
		} finally {
			devInviting = false;
		}
	}

	async function handleRemoveMember(userId: string, memberName: string) {
		if (!devSelectedTeam) return;
		const teamId = devSelectedTeam.id;
		await confirmAction(`Remove "${memberName}" from team?`, "Remove", async () => {
			await removeTeamMember(teamId, userId);
			devMembers = devMembers.filter((m) => m.user_id !== userId);
		});
	}

	async function handleCreateApp() {
		if (!devSelectedTeam || !devNewAppName.trim()) return;
		devCreatingApp = true;
		try {
			const app = await createApplication(devSelectedTeam.id, devNewAppName.trim(), devNewAppDesc.trim() || undefined);
			devApps = [...devApps, app];
			devNewAppName = "";
			devNewAppDesc = "";
		} catch (e) {
			toast(getApiError(e, "Failed to create application"), "error");
		} finally {
			devCreatingApp = false;
		}
	}

	async function handleSaveAppEdit() {
		if (!devSelectedTeam || !devEditingApp || !devEditAppName.trim()) return;
		try {
			const updated = await updateApplication(devSelectedTeam.id, devEditingApp.id, {
				name: devEditAppName.trim(),
				description: devEditAppDesc.trim() || undefined,
			});
			devApps = devApps.map((a) => (a.id === updated.id ? updated : a));
			devEditingApp = null;
		} catch (e) {
			toast(getApiError(e, "Failed to update application"), "error");
		}
	}

	async function handleTogglePublic(app: Application) {
		if (!devSelectedTeam) return;
		try {
			const updated = await updateApplication(devSelectedTeam.id, app.id, { public: !app.public });
			devApps = devApps.map((a) => (a.id === updated.id ? updated : a));
		} catch (e) {
			toast(getApiError(e, "Failed to update visibility"), "error");
		}
	}

	async function handleDeleteApp(app: Application) {
		if (!devSelectedTeam) return;
		const teamId = devSelectedTeam.id;
		await confirmAction(`Delete application "${app.name}"?`, "Delete", async () => {
			await deleteApplication(teamId, app.id);
			devApps = devApps.filter((a) => a.id !== app.id);
		});
	}

	async function handleCreateBot(app: Application) {
		if (!devSelectedTeam) return;
		try {
			const res = await createBot(devSelectedTeam.id, app.id);
			devBotToken = res.token;
			devShowToken = true;
			devApps = devApps.map((a) => (a.id === app.id ? { ...a, bot_user_id: "created" } : a));
			toast("Bot created! Copy the token — it won't be shown again.", "success");
		} catch (e) {
			toast(getApiError(e, "Failed to create bot"), "error");
		}
	}

	async function handleResetBotToken(app: Application) {
		if (!devSelectedTeam) return;
		const teamId = devSelectedTeam.id;
		await confirmAction("Reset bot token? The old token will stop working immediately.", "Reset", async () => {
			const res = await resetBotToken(teamId, app.id);
			devBotToken = res.token;
			devShowToken = true;
			toast("Token reset! Copy the new token — it won't be shown again.", "success");
		});
	}

	async function handleDeleteBot(app: Application) {
		if (!devSelectedTeam) return;
		const teamId = devSelectedTeam.id;
		await confirmAction("Delete this bot? It will be removed from all spaces.", "Delete", async () => {
			await deleteBot(teamId, app.id);
			devApps = devApps.map((a) => (a.id === app.id ? { ...a, bot_user_id: null, bot_token_hash: null } : a));
			devBotToken = null;
		});
	}

	function copyToken() {
		if (devBotToken) {
			navigator.clipboard.writeText(devBotToken);
			toast("Token copied to clipboard", "success");
		}
	}

	function getBotInviteLink(botUserId: string): string {
		return `${DUVET_DOMAIN}/invite?bot=${botUserId}`;
	}

	function copyBotInviteLink(botUserId: string) {
		navigator.clipboard.writeText(getBotInviteLink(botUserId));
		toast("Link copied!", "success");
	}

	async function handleAcceptTeamInvite(inviteId: string) {
		try {
			await answerTeamInvite(inviteId, true);
			toast("Invite accepted!", "success");
			void loadDevTeams();
		} catch (e) {
			toast(getApiError(e, "Failed to accept invite"), "error");
		}
	}

	async function handleDeclineTeamInvite(inviteId: string) {
		try {
			await answerTeamInvite(inviteId, false);
			toast("Invite declined", "success");
		} catch (e) {
			toast(getApiError(e, "Failed to decline invite"), "error");
		}
	}

	$effect(() => {
		if (open && activeSection === "developer") {
			void loadDevTeams();
			devSelectedTeam = null;
			devApps = [];
			devMembers = [];
			devBotToken = null;
		}
	});

	const previewMember = $derived({
		id: $currentUser?.id ?? "",
		member_id: "",
		username: alias.trim() || username || $currentUser?.username || "",
		raw_username: username || $currentUser?.username || "",
		avatar_url:
			pendingAvatar === "remove"
				? null
				: (pendingAvatarPreview ?? ($currentUser ? getAvatarURL($currentUser.id, $currentUser.avatar) : null)),
		banner_url:
			pendingBanner === "remove"
				? null
				: (pendingBannerPreview ?? ($currentUser ? getAvatarURL($currentUser.id, $currentUser.banner) : null)),
		status: userStatusToString(chosenStatus($currentUser?.status)),
		// A phone, as for anyone, when the gateway says the user is connected only from the mobile app.
		mobile_only: $ownMobileOnly,
		badges: $currentUser?.badges ?? 0,
		is_bot: $currentUser?.is_bot ?? false,
		is_owner: false,
		roles: [] as import("$lib/types").Role[],
		bio: bio.trim(),
	});

	const hasChanges = $derived(
		$currentUser !== null &&
			(username !== ($currentUser.username ?? "") ||
				alias !== ($currentUser.alias ?? "") ||
				bio.trim() !== ($currentUser.custom ?? "") ||
				hasImageChanges),
	);

	async function handleSave() {
		if (!$currentUser || saving) return;
		if (bioTooLong) {
			saveError = `Your bio can be at most ${BIO_MAX_LENGTH} characters.`;
			return;
		}
		saving = true;
		saveError = null;
		saveSuccess = false;

		try {
			let updated: any;

			if (hasImageChanges) {
				const form = new FormData();
				form.append("username", username.trim() || $currentUser!.username);
				form.append("alias", alias.trim() || "");
				form.append("custom", bio.trim());

				if (pendingAvatar instanceof File) {
					form.append("avatar", pendingAvatar);
				} else if (pendingAvatar === "remove") {
					form.append("remove_avatar", "true");
				}

				if (pendingBanner instanceof File) {
					form.append("banner", pendingBanner);
				} else if (pendingBanner === "remove") {
					form.append("remove_banner", "true");
				}

				const uploading = pendingAvatar instanceof File || pendingBanner instanceof File;
				const res = await api.patch(
					"/api/users/@me",
					form,
					uploading
						? { onUploadProgress: (sent, total) => (profileUploadPercent = uploadPercent(sent, total)) }
						: undefined,
				);
				updated = res.data;
			} else {
				updated = await updateUser({
					username: username.trim() || $currentUser!.username,
					alias: alias.trim() || null,
					custom: bio.trim(),
				});
			}

			resetImageStages();
			const newBio: string = updated.custom ?? "";

			currentUser.update((u) =>
				u
					? {
							...u,
							username: updated.username,
							alias: updated.alias ?? null,
							avatar: updated.avatar ?? null,
							banner: updated.banner ?? null,
							custom: newBio,
						}
					: u,
			);

			const newName = updated.alias ?? updated.username;
			const newAvatar = getAvatarURL(updated.id, updated.avatar);
			const userId = $currentUser?.id;

			if (userId) {
				gatewaySpaces.update((spaces) =>
					spaces.map((s) => ({
						...s,
						users: s.users.map((u) =>
							u.id === userId
								? {
										...u,
										username: updated.username,
										alias: updated.alias ?? null,
										avatar: newAvatar,
										banner: updated.banner ?? null,
										custom: newBio,
									}
								: u,
						),
					})),
				);

				channelMessages.update((rooms) => {
					const result: typeof rooms = {};
					for (const [roomId, msgs] of Object.entries(rooms)) {
						result[roomId] = msgs.map((m) =>
							m.author_id === userId
								? {
										...m,
										author_name: newName,
										author_avatar_url: newAvatar,
									}
								: m,
						);
					}
					return result;
				});

				dmMessages.update((convs) => {
					const result: typeof convs = {};
					for (const [convId, msgs] of Object.entries(convs)) {
						result[convId] = msgs.map((m) => {
							if (m.author_id !== userId || !m.user) return m;
							return {
								...m,
								user: {
									...m.user,
									username: updated.username,
									alias: updated.alias ?? null,
									avatar: newAvatar,
									banner: updated.banner ?? null,
								},
							};
						});
					}
					return result;
				});

				conversations.update((list) =>
					list.map((c) => ({
						...c,
						members: c.members.map((m) =>
							m.user_id === userId
								? {
										...m,
										user: {
											...m.user,
											username: updated.username,
											alias: updated.alias ?? null,
											avatar: newAvatar,
											banner: updated.banner ?? null,
											custom: newBio,
										},
									}
								: m,
						),
					})),
				);
			}

			saveSuccess = true;
			setTimeout(() => (saveSuccess = false), 2000);
		} catch (err) {
			saveError = getApiError(err, "Failed to save changes");
		} finally {
			saving = false;
			profileUploadPercent = null;
		}
	}

	function handleReset() {
		if (!$currentUser) return;
		username = $currentUser.username ?? "";
		alias = $currentUser.alias ?? "";
		bio = $currentUser.custom ?? "";
		resetImageStages();
		saveError = null;
	}

	// The shell's layout, saved on this device: the spaces column's mode and where the open chats are listed.
	const themeChoices = [
		{ value: "system", label: "System" },
		{ value: "light", label: "Light" },
		{ value: "dark", label: "Dark" },
	] as const;
	const spacesColumnChoices = [
		{ value: "fixed", label: "Fixed" },
		{ value: "auto-hide", label: "Auto-hide" },
	] as const;
	const openChatsChoices = [
		{ value: "tabs", label: "Tabs on top" },
		{ value: "vertical", label: "Vertical list" },
	] as const;
	const membersColumnChoices = [
		{ value: "auto", label: "Auto" },
		{ value: "shown", label: "Shown" },
		{ value: "hidden", label: "Hidden" },
	] as const;
	const keyboardChoices = [
		{ value: "off", label: "Off" },
		{ value: "on", label: "On" },
	] as const;

	// A radio group moves its choice with the arrow keys, as native radios do.
	function radioKeydown(e: KeyboardEvent, values: readonly string[], current: string, set: (v: string) => void) {
		const step =
			e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
		if (!step) return;
		e.preventDefault();
		const next = values[(values.indexOf(current) + step + values.length) % values.length]!;
		set(next);
		const group = (e.currentTarget as HTMLElement).closest('[role="radiogroup"]');
		group?.querySelector<HTMLElement>(`[data-value="${next}"]`)?.focus();
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-500 bg-black/70 backdrop-blur-sm" />
		<Dialog.Content class="fixed inset-0 z-501 flex items-center justify-center p-4 sm:p-8">
			<div
				class="rounded-card border-duvet-line bg-duvet-bg text-duvet-ink shadow-duvet-float flex h-full max-h-[920px] w-full max-w-[1180px] overflow-hidden border"
			>
				<!-- Left sidebar -->
				<aside class="bg-duvet-sunk flex w-64 shrink-0 flex-col py-6">
					<p class="text-duvet-ink2 mb-2 px-6 text-[13px] font-bold">Settings</p>
					<nav class="flex flex-col gap-0.5 px-3">
						{#each settingsSections as section (section.id)}
							{#if section.id === "developer"}
								<div class="border-duvet-line mx-3 my-2 border-t"></div>
							{/if}
							<button
								class="rounded-row flex h-9 items-center gap-2.5 px-3 text-left text-sm font-semibold transition-colors motion-reduce:transition-none {activeSection ===
								section.id
									? 'bg-duvet-card text-duvet-ink shadow-duvet-raised'
									: 'text-duvet-ink2 hover:bg-duvet-card/60 hover:text-duvet-ink'}"
								aria-current={activeSection === section.id ? "page" : undefined}
								onclick={() => (activeSection = section.id)}
							>
								<section.icon class="size-4 shrink-0" />
								{section.label}
								{#if section.id === "developer" && $pendingTeamInvites.length > 0}
									<span
										class="bg-duvet-accent text-duvet-on-accent ml-auto flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[11px] font-bold"
										>{$pendingTeamInvites.length}</span
									>
								{/if}
							</button>
						{/each}
					</nav>
					<div class="mt-auto px-3 pb-2">
						<button
							class="rounded-row text-duvet-danger hover:bg-duvet-danger/10 flex h-9 w-full items-center gap-2.5 px-3 text-left text-sm font-semibold transition-colors motion-reduce:transition-none"
							onclick={logout}
						>
							<LogOutIcon class="size-4 shrink-0" />
							Log Out
						</button>
					</div>
				</aside>

				<!-- Main content -->
				<div class="flex min-w-0 flex-1 flex-col">
					<!-- Header -->
					<div class="border-duvet-line flex h-16 shrink-0 items-center justify-between border-b px-8">
						<h2 class="text-lg font-bold">
							{#if activeSection === "account"}My Account{:else if activeSection === "security"}Security{:else if activeSection === "audio"}Audio{:else if activeSection === "appearance"}Appearance{:else if activeSection === "activity"}Activity
								Privacy{:else if activeSection === "attachments"}Attachments{:else if activeSection === "buckets"}S3
								Buckets{:else if activeSection === "developer"}Developer{/if}
						</h2>
						<Dialog.Close
							class="text-duvet-ink2 hover:bg-duvet-card hover:text-duvet-ink flex size-9 items-center justify-center rounded-xl transition-colors motion-reduce:transition-none"
						>
							<XIcon class="size-4" />
						</Dialog.Close>
					</div>

					<!-- Scrollable content, at a width that reads well however wide the window is -->
					<div class="flex-1 overflow-y-auto">
						<div class="mx-auto w-full max-w-4xl space-y-6 px-8 py-8">
							{#if activeSection === "account"}
								<!-- Profile preview card -->
								<MemberProfileCard
									member={previewMember}
									onAvatarClick={() => (showAvatarCrop = true)}
									onAvatarRemove={() => handleRemoveImageStage("avatar")}
									onBannerClick={() => (showBannerCrop = true)}
									onBannerRemove={() => handleRemoveImageStage("banner")}
								/>

								<!-- Form fields -->
								<div class="space-y-5">
									<!-- Display name -->
									<div>
										<label for="alias" class="text-duvet-ink2 mb-1.5 block text-[13px] font-bold"> Display Name </label>
										<input
											id="alias"
											type="text"
											bind:value={alias}
											maxlength={32}
											placeholder={$currentUser?.username ?? ""}
											class="focus-override bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent h-10 w-full rounded-xl px-3 text-sm transition-colors focus-visible:outline-2"
										/>
										<p class="text-duvet-ink2 mt-1 text-xs">
											This is how others see you. Leave empty to use your username.
										</p>
									</div>

									<!-- Bio -->
									<div>
										<label for="bio" class="text-duvet-ink2 mb-1.5 block text-[13px] font-bold"> About Me </label>
										<textarea
											id="bio"
											bind:value={bio}
											rows="3"
											placeholder="A few words about you"
											aria-invalid={bioTooLong}
											class="focus-override bg-duvet-sunk shadow-duvet-press text-duvet-ink placeholder:text-duvet-ink2 w-full resize-none rounded-xl px-3 py-2 text-sm focus-visible:outline-2 {bioTooLong
												? 'outline-duvet-danger outline-2'
												: 'focus-visible:outline-duvet-accent'}"
										></textarea>
										<p class="text-duvet-ink2 mt-1 flex justify-between gap-2 text-xs">
											<span>Shown on your profile. Leave empty for none.</span>
											<span class={bioTooLong ? "text-duvet-danger" : ""}>{bioLength}/{BIO_MAX_LENGTH}</span>
										</p>
									</div>

									<!-- Username -->
									<div>
										<label for="username" class="text-duvet-ink2 mb-1.5 block text-[13px] font-bold"> Username </label>
										<input
											id="username"
											type="text"
											bind:value={username}
											maxlength={32}
											placeholder="username"
											class="focus-override bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent h-10 w-full rounded-xl px-3 text-sm transition-colors focus-visible:outline-2"
										/>
									</div>
								</div>
							{:else if activeSection === "security"}
								<!-- Email verification -->
								{#if $currentUser && !$currentUser.email_verified}
									<div
										class="border-duvet-warn/30 bg-duvet-warn/10 flex items-center gap-3 rounded-lg border px-4 py-3"
									>
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
											class="text-duvet-warn shrink-0"
										>
											<rect width="20" height="16" x="2" y="4" rx="2" />
											<path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
										</svg>
										<div class="min-w-0 flex-1">
											<p class="text-duvet-warn text-sm font-medium">Email not verified</p>
											<p class="text-duvet-warn/60 text-xs">Verify your email to secure your account.</p>
										</div>
										<button
											onclick={handleSendVerification}
											disabled={sendingVerification}
											class="bg-duvet-warn/20 text-duvet-warn hover:bg-duvet-warn/30 shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
										>
											{sendingVerification ? "Sending..." : "Send verification"}
										</button>
									</div>
								{:else if $currentUser?.email_verified}
									<div
										class="border-duvet-alive/50 bg-duvet-alive/10 flex items-center gap-3 rounded-lg border px-4 py-3"
									>
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
											class="text-duvet-alive shrink-0"
										>
											<rect width="20" height="16" x="2" y="4" rx="2" />
											<path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
										</svg>
										<p class="text-duvet-alive text-sm font-medium">Email verified</p>
									</div>
								{/if}

								<!-- Password -->
								<div class="rounded-card border-duvet-line bg-duvet-card/40 border px-4 py-4">
									<div class="flex items-center justify-between">
										<div>
											<p class="text-duvet-ink2 text-[13px] font-bold">Password</p>
											<p class="text-duvet-ink2 mt-1 text-xs">
												Send a reset link to your email to change your password.
											</p>
										</div>
										<button
											onclick={handleSendResetPassword}
											disabled={sendingReset}
											class="rounded-row bg-duvet-ink/10 text-duvet-ink hover:bg-duvet-ink/15 shrink-0 px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
										>
											{sendingReset ? "Sending..." : "Reset password"}
										</button>
									</div>
								</div>

								<!-- Change email -->
								<div class="rounded-card border-duvet-line bg-duvet-card/40 border px-4 py-4">
									<p class="text-duvet-ink2 text-[13px] font-bold">Email</p>
									<p class="text-duvet-ink2 mt-1 text-xs">
										Current: <span class="text-duvet-ink">{"—"}</span>
									</p>
									<div class="mt-3 flex items-center gap-2">
										<input
											type="email"
											bind:value={newEmail}
											placeholder="New email address"
											class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent h-9 flex-1 rounded-xl px-3 text-sm focus-visible:outline-2"
										/>
										<button
											onclick={handleSendChangeEmail}
											disabled={sendingEmailChange || !newEmail.trim()}
											class="rounded-row bg-duvet-ink/10 text-duvet-ink hover:bg-duvet-ink/15 shrink-0 px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
										>
											{sendingEmailChange ? "Sending..." : "Send verification"}
										</button>
									</div>
									<p class="text-duvet-ink2/60 mt-2 text-xs">A verification link will be sent to the new address.</p>
								</div>
							{:else if activeSection === "audio"}
								{@const sliders: { key: SoundEvent | "master"; label: string }[] = [
								{ key: "master", label: "Master Volume" },
								{ key: "notification", label: "Notifications" },
								{ key: "join_vc", label: "Join Voice" },
								{ key: "leave_vc", label: "Leave Voice" },
								{ key: "voice_calling", label: "Incoming Call" },
								{ key: "screen_sharing_on", label: "Screen Share On" },
								{ key: "screen_sharing_off", label: "Screen Share Off" },
							]}
								<div class="space-y-4">
									{#each sliders as { key, label } (key)}
										{@const value = key === "master" ? audioStore.settings.master : audioStore.settings[key]}
										<div class="rounded-card border-duvet-line bg-duvet-card/40 border px-4 py-3">
											<div class="mb-2 flex items-center justify-between">
												<span class="text-duvet-ink text-sm font-medium">{label}</span>
												<span class="text-duvet-ink2 text-xs tabular-nums">{value}%</span>
											</div>
											<div class="flex items-center gap-3">
												<input
													type="range"
													min="0"
													max="200"
													step="1"
													{value}
													oninput={(e) => {
														const v = parseInt((e.target as HTMLInputElement).value);
														if (key === "master") {
															audioStore.setMaster(v);
														} else {
															audioStore.set(key, v);
														}
													}}
													class="bg-duvet-ink/10 accent-duvet-accent [&::-webkit-slider-thumb]:bg-duvet-accent h-1.5 w-full cursor-pointer appearance-none rounded-full [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full"
												/>
												{#if key !== "master"}
													<button
														class="hover:bg-duvet-ink/10 shrink-0 rounded p-1 transition-colors {previewingSound === key
															? 'text-duvet-ink2'
															: 'text-duvet-ink2 hover:text-duvet-ink'}"
														title={previewingSound === key ? "Stop" : "Preview"}
														onclick={() => togglePreview(key)}
													>
														{#if previewingSound === key}
															<StopIcon class="size-3.5" />
														{:else}
															<VolumeIcon class="size-3.5" />
														{/if}
													</button>
												{/if}
											</div>
										</div>
									{/each}
								</div>
							{:else if activeSection === "appearance"}
								{#snippet segmented(
									label: string,
									description: string,
									choices: readonly { value: string; label: string }[],
									current: string,
									set: (v: string) => void,
								)}
									<div class="flex items-center justify-between gap-4">
										<div>
											<p class="text-duvet-ink text-sm font-semibold">{label}</p>
											<p class="text-duvet-ink2 mt-1 text-xs">{description}</p>
										</div>
										<div
											role="radiogroup"
											aria-label={label}
											class="rounded-row bg-duvet-sunk shadow-duvet-press flex shrink-0 gap-1 p-1"
										>
											{#each choices as choice (choice.value)}
												<button
													type="button"
													role="radio"
													aria-checked={current === choice.value}
													tabindex={current === choice.value ? 0 : -1}
													data-value={choice.value}
													class="focus-visible:outline-duvet-accent rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 {current ===
													choice.value
														? 'bg-duvet-chosen text-duvet-chosen-ink shadow-duvet-raised'
														: 'text-duvet-ink2 hover:text-duvet-ink'}"
													onclick={() => set(choice.value)}
													onkeydown={(e) =>
														radioKeydown(
															e,
															choices.map((c) => c.value),
															current,
															set,
														)}
												>
													{choice.label}
												</button>
											{/each}
										</div>
									</div>
								{/snippet}

								<!-- Layout -->
								<div class="rounded-card border-duvet-line bg-duvet-card/40 mb-6 space-y-4 border px-4 py-4">
									{@render segmented(
										"Theme",
										"System follows your computer's light or dark appearance. Saved on this device.",
										themeChoices,
										theme.pref,
										(v) => setThemePref(parseThemePref(v)),
									)}
									{@render segmented(
										"Spaces column",
										"Auto-hide folds it to an edge that opens over the chat when you point at it.",
										spacesColumnChoices,
										layoutPrefs.spacesColumn,
										(v) => (layoutPrefs.spacesColumn = v === "auto-hide" ? "auto-hide" : "fixed"),
									)}
									{@render segmented(
										"Open chats",
										"A vertical list puts them at the top of the spaces column instead of tabs over each chat.",
										openChatsChoices,
										layoutPrefs.openChats,
										(v) => (layoutPrefs.openChats = v === "vertical" ? "vertical" : "tabs"),
									)}
									{@render segmented(
										"Members column",
										`Auto opens it in rooms with more than ${BUSY_ROOM_ONLINE} people online. The faces in the bar list the members either way.`,
										membersColumnChoices,
										layoutPrefs.membersColumn,
										(v) => (layoutPrefs.membersColumn = v === "shown" || v === "hidden" ? v : "auto"),
									)}
									{@render segmented(
										"Keyboard navigation",
										"Esc in the message box moves to the messages: j and k go through them, r replies, e edits, f shows jump marks. Press ? for all of them.",
										keyboardChoices,
										layoutPrefs.keyboardNavigation ? "on" : "off",
										(v) => (layoutPrefs.keyboardNavigation = v === "on"),
									)}
								</div>

								<p class="text-duvet-ink2 mb-4 text-xs">
									Customize how code blocks look in messages. Paste a URL to a VS Code theme JSON file.
								</p>

								<div class="space-y-3">
									<div>
										<label for="code-theme-url" class="text-duvet-ink2 mb-1 block text-xs font-medium"
											>Code Theme URL</label
										>
										<input
											id="code-theme-url"
											type="text"
											bind:value={codeThemeUrl}
											placeholder="https://raw.githubusercontent.com/.../theme.json"
											class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent w-full rounded-xl px-3 py-2 text-sm focus-visible:outline-2"
											onkeydown={(e) => e.key === "Enter" && handleSaveTheme()}
										/>
									</div>
									<div class="flex items-center gap-2">
										<button
											class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised rounded-xl px-4 py-2 text-sm font-bold transition-colors hover:brightness-110 disabled:opacity-50"
											onclick={handleSaveTheme}
											disabled={savingTheme}
										>
											{savingTheme ? "Loading..." : "Apply"}
										</button>
										{#if codeThemeUrl}
											<button
												class="text-duvet-ink2 hover:bg-duvet-card hover:text-duvet-ink rounded-md px-4 py-2 text-sm font-medium transition-colors"
												onclick={() => {
													codeThemeUrl = "";
													handleSaveTheme();
												}}
											>
												Reset to default
											</button>
										{/if}
									</div>
								</div>

								<!-- Preview -->
								<div class="mt-6">
									<p class="text-duvet-ink2 mb-2 text-xs font-medium">Preview</p>
									{#key themeVersion}
										<p class="msg-content text-duvet-ink text-sm">
											{@html renderMarkdown(
												'```go\npackage main\n\nimport "fmt"\n\nfunc main() {\n\tnames := []string{"Alice", "Bob"}\n\tfor _, name := range names {\n\t\tfmt.Printf("Hello, %s!\\n", name)\n\t}\n}\n```',
											)}
										</p>
									{/key}
								</div>

								<!-- Faces in voice -->
								<div class="rounded-card border-duvet-line bg-duvet-card/40 border px-4 py-4">
									<div class="flex items-center justify-between gap-4">
										<div>
											<p class="text-duvet-ink2 text-[13px] font-bold">Faces in voice</p>
											<p class="text-duvet-ink2 mt-1 text-xs">
												Voice room tiles show everyone's animated face instead of their avatar. Saved on this device.
											</p>
										</div>
										<button
											type="button"
											role="switch"
											aria-checked={$voiceFaces}
											aria-label="Faces in voice"
											onclick={() => voiceFaces.update((v) => !v)}
											class="relative h-5 w-9 shrink-0 rounded-full transition-colors {$voiceFaces
												? 'bg-duvet-accent'
												: 'bg-duvet-ink/15'}"
										>
											<span
												class="bg-fixed-white shadow-duvet-raised absolute top-0.5 left-0.5 size-4 rounded-full transition-transform {$voiceFaces
													? 'translate-x-4'
													: ''}"
											></span>
										</button>
									</div>
								</div>
							{:else if activeSection === "activity"}
								<div class="rounded-card border-duvet-line bg-duvet-card/40 border px-4 py-4">
									<div class="flex items-center justify-between gap-4">
										<div>
											<p class="text-duvet-ink2 text-[13px] font-bold">Share what I listen to on Spotify</p>
											<p class="text-duvet-ink2 mt-1 text-xs">
												While Spotify plays on this computer, the people in your spaces see the song, its artist and how
												far along it is. Saved on this device.
											</p>
										</div>
										<button
											type="button"
											role="switch"
											aria-checked={$shareSpotify}
											aria-label="Share what I listen to on Spotify"
											onclick={() => shareSpotify.update((v) => !v)}
											class="relative h-5 w-9 shrink-0 rounded-full transition-colors {$shareSpotify
												? 'bg-duvet-accent'
												: 'bg-duvet-ink/15'}"
										>
											<span
												class="bg-fixed-white shadow-duvet-raised absolute top-0.5 left-0.5 size-4 rounded-full transition-transform {$shareSpotify
													? 'translate-x-4'
													: ''}"
											></span>
										</button>
									</div>
								</div>
							{:else if activeSection === "attachments"}
								{#if myTransfer}
									<StorageTransferCard
										transfer={myTransfer}
										source={storageLabel(myTransfer.source_bucket_id)}
										target={storageLabel(myTransfer.target_bucket_id)}
									/>
								{/if}
								<!-- Active custom bucket banner -->
								{#if hasActiveBucket}
									{@const activeBucket = buckets.find((b) => b.is_active)}
									<div
										class="border-duvet-alive/50 bg-duvet-alive/10 flex items-center gap-3 rounded-lg border px-4 py-3"
									>
										<DatabaseIcon class="text-duvet-alive size-5 shrink-0" />
										<div class="min-w-0 flex-1">
											<p class="text-duvet-alive text-sm font-medium">Using your own storage</p>
											<p class="text-duvet-alive/60 truncate text-xs">
												{activeBucket?.name} · {activeBucket?.bucket_name}
											</p>
										</div>
										<span
											class="text-xxs bg-duvet-alive/20 text-duvet-alive shrink-0 rounded px-1.5 py-0.5 font-semibold"
											>NO QUOTA</span
										>
									</div>
								{/if}
								<!-- Default storage quota (always shown) -->
								{#if storageStatus}
									<div class="rounded-card border-duvet-line bg-duvet-card/40 space-y-3 border px-4 py-4">
										<div class="flex items-center justify-between">
											<p class="text-duvet-ink text-sm font-semibold">Default Storage</p>
											<p class="text-duvet-ink2 text-xs">
												{formatFileSize(storageStatus.used_bytes)} / {formatFileSize(storageStatus.max_bytes)}
											</p>
										</div>
										<!-- Progress bar -->
										<div class="bg-duvet-ink/10 h-2 w-full overflow-hidden rounded-full">
											<div
												class="h-full rounded-full transition-all duration-300 {storageStatus.percentage_used > 90
													? 'bg-duvet-danger'
													: storageStatus.percentage_used > 70
														? 'bg-duvet-warn'
														: 'bg-duvet-ink2'}"
												style="width: {Math.min(storageStatus.percentage_used, 100)}%"
											></div>
										</div>
										<div class="text-duvet-ink2 flex gap-4 text-xs">
											<span>{storageStatus.percentage_used}% used</span>
											<span>Upload limit: {formatFileSize(storageStatus.upload_limit_bytes)} per file</span>
										</div>
									</div>
								{/if}

								<!-- Summary bar -->
								<div
									class="rounded-card border-duvet-line bg-duvet-card/40 flex items-center justify-between gap-3 border px-4 py-3"
								>
									<div class="text-duvet-ink text-sm">
										{#if listedHere}
											<span class="text-duvet-ink font-semibold">{attachments.length}</span>
											file{attachments.length !== 1 ? "s" : ""}
											{#if attachmentsLocation !== "all"}
												<span class="text-duvet-ink2/60 mx-1">·</span>
												{formatFileSize(locationBytes)}
											{/if}
										{/if}
									</div>
									<div class="flex items-center gap-2">
										{#if buckets.length > 0 || attachmentsLocation !== "all"}
											<label class="text-duvet-ink2 flex items-center gap-2 text-xs">
												Location
												<select
													value={attachmentsLocation}
													onchange={(e) => setAttachmentsLocation(e.currentTarget.value)}
													class="text-duvet-ink bg-duvet-sunk shadow-duvet-press focus-visible:outline-duvet-accent max-w-40 rounded-xl px-2 py-1 text-xs focus-visible:outline-2"
												>
													<option value="all">All</option>
													<option value={DEFAULT_STORAGE}>Default storage</option>
													{#each buckets as b (b.id)}
														<option value={b.id}>{b.name}</option>
													{/each}
												</select>
											</label>
										{/if}
										{#if attachments.length > 0 && attachmentsLocation === "all"}
											<button
												onclick={handleDeleteAll}
												class="bg-duvet-danger/20 text-duvet-danger hover:bg-duvet-danger/30 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors"
											>
												<TrashIcon class="size-3.5" />
												Delete All
											</button>
										{/if}
									</div>
								</div>

								{#if attachmentsError}
									<p class="bg-duvet-danger/10 text-duvet-danger rounded-md px-3 py-2 text-sm">
										{attachmentsError}
									</p>
								{/if}

								{#if attachmentsLoading}
									<div class="space-y-2">
										{#each Array(5) as _}
											<div class="bg-duvet-card/40 h-14 animate-pulse rounded-lg"></div>
										{/each}
									</div>
								{:else if !listedHere}
									<!-- The location's files didn't load (the error above says why): the list is another's. -->
								{:else if attachments.length === 0}
									<div class="text-duvet-ink2 flex flex-col items-center justify-center py-16">
										<PaperclipIcon class="mb-3 size-10" />
										<p class="text-sm">{attachmentsLocation === "all" ? "No attachments yet" : "No files here"}</p>
									</div>
								{:else}
									<div class="space-y-1">
										{#if picking}
											<FilePickerBar {picker} />
										{/if}
										{#each picker.shown as att (att.id)}
											{@const isImage = att.content_type.startsWith("image/")}
											{@const isAudio = att.content_type.startsWith("audio/")}
											<div
												class="group border-duvet-line bg-duvet-card/30 hover:bg-duvet-card/50 rounded-lg border transition-colors"
											>
												<div class="flex items-center gap-3 px-3 py-2.5">
													{#if picking}
														<input
															type="checkbox"
															checked={picker.picked.has(att.id)}
															onchange={() => picker.toggle(att.id)}
															aria-label="Select {att.filename}"
															class="border-duvet-line bg-duvet-card accent-duvet-accent size-4 shrink-0 rounded"
														/>
													{/if}
													<!-- Thumbnail -->
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
													<!-- Info -->
													<div class="min-w-0 flex-1">
														<p class="text-duvet-ink truncate text-sm">
															{att.filename}
														</p>
														<p class="text-duvet-ink2 text-xs">
															{formatFileSize(att.size_bytes)}
															<span class="text-duvet-ink2/60 mx-1">·</span>
															{new Date(att.created_at).toLocaleDateString()}
														</p>
													</div>
													<!-- Download -->
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
													<!-- Delete -->
													<button
														onclick={() => handleDeleteAttachment(att.id)}
														class="text-duvet-ink2 hover:bg-duvet-danger/20 hover:text-duvet-danger flex h-8 w-8 shrink-0 items-center justify-center rounded-md opacity-0 transition-all group-hover:opacity-100"
														title="Delete attachment"
													>
														<TrashIcon class="size-4" />
													</button>
												</div>
												{#if isAudio}
													<div class="px-3 pb-2.5">
														<VoiceNotePlayer
															src="{attachmentHost}{att.url ?? `/attachments/${att.id}`}"
															attachmentId={att.id}
															compact
														/>
													</div>
												{/if}
											</div>
										{/each}
									</div>
								{/if}
							{:else if activeSection === "buckets"}
								{#if myTransfer}
									<StorageTransferCard
										transfer={myTransfer}
										source={storageLabel(myTransfer.source_bucket_id)}
										target={storageLabel(myTransfer.target_bucket_id)}
									/>
								{/if}
								<p class="text-duvet-ink2 mb-4 text-xs">
									Connect your own S3/R2 buckets for unlimited storage. When a bucket is active, uploads go to your
									bucket instead of the default and quota limits don't apply.
								</p>

								{#if !bucketsLoading}
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
													The bucket owner can <strong>read, modify, or delete</strong> all your uploaded files at any time.
												</li>
												<li>
													They can <strong>revoke access</strong> without warning, causing your attachments to stop loading.
												</li>
												<li>
													Your files may be <strong>logged, monitored, or shared</strong> by the bucket owner.
												</li>
											</ul>
										</div>
									</div>
								{/if}

								{#if bucketsError}
									<p class="bg-duvet-danger/10 text-duvet-danger mb-4 rounded-md px-3 py-2 text-sm">
										{bucketsError}
									</p>
								{/if}

								<!-- Create / Edit form -->
								{#if showBucketForm}
									<div class="rounded-card border-duvet-line bg-duvet-card/40 mb-4 space-y-3 border p-4">
										<h3 class="text-duvet-ink text-sm font-semibold">
											{editingBucket ? "Edit Bucket" : "New Bucket"}
										</h3>
										<div class="grid grid-cols-2 gap-3">
											<div>
												<label for="bucket-name" class="text-duvet-ink2 mb-1 block text-[13px] font-bold">Name</label>
												<input
													id="bucket-name"
													type="text"
													bind:value={bName}
													placeholder="My R2"
													class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent h-9 w-full rounded-xl px-3 text-sm focus-visible:outline-2"
												/>
											</div>
											<div>
												<label for="bucket-region" class="text-duvet-ink2 mb-1 block text-[13px] font-bold"
													>Region</label
												>
												<input
													id="bucket-region"
													type="text"
													bind:value={bRegion}
													placeholder="auto"
													class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent h-9 w-full rounded-xl px-3 text-sm focus-visible:outline-2"
												/>
											</div>
										</div>
										<div>
											<label for="bucket-endpoint" class="text-duvet-ink2 mb-1 block text-[13px] font-bold"
												>Endpoint</label
											>
											<input
												id="bucket-endpoint"
												type="text"
												bind:value={bEndpoint}
												placeholder="https://account-id.r2.cloudflarestorage.com"
												class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent h-9 w-full rounded-xl px-3 text-sm focus-visible:outline-2"
											/>
										</div>
										<div>
											<label for="bucket-bucket-name" class="text-duvet-ink2 mb-1 block text-[13px] font-bold"
												>Bucket Name</label
											>
											<input
												id="bucket-bucket-name"
												type="text"
												bind:value={bBucketName}
												placeholder="my-bucket"
												class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent h-9 w-full rounded-xl px-3 text-sm focus-visible:outline-2"
											/>
										</div>
										<div class="grid grid-cols-2 gap-3">
											<div>
												<label for="bucket-access-key" class="text-duvet-ink2 mb-1 block text-[13px] font-bold"
													>Access Key ID</label
												>
												<input
													id="bucket-access-key"
													type="text"
													bind:value={bAccessKey}
													placeholder="access key"
													class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent h-9 w-full rounded-xl px-3 text-sm focus-visible:outline-2"
												/>
											</div>
											<div>
												<label for="bucket-secret-key" class="text-duvet-ink2 mb-1 block text-[13px] font-bold"
													>Secret Access Key</label
												>
												<input
													id="bucket-secret-key"
													type="password"
													bind:value={bSecretKey}
													placeholder={editingBucket ? "leave empty to keep current" : "secret key"}
													class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent h-9 w-full rounded-xl px-3 text-sm focus-visible:outline-2"
												/>
											</div>
										</div>
										<label class="flex cursor-pointer items-center gap-2">
											<input
												type="checkbox"
												bind:checked={bUsePathStyle}
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
												<label for="b-max-bytes" class="text-duvet-ink2 mb-1 block text-[13px] font-bold"
													>Total Limit (MB)</label
												>
												<input
													id="b-max-bytes"
													type="number"
													min="0"
													step="1"
													bind:value={bMaxBytesMB}
													placeholder="No limit"
													class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent h-9 w-full rounded-xl px-3 text-sm focus-visible:outline-2"
												/>
											</div>
											<div>
												<label for="b-upload-limit" class="text-duvet-ink2 mb-1 block text-[13px] font-bold"
													>Per-file Limit (MB)</label
												>
												<input
													id="b-upload-limit"
													type="number"
													min="0"
													step="1"
													bind:value={bUploadLimitMB}
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
												onclick={resetBucketForm}>Cancel</button
											>
											<button
												class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised rounded-xl px-4 py-1.5 text-sm font-bold transition-colors hover:brightness-110 disabled:opacity-50"
												disabled={bucketSaving}
												onclick={handleSaveBucket}
											>
												{bucketSaving ? "Saving..." : editingBucket ? "Update" : "Create"}
											</button>
										</div>
									</div>
								{:else}
									<button
										class="bg-duvet-ink/5 text-duvet-ink hover:bg-duvet-ink/6 mb-4 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors"
										onclick={() => {
											resetBucketForm();
											showBucketForm = true;
										}}
									>
										<PlusIcon class="size-4" /> Add Bucket
									</button>
								{/if}

								<!-- Bucket list -->
								{#if bucketsLoading}
									<div class="space-y-2">
										{#each Array(3) as _}
											<div class="bg-duvet-card/40 h-16 animate-pulse rounded-lg"></div>
										{/each}
									</div>
								{:else if buckets.length === 0}
									<div class="text-duvet-ink2 flex flex-col items-center justify-center py-12">
										<DatabaseIcon class="mb-3 size-10" />
										<p class="text-sm">No buckets configured</p>
									</div>
								{:else}
									<div class="space-y-2">
										{#each buckets as bucket (bucket.id)}
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
														onclick={() => handleToggleActive(bucket)}
														disabled={togglingBucketId === bucket.id}
													>
														{#if togglingBucketId === bucket.id}
															<div
																class="border-duvet-ink2/40 size-4 animate-spin rounded-full border-2 border-t-transparent"
															></div>
														{:else if bucket.is_active}
															<XIcon class="size-4" />
														{:else}
															<CheckIcon class="size-4" />
														{/if}
													</button>
													<button
														class="text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink flex h-8 w-8 items-center justify-center rounded-md transition-all disabled:opacity-50"
														title={myTransfer ? "Wait for the transfer under way to end" : "Move files…"}
														onclick={() => openMoveBucket(bucket)}
														disabled={movingBucketId === bucket.id || myTransfer !== null}
													>
														{#if movingBucketId === bucket.id}
															<div
																class="border-duvet-ink2/40 size-4 animate-spin rounded-full border-2 border-t-transparent"
															></div>
														{:else}
															<MoveIcon class="size-4" />
														{/if}
													</button>
													<button
														class="text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink flex h-8 w-8 items-center justify-center rounded-md transition-all"
														title="Edit"
														onclick={() => startEditBucket(bucket)}
													>
														<PencilIcon class="size-4" />
													</button>
													<button
														class="text-duvet-ink2 hover:bg-duvet-danger/20 hover:text-duvet-danger flex h-8 w-8 items-center justify-center rounded-md transition-all"
														title="Delete"
														onclick={() => handleDeleteBucket(bucket.id)}
													>
														<TrashIcon class="size-4" />
													</button>
												</div>
											</div>
										{/each}
									</div>
								{/if}
							{:else if activeSection === "developer"}
								{#if $pendingTeamInvites.length > 0}
									<div class="mb-6">
										<h4 class="text-duvet-ink2 mb-2 text-[13px] font-bold">Pending Team Invites</h4>
										<div class="space-y-2">
											{#each $pendingTeamInvites as invite (invite.id)}
												<div
													class="border-duvet-line bg-duvet-bg/30 flex items-center justify-between rounded-md border px-4 py-3"
												>
													<div>
														<p class="text-duvet-ink text-sm font-medium">{invite.team_name}</p>
														<p class="text-xxs text-duvet-ink2">Invited by {invite.invited_by_username}</p>
													</div>
													<div class="flex items-center gap-2">
														<button
															class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised rounded-xl px-3 py-1.5 text-xs font-bold transition-colors hover:brightness-110"
															onclick={() => handleAcceptTeamInvite(invite.id)}
														>
															Accept
														</button>
														<button
															class="text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
															onclick={() => handleDeclineTeamInvite(invite.id)}
														>
															Decline
														</button>
													</div>
												</div>
											{/each}
										</div>
									</div>
								{/if}

								{#if !devSelectedTeam}
									<p class="text-duvet-ink2 mb-4 text-xs">
										Create a team to manage applications and bots. Team members can collaborate on your apps.
									</p>

									<div class="mb-4 flex gap-2">
										<input
											type="text"
											bind:value={devNewTeamName}
											placeholder="Team name"
											class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent flex-1 rounded-xl px-3 py-2 text-sm focus-visible:outline-2"
											onkeydown={(e) => e.key === "Enter" && handleCreateTeam()}
										/>
										<button
											class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition-colors hover:brightness-110 disabled:opacity-50"
											onclick={handleCreateTeam}
											disabled={devCreatingTeam || !devNewTeamName.trim()}
										>
											<PlusIcon class="size-4" />
											Create
										</button>
									</div>

									{#if devLoading}
										<p class="text-duvet-ink2 text-sm">Loading...</p>
									{:else if devTeams.length === 0}
										<p class="text-duvet-ink2 text-sm">No teams yet. Create one to get started.</p>
									{:else}
										<div class="space-y-2">
											{#each devTeams as team (team.id)}
												<button
													class="group border-duvet-line bg-duvet-card/50 hover:border-duvet-line hover:bg-duvet-card flex w-full items-center justify-between rounded-md border px-4 py-3 text-left transition-colors"
													onclick={() => selectTeam(team)}
												>
													<div>
														<p class="text-duvet-ink text-sm font-medium">{team.name}</p>
														<p class="text-xxs text-duvet-ink2">ID: {team.id}</p>
													</div>
													<ChevronLeftIcon class="text-duvet-ink2 group-hover:text-duvet-ink size-4 rotate-180" />
												</button>
											{/each}
										</div>
									{/if}
								{:else}
									<button
										class="text-duvet-ink2 hover:text-duvet-ink mb-4 flex items-center gap-1 text-sm transition-colors"
										onclick={() => {
											devSelectedTeam = null;
											devApps = [];
											devMembers = [];
											devBotToken = null;
										}}
									>
										<ChevronLeftIcon class="size-4" />
										Back to teams
									</button>

									<div class="mb-6 flex items-center justify-between">
										{#if devEditingTeam?.id === devSelectedTeam.id}
											<div class="flex flex-1 items-center gap-2">
												<input
													type="text"
													bind:value={devEditTeamName}
													class="bg-duvet-sunk text-duvet-ink shadow-duvet-press focus-visible:outline-duvet-accent flex-1 rounded-xl px-3 py-1.5 text-sm focus-visible:outline-2"
													onkeydown={(e) => e.key === "Enter" && handleSaveTeamEdit()}
												/>
												<button
													class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised rounded-xl px-2 py-1.5 text-xs hover:brightness-110"
													onclick={handleSaveTeamEdit}>Save</button
												>
												<button
													class="text-duvet-ink2 hover:text-duvet-ink rounded-md px-2 py-1.5 text-xs"
													onclick={() => (devEditingTeam = null)}>Cancel</button
												>
											</div>
										{:else}
											<h3 class="text-duvet-ink text-lg font-semibold">{devSelectedTeam.name}</h3>
											<div class="flex items-center gap-1">
												{#if devSelectedTeam.owner_id === $currentUser?.id}
													<button
														class="text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink rounded-md p-1.5"
														title="Edit"
														onclick={() => {
															devEditingTeam = devSelectedTeam;
															devEditTeamName = devSelectedTeam?.name ?? "";
														}}
													>
														<PencilIcon class="size-4" />
													</button>
													<button
														class="text-duvet-ink2 hover:bg-duvet-danger/20 hover:text-duvet-danger rounded-md p-1.5"
														title="Delete"
														onclick={() => devSelectedTeam && handleDeleteTeam(devSelectedTeam)}
													>
														<TrashIcon class="size-4" />
													</button>
												{/if}
											</div>
										{/if}
									</div>

									<!-- Members -->
									<div class="mb-6">
										<h4 class="text-duvet-ink2 mb-2 text-[13px] font-bold">Members</h4>
										<div class="space-y-1">
											{#each devMembers as member (member.user_id)}
												<div class="bg-duvet-card/50 flex items-center justify-between rounded-md px-3 py-2">
													<div class="flex items-center gap-2">
														<span class="text-duvet-ink text-sm">{member.username}</span>
														{#if member.role === TeamRole.Admin}
															<span class="text-xxs bg-duvet-ink/10 text-duvet-ink rounded px-1.5 py-0.5 font-medium"
																>Admin</span
															>
														{/if}
													</div>
													{#if devSelectedTeam.owner_id === $currentUser?.id && member.user_id !== $currentUser?.id}
														<button
															class="text-duvet-ink2 hover:text-duvet-danger"
															title="Remove"
															onclick={() => handleRemoveMember(member.user_id, member.username)}
														>
															<XIcon class="size-4" />
														</button>
													{/if}
												</div>
											{/each}
										</div>
										{#if devSelectedTeam.owner_id === $currentUser?.id}
											<div class="mt-2 flex gap-2">
												<input
													type="text"
													bind:value={devInviteEmail}
													placeholder="Email to invite"
													class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent flex-1 rounded-xl px-3 py-1.5 text-xs focus-visible:outline-2"
													onkeydown={(e) => e.key === "Enter" && handleInviteMember()}
												/>
												<button
													class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised flex items-center gap-1 rounded-xl px-2 py-1.5 text-xs hover:brightness-110 disabled:opacity-50"
													onclick={handleInviteMember}
													disabled={devInviting || !devInviteEmail.trim()}
												>
													<UserPlusIcon class="size-3.5" />
													Invite
												</button>
											</div>
										{/if}
									</div>

									<!-- Applications -->
									<div>
										<h4 class="text-duvet-ink2 mb-2 text-[13px] font-bold">Applications</h4>
										{#if devAppsLoading}
											<p class="text-duvet-ink2 text-sm">Loading...</p>
										{:else}
											<div class="mb-3 flex gap-2">
												<input
													type="text"
													bind:value={devNewAppName}
													placeholder="App name"
													class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent flex-1 rounded-xl px-3 py-1.5 text-xs focus-visible:outline-2"
													onkeydown={(e) => e.key === "Enter" && handleCreateApp()}
												/>
												<button
													class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised flex items-center gap-1 rounded-xl px-2 py-1.5 text-xs hover:brightness-110 disabled:opacity-50"
													onclick={handleCreateApp}
													disabled={devCreatingApp || !devNewAppName.trim()}
												>
													<PlusIcon class="size-3.5" />
													Create
												</button>
											</div>

											{#if devApps.length === 0}
												<p class="text-duvet-ink2 text-sm">No applications yet.</p>
											{:else}
												<div class="space-y-3">
													{#each devApps as app (app.id)}
														<div class="border-duvet-line bg-duvet-card/50 rounded-md border p-4">
															{#if devEditingApp?.id === app.id}
																<div class="space-y-2">
																	<input
																		type="text"
																		bind:value={devEditAppName}
																		placeholder="App name"
																		class="bg-duvet-sunk text-duvet-ink shadow-duvet-press focus-visible:outline-duvet-accent w-full rounded-xl px-3 py-1.5 text-sm focus-visible:outline-2"
																	/>
																	<input
																		type="text"
																		bind:value={devEditAppDesc}
																		placeholder="Description (optional)"
																		class="bg-duvet-sunk text-duvet-ink shadow-duvet-press focus-visible:outline-duvet-accent w-full rounded-xl px-3 py-1.5 text-sm focus-visible:outline-2"
																	/>
																	<div class="flex gap-2">
																		<button
																			class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised rounded-xl px-3 py-1.5 text-xs hover:brightness-110"
																			onclick={handleSaveAppEdit}>Save</button
																		>
																		<button
																			class="text-duvet-ink2 hover:text-duvet-ink rounded-md px-3 py-1.5 text-xs"
																			onclick={() => (devEditingApp = null)}>Cancel</button
																		>
																	</div>
																</div>
															{:else}
																<div class="mb-2 flex items-start justify-between">
																	<div>
																		<p class="text-duvet-ink text-sm font-medium">{app.name}</p>
																		{#if app.description}
																			<p class="text-duvet-ink2 text-xs">{app.description}</p>
																		{/if}
																		<p class="text-xxs text-duvet-ink2/60 mt-1 select-text">ID: {app.id}</p>
																	</div>
																	<div class="flex items-center gap-1">
																		<button
																			class="flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors {app.public
																				? 'text-duvet-alive hover:bg-duvet-alive/20'
																				: 'text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink'}"
																			title={app.public
																				? "Public — anyone can add this bot"
																				: "Private — only team members can add"}
																			onclick={() => handleTogglePublic(app)}
																		>
																			{#if app.public}
																				<GlobeIcon class="size-3.5" />
																			{:else}
																				<LockIcon class="size-3.5" />
																			{/if}
																		</button>
																		<button
																			class="text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink rounded-md p-1.5"
																			title="Edit"
																			onclick={() => {
																				devEditingApp = app;
																				devEditAppName = app.name;
																				devEditAppDesc = app.description ?? "";
																			}}
																		>
																			<PencilIcon class="size-4" />
																		</button>
																		<button
																			class="text-duvet-ink2 hover:bg-duvet-danger/20 hover:text-duvet-danger rounded-md p-1.5"
																			title="Delete"
																			onclick={() => handleDeleteApp(app)}
																		>
																			<TrashIcon class="size-4" />
																		</button>
																	</div>
																</div>
																<div class="border-duvet-line mt-3 border-t pt-3">
																	{#if app.bot_user_id}
																		<div class="flex items-center justify-between">
																			<div class="flex items-center gap-2">
																				<BotIcon class="text-duvet-ink2 size-4" />
																				<span class="text-duvet-ink text-xs">Bot active</span>
																			</div>
																			<div class="flex items-center gap-1">
																				<button
																					class="text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink flex items-center gap-1 rounded-md px-2 py-1 text-xs"
																					onclick={() => handleResetBotToken(app)}
																				>
																					<RotateIcon class="size-3.5" />
																					Reset Token
																				</button>
																				<button
																					class="text-duvet-danger hover:bg-duvet-danger/20 flex items-center gap-1 rounded-md px-2 py-1 text-xs"
																					onclick={() => handleDeleteBot(app)}
																				>
																					<TrashIcon class="size-3.5" />
																					Delete Bot
																				</button>
																			</div>
																		</div>
																		<!-- Bot name/alias editing -->
																		<div class="mt-2 space-y-2">
																			<input
																				type="text"
																				value={botEditingAppId === app.id
																					? botEditUsername
																					: (botUsers[app.bot_user_id ?? ""]?.username ?? "")}
																				placeholder="Username"
																				class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent w-full rounded-xl px-3 py-1.5 text-xs focus-visible:outline-2"
																				onfocus={() => {
																					if (botEditingAppId !== app.id) startBotEdit(app);
																				}}
																				oninput={(e) => {
																					if (botEditingAppId !== app.id) startBotEdit(app);
																					botEditUsername = e.currentTarget.value;
																				}}
																			/>
																			<input
																				type="text"
																				value={botEditingAppId === app.id
																					? botEditAlias
																					: (botUsers[app.bot_user_id ?? ""]?.alias ?? "")}
																				placeholder="Display name (optional)"
																				class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent w-full rounded-xl px-3 py-1.5 text-xs focus-visible:outline-2"
																				onfocus={() => {
																					if (botEditingAppId !== app.id) startBotEdit(app);
																				}}
																				oninput={(e) => {
																					if (botEditingAppId !== app.id) startBotEdit(app);
																					botEditAlias = e.currentTarget.value;
																				}}
																			/>
																		</div>
																		<div class="mt-2 flex items-center gap-2">
																			<span class="text-xxs text-duvet-ink2">Invite link:</span>
																			<code
																				class="text-xxs bg-duvet-bg text-duvet-ink2 flex-1 truncate rounded px-2 py-1 select-text"
																				>{getBotInviteLink(app.bot_user_id ?? "")}</code
																			>
																			<button
																				class="text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink shrink-0 rounded p-1"
																				title="Copy"
																				onclick={() => copyBotInviteLink(app.bot_user_id ?? "")}
																			>
																				<CopyIcon class="size-3.5" />
																			</button>
																		</div>
																		{#if hasActiveBucket}
																			{@const botU = app.bot_user_id ? botUsers[app.bot_user_id] : null}
																			<div class="border-duvet-line mt-3 border-t pt-3">
																				<p class="text-xxs text-duvet-ink2 mb-2">Bot appearance</p>
																				<div class="flex items-center gap-3">
																					<!-- Avatar -->
																					<div class="group relative">
																						{#if botAvatarPreview}
																							<img
																								src={botAvatarPreview}
																								alt="avatar"
																								class="h-12 w-12 rounded-full object-cover"
																							/>
																							<button
																								class="absolute inset-0 flex items-center justify-center rounded-full bg-black/60 opacity-0 transition-opacity group-hover:opacity-100"
																								onclick={clearBotAvatar}
																								title="Undo"
																							>
																								<XIcon class="text-fixed-white size-4" />
																							</button>
																						{:else if pendingBotAvatar === "remove"}
																							<div
																								class="bg-duvet-card text-duvet-ink2/60 flex h-12 w-12 items-center justify-center rounded-full"
																							>
																								<XIcon class="size-4" />
																							</div>
																							<button
																								class="absolute inset-0 flex items-center justify-center rounded-full bg-black/60 opacity-0 transition-opacity group-hover:opacity-100"
																								onclick={() => {
																									pendingBotAvatar = null;
																								}}
																								title="Undo"
																							>
																								<RotateIcon class="text-fixed-white size-4" />
																							</button>
																						{:else if botU?.avatar}
																							<img
																								src={getAvatarURL(botU.id, botU.avatar)}
																								alt="avatar"
																								class="h-12 w-12 rounded-full object-cover"
																							/>
																							<div
																								class="absolute inset-0 flex items-center justify-center gap-1 rounded-full bg-black/60 opacity-0 transition-opacity group-hover:opacity-100"
																							>
																								<button
																									class="text-fixed-white hover:bg-fixed-white/20 rounded p-0.5"
																									onclick={() => {
																										botCropTargetApp = app;
																										showBotAvatarCrop = true;
																									}}
																									title="Change"><PencilIcon class="size-3.5" /></button
																								>
																								<button
																									class="hover:bg-fixed-white/20 text-duvet-danger rounded p-0.5"
																									onclick={removeBotAvatar}
																									title="Remove"><TrashIcon class="size-3.5" /></button
																								>
																							</div>
																						{:else}
																							<button
																								class="bg-duvet-card text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink flex h-12 w-12 items-center justify-center rounded-full transition-colors"
																								onclick={() => {
																									botCropTargetApp = app;
																									showBotAvatarCrop = true;
																								}}
																								title="Set avatar"
																							>
																								<PlusIcon class="size-4" />
																							</button>
																						{/if}
																					</div>
																					<!-- Banner, 5:2 as it's cropped -->
																					<div class="group relative">
																						{#if botBannerPreview}
																							<img
																								src={botBannerPreview}
																								alt="banner"
																								class="aspect-[5/2] h-12 rounded object-cover"
																							/>
																							<button
																								class="absolute inset-0 flex items-center justify-center rounded bg-black/60 opacity-0 transition-opacity group-hover:opacity-100"
																								onclick={clearBotBanner}
																								title="Undo"
																							>
																								<XIcon class="text-fixed-white size-4" />
																							</button>
																						{:else if pendingBotBanner === "remove"}
																							<div
																								class="bg-duvet-card text-duvet-ink2/60 flex aspect-[5/2] h-12 items-center justify-center rounded"
																							>
																								<XIcon class="size-4" />
																							</div>
																							<button
																								class="absolute inset-0 flex items-center justify-center rounded bg-black/60 opacity-0 transition-opacity group-hover:opacity-100"
																								onclick={() => {
																									pendingBotBanner = null;
																								}}
																								title="Undo"
																							>
																								<RotateIcon class="text-fixed-white size-4" />
																							</button>
																						{:else if botU?.banner}
																							<img
																								src={getAvatarURL(botU.id, botU.banner)}
																								alt="banner"
																								class="aspect-[5/2] h-12 rounded object-cover"
																							/>
																							<div
																								class="absolute inset-0 flex items-center justify-center gap-1 rounded bg-black/60 opacity-0 transition-opacity group-hover:opacity-100"
																							>
																								<button
																									class="text-fixed-white hover:bg-fixed-white/20 rounded p-0.5"
																									onclick={() => {
																										botCropTargetApp = app;
																										showBotBannerCrop = true;
																									}}
																									title="Change"><PencilIcon class="size-3.5" /></button
																								>
																								<button
																									class="hover:bg-fixed-white/20 text-duvet-danger rounded p-0.5"
																									onclick={removeBotBanner}
																									title="Remove"><TrashIcon class="size-3.5" /></button
																								>
																							</div>
																						{:else}
																							<button
																								class="bg-duvet-card text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink flex aspect-[5/2] h-12 items-center justify-center rounded transition-colors"
																								onclick={() => {
																									botCropTargetApp = app;
																									showBotBannerCrop = true;
																								}}
																								title="Set banner"
																							>
																								<PlusIcon class="size-4" />
																							</button>
																						{/if}
																					</div>
																				</div>
																				{#if hasBotProfileChanges}
																					<button
																						class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised mt-2 rounded-xl px-3 py-1.5 text-xs font-bold tabular-nums transition-colors hover:brightness-110 disabled:opacity-50"
																						onclick={() => handleSaveBotProfile(app)}
																						disabled={savingBotProfile}
																					>
																						{savingBotProfile
																							? botUploadPercent === null
																								? "Saving..."
																								: uploadNote(botUploadPercent)
																							: "Save Changes"}
																					</button>
																				{/if}
																			</div>
																		{/if}
																	{:else}
																		<button
																			class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors hover:brightness-110"
																			onclick={() => handleCreateBot(app)}
																		>
																			<BotIcon class="size-3.5" />
																			Create Bot
																		</button>
																	{/if}
																</div>
															{/if}
														</div>
													{/each}
												</div>
											{/if}

											{#if devBotToken}
												<div class="border-duvet-warn/50 bg-duvet-warn/10 mt-4 rounded-md border p-4">
													<p class="text-duvet-warn mb-2 text-xs font-medium">
														Bot Token — copy it now, it won't be shown again!
													</p>
													<div class="flex items-center gap-2">
														<code
															class="bg-duvet-bg text-duvet-ink flex-1 rounded px-3 py-2 font-mono text-xs break-all select-text"
															>{devShowToken ? devBotToken : "\u2022".repeat(40)}</code
														>
														<button
															class="text-duvet-ink2 hover:text-duvet-ink rounded-md p-1.5"
															title={devShowToken ? "Hide" : "Show"}
															onclick={() => (devShowToken = !devShowToken)}
														>
															{#if devShowToken}<EyeOffIcon class="size-4" />{:else}<EyeIcon class="size-4" />{/if}
														</button>
														<button
															class="text-duvet-ink2 hover:text-duvet-ink rounded-md p-1.5"
															title="Copy"
															onclick={copyToken}
														>
															<CopyIcon class="size-4" />
														</button>
													</div>
												</div>
											{/if}
										{/if}
									</div>
								{/if}
							{/if}
						</div>
					</div>

					<!-- Move bar (appears while files of a location are picked) -->
					{#if activeSection === "attachments" && picking && picker.pickedFiles.length > 0}
						{@const pickedCount = picker.pickedFiles.length}
						{@const tooMany = (picker.filter.attachment_ids?.length ?? 0) > MAX_PICKED_FILES}
						<div
							transition:slide={{ duration: 200 }}
							class="border-duvet-line bg-duvet-bg/80 flex shrink-0 items-center justify-between gap-4 border-t px-6 py-3"
						>
							<p class="text-duvet-ink2 min-w-0 truncate text-sm">
								{#if myTransfer}
									Wait for the transfer under way to end.
								{:else if tooMany}
									Pick {MAX_PICKED_FILES} files at most, or Select all.
								{:else}
									{countFiles(pickedCount)} selected
								{/if}
							</p>
							<div class="flex shrink-0 items-center gap-2">
								<button
									onclick={() => picker.picked.clear()}
									class="text-duvet-ink hover:text-duvet-ink rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
								>
									Clear
								</button>
								<button
									onclick={openMovePicked}
									disabled={myTransfer !== null || tooMany}
									class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-sm font-bold transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
								>
									<MoveIcon class="size-4" />
									Move {countFiles(pickedCount)} ({formatFileSize(picker.pickedBytes)}) to…
								</button>
							</div>
						</div>
					{/if}

					<!-- Save bar (appears when there are unsaved changes) -->
					{#if hasChanges || saveError}
						<div
							transition:slide={{ duration: 200 }}
							class="border-duvet-line bg-duvet-bg/80 flex shrink-0 items-center justify-between gap-4 border-t px-6 py-3"
						>
							<div class="flex min-w-0 items-center gap-2">
								{#if saveError}
									<p class="text-duvet-danger truncate text-sm">
										{saveError}
									</p>
								{:else}
									<p class="text-duvet-ink2 text-sm">You have unsaved changes.</p>
								{/if}
							</div>
							<div class="flex shrink-0 items-center gap-2">
								<button
									onclick={handleReset}
									disabled={saving}
									class="text-duvet-ink hover:text-duvet-ink rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
								>
									Reset
								</button>
								<button
									onclick={handleSave}
									disabled={saving || bioTooLong}
									class="bg-duvet-accent text-duvet-on-accent shadow-duvet-raised flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-sm font-bold tabular-nums transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
								>
									{#if saveSuccess}
										<CheckIcon class="size-4" />
										Saved
									{:else if saving}
										{profileUploadPercent === null ? "Saving…" : uploadNote(profileUploadPercent)}
									{:else}
										Save Changes
									{/if}
								</button>
							</div>
						</div>
					{/if}
				</div>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<ImageCropModal
	bind:open={showAvatarCrop}
	title="Change Avatar"
	aspect={1}
	round
	targetWidth={256}
	targetHeight={256}
	onConfirm={(f) => handleImageCropStage("avatar", f)}
/>
<ImageCropModal
	bind:open={showBannerCrop}
	title="Change Banner"
	aspect={5 / 2}
	targetWidth={600}
	targetHeight={240}
	onConfirm={(f) => handleImageCropStage("banner", f)}
/>
<ImageCropModal
	bind:open={showBotAvatarCrop}
	title="Change Bot Avatar"
	aspect={1}
	round
	targetWidth={256}
	targetHeight={256}
	onConfirm={(f) => onBotAvatarCrop(f)}
/>
<ImageCropModal
	bind:open={showBotBannerCrop}
	title="Change Bot Banner"
	aspect={5 / 2}
	targetWidth={600}
	targetHeight={240}
	onConfirm={(f) => onBotBannerCrop(f)}
/>
<MoveFilesDialog
	bind:open={moveOpen}
	spaceId={null}
	choices={myStorageChoices}
	sourceId={moveSourceId}
	files={moveFiles}
	filter={moveFilter}
	onStarted={onMoveStarted}
/>
<BucketFilesDialog
	bind:request={bucketFilesRequest}
	onMove={(bucket) => openMoveBucket(bucket)}
	onDelete={deleteBucketWithFiles}
/>
