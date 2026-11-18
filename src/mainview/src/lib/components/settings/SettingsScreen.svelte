<script lang="ts">
	import { onDestroy, untrack } from "svelte";
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
		Mail as MailIcon,
		KeyRound as KeyIcon,
		Mic as MicIcon,
		Download as DownloadIcon,
		TriangleAlert as WarningIcon,
		Users as UsersIcon,
		ChevronRight as ChevronRightIcon,
	} from "@lucide/svelte";
	import { slide } from "svelte/transition";
	import { currentUser } from "$lib/stores.svelte";
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
	import { getHostURL, getAvatarURL, DUVET_DOMAIN } from "$lib/common/common";
	import { confirmAction } from "$lib/stores/confirm.svelte";
	import { toast } from "$lib/stores/toast.svelte";
	import { sendVerificationEmail, sendResetPasswordEmail, sendChangeEmail } from "$lib/api/auth";
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
	import { setThemePref, theme } from "$lib/theme.svelte";
	import { parseThemePref, type ThemePref } from "$lib/theme";
	import { isElectrobunWindow } from "$lib/electrobun-rpc";
	import type { Shell } from "$lib/platform";
	import { chosenStatus } from "$lib/status";
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

	import SettingsFrame from "./SettingsFrame.svelte";
	import SettingsGroup from "./SettingsGroup.svelte";
	import SettingsRow from "./SettingsRow.svelte";
	import Slider from "./Slider.svelte";
	import ChoiceCards from "./ChoiceCards.svelte";
	import Avatar from "$lib/components/ui/Avatar.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import IconButton from "$lib/components/ui/IconButton.svelte";
	import Segmented from "$lib/components/ui/Segmented.svelte";
	import Toggle from "$lib/components/ui/Toggle.svelte";
	import { iconButtonClass } from "$lib/components/ui/recipes";
	import {
		calloutClass,
		CARD,
		CHECKBOX,
		FIELD,
		FIELD_AREA,
		FIELD_SM,
		FIELD_WRONG,
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
	} from "./recipes";
	import { pageSettingsHost, type MessageLayout, type SettingsHost } from "$lib/settings-host";
	import { parseSettingsSection, SETTINGS_SECTION_KEY, type SettingsSection as Section } from "$lib/settings-sections";

	// Settings (#357, DESIGN-MAP.md S-47 to S-57): the user's own account, files, sounds, looks and developer teams. On
	// the web it is a sheet of the app's page; in the desktop app it fills the Settings window, which has none of the
	// app's stores but what the main window mirrors to it, and reaches the app through `host`.
	let {
		mode = "sheet",
		chrome = "web",
		open = $bindable(false),
		mobileOnly = false,
		host = pageSettingsHost,
		section = undefined,
		asked = null,
	}: {
		mode?: "sheet" | "window";
		chrome?: Shell["chrome"];
		open?: boolean;
		/** Whether the gateway says the user is connected only from the mobile app. */
		mobileOnly?: boolean;
		host?: SettingsHost;
		/** The section to open on; the one viewed last without it. */
		section?: Section;
		/** A section asked of the open window, each time it is: `at` tells one asking from the next. */
		asked?: { section?: Section; at: number } | null;
	} = $props();

	// Only the desktop app reads what this computer plays.
	const desktopApp = isElectrobunWindow();
	// A window's page ends as it closes: the section viewed last is kept for the next one. A sheet stays mounted.
	function savedSection(): Section {
		try {
			return parseSettingsSection(localStorage.getItem(SETTINGS_SECTION_KEY), desktopApp);
		} catch {
			return "account";
		}
	}
	let activeSection = $state<Section>(untrack(() => section ?? (mode === "window" ? savedSection() : "account")));
	$effect(() => {
		const next = asked?.section;
		if (next) untrack(() => (activeSection = next));
	});
	$effect(() => {
		if (mode !== "window") return;
		try {
			localStorage.setItem(SETTINGS_SECTION_KEY, activeSection);
		} catch {
			// no storage: the next window opens on My account
		}
	});
	// The side panel's sections, in order; Developer sits apart.
	const sectionGroups = $derived<SettingsNavGroup<Section>[]>([
		{
			items: [
				{ id: "account", label: "My account", icon: UserIcon, tile: "#5e6380" },
				{ id: "attachments", label: "Attachments", icon: PaperclipIcon, tile: "#0b6fe8" },
				{ id: "security", label: "Security", icon: ShieldIcon, tile: "#2f9e62" },
				{ id: "audio", label: "Audio", icon: VolumeIcon, tile: "#f97316" },
				{ id: "appearance", label: "Appearance", icon: PaletteIcon, tile: "#2f4cff" },
				...(desktopApp
					? [{ id: "activity" as const, label: "Activity privacy", icon: ActivityIcon, tile: "#e44fcb" }]
					: []),
				{ id: "buckets", label: "S3 buckets", icon: DatabaseIcon, tile: "#0e8fd6" },
			],
		},
		{
			items: [
				{ id: "developer", label: "Developer", icon: CodeIcon, tile: "#5f45b5", count: $pendingTeamInvites.length },
			],
		},
	]);

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

	const formatFileSize = listFileSize;

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
			host.codeThemeChanged(url);
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
		mobile_only: mobileOnly,
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
			// The new name and picture show everywhere at once: the Spaces' member lists, the user's messages, their
			// conversations (lib/own-profile.ts).
			host.profileSaved({
				id: updated.id,
				username: updated.username,
				alias: updated.alias ?? null,
				avatar: updated.avatar ?? null,
				banner: updated.banner ?? null,
				custom: updated.custom ?? "",
			});

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
	] as const satisfies readonly { value: ThemePref; label: string }[];
	const messageLayoutChoices = [
		{ value: "bubbles", label: "Bubbles", tag: "Default" },
		{ value: "flat", label: "Flat rows" },
	] as const satisfies readonly { value: MessageLayout; label: string; tag?: string }[];
	const spacesColumnChoices = [
		{ value: "fixed", label: "Fixed" },
		{ value: "auto-hide", label: "Auto-hide" },
	] as const;
	const openChatsChoices = [
		{ value: "tabs", label: "Tabs on top" },
		{ value: "vertical", label: "Vertical list" },
	] as const;
	const keyboardChoices = [
		{ value: "off", label: "Off" },
		{ value: "on", label: "On" },
	] as const;
	const sounds: { key: SoundEvent; label: string }[] = [
		{ key: "notification", label: "Notifications" },
		{ key: "join_vc", label: "Join voice" },
		{ key: "leave_vc", label: "Leave voice" },
		{ key: "voice_calling", label: "Incoming call" },
		{ key: "screen_sharing_on", label: "Screen share on" },
		{ key: "screen_sharing_off", label: "Screen share off" },
	];

	// Bubbles or flat rows: the conversation's own preference, which the host reads and sets.
	let messageLayout = $state<MessageLayout>(untrack(() => host.messageLayout()));
	function setMessageLayout(layout: MessageLayout) {
		messageLayout = layout;
		host.setMessageLayout(layout);
	}
