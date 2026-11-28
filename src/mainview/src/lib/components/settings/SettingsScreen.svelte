<script lang="ts">
	import { onDestroy, onMount, untrack } from "svelte";
	import { SvelteSet } from "svelte/reactivity";
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
		Languages as LanguageIcon,
		Activity as ActivityIcon,
		ArrowRightLeft as MoveIcon,
		Mail as MailIcon,
		KeyRound as KeyIcon,
		Mic as MicIcon,
		Search as SearchIcon,
		Download as DownloadIcon,
		TriangleAlert as WarningIcon,
		Users as UsersIcon,
		ChevronRight as ChevronRightIcon,
	} from "@lucide/svelte";
	import { slide } from "svelte/transition";
	import { motionMs } from "$lib/motion";
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
	import {
		accountForUser,
		activateAccount,
		forgetAccount as forgetSavedAccount,
		rememberAccount,
		type StoredAccount,
	} from "$lib/accounts";
	import { confirmAction } from "$lib/stores/confirm.svelte";
	import { toast } from "$lib/stores/toast.svelte";
	import { logInForAccount, sendVerificationEmail, sendResetPasswordEmail, sendChangeEmail } from "$lib/api/auth";
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
	import {
		pendingTeamInvites,
		myBuckets,
		voiceFaces,
		shareSpotify,
		shareGameActivity,
		noiseSuppression,
		selectedMicId,
		selectedCameraId,
	} from "$lib/stores.svelte";
	import { listMicrophones } from "$lib/mic-devices";
	import { listCameras } from "$lib/camera-devices";
	import type { CameraChoice, MicChoice } from "$lib/media-state";
	import { layoutPrefs } from "$lib/layout-prefs.svelte";
	import type { OpenChatsMode, SpacesColumnMode } from "$lib/layout-prefs";
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
	import VoiceVideoSettings from "./VoiceVideoSettings.svelte";
	import ChoiceCards from "./ChoiceCards.svelte";
	import LanguageSelect from "./LanguageSelect.svelte";
	import ImagePreview from "$lib/components/ImagePreview.svelte";
	import TextFilePreview from "$lib/components/TextFilePreview.svelte";
	import Avatar from "$lib/components/ui/Avatar.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import IconButton from "$lib/components/ui/IconButton.svelte";
	import Segmented from "$lib/components/ui/Segmented.svelte";
	import Toggle from "$lib/components/ui/Toggle.svelte";
	import { FOCUS_RING, iconButtonClass } from "$lib/components/ui/recipes";
	import {
		ACTION_BAR,
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
		NAV_ICON_SLOT,
		navItemClass,
		NOTE,
		ROW_TILE,
		SELECT,
		SKELETON,
		TAG,
		usagePercent,
		usageTone,
		type SettingsNavGroup,
	} from "./recipes";
	import { pageSettingsHost, type MessageLayout, type SettingsHost } from "$lib/settings-host";
	import { OFFERED, localePref, setLocalePref, systemLanguageName, t, type MessageKey } from "$lib/i18n";
	import { formatDate, formatNumber } from "$lib/i18n/format";
	import Rich from "$lib/components/Rich.svelte";
	import { parseLocalePref } from "$lib/i18n/locale";
	import { defaultMessageLayout } from "$lib/message-layout";
	import { USER_SCOPE, type StagedImage } from "$lib/staged-images";
	import { isImageAttachment, isTextAttachment } from "$lib/attachment-preview";
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
	// The side panel's sections, in larger groups: who the settings are for, how the app looks and sounds, the files
	// behind the account, and the tools for builders.
	const sectionGroups = $derived<SettingsNavGroup<Section>[]>([
		{
			title: t("settings_group_account"),
			items: [
				{ id: "account", label: t("settings_section_account"), icon: UserIcon, tile: "#5e6380" },
				{ id: "security", label: t("settings_section_security"), icon: ShieldIcon, tile: "#2f9e62" },
				...(desktopApp
					? [
							{
								id: "activity" as const,
								label: t("settings_section_activity"),
								icon: ActivityIcon,
								tile: "#e44fcb",
							},
						]
					: []),
			],
		},
		{
			title: t("settings_group_app_media"),
			items: [
				{ id: "appearance", label: t("settings_section_appearance"), icon: PaletteIcon, tile: "#2f4cff" },
				{ id: "language", label: t("settings_language_title"), icon: LanguageIcon, tile: "#0e8fd6" },
				{ id: "audio", label: t("settings_section_audio"), icon: VolumeIcon, tile: "#f97316" },
				{ id: "voice-video", label: t("settings_section_voice_video"), icon: MicIcon, tile: "#e01890" },
			],
		},
		{
			title: t("settings_group_files"),
			items: [
				{ id: "attachments", label: t("settings_section_attachments"), icon: PaperclipIcon, tile: "#0b6fe8" },
				{ id: "buckets", label: t("settings_section_buckets"), icon: DatabaseIcon, tile: "#0e8fd6" },
			],
		},
		{
			title: t("settings_group_developer"),
			items: [
				{
					id: "developer",
					label: t("settings_section_developer"),
					icon: CodeIcon,
					tile: "#5f45b5",
					count: $pendingTeamInvites.length,
				},
			],
		},
	]);

	// ── The accounts signed in on this device ──────────────────────────────────
	let accounts = $state<StoredAccount[]>([]);
	let showAddAccount = $state(false);
	let addAccountEmail = $state("");
	let addAccountPassword = $state("");
	let addAccountError = $state("");
	let addingAccount = $state(false);

	function rememberCurrentAccount() {
		const user = $currentUser;
		if (!user) return;
		const account = accountForUser(user);
		if (account) accounts = rememberAccount(account);
	}

	$effect(() => {
		const user = $currentUser;
		if (!user) return;
		const account = accountForUser(user);
		if (account) accounts = rememberAccount(account);
	});

	function switchToAccount(account: StoredAccount) {
		if (account.id === $currentUser?.id) return;
		// The account in use may have renewed its tokens since the list was read: keep what's current before leaving it.
		rememberCurrentAccount();
		activateAccount(account);
		void host.switchAccount();
	}

	async function removeSavedAccount(account: StoredAccount) {
		await confirmAction(
			t("settings_accounts_remove_confirm", { name: account.name }),
			t("settings_accounts_remove"),
			async () => {
				accounts = forgetSavedAccount(account.id);
			},
		);
	}

	async function addAccount() {
		if (addingAccount || !addAccountEmail.trim() || !addAccountPassword) return;
		addingAccount = true;
		addAccountError = "";
		try {
			const result = await logInForAccount({ email: addAccountEmail.trim(), password: addAccountPassword });
			const user = result.user;
			accounts = rememberAccount({
				id: user.id,
				name: user.alias ?? user.username,
				username: user.username,
				avatar: user.avatar,
				accessToken: result.token,
				refreshToken: result.sessionToken,
			});
			addAccountEmail = "";
			addAccountPassword = "";
			showAddAccount = false;
			toast(t("settings_accounts_added"), "success");
		} catch (err) {
			addAccountError = err instanceof Error ? err.message : String(err);
		} finally {
			addingAccount = false;
		}
	}

	function signOut() {
		const id = $currentUser?.id;
		if (id) accounts = forgetSavedAccount(id);
		void host.logout();
	}

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
	// The files picked to delete: a checkbox of their own, beside the one the move picker draws while it is open.
	const selectedForDelete = new SvelteSet<string>();
	const selectedDeleteCount = $derived(attachments.filter((a) => selectedForDelete.has(a.id)).length);
	let attachmentsLoadId = 0;

	// The previews of a file in the list: a picture in the chat's viewer, a text file in its read-only dialog.
	let previewOpen = $state(false);
	let previewSrc = $state("");
	let previewAlt = $state("");
	let textPreviewOpen = $state(false);
	let textPreviewSrc = $state("");
	let textPreviewName = $state("");

	function openPreview(src: string, alt: string) {
		previewSrc = src;
		previewAlt = alt;
		previewOpen = true;
	}

	function openTextPreview(src: string, name: string) {
		textPreviewSrc = src;
		textPreviewName = name;
		textPreviewOpen = true;
	}

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
			if (loadId === attachmentsLoadId) attachmentsError = getApiError(err, t("settings_load_failed"));
		} finally {
			if (loadId === attachmentsLoadId) attachmentsLoading = false;
		}
	}

	/** Shows another storage's files. Its picks and kind filters start over. */
	function setAttachmentsLocation(location: string) {
		picker.clear();
		selectedForDelete.clear();
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
		const question = att
			? t("settings_attachment_delete_confirm", { name: att.filename })
			: t("settings_attachment_delete_confirm_unnamed");
		await confirmAction(
			question,
			t("settings_delete"),
			async () => {
				await deleteMyAttachment(id);
				attachments = attachments.filter((a) => a.id !== id);
				selectedForDelete.delete(id);
				await refreshStorageStatus();
			},
			t("settings_delete_busy"),
		);
	}

	async function handleDeleteAll() {
		await confirmAction(
			t("settings_attachments_delete_all_confirm"),
			t("settings_delete"),
			async () => {
				await deleteAllMyAttachments();
				attachments = [];
				selectedForDelete.clear();
				await refreshStorageStatus();
			},
			t("settings_delete_busy"),
		);
	}

	function toggleDeleteSelection(id: string) {
		if (selectedForDelete.has(id)) selectedForDelete.delete(id);
		else selectedForDelete.add(id);
	}

	async function handleDeleteSelected() {
		const ids = attachments.filter((a) => selectedForDelete.has(a.id)).map((a) => a.id);
		if (ids.length === 0) return;
		const count = ids.length;
		await confirmAction(
			t("settings_attachments_delete_selected_confirm", { count }),
			t("settings_delete"),
			async () => {
				const results = await Promise.allSettled(ids.map((id) => deleteMyAttachment(id)));
				const deleted = new Set(ids.filter((_, i) => results[i]?.status === "fulfilled"));
				attachments = attachments.filter((a) => !deleted.has(a.id));
				for (const id of deleted) selectedForDelete.delete(id);
				await refreshStorageStatus();
				const failure = results.find((result) => result.status === "rejected");
				if (failure) throw failure.reason;
			},
			t("settings_delete_busy"),
		);
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
			bucketsError = getApiError(e, t("settings_load_failed"));
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
				bucketsError = getApiError(e, t("settings_save_failed"));
			} finally {
				bucketSaving = false;
			}
		};

		if (editingBucket) {
			await doSave();
		} else {
			await confirmAction(
				t("settings_bucket_add_confirm"),
				t("settings_bucket_add_confirm_button"),
				doSave,
				t("settings_bucket_add_busy"),
			);
		}
	}

	async function handleDeleteBucket(id: string) {
		const b = buckets.find((x) => x.id === id);
		// Gone already (deleted elsewhere): there is nothing to name, or to delete.
		if (!b) return;
		await confirmAction(
			t("settings_bucket_delete_confirm", { name: b.name }),
			t("settings_delete"),
			async () => {
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
			},
			t("settings_delete_busy"),
		);
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
			toast(getApiError(e, t("settings_bucket_toggle_failed")), "error");
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

	/** A bucket's name for a transfer's card; null for one whose name isn't known, and for the default storage (null),
	 * which the card's sentences say in words of their own. */
	function storageLabel(bucketId: string | null): string | null {
		if (bucketId === null) return null;
		return buckets.find((b) => b.id === bucketId)?.name ?? storageTransfers.storageName(bucketId);
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
				toast(t("settings_bucket_no_files", { name: bucket.name }), "info");
				return;
			}
			moveSourceId = bucket.id;
			moveFiles = files;
			moveFilter = {};
			moveOpen = true;
		} catch (err) {
			toast(getApiError(err, t("settings_bucket_files_load_failed")), "error");
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
		storageTransfers.onEnd((transfer) => {
			if (!open || transfer.owner_id !== $currentUser?.id) return;
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
			toast(t("settings_email_verification_sent"), "success");
		} catch (err) {
			toast(getApiError(err, t("settings_email_verification_failed")), "error");
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
			toast(t("settings_password_reset_sent"), "success");
		} catch (err) {
			toast(getApiError(err, t("settings_password_reset_failed")), "error");
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

	// Voice and video state: the microphones and cameras to pick from, looked for when the section opens.
	let mics = $state<MicChoice[]>([]);
	let micsLoaded = $state(false);
	let cameras = $state<CameraChoice[]>([]);
	let camerasLoaded = $state(false);

	async function loadMics() {
		mics = await listMicrophones();
		micsLoaded = true;
	}

	async function loadCameras() {
		cameras = await listCameras();
		camerasLoaded = true;
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
				toast(t("settings_code_theme_reset"), "success");
			} else {
				await loadCustomTheme(url);
				toast(t("settings_code_theme_applied"), "success");
			}
			themeVersion++;
			host.codeThemeChanged(url);
		} catch (e) {
			toast(getApiError(e, t("settings_code_theme_failed")), "error");
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
			toast(t("settings_email_change_sent"), "success");
			newEmail = "";
		} catch (err) {
			toast(getApiError(err, t("settings_email_change_failed")), "error");
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

	// In a window of its own this screen ends with the window, and what was picked with it: the host keeps each pick
	// for the next time, as the web's sheet does by staying mounted (lib/staged-images.ts). What was kept is read as
	// the screen opens; from then on the host is told each pick, and that it is gone once saved or dropped.
	let stagesKnown = $state(false);
	onMount(() => {
		const restore = (kind: "avatar" | "banner", kept: StagedImage | undefined) => {
			if (kept === "remove") handleRemoveImageStage(kind);
			else if (kept) handleImageCropStage(kind, kept);
		};
		void host.stagedImages(USER_SCOPE).then((kept) => {
			// What was picked while this was read stands.
			if (pendingAvatar === null) restore("avatar", kept.avatar);
			if (pendingBanner === null) restore("banner", kept.banner);
			stagesKnown = true;
		});
	});
	$effect(() => {
		const picked = pendingAvatar;
		if (stagesKnown) host.stageImage(USER_SCOPE, "avatar", picked);
	});
	$effect(() => {
		const picked = pendingBanner;
		if (stagesKnown) host.stageImage(USER_SCOPE, "banner", picked);
	});

	// Form state. A screen that mounts open, a window of its own, starts with the account's values: filled only by the
	// effect below, after the first render, the form differed from the account for that render, and the save bar was
	// drawn and slid away each time the window opened.
	const opensAs = untrack(() => (open ? $currentUser : null));
	let username = $state(opensAs?.username ?? "");
	let alias = $state(opensAs?.alias ?? "");
	let bio = $state(opensAs?.custom ?? "");
	let saving = $state(false);
	// How far a new avatar or banner has gone up while the profile saves, in percent, which Save says: null until its
	// first progress, and while nothing new goes up.
	let profileUploadPercent = $state<number | null>(null);
	// A save that failed, kept as it failed: the save bar, which shows in every section, Appearance among them, says it in
	// the language of the moment.
	let saveFailure = $state<{ err: unknown } | null>(null);
	const saveError = $derived(saveFailure ? getApiError(saveFailure.err, t("settings_profile_save_failed")) : null);
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
			saveFailure = null;
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
			toast(t("settings_bot_profile_saved"), "success");
			// Refresh bot user data
			if (app.bot_user_id) {
				const fresh = await getBotUser(app.bot_user_id).catch(() => null);
				if (fresh) botUsers = { ...botUsers, [app.bot_user_id]: fresh };
			}
		} catch (e) {
			toast(getApiError(e, t("settings_bot_profile_save_failed")), "error");
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
			toast(getApiError(e, t("settings_teams_load_failed")), "error");
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
			toast(getApiError(e, t("settings_team_load_failed")), "error");
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
			toast(getApiError(e, t("settings_team_create_failed")), "error");
		} finally {
			devCreatingTeam = false;
		}
	}

	async function handleDeleteTeam(team: Team) {
		await confirmAction(
			t("settings_team_delete_confirm", { name: team.name }),
			t("settings_delete"),
			async () => {
				await deleteTeam(team.id);
				devTeams = devTeams.filter((kept) => kept.id !== team.id);
				if (devSelectedTeam?.id === team.id) {
					devSelectedTeam = null;
					devApps = [];
					devMembers = [];
				}
			},
			t("settings_delete_busy"),
		);
	}

	async function handleSaveTeamEdit() {
		if (!devEditingTeam || !devEditTeamName.trim()) return;
		try {
			const updated = await updateTeam(devEditingTeam.id, devEditTeamName.trim());
			devTeams = devTeams.map((each) => (each.id === updated.id ? updated : each));
			if (devSelectedTeam?.id === updated.id) devSelectedTeam = updated;
			devEditingTeam = null;
		} catch (e) {
			toast(getApiError(e, t("settings_team_save_failed")), "error");
		}
	}

	async function handleInviteMember() {
		if (!devSelectedTeam || !devInviteEmail.trim()) return;
		devInviting = true;
		try {
			await inviteToTeam(devSelectedTeam.id, devInviteEmail.trim());
			toast(t("settings_team_invite_sent"), "success");
			devInviteEmail = "";
		} catch (e) {
			toast(getApiError(e, t("settings_team_invite_failed")), "error");
		} finally {
			devInviting = false;
		}
	}

	async function handleRemoveMember(userId: string, memberName: string) {
		if (!devSelectedTeam) return;
		const teamId = devSelectedTeam.id;
		await confirmAction(
			t("settings_team_member_remove_confirm", { name: memberName }),
			t("settings_team_member_remove"),
			async () => {
				await removeTeamMember(teamId, userId);
				devMembers = devMembers.filter((m) => m.user_id !== userId);
			},
			t("settings_team_member_remove_busy"),
		);
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
			toast(getApiError(e, t("settings_app_create_failed")), "error");
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
			toast(getApiError(e, t("settings_app_save_failed")), "error");
		}
	}

	async function handleTogglePublic(app: Application) {
		if (!devSelectedTeam) return;
		try {
			const updated = await updateApplication(devSelectedTeam.id, app.id, { public: !app.public });
			devApps = devApps.map((a) => (a.id === updated.id ? updated : a));
		} catch (e) {
			toast(getApiError(e, t("settings_app_visibility_failed")), "error");
		}
	}

	async function handleDeleteApp(app: Application) {
		if (!devSelectedTeam) return;
		const teamId = devSelectedTeam.id;
		await confirmAction(
			t("settings_app_delete_confirm", { name: app.name }),
			t("settings_delete"),
			async () => {
				await deleteApplication(teamId, app.id);
				devApps = devApps.filter((a) => a.id !== app.id);
			},
			t("settings_delete_busy"),
		);
	}

	async function handleCreateBot(app: Application) {
		if (!devSelectedTeam) return;
		const teamId = devSelectedTeam.id;
		try {
			const res = await createBot(teamId, app.id);
			devBotToken = res.token;
			devShowToken = true;
			toast(t("settings_bot_created"), "success");
		} catch (e) {
			toast(getApiError(e, t("settings_bot_create_failed")), "error");
			return;
		}
		await loadNewBot(teamId, app.id);
	}

	/** The API answers a new bot with its token alone: its ID comes with the team's apps, read again, then the bot. An
	 * app whose read fails shows its bot once the team is opened again. */
	async function loadNewBot(teamId: string, appId: string) {
		const fresh = (await listApplications(teamId).catch(() => null))?.find((a) => a.id === appId);
		if (!fresh || devSelectedTeam?.id !== teamId) return;
		devApps = devApps.map((a) => (a.id === appId ? fresh : a));
		const botId = fresh.bot_user_id;
		if (!botId) return;
		const bot = await getBotUser(botId).catch(() => null);
		if (bot && devSelectedTeam?.id === teamId) botUsers = { ...botUsers, [botId]: bot };
	}

	async function handleResetBotToken(app: Application) {
		if (!devSelectedTeam) return;
		const teamId = devSelectedTeam.id;
		await confirmAction(
			t("settings_bot_token_reset_confirm"),
			t("settings_bot_token_reset_button"),
			async () => {
				const res = await resetBotToken(teamId, app.id);
				devBotToken = res.token;
				devShowToken = true;
				toast(t("settings_bot_token_reset_done"), "success");
			},
			t("settings_bot_token_reset_busy"),
		);
	}

	async function handleDeleteBot(app: Application) {
		if (!devSelectedTeam) return;
		const teamId = devSelectedTeam.id;
		await confirmAction(
			t("settings_bot_delete_confirm"),
			t("settings_delete"),
			async () => {
				await deleteBot(teamId, app.id);
				devApps = devApps.map((a) => (a.id === app.id ? { ...a, bot_user_id: null, bot_token_hash: null } : a));
				devBotToken = null;
			},
			t("settings_delete_busy"),
		);
	}

	function copyToken() {
		if (devBotToken) {
			navigator.clipboard.writeText(devBotToken);
			toast(t("settings_bot_token_copied"), "success");
		}
	}

	function getBotInviteLink(botUserId: string): string {
		return `${DUVET_DOMAIN}/invite?bot=${botUserId}`;
	}

	function copyBotInviteLink(botUserId: string) {
		navigator.clipboard.writeText(getBotInviteLink(botUserId));
		toast(t("settings_bot_link_copied"), "success");
	}

	async function handleAcceptTeamInvite(inviteId: string) {
		try {
			await answerTeamInvite(inviteId, true);
			toast(t("settings_team_invite_accepted"), "success");
			void loadDevTeams();
		} catch (e) {
			toast(getApiError(e, t("settings_team_invite_accept_failed")), "error");
		}
	}

	async function handleDeclineTeamInvite(inviteId: string) {
		try {
			await answerTeamInvite(inviteId, false);
			toast(t("settings_team_invite_declined"), "success");
		} catch (e) {
			toast(getApiError(e, t("settings_team_invite_decline_failed")), "error");
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
		// Save is disabled while the bio is too long, and its counter says so.
		if (!$currentUser || saving || bioTooLong) return;
		saving = true;
		saveFailure = null;
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
			saveFailure = { err };
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
		saveFailure = null;
	}

	// The shell's layout, saved on this device: the spaces column's mode and where the open chats are listed.
	const themeChoices = $derived<readonly { value: ThemePref; label: string }[]>([
		{ value: "system", label: t("settings_theme_system") },
		{ value: "light", label: t("settings_theme_light") },
		{ value: "dark", label: t("settings_theme_dark") },
	]);
	const platformLayout = defaultMessageLayout();
	const messageLayoutChoices = $derived<readonly { value: MessageLayout; label: string; tag?: string }[]>([
		{
			value: "bubbles",
			label: t("settings_messages_bubbles"),
			tag: platformLayout === "bubbles" ? t("settings_messages_default") : undefined,
		},
		{
			value: "flat",
			label: t("settings_messages_flat"),
			tag: platformLayout === "flat" ? t("settings_messages_default") : undefined,
		},
	]);
	const spacesColumnChoices = $derived<readonly { value: SpacesColumnMode; label: string }[]>([
		{ value: "fixed", label: t("settings_sidebar_fixed") },
		{ value: "auto-hide", label: t("settings_sidebar_auto_hide") },
	]);
	const openChatsChoices = $derived<readonly { value: OpenChatsMode; label: string }[]>([
		{ value: "tabs", label: t("settings_open_chats_tabs") },
		{ value: "vertical", label: t("settings_open_chats_vertical") },
	]);
	const keyboardChoices = $derived<readonly { value: "off" | "on"; label: string }[]>([
		{ value: "off", label: t("settings_keyboard_off") },
		{ value: "on", label: t("settings_keyboard_on") },
	]);
	// Each sound's name, drawn where it's shown.
	const sounds: { key: SoundEvent; label: MessageKey }[] = [
		{ key: "notification", label: "settings_sound_notification" },
		{ key: "join_vc", label: "settings_sound_join_voice" },
		{ key: "leave_vc", label: "settings_sound_leave_voice" },
		{ key: "voice_calling", label: "settings_sound_incoming_call" },
		{ key: "screen_sharing_on", label: "settings_sound_screen_share_on" },
		{ key: "screen_sharing_off", label: "settings_sound_screen_share_off" },
	];

	// A size in megabytes, as a bucket's usage writes it: to so many decimals, without grouping (10240 MB).
	const megabytes = (bytes: number, digits: number) =>
		formatNumber(bytes / (1024 * 1024), {
			minimumFractionDigits: digits,
			maximumFractionDigits: digits,
			useGrouping: false,
		});
	// A whole percent, in the locale's way: 42%, or 42 % in French.
	const percent = (value: number) => formatNumber(value / 100, { style: "percent" });

	// Bubbles or flat rows: the conversation's own preference, which the host reads and sets.
	let messageLayout = $state<MessageLayout>(untrack(() => host.messageLayout()));
	function setMessageLayout(layout: MessageLayout) {
		messageLayout = layout;
		host.setMessageLayout(layout);
	}
</script>

{#snippet strong(text: string)}<strong>{text}</strong>{/snippet}

{#snippet fileCount(text: string)}<span class="text-duvet-ink font-semibold tabular-nums">{text}</span>{/snippet}

{#snippet pathStyleNote(text: string)}<span class="text-duvet-ink2">{text}</span>{/snippet}

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

<SettingsFrame {mode} {chrome} bind:open name={t("settings_name")} groups={sectionGroups} bind:active={activeSection}>
	{#snippet head()}
		<button
			type="button"
			class="rounded-row flex shrink-0 items-center gap-3 p-2.5 text-left transition-colors duration-[120ms] motion-reduce:transition-none {activeSection ===
			'account'
				? 'bg-duvet-accent-tint'
				: 'hover:bg-duvet-sb-hover'}"
			onclick={() => (activeSection = "account")}
		>
			<Avatar
				src={$currentUser ? getAvatarURL($currentUser.id, $currentUser.avatar) : null}
				size={40}
				ring="var(--duvet-sb-ring)"
			/>
			<span class="min-w-0 flex-1">
				<span class="block truncate text-[14.5px] font-semibold">
					{$currentUser?.alias ?? $currentUser?.username ?? ""}
				</span>
				<span class="text-duvet-ink2 block truncate text-[13.5px]">{t("settings_account_caption")}</span>
			</span>
		</button>
	{/snippet}

	{#snippet foot()}
		<button type="button" class={navItemClass(false, true)} onclick={signOut}>
			<span class={NAV_ICON_SLOT}><LogOutIcon size={16} /></span>
			{t("settings_sign_out")}
		</button>
	{/snippet}

	{#snippet bars()}
		<!-- Move bar (appears while files of a location are picked) -->
		{#if activeSection === "attachments" && picking && picker.pickedFiles.length > 0}
			{@const pickedCount = picker.pickedFiles.length}
			{@const tooMany = (picker.filter.attachment_ids?.length ?? 0) > MAX_PICKED_FILES}
			<div transition:slide={{ duration: motionMs(200) }} class={ACTION_BAR}>
				<p class="text-duvet-ink2 min-w-0 truncate">
					{#if myTransfer}
						{t("settings_transfer_wait_notice")}
					{:else if tooMany}
						{t("settings_move_too_many", { max: MAX_PICKED_FILES })}
					{:else}
						{t("settings_move_picked", { count: pickedCount })}
					{/if}
				</p>
				<div class="flex shrink-0 items-center gap-2">
					<Button variant="quiet" onclick={() => picker.picked.clear()}>{t("settings_move_clear")}</Button>
					<Button onclick={openMovePicked} disabled={myTransfer !== null || tooMany}>
						<MoveIcon size={15} />
						{t("settings_move_files", { count: pickedCount, size: formatFileSize(picker.pickedBytes) })}
					</Button>
				</div>
			</div>
		{/if}

		<!-- Save bar (appears when there are unsaved changes) -->
		{#if hasChanges || saveError}
			<div transition:slide={{ duration: motionMs(200) }} class={ACTION_BAR}>
				<div class="flex min-w-0 items-center gap-2">
					{#if saveError}
						<p class="text-duvet-danger truncate" role="alert">{saveError}</p>
					{:else}
						<p class="text-duvet-ink2">{t("settings_unsaved")}</p>
					{/if}
				</div>
				<div class="flex shrink-0 items-center gap-2">
					<Button variant="quiet" onclick={handleReset} disabled={saving}>{t("settings_profile_reset")}</Button>
					<Button onclick={handleSave} disabled={saving || bioTooLong} class="tabular-nums">
						{#if saveSuccess}
							<CheckIcon size={15} />
							{t("settings_saved")}
						{:else if saving}
							{profileUploadPercent === null ? t("settings_saving") : uploadNote(profileUploadPercent)}
						{:else}
							{t("settings_save_changes")}
						{/if}
					</Button>
				</div>
			</div>
		{/if}
	{/snippet}

	{#if activeSection === "account"}
		<SettingsGroup title={t("settings_accounts_title")} note={t("settings_accounts_note")}>
			{#each accounts as account (account.id)}
				{@const current = account.id === $currentUser?.id}
				<div class="flex min-h-[60px] items-center gap-3 px-4 py-3">
					<UserAvatar src={getAvatarURL(account.id, account.avatar)} name={account.name} size={34} />
					<div class="min-w-0 flex-1">
						<p class="text-duvet-ink truncate text-[14.5px] font-medium">{account.name}</p>
						<p class="text-duvet-ink2 truncate text-[13px]">@{account.username}</p>
					</div>
					{#if current}
						<span class="{TAG} bg-duvet-alive/20 text-duvet-alive-text">{t("settings_accounts_current")}</span>
					{:else}
						<Button variant="secondary" size="sm" onclick={() => switchToAccount(account)}>
							{t("settings_accounts_switch")}
						</Button>
						<IconButton
							label={t("settings_accounts_remove_label", { name: account.name })}
							title={t("settings_accounts_remove")}
							danger
							onclick={() => removeSavedAccount(account)}
						>
							<TrashIcon size={16} />
						</IconButton>
					{/if}
				</div>
			{/each}
			<div class="flex items-center justify-end px-4 py-3">
				<Button variant="secondary" size="sm" onclick={() => (showAddAccount = !showAddAccount)}>
					<PlusIcon size={14} />
					{t("settings_accounts_add")}
				</Button>
			</div>
		</SettingsGroup>

		{#if showAddAccount}
			<SettingsGroup title={t("settings_accounts_add_title")} note={t("settings_accounts_add_note")} plain>
				<form
					class="flex flex-col gap-3"
					onsubmit={(event) => {
						event.preventDefault();
						void addAccount();
					}}
				>
					<div>
						<label for="account-email" class={LABEL}>{t("auth_email_label")}</label>
						<input
							id="account-email"
							type="email"
							autocomplete="email"
							bind:value={addAccountEmail}
							class={FIELD}
							placeholder={t("auth_email_placeholder")}
							disabled={addingAccount}
						/>
					</div>
					<div>
						<label for="account-password" class={LABEL}>{t("auth_password_label")}</label>
						<input
							id="account-password"
							type="password"
							autocomplete="current-password"
							bind:value={addAccountPassword}
							class={FIELD}
							placeholder={t("auth_sign_in_password_placeholder")}
							disabled={addingAccount}
						/>
					</div>
					{#if addAccountError}
						<p class={calloutClass("danger")} role="alert">{addAccountError}</p>
					{/if}
					<div class="flex justify-end gap-2">
						<Button
							variant="quiet"
							onclick={() => {
								showAddAccount = false;
								addAccountError = "";
							}}
						>
							{t("settings_cancel")}
						</Button>
						<Button type="submit" disabled={addingAccount || !addAccountEmail.trim() || !addAccountPassword}>
							{addingAccount ? t("auth_sign_in_busy") : t("auth_sign_in")}
						</Button>
					</div>
				</form>
			</SettingsGroup>
		{/if}

		<!-- Profile preview card -->
		<MemberProfileCard
			member={previewMember}
			onAvatarClick={() => (showAvatarCrop = true)}
			onAvatarRemove={() => handleRemoveImageStage("avatar")}
			onBannerClick={() => (showBannerCrop = true)}
			onBannerRemove={() => handleRemoveImageStage("banner")}
		/>

		<SettingsGroup title={t("settings_profile_title")} plain class="flex flex-col gap-4">
			<div>
				<label for="alias" class={LABEL}>{t("settings_display_name")}</label>
				<input
					id="alias"
					type="text"
					bind:value={alias}
					maxlength={32}
					placeholder={$currentUser?.username ?? ""}
					class={FIELD}
				/>
				<p class="text-duvet-ink2 mt-1.5 text-[13px]">{t("settings_display_name_note")}</p>
			</div>

			<div>
				<label for="bio" class={LABEL}>{t("settings_bio_label")}</label>
				<textarea
					id="bio"
					bind:value={bio}
					rows="3"
					placeholder={t("settings_bio_placeholder")}
					aria-invalid={bioTooLong}
					class="{FIELD_AREA} {bioTooLong ? FIELD_WRONG : ''}"
				></textarea>
				<p class="text-duvet-ink2 mt-1 flex justify-between gap-2 text-[13px]">
					<span>{t("settings_bio_note")}</span>
					<span class="tabular-nums {bioTooLong ? 'text-duvet-danger' : ''}"
						>{t("settings_bio_count", { count: bioLength, max: BIO_MAX_LENGTH })}</span
					>
				</p>
			</div>

			<div>
				<label for="username" class={LABEL}>{t("settings_username_label")}</label>
				<input
					id="username"
					type="text"
					bind:value={username}
					maxlength={32}
					placeholder={t("settings_username_placeholder")}
					class={FIELD}
				/>
			</div>
		</SettingsGroup>
	{:else if activeSection === "security"}
		<!-- Email verification -->
		{#if $currentUser && !$currentUser.email_verified}
			<div class="{calloutClass('warn')} items-center">
				<MailIcon size={18} class="shrink-0" />
				<div class="min-w-0 flex-1">
					<p class="font-semibold">{t("settings_email_unverified")}</p>
					<p class="opacity-80">{t("settings_email_unverified_note")}</p>
				</div>
				<Button variant="secondary" size="sm" onclick={handleSendVerification} disabled={sendingVerification}>
					{sendingVerification ? t("settings_sending") : t("settings_email_send_verification")}
				</Button>
			</div>
		{:else if $currentUser?.email_verified}
			<div class="{calloutClass('good')} items-center">
				<MailIcon size={18} class="shrink-0" />
				<p class="font-semibold">{t("settings_email_verified")}</p>
			</div>
		{/if}

		<SettingsGroup title={t("settings_sign_in_title")}>
			<SettingsRow label={t("settings_password_label")} line={t("settings_password_line")} icon={KeyIcon}>
				<Button variant="secondary" size="sm" onclick={handleSendResetPassword} disabled={sendingReset}>
					{sendingReset ? t("settings_sending") : t("settings_password_reset")}
				</Button>
			</SettingsRow>
			<SettingsRow label={t("settings_email_label")} icon={MailIcon} labelFor="new-email" stacked>
				<input
					id="new-email"
					type="email"
					bind:value={newEmail}
					placeholder={t("settings_email_new_placeholder")}
					class="{FIELD} flex-1"
				/>
				<Button variant="secondary" onclick={handleSendChangeEmail} disabled={sendingEmailChange || !newEmail.trim()}>
					{sendingEmailChange ? t("settings_sending") : t("settings_email_send_verification")}
				</Button>
			</SettingsRow>
		</SettingsGroup>
		<p class={NOTE}>{t("settings_email_change_note")}</p>
	{:else if activeSection === "audio"}
		{#snippet soundRow(key: SoundEvent | "master", label: string)}
			{@const value = key === "master" ? audioStore.settings.master : audioStore.settings[key]}
			<SettingsRow {label}>
				{#if key !== "master"}
					<IconButton
						label={previewingSound === key ? t("settings_sound_stop") : t("settings_sound_preview")}
						title={previewingSound === key ? t("settings_sound_stop") : t("settings_sound_preview")}
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
				<span class="text-duvet-ink2 w-10 text-right text-[13px] tabular-nums">{percent(value)}</span>
			</SettingsRow>
		{/snippet}
		<SettingsGroup title={t("settings_sounds_all")}>
			{@render soundRow("master", t("settings_sound_master"))}
		</SettingsGroup>
		<SettingsGroup title={t("settings_sounds_each")}>
			{#each sounds as sound (sound.key)}
				{@render soundRow(sound.key, t(sound.label))}
			{/each}
		</SettingsGroup>
	{:else if activeSection === "voice-video"}
		<VoiceVideoSettings
			micId={$selectedMicId}
			cameraId={$selectedCameraId}
			noiseSuppression={$noiseSuppression}
			{mics}
			{micsLoaded}
			{cameras}
			{camerasLoaded}
			onSelectMic={(id) => selectedMicId.set(id)}
			onSelectCamera={(id) => selectedCameraId.set(id)}
			onToggleNoiseSuppression={(on) => noiseSuppression.set(on)}
			onRefreshMics={loadMics}
			onRefreshCameras={loadCameras}
		/>
	{:else if activeSection === "appearance"}
		<SettingsGroup title={t("settings_theme_title")} plain class="p-0!" note={t("settings_theme_note")}>
			<ChoiceCards
				label={t("settings_theme_title")}
				options={themeChoices}
				value={theme.pref}
				onValueChange={(pref) => setThemePref(parseThemePref(pref))}
				preview={themePreview}
			/>
		</SettingsGroup>

		<SettingsGroup title={t("settings_messages_title")} plain class="p-0!" note={t("settings_messages_note")}>
			<ChoiceCards
				label={t("settings_messages_title")}
				options={messageLayoutChoices}
				value={messageLayout}
				onValueChange={setMessageLayout}
				preview={layoutPreview}
			/>
		</SettingsGroup>

		<SettingsGroup title={t("settings_layout_title")}>
			<SettingsRow label={t("settings_sidebar_label")} line={t("settings_sidebar_line")}>
				<Segmented
					label={t("settings_sidebar_label")}
					options={spacesColumnChoices}
					value={layoutPrefs.spacesColumn}
					onValueChange={(picked) => (layoutPrefs.spacesColumn = picked)}
				/>
			</SettingsRow>
			<SettingsRow label={t("settings_open_chats_label")} line={t("settings_open_chats_line")}>
				<Segmented
					label={t("settings_open_chats_label")}
					options={openChatsChoices}
					value={layoutPrefs.openChats}
					onValueChange={(picked) => (layoutPrefs.openChats = picked)}
				/>
			</SettingsRow>
			<SettingsRow label={t("settings_keyboard_label")} line={t("settings_keyboard_line")}>
				<Segmented
					label={t("settings_keyboard_label")}
					options={keyboardChoices}
					value={layoutPrefs.keyboardNavigation ? "on" : "off"}
					onValueChange={(picked) => (layoutPrefs.keyboardNavigation = picked === "on")}
				/>
			</SettingsRow>
		</SettingsGroup>

		<SettingsGroup title={t("settings_code_title")} plain class="flex flex-col gap-3" note={t("settings_code_note")}>
			<div>
				<label for="code-theme-url" class={LABEL}>{t("settings_code_theme_label")}</label>
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
						{savingTheme ? t("settings_loading") : t("settings_code_theme_apply")}
					</Button>
					{#if codeThemeUrl}
						<Button
							variant="quiet"
							onclick={() => {
								codeThemeUrl = "";
								void handleSaveTheme();
							}}
						>
							{t("settings_code_theme_reset_button")}
						</Button>
					{/if}
				</div>
			</div>
			<!-- Preview -->
			<div>
				<p class={LABEL}>{t("settings_code_preview")}</p>
				{#key themeVersion}
					<p class="msg-content text-duvet-ink text-[14.5px]">
						{@html renderMarkdown(
							'```go\npackage main\n\nimport "fmt"\n\nfunc main() {\n\tnames := []string{"Alice", "Bob"}\n\tfor _, name := range names {\n\t\tfmt.Printf("Hello, %s!\\n", name)\n\t}\n}\n```',
						)}
					</p>
				{/key}
			</div>
		</SettingsGroup>

		<SettingsGroup title={t("settings_voice_title")}>
			<SettingsRow label={t("settings_voice_faces")} line={t("settings_voice_faces_line")}>
				<Toggle label={t("settings_voice_faces")} checked={$voiceFaces} onCheckedChange={(on) => voiceFaces.set(on)} />
			</SettingsRow>
		</SettingsGroup>
	{:else if activeSection === "language"}
		<SettingsGroup>
			<SettingsRow label={t("settings_language_label")} line={t("settings_language_note")} labelFor="app-language">
				<LanguageSelect
					id="app-language"
					value={localePref()}
					offered={OFFERED}
					systemLabel={t("settings_language_system", { language: systemLanguageName() })}
					onValueChange={(value) => void setLocalePref(parseLocalePref(value, OFFERED))}
				/>
			</SettingsRow>
		</SettingsGroup>
	{:else if activeSection === "activity"}
		<SettingsGroup>
			<SettingsRow label={t("settings_activity_spotify")} line={t("settings_activity_spotify_line")}>
				<Toggle
					label={t("settings_activity_spotify")}
					checked={$shareSpotify}
					onCheckedChange={(on) => shareSpotify.set(on)}
				/>
			</SettingsRow>
			<SettingsRow label={t("settings_activity_games")} line={t("settings_activity_games_line")}>
				<Toggle
					label={t("settings_activity_games")}
					checked={$shareGameActivity}
					onCheckedChange={(on) => shareGameActivity.set(on)}
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
					<p class="font-semibold">{t("settings_storage_own")}</p>
					<p class="truncate opacity-80">{activeBucket?.name} · {activeBucket?.bucket_name}</p>
				</div>
				<span class="{TAG} bg-duvet-alive/20 uppercase">{t("settings_storage_no_quota")}</span>
			</div>
		{/if}
		<!-- Default storage quota (always shown) -->
		{#if storageStatus}
			<div class="{CARD} flex flex-col gap-3 p-4">
				<div class="flex items-baseline justify-between gap-3">
					<p class="text-duvet-ink2 text-[14px] font-medium">{t("settings_storage_default")}</p>
					<p class="text-[24px] leading-none font-semibold tabular-nums">
						{formatFileSize(storageStatus.used_bytes)}
						<span class="text-duvet-ink2 text-[14.5px] font-medium">/ {formatFileSize(storageStatus.max_bytes)}</span>
					</p>
				</div>
				{@render usageBar(Math.min(storageStatus.percentage_used, 100))}
				<div class="text-duvet-ink2 flex gap-4 text-[13px]">
					<span>{t("settings_storage_used", { percent: percent(storageStatus.percentage_used) })}</span>
					<span>{t("settings_storage_upload_limit", { size: formatFileSize(storageStatus.upload_limit_bytes) })}</span>
				</div>
			</div>
		{/if}

		<!-- Summary bar: the count on a line of its own, then the location and the buttons at the right, the buttons
		     together on one line, the location above them where a longer language leaves no room beside them (#562). -->
		<div class="flex flex-col gap-2 px-2">
			{#if listedHere}
				<p class="text-duvet-ink2 text-[14px]">
					<Rich key="settings_attachments_count" values={{ count: attachments.length }} tags={{ b: fileCount }} />
					{#if attachmentsLocation !== "all"}
						<span class="mx-1 opacity-60">·</span>
						{formatFileSize(locationBytes)}
					{/if}
				</p>
			{/if}
			<div class="flex flex-wrap items-center justify-end gap-2">
				{#if buckets.length > 0 || attachmentsLocation !== "all"}
					<label class="text-duvet-ink2 flex min-w-0 items-center gap-2 text-[13px]">
						{t("settings_attachments_location")}
						<select
							value={attachmentsLocation}
							onchange={(e) => setAttachmentsLocation(e.currentTarget.value)}
							class="{SELECT} min-w-0"
						>
							<option value="all">{t("settings_attachments_all")}</option>
							<option value={DEFAULT_STORAGE}>{t("settings_storage_default")}</option>
							{#each buckets as b (b.id)}
								<option value={b.id}>{b.name}</option>
							{/each}
						</select>
					</label>
				{/if}
				<div class="flex shrink-0 items-center gap-2">
					<Button variant="warn" size="sm" disabled={selectedDeleteCount === 0} onclick={handleDeleteSelected}>
						<TrashIcon size={13} />
						{t("settings_attachments_delete_selected")}
					</Button>
					{#if attachments.length > 0 && attachmentsLocation === "all"}
						<Button variant="danger" size="sm" onclick={handleDeleteAll}>
							<TrashIcon size={13} />
							{t("settings_attachments_delete_all")}
						</Button>
					{/if}
				</div>
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
				<p class="text-[14.5px]">
					{attachmentsLocation === "all" ? t("settings_attachments_none") : t("settings_attachments_none_here")}
				</p>
			</div>
		{:else}
			<div class="flex flex-col gap-2">
				{#if picking}
					<FilePickerBar {picker} />
				{/if}
				<div class="{CARD} divide-duvet-line divide-y">
					{#each picker.shown as att (att.id)}
						{@const isImage = isImageAttachment(att.content_type)}
						{@const isText = isTextAttachment(att.content_type, att.filename)}
						{@const isAudio = att.content_type.startsWith("audio/")}
						{@const src = `${attachmentHost}${att.url ?? `/attachments/${att.id}`}`}
						<div
							class="group hover:bg-duvet-hover-soft transition-colors motion-reduce:transition-none"
							class:bg-duvet-accent-tint={selectedForDelete.has(att.id)}
						>
							<div class="flex items-center gap-3 px-3.5 py-2.5">
								<input
									type="checkbox"
									checked={selectedForDelete.has(att.id)}
									onchange={() => toggleDeleteSelection(att.id)}
									aria-label={t("settings_attachment_select_delete", { name: att.filename })}
									title={t("settings_attachment_select_delete_title")}
									class={CHECKBOX}
								/>
								{#if picking}
									<!-- A second box, only while files are picked to move, with the move picker's own meaning. -->
									<input
										type="checkbox"
										checked={picker.picked.has(att.id)}
										onchange={() => picker.toggle(att.id)}
										aria-label={t("settings_attachment_select", { name: att.filename })}
										title={t("settings_attachment_select_title")}
										class={CHECKBOX}
									/>
								{/if}
								<!-- Thumbnail: a picture or a text file opens its preview here too, as the magnifier does. -->
								{#if isImage}
									<button
										type="button"
										class="rounded-tile size-10 shrink-0 cursor-zoom-in overflow-hidden transition-[filter] hover:brightness-105 motion-reduce:transition-none {FOCUS_RING}"
										title={t("settings_attachment_preview")}
										aria-label={t("settings_attachment_preview_named", { name: att.filename })}
										onclick={() => openPreview(src, att.filename)}
									>
										<img {src} alt="" class="bg-duvet-secondary-fill size-full object-cover" />
									</button>
								{:else if isText}
									<button
										type="button"
										class="bg-duvet-secondary-fill text-duvet-ink2 rounded-tile hover:bg-duvet-hover-strong grid size-10 shrink-0 place-items-center transition-colors motion-reduce:transition-none {FOCUS_RING}"
										title={t("settings_attachment_preview")}
										aria-label={t("settings_attachment_preview_named", { name: att.filename })}
										onclick={() => openTextPreview(src, att.filename)}
									>
										<PaperclipIcon size={16} />
									</button>
								{:else}
									<div
										class="bg-duvet-secondary-fill text-duvet-ink2 rounded-tile grid size-10 shrink-0 place-items-center"
									>
										{#if isAudio}<MicIcon size={16} />{:else}<PaperclipIcon size={16} />{/if}
									</div>
								{/if}
								<!-- Info -->
								<div class="min-w-0 flex-1">
									<p class="truncate text-[14.5px] font-medium">{att.filename}</p>
									<p class="text-duvet-ink2 text-[13px]">
										{formatFileSize(att.size_bytes)}
										<span class="mx-1 opacity-60">·</span>
										{formatDate(new Date(att.created_at))}
									</p>
								</div>
								<div
									class="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
								>
									{#if isImage || isText}
										<IconButton
											label={t("settings_attachment_preview_named", { name: att.filename })}
											title={t("settings_attachment_preview")}
											onclick={() => (isImage ? openPreview(src, att.filename) : openTextPreview(src, att.filename))}
										>
											<SearchIcon size={16} />
										</IconButton>
									{/if}
									<a
										href={src}
										download={att.filename}
										class={iconButtonClass()}
										title={t("settings_attachment_download")}
										aria-label={t("settings_attachment_download_named", { name: att.filename })}
									>
										<DownloadIcon size={16} />
									</a>
									<IconButton
										label={t("settings_attachment_delete")}
										title={t("settings_attachment_delete")}
										danger
										onclick={() => handleDeleteAttachment(att.id)}
									>
										<TrashIcon size={16} />
									</IconButton>
								</div>
							</div>
							{#if isAudio}
								<div class="px-3.5 pb-2.5">
									<VoiceNotePlayer {src} attachmentId={att.id} compact />
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
			{t("settings_buckets_note")}
		</p>

		{#if !bucketsLoading}
			<div class={calloutClass("warn")}>
				<WarningIcon size={18} class="mt-0.5 shrink-0" />
				<div class="space-y-1">
					<p class="font-semibold">{t("settings_bucket_warning_title")}</p>
					<p><Rich key="settings_bucket_warning_lead" tags={{ b: strong }} /></p>
					<ul class="list-disc space-y-0.5 pl-4">
						<li><Rich key="settings_bucket_warning_owner" tags={{ b: strong }} /></li>
						<li><Rich key="settings_bucket_warning_revoke" tags={{ b: strong }} /></li>
						<li><Rich key="settings_bucket_warning_logged" tags={{ b: strong }} /></li>
					</ul>
				</div>
			</div>
		{/if}

		{#if bucketsError}
			<p class={calloutClass("danger")} role="alert">{bucketsError}</p>
		{/if}

		<!-- Create / Edit form -->
		{#if showBucketForm}
			<SettingsGroup
				title={editingBucket ? t("settings_bucket_edit_title") : t("settings_bucket_new_title")}
				plain
				class="flex flex-col gap-3"
			>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="bucket-name" class={LABEL}>{t("settings_bucket_name")}</label>
						<input
							id="bucket-name"
							type="text"
							bind:value={bName}
							placeholder={t("settings_bucket_name_placeholder")}
							class={FIELD}
						/>
					</div>
					<div>
						<label for="bucket-region" class={LABEL}>{t("settings_bucket_region")}</label>
						<input id="bucket-region" type="text" bind:value={bRegion} placeholder="auto" class={FIELD} />
					</div>
				</div>
				<div>
					<label for="bucket-endpoint" class={LABEL}>{t("settings_bucket_endpoint")}</label>
					<input
						id="bucket-endpoint"
						type="text"
						bind:value={bEndpoint}
						placeholder="https://account-id.r2.cloudflarestorage.com"
						class={FIELD}
					/>
				</div>
				<div>
					<label for="bucket-bucket-name" class={LABEL}>{t("settings_bucket_bucket_name")}</label>
					<input
						id="bucket-bucket-name"
						type="text"
						bind:value={bBucketName}
						placeholder={t("settings_bucket_bucket_name_placeholder")}
						class={FIELD}
					/>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="bucket-access-key" class={LABEL}>{t("settings_bucket_access_key")}</label>
						<input
							id="bucket-access-key"
							type="text"
							bind:value={bAccessKey}
							placeholder={t("settings_bucket_access_key_placeholder")}
							class={FIELD}
						/>
					</div>
					<div>
						<label for="bucket-secret-key" class={LABEL}>{t("settings_bucket_secret_key")}</label>
						<input
							id="bucket-secret-key"
							type="password"
							bind:value={bSecretKey}
							placeholder={editingBucket
								? t("settings_bucket_secret_key_keep")
								: t("settings_bucket_secret_key_placeholder")}
							class={FIELD}
						/>
					</div>
				</div>
				<label class="flex cursor-pointer items-center gap-2">
					<input type="checkbox" bind:checked={bUsePathStyle} class={CHECKBOX} />
					<span class="text-duvet-ink text-[13px]"
						><Rich key="settings_bucket_path_style" tags={{ note: pathStyleNote }} /></span
					>
				</label>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="b-max-bytes" class={LABEL}>{t("settings_bucket_total_limit")}</label>
						<input
							id="b-max-bytes"
							type="number"
							min="0"
							step="1"
							bind:value={bMaxBytesMB}
							placeholder={t("settings_bucket_no_limit")}
							class={FIELD}
						/>
					</div>
					<div>
						<label for="b-upload-limit" class={LABEL}>{t("settings_bucket_file_limit_label")}</label>
						<input
							id="b-upload-limit"
							type="number"
							min="0"
							step="1"
							bind:value={bUploadLimitMB}
							placeholder={t("settings_bucket_no_limit")}
							class={FIELD}
						/>
					</div>
				</div>
				<p class="text-duvet-ink2 text-[13px]">{t("settings_bucket_limits_note")}</p>
				<div class="flex justify-end gap-2 pt-1">
					<Button variant="quiet" onclick={resetBucketForm}>{t("settings_cancel")}</Button>
					<Button disabled={bucketSaving} onclick={handleSaveBucket}>
						{bucketSaving ? t("settings_saving") : editingBucket ? t("settings_bucket_update") : t("settings_create")}
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
					<PlusIcon size={15} />
					{t("settings_bucket_add")}
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
				<p class="text-[14.5px]">{t("settings_buckets_none")}</p>
			</div>
		{:else}
			<div class="{CARD} divide-duvet-line divide-y">
				{#each buckets as bucket (bucket.id)}
					<div
						class="group hover:bg-duvet-hover-soft flex items-center gap-3 px-3.5 py-3 transition-colors motion-reduce:transition-none"
					>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="truncate text-[14.5px] font-medium">{bucket.name}</span>
								{#if bucket.is_active}
									<span class="{TAG} bg-duvet-alive/20 text-duvet-alive-text uppercase"
										>{t("settings_bucket_active")}</span
									>
								{:else}
									<span class="{TAG} bg-duvet-secondary-fill text-duvet-ink2 uppercase"
										>{t("settings_bucket_inactive")}</span
									>
								{/if}
							</div>
							<p class="text-duvet-ink2 mt-0.5 truncate text-[13px]">{bucket.bucket_name} · {bucket.endpoint}</p>
							{#if bucket.max_bytes}
								{@const pct = usagePercent(bucket.used_bytes, bucket.max_bytes)}
								<div class="mt-1.5 space-y-1">
									<div class="text-duvet-ink2 flex items-center justify-between text-[12px] tabular-nums">
										<span
											>{t("settings_bucket_usage", {
												used: megabytes(bucket.used_bytes, 1),
												max: megabytes(bucket.max_bytes, 0),
											})}</span
										>
										<span>{percent(pct)}</span>
									</div>
									{@render usageBar(pct)}
									{#if bucket.upload_limit_bytes}
										<p class="text-duvet-ink2 text-[12px]">
											{t("settings_bucket_file_limit", { size: megabytes(bucket.upload_limit_bytes, 0) })}
										</p>
									{/if}
								</div>
							{:else if bucket.upload_limit_bytes}
								<p class="text-duvet-ink2 mt-0.5 text-[12px]">
									{t("settings_bucket_file_limit", { size: megabytes(bucket.upload_limit_bytes, 0) })}
								</p>
							{/if}
						</div>
						<div
							class="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
						>
							<IconButton
								label={bucket.is_active ? t("settings_bucket_deactivate") : t("settings_bucket_activate")}
								title={bucket.is_active ? t("settings_bucket_deactivate") : t("settings_bucket_activate")}
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
								label={t("settings_bucket_move_files")}
								title={myTransfer ? t("settings_transfer_wait") : t("settings_bucket_move_files")}
								onclick={() => openMoveBucket(bucket)}
								disabled={movingBucketId === bucket.id || myTransfer !== null}
							>
								{#if movingBucketId === bucket.id}
									{@render spinner()}
								{:else}
									<MoveIcon size={16} />
								{/if}
							</IconButton>
							<IconButton label={t("settings_edit")} title={t("settings_edit")} onclick={() => startEditBucket(bucket)}>
								<PencilIcon size={16} />
							</IconButton>
							<IconButton
								label={t("settings_delete")}
								title={t("settings_delete")}
								danger
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
			<SettingsGroup title={t("settings_team_invites_title")}>
				{#each $pendingTeamInvites as invite (invite.id)}
					<SettingsRow
						label={invite.team_name}
						line={t("settings_team_invited_by", { name: invite.invited_by_username })}
						icon={UserPlusIcon}
					>
						<Button size="sm" onclick={() => handleAcceptTeamInvite(invite.id)}
							>{t("settings_team_invite_accept")}</Button
						>
						<Button variant="quiet" size="sm" onclick={() => handleDeclineTeamInvite(invite.id)}
							>{t("settings_team_invite_decline")}</Button
						>
					</SettingsRow>
				{/each}
			</SettingsGroup>
		{/if}

		{#if !devSelectedTeam}
			<p class={NOTE}>{t("settings_teams_note")}</p>

			<div class="flex gap-2">
				<input
					type="text"
					bind:value={devNewTeamName}
					placeholder={t("settings_team_name")}
					aria-label={t("settings_team_name")}
					class="{FIELD} flex-1"
					onkeydown={(e) => e.key === "Enter" && handleCreateTeam()}
				/>
				<Button onclick={handleCreateTeam} disabled={devCreatingTeam || !devNewTeamName.trim()}>
					<PlusIcon size={15} />
					{t("settings_create")}
				</Button>
			</div>

			{#if devLoading}
				<p class="text-duvet-ink2 px-1.5 text-[14.5px]">{t("settings_loading")}</p>
			{:else if devTeams.length === 0}
				<p class="text-duvet-ink2 px-1.5 text-[14.5px]">{t("settings_teams_none")}</p>
			{:else}
				<SettingsGroup title={t("settings_teams_title")}>
					{#each devTeams as team (team.id)}
						<button
							type="button"
							class="hover:bg-duvet-hover-soft flex min-h-[60px] w-full items-center gap-4 px-4 py-3 text-left transition-colors motion-reduce:transition-none"
							onclick={() => selectTeam(team)}
						>
							<span class={ROW_TILE}>
								<UsersIcon size={16} />
							</span>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-[14.5px] font-medium">{team.name}</span>
								<span class="text-duvet-ink2 block truncate text-[13px]">{t("settings_id", { id: team.id })}</span>
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
					class="text-duvet-accent-text flex items-center gap-1 text-[14px] font-medium hover:underline"
					onclick={() => {
						devSelectedTeam = null;
						devApps = [];
						devMembers = [];
						devBotToken = null;
					}}
				>
					<ChevronLeftIcon size={15} />
					{t("settings_teams_back")}
				</button>
			</div>

			<div class="{CARD} flex items-center justify-between gap-3 px-3.5 py-3">
				{#if devEditingTeam?.id === devSelectedTeam.id}
					<div class="flex flex-1 items-center gap-2">
						<input
							type="text"
							bind:value={devEditTeamName}
							aria-label={t("settings_team_name")}
							class="{FIELD_SM} flex-1"
							onkeydown={(e) => e.key === "Enter" && handleSaveTeamEdit()}
						/>
						<Button size="sm" onclick={handleSaveTeamEdit}>{t("settings_save")}</Button>
						<Button variant="quiet" size="sm" onclick={() => (devEditingTeam = null)}>{t("settings_cancel")}</Button>
					</div>
				{:else}
					<h3 class="min-w-0 flex-1 truncate text-[16px] font-semibold">{devSelectedTeam.name}</h3>
					<div class="flex items-center gap-1">
						{#if devSelectedTeam.owner_id === $currentUser?.id}
							<IconButton
								label={t("settings_edit")}
								title={t("settings_edit")}
								onclick={() => {
									devEditingTeam = devSelectedTeam;
									devEditTeamName = devSelectedTeam?.name ?? "";
								}}
							>
								<PencilIcon size={16} />
							</IconButton>
							<IconButton
								label={t("settings_delete")}
								title={t("settings_delete")}
								danger
								onclick={() => devSelectedTeam && handleDeleteTeam(devSelectedTeam)}
							>
								<TrashIcon size={16} />
							</IconButton>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Members -->
			<SettingsGroup title={t("settings_team_members_title")}>
				{#each devMembers as member (member.user_id)}
					<div class="flex min-h-11 items-center justify-between gap-3 px-3.5 py-2">
						<div class="flex min-w-0 items-center gap-2">
							<span class="truncate text-[14.5px] font-medium">{member.username}</span>
							{#if member.role === TeamRole.Admin}
								<span class="{TAG} bg-duvet-secondary-fill text-duvet-ink2">{t("settings_team_admin")}</span>
							{/if}
						</div>
						{#if devSelectedTeam.owner_id === $currentUser?.id && member.user_id !== $currentUser?.id}
							<IconButton
								label={t("settings_team_member_remove")}
								title={t("settings_team_member_remove")}
								size="sm"
								danger
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
							placeholder={t("settings_team_invite_email")}
							aria-label={t("settings_team_invite_email")}
							class="{FIELD_SM} flex-1"
							onkeydown={(e) => e.key === "Enter" && handleInviteMember()}
						/>
						<Button size="sm" onclick={handleInviteMember} disabled={devInviting || !devInviteEmail.trim()}>
							<UserPlusIcon size={14} />
							{t("settings_team_invite")}
						</Button>
					</div>
				{/if}
			</SettingsGroup>

			<!-- Applications -->
			<section class="flex flex-col gap-2">
				<h3 class={GROUP_TITLE}>{t("settings_apps_title")}</h3>
				{#if devAppsLoading}
					<p class="text-duvet-ink2 px-1.5 text-[14.5px]">{t("settings_loading")}</p>
				{:else}
					<div class="flex gap-2">
						<input
							type="text"
							bind:value={devNewAppName}
							placeholder={t("settings_app_name")}
							aria-label={t("settings_app_name")}
							class="{FIELD} flex-1"
							onkeydown={(e) => e.key === "Enter" && handleCreateApp()}
						/>
						<Button onclick={handleCreateApp} disabled={devCreatingApp || !devNewAppName.trim()}>
							<PlusIcon size={15} />
							{t("settings_create")}
						</Button>
					</div>

					{#if devApps.length === 0}
						<p class="text-duvet-ink2 px-1.5 text-[14.5px]">{t("settings_apps_none")}</p>
					{:else}
						<div class="flex flex-col gap-3">
							{#each devApps as app (app.id)}
								<div class="{CARD} p-3.5">
									{#if devEditingApp?.id === app.id}
										<div class="flex flex-col gap-2">
											<input
												type="text"
												bind:value={devEditAppName}
												placeholder={t("settings_app_name")}
												aria-label={t("settings_app_name")}
												class={FIELD}
											/>
											<input
												type="text"
												bind:value={devEditAppDesc}
												placeholder={t("settings_app_description")}
												aria-label={t("settings_app_description")}
												class={FIELD}
											/>
											<div class="flex gap-2">
												<Button size="sm" onclick={handleSaveAppEdit}>{t("settings_save")}</Button>
												<Button variant="quiet" size="sm" onclick={() => (devEditingApp = null)}
													>{t("settings_cancel")}</Button
												>
											</div>
										</div>
									{:else}
										<div class="flex items-start justify-between gap-3">
											<div class="min-w-0">
												<p class="truncate text-[14.5px] font-medium">{app.name}</p>
												{#if app.description}
													<p class="text-duvet-ink2 text-[13px]">{app.description}</p>
												{/if}
												<p class="text-duvet-ink2 mt-1 text-[12px] select-text">{t("settings_id", { id: app.id })}</p>
											</div>
											<div class="flex shrink-0 items-center gap-1">
												<IconButton
													label={app.public ? t("settings_app_public") : t("settings_app_private")}
													title={app.public ? t("settings_app_public") : t("settings_app_private")}
													class={app.public ? "text-duvet-alive-text!" : ""}
													onclick={() => handleTogglePublic(app)}
												>
													{#if app.public}
														<GlobeIcon size={15} />
													{:else}
														<LockIcon size={15} />
													{/if}
												</IconButton>
												<IconButton
													label={t("settings_edit")}
													title={t("settings_edit")}
													onclick={() => {
														devEditingApp = app;
														devEditAppName = app.name;
														devEditAppDesc = app.description ?? "";
													}}
												>
													<PencilIcon size={16} />
												</IconButton>
												<IconButton
													label={t("settings_delete")}
													title={t("settings_delete")}
													danger
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
														<span class="text-[14px] font-medium">{t("settings_bot_active")}</span>
													</div>
													<div class="flex items-center gap-1">
														<Button variant="quiet" size="sm" onclick={() => handleResetBotToken(app)}>
															<RotateIcon size={13} />
															{t("settings_bot_token_reset")}
														</Button>
														<Button
															variant="quiet"
															size="sm"
															class="text-duvet-danger! hover:bg-duvet-danger/15!"
															onclick={() => handleDeleteBot(app)}
														>
															<TrashIcon size={13} />
															{t("settings_bot_delete")}
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
														placeholder={t("settings_bot_username")}
														aria-label={t("settings_bot_username")}
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
														placeholder={t("settings_bot_display_name")}
														aria-label={t("settings_bot_display_name")}
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
													<span class="text-duvet-ink2 shrink-0 text-[12px]">{t("settings_bot_invite_link")}</span>
													<code
														class="bg-duvet-code-bg text-duvet-ink2 min-w-0 flex-1 truncate rounded-md px-2 py-1 font-mono text-[12px] select-text"
														>{getBotInviteLink(app.bot_user_id ?? "")}</code
													>
													<IconButton
														label={t("settings_copy")}
														title={t("settings_copy")}
														size="sm"
														onclick={() => copyBotInviteLink(app.bot_user_id ?? "")}
													>
														<CopyIcon size={13} />
													</IconButton>
												</div>
												{#if hasActiveBucket}
													{@const botU = app.bot_user_id ? botUsers[app.bot_user_id] : null}
													<div class="border-duvet-line mt-3 border-t pt-3">
														<p class="text-duvet-ink2 mb-2 text-[12px]">{t("settings_bot_appearance")}</p>
														<div class="flex items-center gap-3">
															<!-- Avatar -->
															<div class="group relative">
																{#if botAvatarPreview}
																	<img src={botAvatarPreview} alt="" class="size-12 rounded-[28%] object-cover" />
																	<button
																		class="bg-duvet-media-scrim absolute inset-0 flex items-center justify-center rounded-[28%] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
																		onclick={clearBotAvatar}
																		title={t("settings_bot_image_undo")}
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
																		class="bg-duvet-media-scrim absolute inset-0 flex items-center justify-center rounded-[28%] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
																		onclick={() => {
																			pendingBotAvatar = null;
																		}}
																		title={t("settings_bot_image_undo")}
																	>
																		<RotateIcon class="text-fixed-white size-4" />
																	</button>
																{:else if botU?.avatar}
																	<img
																		src={getAvatarURL(botU.id, botU.avatar)}
																		alt=""
																		class="size-12 rounded-[28%] object-cover"
																	/>
																	<div
																		class="bg-duvet-media-scrim absolute inset-0 flex items-center justify-center gap-1 rounded-[28%] opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
																	>
																		<button
																			class="text-fixed-white hover:bg-fixed-white/20 rounded p-0.5"
																			onclick={() => {
																				botCropTargetApp = app;
																				showBotAvatarCrop = true;
																			}}
																			title={t("settings_bot_image_change")}><PencilIcon class="size-3.5" /></button
																		>
																		<button
																			class="hover:bg-fixed-white/20 text-duvet-call-red-ink rounded p-0.5"
																			onclick={removeBotAvatar}
																			title={t("settings_bot_image_remove")}><TrashIcon class="size-3.5" /></button
																		>
																	</div>
																{:else}
																	<button
																		class="bg-duvet-secondary-fill text-duvet-accent-text hover:bg-duvet-hover-strong flex size-12 items-center justify-center rounded-[28%] transition-colors motion-reduce:transition-none"
																		onclick={() => {
																			botCropTargetApp = app;
																			showBotAvatarCrop = true;
																		}}
																		title={t("settings_bot_avatar_set")}
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
																		alt=""
																		class="rounded-tile aspect-[5/2] h-12 object-cover"
																	/>
																	<button
																		class="bg-duvet-media-scrim rounded-tile absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
																		onclick={clearBotBanner}
																		title={t("settings_bot_image_undo")}
																	>
																		<XIcon class="text-fixed-white size-4" />
																	</button>
																{:else if pendingBotBanner === "remove"}
																	<div
																		class="bg-duvet-secondary-fill text-duvet-ink2 rounded-tile flex aspect-[5/2] h-12 items-center justify-center"
																	>
																		<XIcon class="size-4" />
																	</div>
																	<button
																		class="bg-duvet-media-scrim rounded-tile absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
																		onclick={() => {
																			pendingBotBanner = null;
																		}}
																		title={t("settings_bot_image_undo")}
																	>
																		<RotateIcon class="text-fixed-white size-4" />
																	</button>
																{:else if botU?.banner}
																	<img
																		src={getAvatarURL(botU.id, botU.banner)}
																		alt=""
																		class="rounded-tile aspect-[5/2] h-12 object-cover"
																	/>
																	<div
																		class="bg-duvet-media-scrim rounded-tile absolute inset-0 flex items-center justify-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
																	>
																		<button
																			class="text-fixed-white hover:bg-fixed-white/20 rounded p-0.5"
																			onclick={() => {
																				botCropTargetApp = app;
																				showBotBannerCrop = true;
																			}}
																			title={t("settings_bot_image_change")}><PencilIcon class="size-3.5" /></button
																		>
																		<button
																			class="hover:bg-fixed-white/20 text-duvet-call-red-ink rounded p-0.5"
																			onclick={removeBotBanner}
																			title={t("settings_bot_image_remove")}><TrashIcon class="size-3.5" /></button
																		>
																	</div>
																{:else}
																	<button
																		class="bg-duvet-secondary-fill text-duvet-accent-text hover:bg-duvet-hover-strong rounded-tile flex aspect-[5/2] h-12 items-center justify-center transition-colors motion-reduce:transition-none"
																		onclick={() => {
																			botCropTargetApp = app;
																			showBotBannerCrop = true;
																		}}
																		title={t("settings_bot_banner_set")}
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
																		? t("settings_saving")
																		: uploadNote(botUploadPercent)
																	: t("settings_save_changes")}
															</Button>
														{/if}
													</div>
												{/if}
											{:else}
												<Button size="sm" onclick={() => handleCreateBot(app)}>
													<BotIcon size={14} />
													{t("settings_bot_create")}
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
							<p class="font-semibold">{t("settings_bot_token_warning")}</p>
							<div class="flex items-center gap-2">
								<code
									class="bg-duvet-code-bg text-duvet-ink min-w-0 flex-1 rounded-md px-3 py-2 font-mono text-[13px] break-all select-text"
									>{devShowToken ? devBotToken : "•".repeat(40)}</code
								>
								<IconButton
									label={devShowToken ? t("settings_bot_token_hide") : t("settings_bot_token_show")}
									title={devShowToken ? t("settings_bot_token_hide") : t("settings_bot_token_show")}
									onclick={() => (devShowToken = !devShowToken)}
								>
									{#if devShowToken}<EyeOffIcon size={16} />{:else}<EyeIcon size={16} />{/if}
								</IconButton>
								<IconButton label={t("settings_copy")} title={t("settings_copy")} onclick={copyToken}>
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

<ImagePreview src={previewSrc} alt={previewAlt} bind:open={previewOpen} />
<TextFilePreview bind:open={textPreviewOpen} filename={textPreviewName} src={textPreviewSrc} />

<ImageCropModal
	bind:open={showAvatarCrop}
	title={t("settings_avatar_change")}
	aspect={1}
	round
	targetWidth={256}
	targetHeight={256}
	onConfirm={(f) => handleImageCropStage("avatar", f)}
/>
<ImageCropModal
	bind:open={showBannerCrop}
	title={t("settings_banner_change")}
	aspect={5 / 2}
	targetWidth={600}
	targetHeight={240}
	onConfirm={(f) => handleImageCropStage("banner", f)}
/>
<ImageCropModal
	bind:open={showBotAvatarCrop}
	title={t("settings_bot_avatar_change")}
	aspect={1}
	round
	targetWidth={256}
	targetHeight={256}
	onConfirm={(f) => onBotAvatarCrop(f)}
/>
<ImageCropModal
	bind:open={showBotBannerCrop}
	title={t("settings_bot_banner_change")}
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
