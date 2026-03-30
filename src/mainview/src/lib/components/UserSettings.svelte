<script lang="ts">
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
	} from "@lucide/svelte";
	import { Dialog } from "bits-ui";
	import { slide } from "svelte/transition";
	import { currentUser, channelMessages, gatewaySpaces, dmMessages, conversations } from "$lib/stores.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import MemberProfileCard from "$lib/components/MemberProfileCard.svelte";
	import ImageCropModal from "$lib/components/ImageCropModal.svelte";
	import api from "$lib/api/api";
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
	} from "$lib/api/user";
	import { getHostURL, getAvatarURL } from "$lib/common/common";
	import { confirmAction } from "$lib/stores/confirm.svelte";
	import { toast } from "$lib/stores/toast.svelte";
	import { sendVerificationEmail, sendResetPasswordEmail, sendChangeEmail, logout } from "$lib/api/auth";
	import { audioStore, type SoundEvent } from "$lib/stores/audio.svelte";
	import VoiceNotePlayer from "$lib/components/VoiceNotePlayer.svelte";

	let {
		open = $bindable(false),
	}: {
		open?: boolean;
	} = $props();

	type Section = "account" | "security" | "audio" | "attachments" | "buckets";
	let activeSection = $state<Section>("account");

	// Attachments state
	const attachmentHost = getHostURL();
	let attachments = $state<UserAttachment[]>([]);
	let attachmentsLoading = $state(false);
	let attachmentsError = $state<string | null>(null);
	let storageStatus = $state<StorageStatus | null>(null);

	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	async function loadAttachments() {
		attachmentsLoading = true;
		attachmentsError = null;
		try {
			[attachments, storageStatus, buckets] = await Promise.all([
				getMyAttachments(),
				getMyStorageStatus(),
				getMyBuckets(),
			]);
		} catch (err) {
			attachmentsError = err instanceof Error ? err.message : "Failed to load";
		} finally {
			attachmentsLoading = false;
		}
	}

	async function refreshStorageStatus() {
		try {
			storageStatus = await getMyStorageStatus();
		} catch {}
	}

	async function handleDeleteAttachment(id: string) {
		const att = attachments.find((a) => a.id === id);
		const name = att?.filename ?? "this file";
		await confirmAction(`Delete "${name}"?`, "Deleting", async () => {
			await deleteMyAttachment(id);
			attachments = attachments.filter((a) => a.id !== id);
			await refreshStorageStatus();
		});
	}

	async function handleDeleteAll() {
		await confirmAction("Delete all your attachments? This cannot be undone.", "Deleting", async () => {
			await deleteAllMyAttachments();
			attachments = [];
			await refreshStorageStatus();
		});
	}

	// Buckets state
	let buckets = $state<StorageBucket[]>([]);
	const hasActiveBucket = $derived(buckets.some((b) => b.is_active));
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
		} catch (e) {
			bucketsError = e instanceof Error ? e.message : "Failed to load";
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
				bucketsError = e instanceof Error ? e.message : "Failed to save";
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
		await confirmAction(`Delete bucket "${b?.name}"?`, "Deleting", async () => {
			await deleteMyBucket(id);
			await loadBuckets();
		});
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
			toast(e instanceof Error ? e.message : "Failed to toggle bucket", "error");
		} finally {
			togglingBucketId = null;
		}
	}

	// Verification state
	let sendingVerification = $state(false);

	async function handleSendVerification() {
		sendingVerification = true;
		try {
			await sendVerificationEmail();
			toast("Verification email sent! Check your inbox.", "success");
		} catch (err) {
			toast(err instanceof Error ? err.message : "Failed to send verification email", "error");
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
			toast(err instanceof Error ? err.message : "Failed to send reset password email", "error");
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
			toast(err instanceof Error ? err.message : "Failed to send email change request", "error");
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
	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let saveSuccess = $state(false);

	// Sync from currentUser when modal opens
	$effect(() => {
		if (open && $currentUser) {
			username = $currentUser.username ?? "";
			alias = $currentUser.alias ?? "";
			saveError = null;
			saveSuccess = false;
		}
	});

	// Load attachments when switching to that section
	$effect(() => {
		if (open && activeSection === "attachments") {
			void loadAttachments();
		}
	});

	$effect(() => {
		if (open && activeSection === "buckets") {
			void loadBuckets();
		}
	});

	const previewMember = $derived({
		id: $currentUser?.id ?? "",
		member_id: "",
		username: alias.trim() || username || $currentUser?.username || "",
		raw_username: username || $currentUser?.username || "",
		avatar_url: pendingAvatar === "remove"
			? null
			: pendingAvatarPreview ?? ($currentUser ? getAvatarURL($currentUser.id, $currentUser.avatar) : null),
		banner_url: pendingBanner === "remove"
			? null
			: pendingBannerPreview ?? ($currentUser ? getAvatarURL($currentUser.id, $currentUser.banner) : null),
		status: "online" as const,
		is_bot: false,
		is_owner: false,
		roles: [] as import("$lib/types").Role[],
	});

	const hasChanges = $derived(
		$currentUser !== null &&
			(username !== ($currentUser.username ?? "") ||
				alias !== ($currentUser.alias ?? "") ||
				hasImageChanges),
	);

	async function handleSave() {
		if (!$currentUser || saving) return;
		saving = true;
		saveError = null;
		saveSuccess = false;

		try {
			let updated: any;

			if (hasImageChanges) {
				const form = new FormData();
				form.append("username", username.trim() || $currentUser!.username);
				form.append("alias", alias.trim() || "");

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

				const res = await api.patch("/api/users/@me", form);
				updated = res.data;
			} else {
				updated = await updateUser({
					username: username.trim() || $currentUser!.username,
					alias: alias.trim() || null,
				});
			}

			resetImageStages();

			currentUser.update((u) =>
				u
					? {
							...u,
							username: updated.username,
							alias: updated.alias ?? null,
							avatar: updated.avatar ?? null,
							banner: updated.banner ?? null,
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
			saveError = err instanceof Error ? err.message : "Failed to save changes";
		} finally {
			saving = false;
		}
	}

	function handleReset() {
		if (!$currentUser) return;
		username = $currentUser.username ?? "";
		alias = $currentUser.alias ?? "";
		resetImageStages();
		saveError = null;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-500 bg-black/70 backdrop-blur-sm" />
		<Dialog.Content class="fixed inset-0 z-501 flex items-center justify-center p-4">
			<div
				class="flex h-[85vh] w-full max-w-3xl overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-100 shadow-2xl"
			>
				<!-- Left sidebar -->
				<aside class="flex w-52 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 py-6">
					<div class="mb-3 px-4">
						<p class="text-xxs mb-1 px-2 font-bold tracking-widest text-zinc-400 uppercase">User Settings</p>
					</div>
					<nav class="flex flex-col gap-0.5 px-2">
						<button
							class="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-medium transition-colors
								{activeSection === 'account' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
							onclick={() => (activeSection = "account")}
						>
							<UserIcon class="size-4 shrink-0" />
							My Account
						</button>
						<button
							class="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-medium transition-colors
								{activeSection === 'attachments' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
							onclick={() => (activeSection = "attachments")}
						>
							<PaperclipIcon class="size-4 shrink-0" />
							Attachments
						</button>
						<button
							class="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-medium transition-colors
								{activeSection === 'security' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
							onclick={() => (activeSection = "security")}
						>
							<ShieldIcon class="size-4 shrink-0" />
							Security
						</button>
						<button
							class="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-medium transition-colors
								{activeSection === 'audio' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
							onclick={() => (activeSection = "audio")}
						>
							<VolumeIcon class="size-4 shrink-0" />
							Audio
						</button>
						<button
							class="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-medium transition-colors
								{activeSection === 'buckets' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
							onclick={() => (activeSection = "buckets")}
						>
							<DatabaseIcon class="size-4 shrink-0" />
							S3 Buckets
						</button>
					</nav>
					<div class="mt-auto px-2 pb-4">
						<button
							class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-medium text-red-400 transition-colors hover:bg-red-600/10 hover:text-red-300"
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
					<div class="flex shrink-0 items-center justify-between border-b border-zinc-800 px-6 py-4">
						<h2 class="text-base font-semibold text-white">
							{#if activeSection === "account"}My Account{:else if activeSection === "security"}Security{:else if activeSection === "audio"}Audio{:else if activeSection === "attachments"}Attachments{:else if activeSection === "buckets"}S3
								Buckets{/if}
						</h2>
						<Dialog.Close
							class="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
						>
							<XIcon class="size-4" />
						</Dialog.Close>
					</div>

					<!-- Scrollable content -->
					<div class="flex-1 space-y-6 overflow-y-auto px-6 py-6">
						{#if activeSection === "account"}
							<!-- Profile preview card -->
							<MemberProfileCard
								member={previewMember}
								editable
								onAvatarClick={() => (showAvatarCrop = true)}
								onAvatarRemove={() => handleRemoveImageStage("avatar")}
								onBannerClick={() => (showBannerCrop = true)}
								onBannerRemove={() => handleRemoveImageStage("banner")}
							/>

							<!-- Form fields -->
							<div class="space-y-5">
								<!-- Display name -->
								<div>
									<label for="alias" class="mb-1.5 block text-xs font-semibold tracking-wide text-zinc-400 uppercase">
										Display Name
									</label>
									<input
										id="alias"
										type="text"
										bind:value={alias}
										maxlength={32}
										placeholder={$currentUser?.username ?? ""}
										class="focus-override h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 transition-colors outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
									/>
									<p class="mt-1 text-xs text-zinc-500">
										This is how others see you. Leave empty to use your username.
									</p>
								</div>

								<!-- Username -->
								<div>
									<label
										for="username"
										class="mb-1.5 block text-xs font-semibold tracking-wide text-zinc-400 uppercase"
									>
										Username
									</label>
									<input
										id="username"
										type="text"
										bind:value={username}
										maxlength={32}
										placeholder="username"
										class="focus-override h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 transition-colors outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
									/>
								</div>


							</div>
						{:else if activeSection === "security"}
							<!-- Email verification -->
							{#if $currentUser && !$currentUser.email_verified}
								<div class="flex items-center gap-3 rounded-lg border border-amber-600/30 bg-amber-950/20 px-4 py-3">
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
										class="shrink-0 text-amber-500"
									>
										<rect width="20" height="16" x="2" y="4" rx="2" />
										<path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
									</svg>
									<div class="min-w-0 flex-1">
										<p class="text-sm font-medium text-amber-300">Email not verified</p>
										<p class="text-xs text-amber-400/60">Verify your email to secure your account.</p>
									</div>
									<button
										onclick={handleSendVerification}
										disabled={sendingVerification}
										class="shrink-0 rounded-md bg-amber-600/20 px-3 py-1.5 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-600/30 disabled:opacity-50"
									>
										{sendingVerification ? "Sending..." : "Send verification"}
									</button>
								</div>
							{:else if $currentUser?.email_verified}
								<div class="flex items-center gap-3 rounded-lg border border-emerald-800/50 bg-emerald-900/20 px-4 py-3">
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
										class="shrink-0 text-emerald-400"
									>
										<rect width="20" height="16" x="2" y="4" rx="2" />
										<path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
									</svg>
									<p class="text-sm font-medium text-emerald-300">Email verified</p>
								</div>
							{/if}

							<!-- Password -->
							<div class="rounded-lg border border-zinc-800 bg-zinc-800/40 px-4 py-4">
								<div class="flex items-center justify-between">
									<div>
										<p class="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Password</p>
										<p class="mt-1 text-xs text-zinc-500">Send a reset link to your email to change your password.</p>
									</div>
									<button
										onclick={handleSendResetPassword}
										disabled={sendingReset}
										class="shrink-0 rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:bg-zinc-600 disabled:opacity-50"
									>
										{sendingReset ? "Sending..." : "Reset password"}
									</button>
								</div>
							</div>

							<!-- Change email -->
							<div class="rounded-lg border border-zinc-800 bg-zinc-800/40 px-4 py-4">
								<p class="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Email</p>
								<p class="mt-1 text-xs text-zinc-500">
									Current: <span class="text-zinc-300">{$currentUser?.email ?? "—"}</span>
								</p>
								<div class="mt-3 flex items-center gap-2">
									<input
										type="email"
										bind:value={newEmail}
										placeholder="New email address"
										class="h-9 flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
									/>
									<button
										onclick={handleSendChangeEmail}
										disabled={sendingEmailChange || !newEmail.trim()}
										class="shrink-0 rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:bg-zinc-600 disabled:opacity-50"
									>
										{sendingEmailChange ? "Sending..." : "Send verification"}
									</button>
								</div>
								<p class="mt-2 text-xs text-zinc-600">A verification link will be sent to the new address.</p>
							</div>
						{:else if activeSection === "audio"}
							{@const sliders: { key: SoundEvent | "master"; label: string }[] = [
								{ key: "master", label: "Master Volume" },
								{ key: "notification", label: "Mentions" },
								{ key: "join_vc", label: "Join Voice" },
								{ key: "leave_vc", label: "Leave Voice" },
								{ key: "voice_calling", label: "Incoming Call" },
								{ key: "screen_sharing_on", label: "Screen Share On" },
								{ key: "screen_sharing_off", label: "Screen Share Off" },
							]}
							<div class="space-y-4">
								{#each sliders as { key, label } (key)}
									{@const value = key === "master" ? audioStore.settings.master : audioStore.settings[key]}
									<div class="rounded-lg border border-zinc-800 bg-zinc-800/40 px-4 py-3">
										<div class="mb-2 flex items-center justify-between">
											<span class="text-sm font-medium text-zinc-200">{label}</span>
											<span class="text-xs tabular-nums text-zinc-500">{value}%</span>
										</div>
										<div class="flex items-center gap-3">
											<input
												type="range"
												min="0"
												max="200"
												step="1"
												value={value}
												oninput={(e) => {
													const v = parseInt((e.target as HTMLInputElement).value);
													if (key === "master") {
														audioStore.setMaster(v);
													} else {
														audioStore.set(key, v);
													}
												}}
												class="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-700 accent-stone-500 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-stone-400"
											/>
											{#if key !== "master"}
												<button
													class="shrink-0 rounded p-1 transition-colors hover:bg-zinc-700 {previewingSound === key ? 'text-stone-400' : 'text-zinc-500 hover:text-zinc-200'}"
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
						{:else if activeSection === "attachments"}
							<!-- Active custom bucket banner -->
							{#if hasActiveBucket}
								{@const activeBucket = buckets.find((b) => b.is_active)}
								<div
									class="flex items-center gap-3 rounded-lg border border-emerald-800/50 bg-emerald-900/20 px-4 py-3"
								>
									<DatabaseIcon class="size-5 shrink-0 text-emerald-400" />
									<div class="min-w-0 flex-1">
										<p class="text-sm font-medium text-emerald-300">Using your own storage</p>
										<p class="truncate text-xs text-emerald-400/60">
											{activeBucket?.name} · {activeBucket?.bucket_name}
										</p>
									</div>
									<span class="text-xxs shrink-0 rounded bg-emerald-600/20 px-1.5 py-0.5 font-semibold text-emerald-400"
										>NO QUOTA</span
									>
								</div>
							{/if}
							<!-- Default storage quota (always shown) -->
							{#if storageStatus}
								<div class="space-y-3 rounded-lg border border-zinc-800 bg-zinc-800/40 px-4 py-4">
									<div class="flex items-center justify-between">
										<p class="text-sm font-semibold text-white">Default Storage</p>
										<p class="text-xs text-zinc-400">
											{formatFileSize(storageStatus.used_bytes)} / {formatFileSize(storageStatus.max_bytes)}
										</p>
									</div>
									<!-- Progress bar -->
									<div class="h-2 w-full overflow-hidden rounded-full bg-zinc-700">
										<div
											class="h-full rounded-full transition-all duration-300 {storageStatus.percentage_used > 90
												? 'bg-red-500'
												: storageStatus.percentage_used > 70
													? 'bg-yellow-500'
													: 'bg-stone-500'}"
											style="width: {Math.min(storageStatus.percentage_used, 100)}%"
										></div>
									</div>
									<div class="flex gap-4 text-xs text-zinc-500">
										<span>{storageStatus.percentage_used}% used</span>
										<span>Upload limit: {formatFileSize(storageStatus.upload_limit_bytes)} per file</span>
									</div>
								</div>
							{/if}

							<!-- Summary bar -->
							<div class="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-800/40 px-4 py-3">
								<div class="text-sm text-zinc-300">
									<span class="font-semibold text-white">{attachments.length}</span>
									file{attachments.length !== 1 ? "s" : ""}
								</div>
								{#if attachments.length > 0}
									<button
										onclick={handleDeleteAll}
										class="flex items-center gap-1.5 rounded-md bg-red-600/20 px-3 py-1.5 text-xs font-semibold text-red-400 transition-colors hover:bg-red-600/30"
									>
										<TrashIcon class="size-3.5" />
										Delete All
									</button>
								{/if}
							</div>

							{#if attachmentsError}
								<p class="rounded-md bg-red-400/10 px-3 py-2 text-sm text-red-400">
									{attachmentsError}
								</p>
							{/if}

							{#if attachmentsLoading}
								<div class="space-y-2">
									{#each Array(5) as _}
										<div class="h-14 animate-pulse rounded-lg bg-zinc-800/40"></div>
									{/each}
								</div>
							{:else if attachments.length === 0}
								<div class="flex flex-col items-center justify-center py-16 text-zinc-500">
									<PaperclipIcon class="mb-3 size-10" />
									<p class="text-sm">No attachments yet</p>
								</div>
							{:else}
								<div class="space-y-1">
									{#each attachments as att (att.id)}
										{@const isImage = att.content_type.startsWith("image/")}
										{@const isAudio = att.content_type.startsWith("audio/")}
										<div
											class="group rounded-lg border border-zinc-800 bg-zinc-800/30 transition-colors hover:bg-zinc-800/50"
										>
											<div class="flex items-center gap-3 px-3 py-2.5">
												<!-- Thumbnail -->
												{#if isImage}
													<img
														src="{attachmentHost}/attachments/{att.id}"
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
												<!-- Info -->
												<div class="min-w-0 flex-1">
													<p class="truncate text-sm text-zinc-200">
														{att.filename}
													</p>
													<p class="text-xs text-zinc-500">
														{formatFileSize(att.size_bytes)}
														<span class="mx-1 text-zinc-600">·</span>
														{new Date(att.created_at).toLocaleDateString()}
													</p>
												</div>
												<!-- Download -->
												<a
													href="{attachmentHost}/attachments/{att.id}"
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
												<!-- Delete -->
												<button
													onclick={() => handleDeleteAttachment(att.id)}
													class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-600/20 hover:text-red-400"
													title="Delete attachment"
												>
													<TrashIcon class="size-4" />
												</button>
											</div>
											{#if isAudio}
												<div class="px-3 pb-2.5">
													<VoiceNotePlayer src="{attachmentHost}/attachments/{att.id}" compact />
												</div>
											{/if}
										</div>
									{/each}
								</div>
							{/if}
						{:else if activeSection === "buckets"}
							<p class="mb-4 text-xs text-zinc-500">
								Connect your own S3/R2 buckets for unlimited storage. When a bucket is active, uploads go to your bucket
								instead of the default and quota limits don't apply.
							</p>

							{#if !bucketsLoading}
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
								<p class="mb-4 rounded-md bg-red-400/10 px-3 py-2 text-sm text-red-400">
									{bucketsError}
								</p>
							{/if}

							<!-- Create / Edit form -->
							{#if showBucketForm}
								<div class="mb-4 space-y-3 rounded-lg border border-zinc-800 bg-zinc-800/40 p-4">
									<h3 class="text-sm font-semibold text-white">
										{editingBucket ? "Edit Bucket" : "New Bucket"}
									</h3>
									<div class="grid grid-cols-2 gap-3">
										<div>
											<label for="bucket-name" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase"
												>Name</label
											>
											<input
												id="bucket-name"
												type="text"
												bind:value={bName}
												placeholder="My R2"
												class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500"
											/>
										</div>
										<div>
											<label for="bucket-region" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase"
												>Region</label
											>
											<input
												id="bucket-region"
												type="text"
												bind:value={bRegion}
												placeholder="auto"
												class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500"
											/>
										</div>
									</div>
									<div>
										<label for="bucket-endpoint" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase"
											>Endpoint</label
										>
										<input
											id="bucket-endpoint"
											type="text"
											bind:value={bEndpoint}
											placeholder="https://account-id.r2.cloudflarestorage.com"
											class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500"
										/>
									</div>
									<div>
										<label for="bucket-bucket-name" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase"
											>Bucket Name</label
										>
										<input
											id="bucket-bucket-name"
											type="text"
											bind:value={bBucketName}
											placeholder="my-bucket"
											class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500"
										/>
									</div>
									<div class="grid grid-cols-2 gap-3">
										<div>
											<label for="bucket-access-key" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase"
												>Access Key ID</label
											>
											<input
												id="bucket-access-key"
												type="text"
												bind:value={bAccessKey}
												placeholder="access key"
												class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500"
											/>
										</div>
										<div>
											<label for="bucket-secret-key" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase"
												>Secret Access Key</label
											>
											<input
												id="bucket-secret-key"
												type="password"
												bind:value={bSecretKey}
												placeholder={editingBucket ? "leave empty to keep current" : "secret key"}
												class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500"
											/>
										</div>
									</div>
									<label class="flex cursor-pointer items-center gap-2">
										<input
											type="checkbox"
											bind:checked={bUsePathStyle}
											class="size-4 rounded border-zinc-600 bg-zinc-800 accent-stone-500"
										/>
										<span class="text-xs text-zinc-400"
											>Use path-style addressing <span class="text-zinc-600">(required for MinIO, RustFS, etc.)</span
											></span
										>
									</label>
									<div class="grid grid-cols-2 gap-3">
										<div>
											<label for="b-max-bytes" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase"
												>Total Limit (MB)</label
											>
											<input
												id="b-max-bytes"
												type="number"
												min="0"
												step="1"
												bind:value={bMaxBytesMB}
												placeholder="No limit"
												class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500"
											/>
										</div>
										<div>
											<label for="b-upload-limit" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase"
												>Per-file Limit (MB)</label
											>
											<input
												id="b-upload-limit"
												type="number"
												min="0"
												step="1"
												bind:value={bUploadLimitMB}
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
											onclick={resetBucketForm}>Cancel</button
										>
										<button
											class="rounded-md bg-stone-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-stone-500 disabled:opacity-50"
											disabled={bucketSaving}
											onclick={handleSaveBucket}
										>
											{bucketSaving ? "Saving..." : editingBucket ? "Update" : "Create"}
										</button>
									</div>
								</div>
							{:else}
								<button
									class="mb-4 flex items-center gap-2 rounded-md bg-stone-600/20 px-3 py-2 text-sm font-medium text-stone-300 transition-colors hover:bg-stone-600/30"
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
										<div class="h-16 animate-pulse rounded-lg bg-zinc-800/40"></div>
									{/each}
								</div>
							{:else if buckets.length === 0}
								<div class="flex flex-col items-center justify-center py-12 text-zinc-500">
									<DatabaseIcon class="mb-3 size-10" />
									<p class="text-sm">No buckets configured</p>
								</div>
							{:else}
								<div class="space-y-2">
									{#each buckets as bucket (bucket.id)}
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
												<p class="mt-0.5 truncate text-xs text-zinc-500">
													{bucket.bucket_name} · {bucket.endpoint}
												</p>
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
													onclick={() => handleToggleActive(bucket)}
													disabled={togglingBucketId === bucket.id}
												>
													{#if togglingBucketId === bucket.id}
														<div
															class="size-4 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent"
														></div>
													{:else if bucket.is_active}
														<XIcon class="size-4" />
													{:else}
														<CheckIcon class="size-4" />
													{/if}
												</button>
												<button
													class="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-all hover:bg-zinc-700 hover:text-zinc-200"
													title="Edit"
													onclick={() => startEditBucket(bucket)}
												>
													<PencilIcon class="size-4" />
												</button>
												<button
													class="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-all hover:bg-red-600/20 hover:text-red-400"
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
						{/if}
					</div>

					<!-- Save bar (appears when there are unsaved changes) -->
					{#if hasChanges || saveError}
						<div
							transition:slide={{ duration: 200 }}
							class="flex shrink-0 items-center justify-between gap-4 border-t border-zinc-800 bg-zinc-900/80 px-6 py-3"
						>
							<div class="flex min-w-0 items-center gap-2">
								{#if saveError}
									<p class="truncate text-sm text-red-400">
										{saveError}
									</p>
								{:else}
									<p class="text-sm text-zinc-400">You have unsaved changes.</p>
								{/if}
							</div>
							<div class="flex shrink-0 items-center gap-2">
								<button
									onclick={handleReset}
									disabled={saving}
									class="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:text-white disabled:opacity-50"
								>
									Reset
								</button>
								<button
									onclick={handleSave}
									disabled={saving}
									class="flex items-center gap-1.5 rounded-md bg-stone-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-stone-500 disabled:cursor-not-allowed disabled:opacity-50"
								>
									{#if saveSuccess}
										<CheckIcon class="size-4" />
										Saved
									{:else if saving}
										Saving…
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

<ImageCropModal bind:open={showAvatarCrop} title="Change Avatar" aspect={1} round targetWidth={256} targetHeight={256} onConfirm={(f) => handleImageCropStage("avatar", f)} />
<ImageCropModal bind:open={showBannerCrop} title="Change Banner" aspect={5 / 2} targetWidth={600} targetHeight={240} onConfirm={(f) => handleImageCropStage("banner", f)} />