</script>

{#snippet spinner()}
	<span class="border-duvet-ink2/40 block size-4 animate-spin rounded-full border-2 border-t-transparent"></span>
{/snippet}

{#snippet miniWindow(dark: boolean)}
	<span class="flex h-full min-w-0 flex-1" style="background: {dark ? '#07070a' : '#f5f7ff'};">
		<span class="h-full w-[30%] shrink-0" style="background: {dark ? '#0d0d12' : '#edf1ff'};"></span>
		<span class="flex min-w-0 flex-1 flex-col justify-end gap-[5px] p-2">
			<span class="h-[7px] w-[58%] rounded-full" style="background: {dark ? '#1a1a22' : '#ffffff'};"></span>
			<span class="h-[7px] w-[42%] self-end rounded-full" style="background: #0b6fe8;"></span>
			<span class="h-[7px] w-[50%] rounded-full" style="background: {dark ? '#1a1a22' : '#ffffff'};"></span>
		</span>
	</span>
{/snippet}

{#snippet themePreview(choice: ThemePref)}
	<span class="flex size-full">
		{#if choice === "system"}
			{@render miniWindow(false)}
			{@render miniWindow(true)}
		{:else}
			{@render miniWindow(choice === "dark")}
		{/if}
	</span>
{/snippet}

{#snippet layoutPreview(choice: MessageLayout)}
	<span class="bg-duvet-bg flex size-full flex-col justify-center gap-[7px] p-3">
		{#if choice === "bubbles"}
			<span class="bg-duvet-card shadow-duvet-raised h-3.5 w-[58%] rounded-full"></span>
			<span class="bg-duvet-azure h-3.5 w-[44%] self-end rounded-full"></span>
			<span class="bg-duvet-card shadow-duvet-raised h-3.5 w-[50%] rounded-full"></span>
		{:else}
			{#each [62, 78, 54] as width (width)}
				<span class="flex items-center gap-1.5">
					<span class="bg-duvet-secondary-fill size-3.5 shrink-0 rounded-full"></span>
					<span class="bg-duvet-ink2/35 h-[5px] rounded-full" style="width: {width}%;"></span>
				</span>
			{/each}
		{/if}
	</span>
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
	{#if myTransfer}
		<StorageTransferCard
			transfer={myTransfer}
			source={storageLabel(myTransfer.source_bucket_id)}
			target={storageLabel(myTransfer.target_bucket_id)}
		/>
	{/if}
{/snippet}

<SettingsFrame {mode} {chrome} bind:open name="Duvet settings" groups={sectionGroups} bind:active={activeSection}>
	{#snippet head()}
		<button
			type="button"
			class="flex shrink-0 items-center gap-2.5 rounded-xl p-2 text-left transition-colors duration-[120ms] motion-reduce:transition-none {activeSection ===
			'account'
				? 'bg-duvet-accent-tint'
				: 'hover:bg-duvet-sb-hover'}"
			onclick={() => (activeSection = "account")}
		>
			<Avatar
				src={$currentUser ? getAvatarURL($currentUser.id, $currentUser.avatar) : null}
				size={34}
				ring="var(--duvet-sb-ring)"
			/>
			<span class="min-w-0 flex-1">
				<span class="block truncate text-[13.5px] font-semibold">
					{$currentUser?.alias ?? $currentUser?.username ?? ""}
				</span>
				<span class="text-duvet-ink2 block truncate text-[11.5px]">Duvet account</span>
			</span>
		</button>
	{/snippet}

	{#snippet foot()}
		<button
			type="button"
			class="text-duvet-danger hover:bg-duvet-danger/10 flex h-8 w-full items-center gap-[9px] rounded-[9px] px-2 text-left text-[13px] font-medium transition-colors duration-[120ms] motion-reduce:transition-none"
			onclick={() => host.logout()}
		>
			<span class="grid size-[22px] shrink-0 place-items-center"><LogOutIcon size={15} /></span>
			Sign out
		</button>
	{/snippet}

	{#snippet bars()}
		<!-- Move bar (appears while files of a location are picked) -->
		{#if activeSection === "attachments" && picking && picker.pickedFiles.length > 0}
			{@const pickedCount = picker.pickedFiles.length}
			{@const tooMany = (picker.filter.attachment_ids?.length ?? 0) > MAX_PICKED_FILES}
			<div
				transition:slide={{ duration: 200 }}
				class="bg-duvet-card shadow-duvet-lifted mx-[26px] mb-3 flex items-center justify-between gap-4 rounded-2xl py-2.5 pr-2.5 pl-4 text-[13px] font-medium"
			>
				<p class="text-duvet-ink2 min-w-0 truncate">
					{#if myTransfer}
						Wait for the transfer under way to end.
					{:else if tooMany}
						Pick {MAX_PICKED_FILES} files at most, or Select all.
					{:else}
						{countFiles(pickedCount)} selected
					{/if}
				</p>
				<div class="flex shrink-0 items-center gap-2">
					<Button variant="quiet" onclick={() => picker.picked.clear()}>Clear</Button>
					<Button onclick={openMovePicked} disabled={myTransfer !== null || tooMany}>
						<MoveIcon size={15} />
						Move {countFiles(pickedCount)} ({formatFileSize(picker.pickedBytes)}) to…
					</Button>
				</div>
			</div>
		{/if}

		<!-- Save bar (appears when there are unsaved changes) -->
		{#if hasChanges || saveError}
			<div
				transition:slide={{ duration: 200 }}
				class="bg-duvet-card shadow-duvet-lifted mx-[26px] mb-3 flex items-center justify-between gap-4 rounded-2xl py-2.5 pr-2.5 pl-4 text-[13px] font-medium"
			>
				<div class="flex min-w-0 items-center gap-2">
					{#if saveError}
						<p class="text-duvet-danger truncate" role="alert">{saveError}</p>
					{:else}
						<p class="text-duvet-ink2">You have unsaved changes.</p>
					{/if}
				</div>
				<div class="flex shrink-0 items-center gap-2">
					<Button variant="quiet" onclick={handleReset} disabled={saving}>Reset</Button>
					<Button onclick={handleSave} disabled={saving || bioTooLong} class="tabular-nums">
						{#if saveSuccess}
							<CheckIcon size={15} />
							Saved
						{:else if saving}
							{profileUploadPercent === null ? "Saving…" : uploadNote(profileUploadPercent)}
						{:else}
							Save changes
						{/if}
					</Button>
				</div>
			</div>
		{/if}
	{/snippet}

	{#if activeSection === "account"}
		<!-- Profile preview card -->
		<MemberProfileCard
			member={previewMember}
			onAvatarClick={() => (showAvatarCrop = true)}
			onAvatarRemove={() => handleRemoveImageStage("avatar")}
			onBannerClick={() => (showBannerCrop = true)}
			onBannerRemove={() => handleRemoveImageStage("banner")}
		/>

		<SettingsGroup title="Profile" plain class="flex flex-col gap-4">
			<div>
				<label for="alias" class={LABEL}>Display name</label>
				<input
					id="alias"
					type="text"
					bind:value={alias}
					maxlength={32}
					placeholder={$currentUser?.username ?? ""}
					class={FIELD}
				/>
				<p class="text-duvet-ink2 mt-1.5 text-xs">This is how others see you. Leave empty to use your username.</p>
			</div>

			<div>
				<label for="bio" class={LABEL}>About me</label>
				<textarea
					id="bio"
					bind:value={bio}
					rows="3"
					placeholder="A few words about you"
					aria-invalid={bioTooLong}
					class="{FIELD_AREA} {bioTooLong ? FIELD_WRONG : ''}"
				></textarea>
				<p class="text-duvet-ink2 mt-1 flex justify-between gap-2 text-xs">
					<span>Shown on your profile. Leave empty for none.</span>
					<span class="tabular-nums {bioTooLong ? 'text-duvet-danger' : ''}">{bioLength}/{BIO_MAX_LENGTH}</span>
				</p>
			</div>

			<div>
				<label for="username" class={LABEL}>Username</label>
				<input id="username" type="text" bind:value={username} maxlength={32} placeholder="username" class={FIELD} />
			</div>
		</SettingsGroup>
	{:else if activeSection === "security"}
		<!-- Email verification -->
		{#if $currentUser && !$currentUser.email_verified}
			<div class="{calloutClass('warn')} items-center">
				<MailIcon size={18} class="shrink-0" />
				<div class="min-w-0 flex-1">
					<p class="font-semibold">Email not verified</p>
					<p class="opacity-80">Verify your email to secure your account.</p>
				</div>
				<Button variant="secondary" size="sm" onclick={handleSendVerification} disabled={sendingVerification}>
					{sendingVerification ? "Sending..." : "Send verification"}
				</Button>
			</div>
		{:else if $currentUser?.email_verified}
			<div class="{calloutClass('good')} items-center">
				<MailIcon size={18} class="shrink-0" />
				<p class="font-semibold">Email verified</p>
			</div>
		{/if}

		<SettingsGroup title="Sign-in">
			<SettingsRow label="Password" line="Send a reset link to your email to change your password." icon={KeyIcon}>
				<Button variant="secondary" size="sm" onclick={handleSendResetPassword} disabled={sendingReset}>
					{sendingReset ? "Sending..." : "Reset password"}
				</Button>
			</SettingsRow>
			<SettingsRow label="Email" line="Current: —" icon={MailIcon} labelFor="new-email" stacked>
				<input
					id="new-email"
					type="email"
					bind:value={newEmail}
					placeholder="New email address"
					class="{FIELD} flex-1"
				/>
				<Button variant="secondary" onclick={handleSendChangeEmail} disabled={sendingEmailChange || !newEmail.trim()}>
					{sendingEmailChange ? "Sending..." : "Send verification"}
				</Button>
			</SettingsRow>
		</SettingsGroup>
		<p class={NOTE}>A verification link will be sent to the new address.</p>
	{:else if activeSection === "audio"}
		{#snippet soundRow(key: SoundEvent | "master", label: string)}
			{@const value = key === "master" ? audioStore.settings.master : audioStore.settings[key]}
			<SettingsRow {label}>
				{#if key !== "master"}
					<IconButton
						label={previewingSound === key ? "Stop" : "Preview"}
						title={previewingSound === key ? "Stop" : "Preview"}
						size="sm"
						onclick={() => togglePreview(key)}
					>
						{#if previewingSound === key}
							<StopIcon size={13} />
						{:else}
							<VolumeIcon size={14} />
						{/if}
					</IconButton>
				{/if}
				<Slider
					{label}
					min={0}
					max={200}
					{value}
					oninput={(volume) => (key === "master" ? audioStore.setMaster(volume) : audioStore.set(key, volume))}
				/>
				<span class="text-duvet-ink2 w-10 text-right text-xs tabular-nums">{value}%</span>
			</SettingsRow>
		{/snippet}
		<SettingsGroup title="All sounds">
			{@render soundRow("master", "Master volume")}
		</SettingsGroup>
		<SettingsGroup title="Each sound">
			{#each sounds as sound (sound.key)}
				{@render soundRow(sound.key, sound.label)}
			{/each}
		</SettingsGroup>
	{:else if activeSection === "appearance"}
		<SettingsGroup
			title="Theme"
			plain
			class="p-0!"
			note="System follows your computer's light or dark appearance. Saved on this device."
		>
			<ChoiceCards
				label="Theme"
				options={themeChoices}
				value={theme.pref}
				onValueChange={(pref) => setThemePref(parseThemePref(pref))}
				preview={themePreview}
			/>
		</SettingsGroup>

		<SettingsGroup
			title="Messages"
			plain
			class="p-0!"
			note="Flat rows fit more on screen; bubbles are easier to follow. You can change it any time."
		>
			<ChoiceCards
				label="Messages"
				options={messageLayoutChoices}
				value={messageLayout}
				onValueChange={setMessageLayout}
				preview={layoutPreview}
			/>
		</SettingsGroup>

		<SettingsGroup title="Layout">
			<SettingsRow
				label="Spaces column"
				line="Auto-hide folds it to an edge that opens over the chat when you point at it."
			>
				<Segmented
					label="Spaces column"
					options={spacesColumnChoices}
					value={layoutPrefs.spacesColumn}
					onValueChange={(picked) => (layoutPrefs.spacesColumn = picked)}
				/>
			</SettingsRow>
			<SettingsRow
				label="Open chats"
				line="A vertical list puts them at the top of the Spaces column instead of tabs over each chat."
			>
				<Segmented
					label="Open chats"
					options={openChatsChoices}
					value={layoutPrefs.openChats}
					onValueChange={(picked) => (layoutPrefs.openChats = picked)}
				/>
			</SettingsRow>
			<SettingsRow
				label="Keyboard navigation"
				line="Esc in the message box moves to the messages: j and k go through them, r replies, e edits, f shows jump marks. Press ? for all of them."
			>
				<Segmented
					label="Keyboard navigation"
					options={keyboardChoices}
					value={layoutPrefs.keyboardNavigation ? "on" : "off"}
					onValueChange={(picked) => (layoutPrefs.keyboardNavigation = picked === "on")}
				/>
			</SettingsRow>
		</SettingsGroup>

		<SettingsGroup
			title="Code blocks"
			plain
			class="flex flex-col gap-3"
			note="Customize how code blocks look in messages. Paste a URL to a VS Code theme JSON file."
		>
			<div>
				<label for="code-theme-url" class={LABEL}>Code theme URL</label>
				<div class="flex items-center gap-2">
					<input
						id="code-theme-url"
						type="text"
						bind:value={codeThemeUrl}
						placeholder="https://raw.githubusercontent.com/.../theme.json"
						class="{FIELD} flex-1"
						onkeydown={(e) => e.key === "Enter" && handleSaveTheme()}
					/>
					<Button onclick={handleSaveTheme} disabled={savingTheme}>
						{savingTheme ? "Loading..." : "Apply"}
					</Button>
					{#if codeThemeUrl}
						<Button
							variant="quiet"
							onclick={() => {
								codeThemeUrl = "";
								void handleSaveTheme();
							}}
						>
							Reset to default
						</Button>
					{/if}
				</div>
			</div>
			<!-- Preview -->
			<div>
				<p class={LABEL}>Preview</p>
				{#key themeVersion}
					<p class="msg-content text-duvet-ink text-sm">
						{@html renderMarkdown(
							'```go\npackage main\n\nimport "fmt"\n\nfunc main() {\n\tnames := []string{"Alice", "Bob"}\n\tfor _, name := range names {\n\t\tfmt.Printf("Hello, %s!\\n", name)\n\t}\n}\n```',
						)}
					</p>
				{/key}
			</div>
		</SettingsGroup>

		<SettingsGroup title="Voice">
			<SettingsRow
				label="Faces in voice"
				line="Voice room tiles show everyone's animated face instead of their avatar. Saved on this device."
			>
				<Toggle label="Faces in voice" checked={$voiceFaces} onCheckedChange={(on) => voiceFaces.set(on)} />
			</SettingsRow>
		</SettingsGroup>
	{:else if activeSection === "activity"}
		<SettingsGroup>
			<SettingsRow
				label="Share what I listen to on Spotify"
				line="While Spotify plays on this computer, the people in your Spaces see the song, its artist and how far along it is. Saved on this device."
			>
				<Toggle
					label="Share what I listen to on Spotify"
					checked={$shareSpotify}
					onCheckedChange={(on) => shareSpotify.set(on)}
				/>
			</SettingsRow>
		</SettingsGroup>
	{:else if activeSection === "attachments"}
		{@render transferCard()}
		<!-- Active custom bucket banner -->
		{#if hasActiveBucket}
			{@const activeBucket = buckets.find((b) => b.is_active)}
			<div class="{calloutClass('good')} items-center">
				<DatabaseIcon size={18} class="shrink-0" />
				<div class="min-w-0 flex-1">
					<p class="font-semibold">Using your own storage</p>
					<p class="truncate opacity-80">{activeBucket?.name} · {activeBucket?.bucket_name}</p>
				</div>
				<span class="{TAG} bg-duvet-alive/20 uppercase">No quota</span>
			</div>
		{/if}
		<!-- Default storage quota (always shown) -->
		{#if storageStatus}
			<div class="{CARD} flex flex-col gap-3 p-4">
				<div class="flex items-baseline justify-between gap-3">
					<p class="text-duvet-ink2 text-[13px] font-medium">Default storage</p>
					<p class="text-[22px] leading-none font-semibold tabular-nums">
						{formatFileSize(storageStatus.used_bytes)}
						<span class="text-duvet-ink2 text-sm font-medium">/ {formatFileSize(storageStatus.max_bytes)}</span>
					</p>
				</div>
				{@render usageBar(Math.min(storageStatus.percentage_used, 100))}
				<div class="text-duvet-ink2 flex gap-4 text-xs">
					<span>{storageStatus.percentage_used}% used</span>
					<span>Upload limit: {formatFileSize(storageStatus.upload_limit_bytes)} per file</span>
				</div>
			</div>
		{/if}

		<!-- Summary bar -->
		<div class="flex min-h-[30px] items-center justify-between gap-3 px-1.5">
			<div class="text-duvet-ink2 text-[13px]">
				{#if listedHere}
					<span class="text-duvet-ink font-semibold tabular-nums">{attachments.length}</span>
					file{attachments.length !== 1 ? "s" : ""}
					{#if attachmentsLocation !== "all"}
						<span class="mx-1 opacity-60">·</span>
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
							class={SELECT}
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
					<Button variant="danger" size="sm" onclick={handleDeleteAll}>
						<TrashIcon size={13} />
						Delete all
					</Button>
				{/if}
			</div>
		</div>

		{#if attachmentsError}
			<p class={calloutClass("danger")} role="alert">{attachmentsError}</p>
		{/if}

		{#if attachmentsLoading}
			<div class="flex flex-col gap-2">
				{#each Array(5) as _, index (index)}
					<div class="{SKELETON} h-14"></div>
				{/each}
			</div>
		{:else if !listedHere}
			<!-- The location's files didn't load (the error above says why): the list is another's. -->
		{:else if attachments.length === 0}
			<div class="text-duvet-ink2 flex flex-col items-center justify-center py-14">
				<PaperclipIcon class="mb-3 size-9" />
				<p class="text-sm">{attachmentsLocation === "all" ? "No attachments yet" : "No files here"}</p>
			</div>
		{:else}
			<div class="flex flex-col gap-2">
				{#if picking}
					<FilePickerBar {picker} />
				{/if}
				<div class="{CARD} divide-duvet-line divide-y">
					{#each picker.shown as att (att.id)}
						{@const isImage = att.content_type.startsWith("image/")}
						{@const isAudio = att.content_type.startsWith("audio/")}
						<div class="group hover:bg-duvet-hover-soft transition-colors motion-reduce:transition-none">
							<div class="flex items-center gap-3 px-3.5 py-2.5">
								{#if picking}
									<input
										type="checkbox"
										checked={picker.picked.has(att.id)}
										onchange={() => picker.toggle(att.id)}
										aria-label="Select {att.filename}"
										class={CHECKBOX}
									/>
								{/if}
								<!-- Thumbnail -->
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
								<!-- Info -->
								<div class="min-w-0 flex-1">
									<p class="truncate text-[13.5px] font-medium">{att.filename}</p>
									<p class="text-duvet-ink2 text-xs">
										{formatFileSize(att.size_bytes)}
										<span class="mx-1 opacity-60">·</span>
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
									<IconButton
										label="Delete attachment"
										title="Delete attachment"
										class="hover:bg-duvet-danger/15! hover:text-duvet-danger!"
										onclick={() => handleDeleteAttachment(att.id)}
									>
										<TrashIcon size={16} />
									</IconButton>
								</div>
							</div>
							{#if isAudio}
								<div class="px-3.5 pb-2.5">
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
			</div>
		{/if}
	{:else if activeSection === "buckets"}
		{@render transferCard()}
		<p class={NOTE}>
			Connect your own S3/R2 buckets for unlimited storage. When a bucket is active, uploads go to your bucket instead
			of the default and quota limits don't apply.
		</p>

		{#if !bucketsLoading}
			<div class={calloutClass("warn")}>
				<WarningIcon size={18} class="mt-0.5 shrink-0" />
				<div class="space-y-1">
					<p class="font-semibold">Before adding a bucket</p>
					<p>
						Only enter credentials that <strong>you own and control</strong>. If someone shared credentials with you, be
						aware that:
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
			<p class={calloutClass("danger")} role="alert">{bucketsError}</p>
		{/if}

		<!-- Create / Edit form -->
		{#if showBucketForm}
			<SettingsGroup title={editingBucket ? "Edit bucket" : "New bucket"} plain class="flex flex-col gap-3">
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="bucket-name" class={LABEL}>Name</label>
						<input id="bucket-name" type="text" bind:value={bName} placeholder="My R2" class={FIELD} />
					</div>
					<div>
						<label for="bucket-region" class={LABEL}>Region</label>
						<input id="bucket-region" type="text" bind:value={bRegion} placeholder="auto" class={FIELD} />
					</div>
				</div>
				<div>
					<label for="bucket-endpoint" class={LABEL}>Endpoint</label>
					<input
						id="bucket-endpoint"
						type="text"
						bind:value={bEndpoint}
						placeholder="https://account-id.r2.cloudflarestorage.com"
						class={FIELD}
					/>
				</div>
				<div>
					<label for="bucket-bucket-name" class={LABEL}>Bucket name</label>
					<input id="bucket-bucket-name" type="text" bind:value={bBucketName} placeholder="my-bucket" class={FIELD} />
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="bucket-access-key" class={LABEL}>Access key ID</label>
						<input id="bucket-access-key" type="text" bind:value={bAccessKey} placeholder="access key" class={FIELD} />
					</div>
					<div>
						<label for="bucket-secret-key" class={LABEL}>Secret access key</label>
						<input
							id="bucket-secret-key"
							type="password"
							bind:value={bSecretKey}
							placeholder={editingBucket ? "leave empty to keep current" : "secret key"}
							class={FIELD}
						/>
					</div>
				</div>
				<label class="flex cursor-pointer items-center gap-2">
					<input type="checkbox" bind:checked={bUsePathStyle} class={CHECKBOX} />
					<span class="text-duvet-ink text-xs"
						>Use path-style addressing <span class="text-duvet-ink2">(required for MinIO, RustFS, etc.)</span></span
					>
				</label>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="b-max-bytes" class={LABEL}>Total limit (MB)</label>
						<input
							id="b-max-bytes"
							type="number"
							min="0"
							step="1"
							bind:value={bMaxBytesMB}
							placeholder="No limit"
							class={FIELD}
						/>
					</div>
					<div>
						<label for="b-upload-limit" class={LABEL}>Per-file limit (MB)</label>
						<input
							id="b-upload-limit"
							type="number"
							min="0"
							step="1"
							bind:value={bUploadLimitMB}
							placeholder="No limit"
							class={FIELD}
						/>
					</div>
				</div>
				<p class="text-duvet-ink2 text-xs">
					Leave empty to remove limits. When a total limit is set, oldest files are recycled automatically when full.
				</p>
				<div class="flex justify-end gap-2 pt-1">
					<Button variant="quiet" onclick={resetBucketForm}>Cancel</Button>
					<Button disabled={bucketSaving} onclick={handleSaveBucket}>
						{bucketSaving ? "Saving..." : editingBucket ? "Update" : "Create"}
					</Button>
				</div>
			</SettingsGroup>
		{:else}
			<div>
				<Button
					variant="secondary"
					onclick={() => {
						resetBucketForm();
						showBucketForm = true;
					}}
				>
					<PlusIcon size={15} /> Add bucket
				</Button>
			</div>
		{/if}

		<!-- Bucket list -->
		{#if bucketsLoading}
			<div class="flex flex-col gap-2">
				{#each Array(3) as _, index (index)}
					<div class="{SKELETON} h-16"></div>
				{/each}
			</div>
		{:else if buckets.length === 0}
			<div class="text-duvet-ink2 flex flex-col items-center justify-center py-12">
				<DatabaseIcon class="mb-3 size-9" />
				<p class="text-sm">No buckets configured</p>
			</div>
		{:else}
			<div class="{CARD} divide-duvet-line divide-y">
				{#each buckets as bucket (bucket.id)}
					<div
						class="group hover:bg-duvet-hover-soft flex items-center gap-3 px-3.5 py-3 transition-colors motion-reduce:transition-none"
					>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="truncate text-[13.5px] font-medium">{bucket.name}</span>
								{#if bucket.is_active}
									<span class="{TAG} bg-duvet-alive/20 text-duvet-alive uppercase">Active</span>
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
											>{(bucket.used_bytes / 1024 / 1024).toFixed(1)} MB / {(bucket.max_bytes / 1024 / 1024).toFixed(0)} MB</span
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
								onclick={() => handleToggleActive(bucket)}
								disabled={togglingBucketId === bucket.id}
							>
								{#if togglingBucketId === bucket.id}
									{@render spinner()}
								{:else if bucket.is_active}
									<XIcon size={16} />
								{:else}
									<CheckIcon size={16} />
								{/if}
							</IconButton>
							<IconButton
								label="Move files…"
								title={myTransfer ? "Wait for the transfer under way to end" : "Move files…"}
								onclick={() => openMoveBucket(bucket)}
								disabled={movingBucketId === bucket.id || myTransfer !== null}
							>
								{#if movingBucketId === bucket.id}
									{@render spinner()}
								{:else}
									<MoveIcon size={16} />
								{/if}
							</IconButton>
							<IconButton label="Edit" title="Edit" onclick={() => startEditBucket(bucket)}>
								<PencilIcon size={16} />
							</IconButton>
							<IconButton
								label="Delete"
								title="Delete"
								class="hover:bg-duvet-danger/15! hover:text-duvet-danger!"
								onclick={() => handleDeleteBucket(bucket.id)}
							>
								<TrashIcon size={16} />
							</IconButton>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{:else if activeSection === "developer"}
		{#if $pendingTeamInvites.length > 0}
			<SettingsGroup title="Pending team invites">
				{#each $pendingTeamInvites as invite (invite.id)}
					<SettingsRow label={invite.team_name} line="Invited by {invite.invited_by_username}" icon={UserPlusIcon}>
						<Button size="sm" onclick={() => handleAcceptTeamInvite(invite.id)}>Accept</Button>
						<Button variant="quiet" size="sm" onclick={() => handleDeclineTeamInvite(invite.id)}>Decline</Button>
					</SettingsRow>
				{/each}
			</SettingsGroup>
		{/if}

		{#if !devSelectedTeam}
			<p class={NOTE}>Create a team to manage applications and bots. Team members can collaborate on your apps.</p>

			<div class="flex gap-2">
				<input
					type="text"
					bind:value={devNewTeamName}
					placeholder="Team name"
					aria-label="Team name"
					class="{FIELD} flex-1"
					onkeydown={(e) => e.key === "Enter" && handleCreateTeam()}
				/>
				<Button onclick={handleCreateTeam} disabled={devCreatingTeam || !devNewTeamName.trim()}>
					<PlusIcon size={15} />
					Create
				</Button>
			</div>

			{#if devLoading}
				<p class="text-duvet-ink2 px-1.5 text-sm">Loading...</p>
			{:else if devTeams.length === 0}
				<p class="text-duvet-ink2 px-1.5 text-sm">No teams yet. Create one to get started.</p>
			{:else}
				<SettingsGroup title="Teams">
					{#each devTeams as team (team.id)}
						<button
							type="button"
							class="hover:bg-duvet-hover-soft flex min-h-[50px] w-full items-center gap-3 px-3.5 py-2 text-left transition-colors motion-reduce:transition-none"
							onclick={() => selectTeam(team)}
						>
							<span
								class="bg-duvet-secondary-fill text-duvet-accent-text grid size-[30px] shrink-0 place-items-center rounded-[9px]"
							>
								<UsersIcon size={16} />
							</span>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-[13.5px] font-medium">{team.name}</span>
								<span class="text-duvet-ink2 block truncate text-xs">ID: {team.id}</span>
							</span>
							<ChevronRightIcon size={16} class="text-duvet-ink2 shrink-0" />
						</button>
					{/each}
				</SettingsGroup>
			{/if}
		{:else}
			<div>
				<button
					type="button"
					class="text-duvet-accent-text flex items-center gap-1 text-[13px] font-medium hover:underline"
					onclick={() => {
						devSelectedTeam = null;
						devApps = [];
						devMembers = [];
						devBotToken = null;
					}}
				>
					<ChevronLeftIcon size={15} />
					Back to teams
				</button>
			</div>

			<div class="{CARD} flex items-center justify-between gap-3 px-3.5 py-3">
				{#if devEditingTeam?.id === devSelectedTeam.id}
					<div class="flex flex-1 items-center gap-2">
						<input
							type="text"
							bind:value={devEditTeamName}
							aria-label="Team name"
							class="{FIELD_SM} flex-1"
							onkeydown={(e) => e.key === "Enter" && handleSaveTeamEdit()}
						/>
						<Button size="sm" onclick={handleSaveTeamEdit}>Save</Button>
						<Button variant="quiet" size="sm" onclick={() => (devEditingTeam = null)}>Cancel</Button>
					</div>
				{:else}
					<h3 class="min-w-0 flex-1 truncate font-serif text-lg font-medium">{devSelectedTeam.name}</h3>
					<div class="flex items-center gap-1">
						{#if devSelectedTeam.owner_id === $currentUser?.id}
							<IconButton
								label="Edit"
								title="Edit"
								onclick={() => {
									devEditingTeam = devSelectedTeam;
									devEditTeamName = devSelectedTeam?.name ?? "";
								}}
							>
								<PencilIcon size={16} />
							</IconButton>
							<IconButton
								label="Delete"
								title="Delete"
								class="hover:bg-duvet-danger/15! hover:text-duvet-danger!"
								onclick={() => devSelectedTeam && handleDeleteTeam(devSelectedTeam)}
							>
								<TrashIcon size={16} />
							</IconButton>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Members -->
			<SettingsGroup title="Members">
				{#each devMembers as member (member.user_id)}
					<div class="flex min-h-11 items-center justify-between gap-3 px-3.5 py-2">
						<div class="flex min-w-0 items-center gap-2">
							<span class="truncate text-[13.5px] font-medium">{member.username}</span>
							{#if member.role === TeamRole.Admin}
								<span class="{TAG} bg-duvet-secondary-fill text-duvet-ink2">Admin</span>
							{/if}
						</div>
						{#if devSelectedTeam.owner_id === $currentUser?.id && member.user_id !== $currentUser?.id}
							<IconButton
								label="Remove"
								title="Remove"
								size="sm"
								class="hover:bg-duvet-danger/15! hover:text-duvet-danger!"
								onclick={() => handleRemoveMember(member.user_id, member.username)}
							>
								<XIcon size={15} />
							</IconButton>
						{/if}
					</div>
				{/each}
				{#if devSelectedTeam.owner_id === $currentUser?.id}
					<div class="flex gap-2 px-3.5 py-2.5">
						<input
							type="text"
							bind:value={devInviteEmail}
							placeholder="Email to invite"
							aria-label="Email to invite"
							class="{FIELD_SM} flex-1"
							onkeydown={(e) => e.key === "Enter" && handleInviteMember()}
						/>
						<Button size="sm" onclick={handleInviteMember} disabled={devInviting || !devInviteEmail.trim()}>
							<UserPlusIcon size={14} />
							Invite
						</Button>
					</div>
				{/if}
			</SettingsGroup>

			<!-- Applications -->
			<section class="flex flex-col gap-2">
				<h3 class={GROUP_TITLE}>Applications</h3>
				{#if devAppsLoading}
					<p class="text-duvet-ink2 px-1.5 text-sm">Loading...</p>
				{:else}
					<div class="flex gap-2">
						<input
							type="text"
							bind:value={devNewAppName}
							placeholder="App name"
							aria-label="App name"
							class="{FIELD} flex-1"
							onkeydown={(e) => e.key === "Enter" && handleCreateApp()}
						/>
						<Button onclick={handleCreateApp} disabled={devCreatingApp || !devNewAppName.trim()}>
							<PlusIcon size={15} />
							Create
						</Button>
					</div>

					{#if devApps.length === 0}
						<p class="text-duvet-ink2 px-1.5 text-sm">No applications yet.</p>
					{:else}
						<div class="flex flex-col gap-3">
							{#each devApps as app (app.id)}
								<div class="{CARD} p-3.5">
									{#if devEditingApp?.id === app.id}
										<div class="flex flex-col gap-2">
											<input
												type="text"
												bind:value={devEditAppName}
												placeholder="App name"
												aria-label="App name"
												class={FIELD}
											/>
											<input
												type="text"
												bind:value={devEditAppDesc}
												placeholder="Description (optional)"
												aria-label="Description (optional)"
												class={FIELD}
											/>
											<div class="flex gap-2">
												<Button size="sm" onclick={handleSaveAppEdit}>Save</Button>
												<Button variant="quiet" size="sm" onclick={() => (devEditingApp = null)}>Cancel</Button>
											</div>
										</div>
									{:else}
										<div class="flex items-start justify-between gap-3">
											<div class="min-w-0">
												<p class="truncate text-[13.5px] font-medium">{app.name}</p>
												{#if app.description}
													<p class="text-duvet-ink2 text-xs">{app.description}</p>
												{/if}
												<p class="text-duvet-ink2 mt-1 text-[11px] select-text">ID: {app.id}</p>
											</div>
											<div class="flex shrink-0 items-center gap-1">
												<IconButton
													label={app.public
														? "Public — anyone can add this bot"
														: "Private — only team members can add"}
													title={app.public
														? "Public — anyone can add this bot"
														: "Private — only team members can add"}
													class={app.public ? "text-duvet-alive!" : ""}
													onclick={() => handleTogglePublic(app)}
												>
													{#if app.public}
														<GlobeIcon size={15} />
													{:else}
														<LockIcon size={15} />
													{/if}
												</IconButton>
												<IconButton
													label="Edit"
													title="Edit"
													onclick={() => {
														devEditingApp = app;
														devEditAppName = app.name;
														devEditAppDesc = app.description ?? "";
													}}
												>
													<PencilIcon size={16} />
												</IconButton>
												<IconButton
													label="Delete"
													title="Delete"
													class="hover:bg-duvet-danger/15! hover:text-duvet-danger!"
													onclick={() => handleDeleteApp(app)}
												>
													<TrashIcon size={16} />
												</IconButton>
											</div>
										</div>
										<div class="border-duvet-line mt-3 border-t pt-3">
											{#if app.bot_user_id}
												<div class="flex items-center justify-between gap-2">
													<div class="flex items-center gap-2">
														<BotIcon size={16} class="text-duvet-ink2" />
														<span class="text-[13px] font-medium">Bot active</span>
													</div>
													<div class="flex items-center gap-1">
														<Button variant="quiet" size="sm" onclick={() => handleResetBotToken(app)}>
															<RotateIcon size={13} />
															Reset token
														</Button>
														<Button
															variant="quiet"
															size="sm"
															class="text-duvet-danger! hover:bg-duvet-danger/15!"
															onclick={() => handleDeleteBot(app)}
														>
															<TrashIcon size={13} />
															Delete bot
														</Button>
													</div>
												</div>
												<!-- Bot name/alias editing -->
												<div class="mt-2 flex flex-col gap-2">
													<input
														type="text"
														value={botEditingAppId === app.id
															? botEditUsername
															: (botUsers[app.bot_user_id ?? ""]?.username ?? "")}
														placeholder="Username"
														aria-label="Username"
														class={FIELD_SM}
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
														aria-label="Display name (optional)"
														class={FIELD_SM}
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
													<span class="text-duvet-ink2 shrink-0 text-[11px]">Invite link:</span>
													<code
														class="bg-duvet-code-bg text-duvet-ink2 min-w-0 flex-1 truncate rounded-md px-2 py-1 font-mono text-[11px] select-text"
														>{getBotInviteLink(app.bot_user_id ?? "")}</code
													>
													<IconButton
														label="Copy"
														title="Copy"
														size="sm"
														onclick={() => copyBotInviteLink(app.bot_user_id ?? "")}
													>
														<CopyIcon size={13} />
													</IconButton>
												</div>
												{#if hasActiveBucket}
													{@const botU = app.bot_user_id ? botUsers[app.bot_user_id] : null}
													<div class="border-duvet-line mt-3 border-t pt-3">
														<p class="text-duvet-ink2 mb-2 text-[11px]">Bot appearance</p>
														<div class="flex items-center gap-3">
															<!-- Avatar -->
															<div class="group relative">
																{#if botAvatarPreview}
																	<img src={botAvatarPreview} alt="avatar" class="size-12 rounded-[28%] object-cover" />
																	<button
																		class="bg-duvet-media-scrim absolute inset-0 flex items-center justify-center rounded-[28%] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
																		onclick={clearBotAvatar}
																		title="Undo"
																	>
																		<XIcon class="text-fixed-white size-4" />
																	</button>
																{:else if pendingBotAvatar === "remove"}
																	<div
																		class="bg-duvet-secondary-fill text-duvet-ink2 flex size-12 items-center justify-center rounded-[28%]"
																	>
																		<XIcon class="size-4" />
																	</div>
																	<button
																		class="bg-duvet-media-scrim absolute inset-0 flex items-center justify-center rounded-[28%] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
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
																		class="size-12 rounded-[28%] object-cover"
																	/>
																	<div
																		class="bg-duvet-media-scrim absolute inset-0 flex items-center justify-center gap-1 rounded-[28%] opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
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
																			class="hover:bg-fixed-white/20 text-duvet-call-red-ink rounded p-0.5"
																			onclick={removeBotAvatar}
																			title="Remove"><TrashIcon class="size-3.5" /></button
																		>
																	</div>
																{:else}
																	<button
																		class="bg-duvet-secondary-fill text-duvet-accent-text hover:bg-duvet-hover-strong flex size-12 items-center justify-center rounded-[28%] transition-colors"
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
																		class="aspect-[5/2] h-12 rounded-[9px] object-cover"
																	/>
																	<button
																		class="bg-duvet-media-scrim absolute inset-0 flex items-center justify-center rounded-[9px] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
																		onclick={clearBotBanner}
																		title="Undo"
																	>
																		<XIcon class="text-fixed-white size-4" />
																	</button>
																{:else if pendingBotBanner === "remove"}
																	<div
																		class="bg-duvet-secondary-fill text-duvet-ink2 flex aspect-[5/2] h-12 items-center justify-center rounded-[9px]"
																	>
																		<XIcon class="size-4" />
																	</div>
																	<button
																		class="bg-duvet-media-scrim absolute inset-0 flex items-center justify-center rounded-[9px] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
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
																		class="aspect-[5/2] h-12 rounded-[9px] object-cover"
																	/>
																	<div
																		class="bg-duvet-media-scrim absolute inset-0 flex items-center justify-center gap-1 rounded-[9px] opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
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
																			class="hover:bg-fixed-white/20 text-duvet-call-red-ink rounded p-0.5"
																			onclick={removeBotBanner}
																			title="Remove"><TrashIcon class="size-3.5" /></button
																		>
																	</div>
																{:else}
																	<button
																		class="bg-duvet-secondary-fill text-duvet-accent-text hover:bg-duvet-hover-strong flex aspect-[5/2] h-12 items-center justify-center rounded-[9px] transition-colors"
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
															<Button
																size="sm"
																class="mt-2 tabular-nums"
																onclick={() => handleSaveBotProfile(app)}
																disabled={savingBotProfile}
															>
																{savingBotProfile
																	? botUploadPercent === null
																		? "Saving..."
																		: uploadNote(botUploadPercent)
																	: "Save changes"}
															</Button>
														{/if}
													</div>
												{/if}
											{:else}
												<Button size="sm" onclick={() => handleCreateBot(app)}>
													<BotIcon size={14} />
													Create bot
												</Button>
											{/if}
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}

					{#if devBotToken}
						<div class="{calloutClass('warn')} flex-col gap-2!">
							<p class="font-semibold">Bot token — copy it now, it won't be shown again!</p>
							<div class="flex items-center gap-2">
								<code
									class="bg-duvet-code-bg text-duvet-ink min-w-0 flex-1 rounded-md px-3 py-2 font-mono text-xs break-all select-text"
									>{devShowToken ? devBotToken : "•".repeat(40)}</code
								>
								<IconButton
									label={devShowToken ? "Hide" : "Show"}
									title={devShowToken ? "Hide" : "Show"}
									onclick={() => (devShowToken = !devShowToken)}
								>
									{#if devShowToken}<EyeOffIcon size={16} />{:else}<EyeIcon size={16} />{/if}
								</IconButton>
								<IconButton label="Copy" title="Copy" onclick={copyToken}>
									<CopyIcon size={16} />
								</IconButton>
							</div>
						</div>
					{/if}
				{/if}
			</section>
		{/if}
	{/if}
</SettingsFrame>

<ImageCropModal
	bind:open={showAvatarCrop}
	title="Change avatar"
	aspect={1}
	round
	targetWidth={256}
	targetHeight={256}
	onConfirm={(f) => handleImageCropStage("avatar", f)}
/>
<ImageCropModal
	bind:open={showBannerCrop}
	title="Change banner"
	aspect={5 / 2}
	targetWidth={600}
	targetHeight={240}
	onConfirm={(f) => handleImageCropStage("banner", f)}
/>
<ImageCropModal
	bind:open={showBotAvatarCrop}
	title="Change bot avatar"
	aspect={1}
	round
	targetWidth={256}
	targetHeight={256}
	onConfirm={(f) => onBotAvatarCrop(f)}
/>
<ImageCropModal
	bind:open={showBotBannerCrop}
	title="Change bot banner"
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
