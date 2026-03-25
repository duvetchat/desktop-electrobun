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
} from "@lucide/svelte";
import { Dialog } from "bits-ui";
import { currentUser, channelMessages, gatewaySpaces, dmMessages, conversations } from "$lib/stores.svelte";
import UserAvatar from "$lib/components/UserAvatar.svelte";
import { updateUser, getMyAttachments, getMyStorageStatus, deleteMyAttachment, deleteAllMyAttachments, getMyBuckets, createMyBucket, updateMyBucket, deleteMyBucket, activateMyBucket, deactivateMyBucket, type UserAttachment, type StorageStatus, type StorageBucket, type CreateBucketPayload } from "$lib/api/user";
import { getHostURL } from "$lib/common/common";
import { confirmAction } from "$lib/stores/confirm.svelte";
import { toast } from "$lib/stores/toast.svelte";
import VoiceNotePlayer from "$lib/components/VoiceNotePlayer.svelte";

let {
	open = $bindable(false),
}: {
	open?: boolean;
} = $props();

type Section = "account" | "attachments" | "buckets";
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

const totalSize = $derived(attachments.reduce((sum, a) => sum + a.size_bytes, 0));

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
	try { storageStatus = await getMyStorageStatus(); } catch {}
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
let bName = $state(""); let bEndpoint = $state(""); let bRegion = $state("auto");
let bBucketName = $state(""); let bAccessKey = $state(""); let bSecretKey = $state("");
let bUsePathStyle = $state(false);

async function loadBuckets() {
	bucketsLoading = true; bucketsError = null;
	try { buckets = await getMyBuckets(); } catch (e) { bucketsError = e instanceof Error ? e.message : "Failed to load"; }
	finally { bucketsLoading = false; }
}

function resetBucketForm() {
	bName = ""; bEndpoint = ""; bRegion = "auto"; bBucketName = ""; bAccessKey = ""; bSecretKey = ""; bUsePathStyle = false;
	editingBucket = null; showBucketForm = false;
}

function startEditBucket(b: StorageBucket) {
	editingBucket = b; showBucketForm = true;
	bName = b.name; bEndpoint = b.endpoint; bRegion = b.region;
	bBucketName = b.bucket_name; bAccessKey = b.access_key_id; bSecretKey = b.secret_access_key;
	bUsePathStyle = b.use_path_style;
}

async function handleSaveBucket() {
	if (!bName.trim() || !bEndpoint.trim() || !bBucketName.trim() || !bAccessKey.trim()) return;
	bucketSaving = true; bucketsError = null;
	try {
		const payload: CreateBucketPayload = {
			name: bName.trim(), endpoint: bEndpoint.trim(), region: bRegion.trim() || "auto",
			bucket_name: bBucketName.trim(), access_key_id: bAccessKey.trim(),
			secret_access_key: bSecretKey.trim(), use_path_style: bUsePathStyle,
		};
		if (editingBucket) {
			await updateMyBucket(editingBucket.id, payload);
		} else {
			await createMyBucket(payload);
		}
		resetBucketForm();
		await loadBuckets();
	} catch (e) { bucketsError = e instanceof Error ? e.message : "Failed to save"; }
	finally { bucketSaving = false; }
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
		if (b.is_active) { await deactivateMyBucket(b.id); }
		else { await activateMyBucket(b.id); }
		await loadBuckets();
	} catch (e) {
		toast(e instanceof Error ? e.message : "Failed to toggle bucket", "error");
	} finally {
		togglingBucketId = null;
	}
}

// Form state
let username = $state("");
let alias = $state("");
let avatar = $state("");
let banner = $state("");
let saving = $state(false);
let saveError = $state<string | null>(null);
let saveSuccess = $state(false);

// Sync from currentUser when modal opens
$effect(() => {
	if (open && $currentUser) {
		username = $currentUser.username ?? "";
		alias = $currentUser.alias ?? "";
		avatar = $currentUser.avatar ?? "";
		banner = $currentUser.banner ?? "";
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

const hasChanges = $derived(
	$currentUser !== null && (
		username !== ($currentUser.username ?? "") ||
		alias !== ($currentUser.alias ?? "") ||
		avatar !== ($currentUser.avatar ?? "") ||
		banner !== ($currentUser.banner ?? "")
	)
);

async function handleSave() {
	if (!$currentUser || saving) return;
	saving = true;
	saveError = null;
	saveSuccess = false;

	try {
		const updated = await updateUser({
			username: username.trim() || $currentUser!.username,
			alias: alias.trim() || null,
			avatar: avatar.trim() || $currentUser!.avatar || null,
			banner: banner.trim() || $currentUser!.banner || null,
		});

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
		const newAvatar = updated.avatar ?? null;
		const userId = $currentUser?.id;

		if (userId) {
			gatewaySpaces.update((spaces) =>
				spaces.map((s) => ({
					...s,
					users: s.users.map((u) =>
						u.id === userId
							? { ...u, username: updated.username, alias: updated.alias ?? null, avatar: newAvatar, banner: updated.banner ?? null }
							: u,
					),
				})),
			);

			channelMessages.update((rooms) => {
				const result: typeof rooms = {};
				for (const [roomId, msgs] of Object.entries(rooms)) {
					result[roomId] = msgs.map((m) =>
						m.author_id === userId
							? { ...m, author_name: newName, author_avatar_url: newAvatar }
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
							user: { ...m.user, username: updated.username, alias: updated.alias ?? null, avatar: newAvatar, banner: updated.banner ?? null },
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
							? { ...m, user: { ...m.user, username: updated.username, alias: updated.alias ?? null, avatar: newAvatar, banner: updated.banner ?? null } }
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
	avatar = $currentUser.avatar ?? "";
	banner = $currentUser.banner ?? "";
	saveError = null;
}
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-500 bg-black/70 backdrop-blur-sm" />
		<Dialog.Content
			class="fixed inset-0 z-501 flex items-center justify-center p-4"
		>
			<div
				class="flex h-[85vh] w-full max-w-3xl overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl text-zinc-100"
			>
				<!-- Left sidebar -->
				<aside class="w-52 shrink-0 bg-zinc-950 flex flex-col py-6 border-r border-zinc-800">
					<div class="px-4 mb-3">
						<p class="text-xxs font-bold tracking-widest uppercase text-zinc-400 px-2 mb-1">
							User Settings
						</p>
					</div>
					<nav class="flex flex-col gap-0.5 px-2">
						<button
							class="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors text-left
								{activeSection === 'account'
								? 'bg-zinc-800 text-white'
								: 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
							onclick={() => (activeSection = "account")}
						>
							<UserIcon class="size-4 shrink-0" />
							My Account
						</button>
						<button
							class="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors text-left
								{activeSection === 'attachments'
								? 'bg-zinc-800 text-white'
								: 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
							onclick={() => (activeSection = "attachments")}
						>
							<PaperclipIcon class="size-4 shrink-0" />
							Attachments
						</button>
						<button
							class="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors text-left
								{activeSection === 'buckets'
								? 'bg-zinc-800 text-white'
								: 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}"
							onclick={() => (activeSection = "buckets")}
						>
							<DatabaseIcon class="size-4 shrink-0" />
							S3 Buckets
						</button>
					</nav>
				</aside>

				<!-- Main content -->
				<div class="flex flex-1 flex-col min-w-0">
					<!-- Header -->
					<div class="flex items-center justify-between border-b border-zinc-800 px-6 py-4 shrink-0">
						<h2 class="text-base font-semibold text-white">
							{#if activeSection === "account"}My Account{:else if activeSection === "attachments"}Attachments{:else if activeSection === "buckets"}R2 Buckets{/if}
						</h2>
						<Dialog.Close
							class="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
						>
							<XIcon class="size-4" />
						</Dialog.Close>
					</div>

					<!-- Scrollable content -->
					<div class="flex-1 overflow-y-auto px-6 py-6 space-y-6">
						{#if activeSection === "account"}
							<!-- Profile preview card -->
							<div class="rounded-xl overflow-hidden border border-zinc-800">
								<!-- Banner -->
								<div
									class="h-20 bg-linear-to-r from-stone-700 to-stone-600 relative"
									style={banner.trim() ? `background-image: url('${banner.trim()}'); background-size: cover; background-position: center;` : ""}
								></div>
								<!-- Avatar + name row -->
								<div class="bg-zinc-800/60 px-4 pb-4">
									<div class="flex items-end gap-3 -mt-6 mb-3">
										<div class="ring-4 ring-zinc-800 rounded-full">
											<UserAvatar
												src={avatar.trim() || $currentUser?.avatar}
												name={alias.trim() || $currentUser?.username || ""}
												size={48}
											/>
										</div>
									</div>
									<p class="font-semibold text-white text-sm">
										{alias.trim() || username || ""}
									</p>
									<p class="text-xs text-zinc-400 mt-0.5">
										{username || $currentUser?.username || ""}
									</p>
								</div>
							</div>

							<!-- Form fields -->
							<div class="space-y-5">
								<!-- Display name -->
								<div>
									<label
										for="alias"
										class="mb-1.5 block text-xs font-semibold tracking-wide text-zinc-400 uppercase"
									>
										Display Name
									</label>
									<input
										id="alias"
										type="text"
										bind:value={alias}
										maxlength={32}
										placeholder={$currentUser?.username ?? ""}
										class="h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500 transition-colors focus-override"
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
										class="h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500 transition-colors focus-override"
									/>
								</div>

								<!-- Avatar URL -->
								<div>
									<label
										for="avatar"
										class="mb-1.5 block text-xs font-semibold tracking-wide text-zinc-400 uppercase"
									>
										Avatar URL
									</label>
									<input
										id="avatar"
										type="text"
										bind:value={avatar}
										placeholder="https://example.com/avatar.png"
										class="h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500 transition-colors focus-override"
									/>
								</div>

								<!-- Banner URL -->
								<div>
									<label
										for="banner"
										class="mb-1.5 block text-xs font-semibold tracking-wide text-zinc-400 uppercase"
									>
										Banner URL
									</label>
									<input
										id="banner"
										type="text"
										bind:value={banner}
										placeholder="https://example.com/banner.png"
										class="h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500 transition-colors focus-override"
									/>
								</div>
							</div>
						{:else if activeSection === "attachments"}
							<!-- Active custom bucket banner -->
							{#if hasActiveBucket}
								{@const activeBucket = buckets.find((b) => b.is_active)}
								<div class="rounded-lg border border-emerald-800/50 bg-emerald-900/20 px-4 py-3 flex items-center gap-3">
									<DatabaseIcon class="size-5 text-emerald-400 shrink-0" />
									<div class="flex-1 min-w-0">
										<p class="text-sm font-medium text-emerald-300">Using your own storage</p>
										<p class="text-xs text-emerald-400/60 truncate">{activeBucket?.name} · {activeBucket?.bucket_name}</p>
									</div>
									<span class="text-xxs font-semibold px-1.5 py-0.5 rounded bg-emerald-600/20 text-emerald-400 shrink-0">NO QUOTA</span>
								</div>
							{/if}
							<!-- Default storage quota (always shown) -->
							{#if storageStatus}
								<div class="rounded-lg border border-zinc-800 bg-zinc-800/40 px-4 py-4 space-y-3">
									<div class="flex items-center justify-between">
										<p class="text-sm font-semibold text-white">Default Storage</p>
										<p class="text-xs text-zinc-400">
											{formatFileSize(storageStatus.used_bytes)} / {formatFileSize(storageStatus.max_bytes)}
										</p>
									</div>
									<!-- Progress bar -->
									<div class="h-2 w-full rounded-full bg-zinc-700 overflow-hidden">
										<div
											class="h-full rounded-full transition-all duration-300 {storageStatus.percentage_used > 90 ? 'bg-red-500' : storageStatus.percentage_used > 70 ? 'bg-yellow-500' : 'bg-stone-500'}"
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
									<span class="font-semibold text-white">{attachments.length}</span> file{attachments.length !== 1 ? "s" : ""}
								</div>
								{#if attachments.length > 0}
									<button
										onclick={handleDeleteAll}
										class="flex items-center gap-1.5 rounded-md bg-red-600/20 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-600/30 transition-colors"
									>
										<TrashIcon class="size-3.5" />
										Delete All
									</button>
								{/if}
							</div>

							{#if attachmentsError}
								<p class="text-sm text-red-400 bg-red-400/10 rounded-md px-3 py-2">{attachmentsError}</p>
							{/if}

							{#if attachmentsLoading}
								<div class="space-y-2">
									{#each Array(5) as _}
										<div class="h-14 rounded-lg bg-zinc-800/40 animate-pulse"></div>
									{/each}
								</div>
							{:else if attachments.length === 0}
								<div class="flex flex-col items-center justify-center py-16 text-zinc-500">
									<PaperclipIcon class="size-10 mb-3" />
									<p class="text-sm">No attachments yet</p>
								</div>
							{:else}
								<div class="space-y-1">
									{#each attachments as att (att.id)}
										{@const isImage = att.content_type.startsWith("image/")}
										{@const isAudio = att.content_type.startsWith("audio/")}
										<div class="rounded-lg border border-zinc-800 bg-zinc-800/30 group hover:bg-zinc-800/50 transition-colors">
											<div class="flex items-center gap-3 px-3 py-2.5">
												<!-- Thumbnail -->
												{#if isImage}
													<img
														src="{attachmentHost}/attachments/{att.id}"
														alt=""
														class="w-10 h-10 rounded object-cover shrink-0 bg-zinc-700"
													/>
												{:else if isAudio}
													<div class="w-10 h-10 rounded bg-zinc-700 flex items-center justify-center shrink-0">
														<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-zinc-400"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
													</div>
												{:else}
													<div class="w-10 h-10 rounded bg-zinc-700 flex items-center justify-center shrink-0">
														<PaperclipIcon class="size-4 text-zinc-400" />
													</div>
												{/if}
												<!-- Info -->
												<div class="flex-1 min-w-0">
													<p class="text-sm text-zinc-200 truncate">{att.filename}</p>
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
												class="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 opacity-0 group-hover:opacity-100 hover:bg-zinc-700 hover:text-zinc-200 transition-all shrink-0"
												title="Download"
											>
												<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
											</a>
											<!-- Delete -->
											<button
												onclick={() => handleDeleteAttachment(att.id)}
												class="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 opacity-0 group-hover:opacity-100 hover:bg-red-600/20 hover:text-red-400 transition-all shrink-0"
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
							<p class="text-xs text-zinc-500 mb-4">Connect your own S3/R2 buckets for unlimited storage. When a bucket is active, uploads go to your bucket instead of the default and quota limits don't apply.</p>

							{#if bucketsError}
								<p class="text-sm text-red-400 bg-red-400/10 rounded-md px-3 py-2 mb-4">{bucketsError}</p>
							{/if}

							<!-- Create / Edit form -->
							{#if showBucketForm}
								<div class="rounded-lg border border-zinc-800 bg-zinc-800/40 p-4 mb-4 space-y-3">
									<h3 class="text-sm font-semibold text-white">{editingBucket ? "Edit Bucket" : "New Bucket"}</h3>
									<div class="grid grid-cols-2 gap-3">
										<div>
											<label for="bucket-name" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase">Name</label>
											<input id="bucket-name" type="text" bind:value={bName} placeholder="My R2" class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500" />
										</div>
										<div>
											<label for="bucket-region" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase">Region</label>
											<input id="bucket-region" type="text" bind:value={bRegion} placeholder="auto" class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500" />
										</div>
									</div>
									<div>
										<label for="bucket-endpoint" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase">Endpoint</label>
										<input id="bucket-endpoint" type="text" bind:value={bEndpoint} placeholder="https://account-id.r2.cloudflarestorage.com" class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500" />
									</div>
									<div>
										<label for="bucket-bucket-name" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase">Bucket Name</label>
										<input id="bucket-bucket-name" type="text" bind:value={bBucketName} placeholder="my-bucket" class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500" />
									</div>
									<div class="grid grid-cols-2 gap-3">
										<div>
											<label for="bucket-access-key" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase">Access Key ID</label>
											<input id="bucket-access-key" type="text" bind:value={bAccessKey} placeholder="access key" class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500" />
										</div>
										<div>
											<label for="bucket-secret-key" class="mb-1 block text-xs font-semibold text-zinc-400 uppercase">Secret Access Key</label>
											<input id="bucket-secret-key" type="password" bind:value={bSecretKey} placeholder={editingBucket ? "leave empty to keep current" : "secret key"} class="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-stone-500" />
										</div>
									</div>
									<label class="flex items-center gap-2 cursor-pointer">
										<input type="checkbox" bind:checked={bUsePathStyle} class="size-4 rounded border-zinc-600 bg-zinc-800 accent-stone-500" />
										<span class="text-xs text-zinc-400">Use path-style addressing <span class="text-zinc-600">(required for MinIO, RustFS, etc.)</span></span>
									</label>
									<div class="flex justify-end gap-2 pt-1">
										<button class="rounded-md px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors" onclick={resetBucketForm}>Cancel</button>
										<button class="rounded-md bg-stone-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-stone-500 transition-colors disabled:opacity-50" disabled={bucketSaving} onclick={handleSaveBucket}>
											{bucketSaving ? "Saving..." : editingBucket ? "Update" : "Create"}
										</button>
									</div>
								</div>
							{:else}
								<button class="flex items-center gap-2 rounded-md bg-stone-600/20 px-3 py-2 text-sm font-medium text-stone-300 hover:bg-stone-600/30 transition-colors mb-4" onclick={() => { resetBucketForm(); showBucketForm = true; }}>
									<PlusIcon class="size-4" /> Add Bucket
								</button>
							{/if}

							<!-- Bucket list -->
							{#if bucketsLoading}
								<div class="space-y-2">
									{#each Array(3) as _}
										<div class="h-16 rounded-lg bg-zinc-800/40 animate-pulse"></div>
									{/each}
								</div>
							{:else if buckets.length === 0}
								<div class="flex flex-col items-center justify-center py-12 text-zinc-500">
									<DatabaseIcon class="size-10 mb-3" />
									<p class="text-sm">No buckets configured</p>
								</div>
							{:else}
								<div class="space-y-2">
									{#each buckets as bucket (bucket.id)}
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
													onclick={() => handleToggleActive(bucket)}
													disabled={togglingBucketId === bucket.id}
												>
													{#if togglingBucketId === bucket.id}
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
													onclick={() => startEditBucket(bucket)}
												>
													<PencilIcon class="size-4" />
												</button>
												<button
													class="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-red-600/20 hover:text-red-400 transition-all"
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
						<div class="shrink-0 border-t border-zinc-800 bg-zinc-900/80 px-6 py-3 flex items-center justify-between gap-4">
							<div class="flex items-center gap-2 min-w-0">
								{#if saveError}
									<p class="text-sm text-red-400 truncate">{saveError}</p>
								{:else}
									<p class="text-sm text-zinc-400">You have unsaved changes.</p>
								{/if}
							</div>
							<div class="flex items-center gap-2 shrink-0">
								<button
									onclick={handleReset}
									disabled={saving}
									class="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-300 hover:text-white transition-colors disabled:opacity-50"
								>
									Reset
								</button>
								<button
									onclick={handleSave}
									disabled={saving}
									class="flex items-center gap-1.5 rounded-md bg-stone-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-stone-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
