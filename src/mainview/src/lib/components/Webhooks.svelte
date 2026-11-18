<script lang="ts">
	import {
		X as XIcon,
		Trash2 as TrashIcon,
		Plus as PlusIcon,
		Check as CheckIcon,
		Link2 as WebhookIcon,
		Copy as CopyIcon,
		Pencil as PencilIcon,
		Camera as CameraIcon,
	} from "@lucide/svelte";
	import { untrack } from "svelte";
	import { getApiError } from "$lib/api/api";
	import {
		listWebhooks,
		createWebhook,
		updateWebhook,
		deleteWebhook,
		resetWebhookToken,
		webhookUrls,
		type Webhook,
	} from "$lib/api/webhooks";
	import { toast } from "$lib/stores/toast.svelte";
	import { confirmAction } from "$lib/stores/confirm.svelte";
	import { getHostURL } from "$lib/common/common";
	import type { GatewaySpace, GatewayRoom } from "$lib/types";

	// The webhooks of a space's text rooms, for whoever may manage them (ManageSpaceWebhooks, which the API checks along
	// with ViewChannels in each room): a room's settings show its own, the space's settings those of every text room the
	// user can view (webhookRooms). With several rooms, a new one is made in the room picked, and each says where it posts.
	let { space, rooms }: { space: GatewaySpace; rooms: GatewayRoom[] } = $props();

	const attachmentHost = getHostURL();
	const several = $derived(rooms.length > 1);
	const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? "deleted room";

	let webhooksLoading = $state(false);
	let loadFailed = $state(false);
	let roomWebhooks = $state<Webhook[]>([]);
	let newWebhookName = $state("");
	let newWebhookRoomId = $state("");
	let newWebhookAvatar = $state<File | null>(null);
	let newWebhookAvatarPreview = $state<string | null>(null);

	// The room a new webhook goes to: the first one until another is picked, and again if the one picked goes.
	$effect.pre(() => {
		if (!rooms.some((r) => r.id === newWebhookRoomId)) newWebhookRoomId = rooms[0]?.id ?? "";
	});

	function pickNewWebhookAvatar() {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "image/*";
		input.onchange = () => {
			const file = input.files?.[0];
			if (!file) return;
			if (newWebhookAvatarPreview) URL.revokeObjectURL(newWebhookAvatarPreview);
			newWebhookAvatar = file;
			newWebhookAvatarPreview = URL.createObjectURL(file);
		};
		input.click();
	}

	function clearNewWebhookAvatar() {
		if (newWebhookAvatarPreview) URL.revokeObjectURL(newWebhookAvatarPreview);
		newWebhookAvatar = null;
		newWebhookAvatarPreview = null;
	}
	let createdWebhookToken = $state<string | null>(null);
	let createdWebhookId = $state<string | null>(null);
	let editingWebhookId = $state<string | null>(null);
	let editingWebhookName = $state("");
	let editingWebhookAvatar = $state<File | "remove" | null>(null);
	let editingWebhookAvatarPreview = $state<string | null>(null);

	function pickEditWebhookAvatar() {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "image/*";
		input.onchange = () => {
			const file = input.files?.[0];
			if (!file) return;
			if (editingWebhookAvatarPreview) URL.revokeObjectURL(editingWebhookAvatarPreview);
			editingWebhookAvatar = file;
			editingWebhookAvatarPreview = URL.createObjectURL(file);
		};
		input.click();
	}

	function removeEditWebhookAvatar() {
		if (editingWebhookAvatarPreview) URL.revokeObjectURL(editingWebhookAvatarPreview);
		editingWebhookAvatar = "remove";
		editingWebhookAvatarPreview = null;
	}
	let isDeletingWebhook = $state<Record<string, boolean>>({});
	let isCreatingWebhook = $state(false);

	// Each room's list, all of them together, by name as the mobile app lists them. Only the latest load's answer shows:
	// one asked for earlier (before a change, or for rooms that changed since) may answer after it.
	let loads = 0;
	async function loadWebhooks() {
		const load = ++loads;
		webhooksLoading = true;
		try {
			const lists = await Promise.all(rooms.map((r) => listWebhooks(space.id, r.id)));
			if (load !== loads) return;
			roomWebhooks = lists
				.flat()
				.sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: "base" }));
			loadFailed = false;
		} catch (err) {
			if (load !== loads) return;
			console.error("Failed to load webhooks:", err);
			toast(getApiError(err, "Failed to load webhooks"), "error");
			loadFailed = true;
		} finally {
			if (load === loads) webhooksLoading = false;
		}
	}

	// Once shown, and for another space or other rooms: the space changes with every presence, its rooms seldom.
	const spaceId = $derived(space.id);
	const roomIds = $derived(rooms.map((r) => r.id).join(","));
	$effect(() => {
		void spaceId;
		void roomIds;
		untrack(() => void loadWebhooks());
	});

	async function handleCreateWebhook() {
		const roomId = newWebhookRoomId;
		if (!newWebhookName.trim() || !roomId) return;
		isCreatingWebhook = true;
		createdWebhookToken = null;
		createdWebhookId = null;
		try {
			const result = await createWebhook(space.id, roomId, newWebhookName.trim(), newWebhookAvatar ?? undefined);
			createdWebhookToken = result.token;
			createdWebhookId = result.webhook.id;
			newWebhookName = "";
			clearNewWebhookAvatar();
			await loadWebhooks();
		} catch (err) {
			console.error("Failed to create webhook:", err);
			toast(getApiError(err, "Failed to create webhook"), "error");
		} finally {
			isCreatingWebhook = false;
		}
	}

	function startWebhookEdit(wh: Webhook) {
		editingWebhookId = wh.id;
		editingWebhookName = wh.username;
		editingWebhookAvatar = null;
		editingWebhookAvatarPreview = wh.avatar ? `${attachmentHost}/attachments/${wh.avatar}` : null;
	}

	function cancelWebhookEdit() {
		editingWebhookId = null;
		editingWebhookName = "";
		editingWebhookAvatarPreview = null;
		editingWebhookAvatar = null;
	}

	async function handleUpdateWebhook(wh: Webhook) {
		if (!editingWebhookName.trim()) return;
		try {
			await updateWebhook(space.id, wh.room_id, wh.id, {
				username: editingWebhookName.trim(),
				avatar: editingWebhookAvatar instanceof File ? editingWebhookAvatar : undefined,
				remove_avatar: editingWebhookAvatar === "remove",
			});
			cancelWebhookEdit();
			await loadWebhooks();
		} catch (err) {
			console.error("Failed to update webhook:", err);
			toast(getApiError(err, "Failed to update webhook"), "error");
		}
	}

	async function handleDeleteWebhook(wh: Webhook) {
		await confirmAction(`Delete webhook "${wh.username}"? This can't be undone.`, "Delete", async () => {
			isDeletingWebhook = { ...isDeletingWebhook, [wh.id]: true };
			try {
				await deleteWebhook(space.id, wh.room_id, wh.id);
				await loadWebhooks();
			} finally {
				isDeletingWebhook = { ...isDeletingWebhook, [wh.id]: false };
			}
		});
	}

	async function handleResetWebhookToken(wh: Webhook) {
		await confirmAction(
			"Reset this webhook's token? The old token will stop working immediately.",
			"Reset Token",
			async () => {
				try {
					const newToken = await resetWebhookToken(space.id, wh.room_id, wh.id);
					createdWebhookToken = newToken;
					createdWebhookId = wh.id;
					toast("Token reset successfully", "success");
				} catch (err) {
					console.error("Failed to reset webhook token:", err);
					toast(getApiError(err, "Failed to reset token"), "error");
				}
			},
		);
	}

	function copyWebhookUrl(url: string, what: string) {
		navigator.clipboard.writeText(url);
		toast(`${what} copied to clipboard`, "success");
	}
</script>

{#if webhooksLoading}
	<p class="text-duvet-ink2 text-sm">Loading webhooks...</p>
{:else}
	<div class="max-w-xl space-y-5">
		<!-- Create new webhook -->
		{#if rooms.length > 0}
			<div class="border-duvet-line bg-duvet-bg space-y-4 rounded-xl border p-5">
				<div class="space-y-1">
					<h3 class="text-duvet-ink text-sm font-bold">Create Webhook</h3>
					<p class="text-duvet-ink2 text-xs">
						Webhooks allow external services to send messages to {several ? "a room" : `#${rooms[0]!.name}`}.
					</p>
				</div>

				<div class="space-y-3">
					<label class="block space-y-1.5">
						<span class="text-duvet-ink2 text-[13px] font-bold">Username</span>
						<input
							type="text"
							class="bg-duvet-sunk text-duvet-ink placeholder:text-duvet-ink2 shadow-duvet-press focus-visible:outline-duvet-accent w-full rounded-xl px-3 py-2 text-sm focus-visible:outline-2"
							placeholder="Webhook Bot"
							bind:value={newWebhookName}
						/>
					</label>

					{#if several}
						<label class="block space-y-1.5">
							<span class="text-duvet-ink2 text-[13px] font-bold">Room</span>
							<select
								class="bg-duvet-sunk text-duvet-ink shadow-duvet-press focus-visible:outline-duvet-accent h-9 w-full rounded-xl px-3 text-sm focus-visible:outline-2"
								bind:value={newWebhookRoomId}
							>
								{#each rooms as r (r.id)}
									<option value={r.id}>#{r.name}</option>
								{/each}
							</select>
						</label>
					{/if}

					<div class="space-y-1.5">
						<span class="text-duvet-ink2 text-[13px] font-bold">Avatar (optional)</span>
						<div class="flex items-center gap-3">
							<div class="group bg-duvet-ink/10 relative size-14 shrink-0 overflow-hidden rounded-full">
								{#if newWebhookAvatarPreview}
									<img src={newWebhookAvatarPreview} alt="Preview" class="size-full object-cover" />
								{:else}
									<div class="flex size-full items-center justify-center">
										<WebhookIcon class="text-duvet-ink2 size-6" />
									</div>
								{/if}
								<div
									class="absolute inset-0 flex items-center justify-center gap-1 bg-black/0 transition-colors group-hover:bg-black/50"
								>
									<button
										type="button"
										class="text-fixed-white flex size-6 cursor-pointer items-center justify-center rounded-full bg-black/60 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/80"
										title="Change avatar"
										onclick={pickNewWebhookAvatar}
									>
										<CameraIcon class="size-3" />
									</button>
									{#if newWebhookAvatarPreview}
										<button
											type="button"
											class="text-duvet-danger flex size-6 cursor-pointer items-center justify-center rounded-full bg-black/60 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/80"
											title="Remove avatar"
											onclick={clearNewWebhookAvatar}
										>
											<TrashIcon class="size-3" />
										</button>
									{/if}
								</div>
							</div>
							<p class="text-duvet-ink2 text-xs">Click to upload an avatar</p>
						</div>
					</div>

					<button
						class="text-duvet-on-accent rounded-row bg-duvet-accent hover:bg-duvet-accent/85 flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
						onclick={handleCreateWebhook}
						disabled={isCreatingWebhook || !newWebhookName.trim()}
					>
						<PlusIcon class="size-4" />
						{isCreatingWebhook ? "Creating..." : "Create"}
					</button>
				</div>
			</div>
		{/if}

		<!-- Token reveal box -->
		{#if createdWebhookToken && createdWebhookId}
			{@const urls = webhookUrls(attachmentHost, createdWebhookId, createdWebhookToken)}
			<div class="border-duvet-warn/30 bg-duvet-warn/10 overflow-hidden rounded-xl border p-4">
				<p class="text-duvet-warn mb-2 text-xs font-semibold">Webhook Token (shown only once)</p>
				<div class="flex items-center gap-2">
					<code class="bg-duvet-card text-duvet-ink min-w-0 flex-1 truncate rounded-md px-3 py-2 text-xs select-text">
						{createdWebhookToken}
					</code>
					<button
						class="rounded-row bg-duvet-ink/10 text-duvet-ink hover:bg-duvet-ink/15 flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors"
						onclick={() => copyWebhookUrl(urls.url, "Webhook URL")}
						title="Copy Webhook URL"
					>
						<CopyIcon class="size-3.5" />
						Copy URL
					</button>
					<button
						class="rounded-row bg-duvet-ink/10 text-duvet-ink hover:bg-duvet-ink/15 flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors"
						onclick={() => copyWebhookUrl(urls.github, "GitHub URL")}
						title="Copy the URL with /github"
					>
						<CopyIcon class="size-3.5" />
						Copy GitHub URL
					</button>
				</div>
				<p class="text-duvet-warn/70 mt-2 truncate text-[11px]" title={urls.url}>
					Webhook URL: {urls.url}
				</p>
				<p class="text-duvet-ink2 mt-1 text-[11px]">
					Paste the GitHub URL as a GitHub repository's webhook: its pushes, issues and pull requests post here.
				</p>
				<button
					class="text-duvet-ink2 hover:text-duvet-ink mt-2 text-xs transition-colors"
					onclick={() => {
						createdWebhookToken = null;
						createdWebhookId = null;
					}}
				>
					Dismiss
				</button>
			</div>
		{/if}

		<!-- Webhook list -->
		{#if loadFailed}
			<div class="flex flex-col items-center justify-center py-12 text-center">
				<WebhookIcon class="text-duvet-ink2/60 mb-3 size-10" />
				<p class="text-duvet-ink2 text-sm">Couldn't load the webhooks.</p>
			</div>
		{:else if roomWebhooks.length === 0}
			<div class="flex flex-col items-center justify-center py-12 text-center">
				<WebhookIcon class="text-duvet-ink2/60 mb-3 size-10" />
				<p class="text-duvet-ink2 text-sm">No webhooks yet.</p>
				<p class="text-duvet-ink2 mt-1 text-xs">
					{rooms.length > 0
						? "Create one above to get started."
						: "Webhooks post in text rooms, and there are none here you can see."}
				</p>
			</div>
		{:else}
			<div class="space-y-1">
				{#each roomWebhooks as wh (wh.id)}
					<div class="group rounded-card border-duvet-line bg-duvet-card flex items-center gap-3 border px-3 py-2.5">
						<!-- Avatar -->
						{#if wh.avatar}
							<img
								src="{attachmentHost}/attachments/{wh.avatar}"
								alt={wh.username}
								class="size-8 shrink-0 rounded-full object-cover"
							/>
						{:else}
							<div class="bg-duvet-ink/10 flex size-8 shrink-0 items-center justify-center rounded-full">
								<WebhookIcon class="text-duvet-ink2 size-4" />
							</div>
						{/if}

						{#if editingWebhookId === wh.id}
							<div class="group/edit bg-duvet-ink/10 relative size-10 shrink-0 overflow-hidden rounded-full">
								{#if editingWebhookAvatarPreview}
									<img src={editingWebhookAvatarPreview} alt="Preview" class="size-full object-cover" />
								{:else}
									<div class="flex size-full items-center justify-center">
										<WebhookIcon class="text-duvet-ink2 size-4" />
									</div>
								{/if}
								<div
									class="absolute inset-0 flex items-center justify-center gap-0.5 bg-black/0 transition-colors group-hover/edit:bg-black/50"
								>
									<button
										type="button"
										class="text-fixed-white flex size-5 cursor-pointer items-center justify-center rounded-full bg-black/60 opacity-0 transition-opacity group-hover/edit:opacity-100 hover:bg-black/80"
										title="Change avatar"
										onclick={pickEditWebhookAvatar}
									>
										<CameraIcon class="size-2.5" />
									</button>
									{#if editingWebhookAvatarPreview}
										<button
											type="button"
											class="text-duvet-danger flex size-5 cursor-pointer items-center justify-center rounded-full bg-black/60 opacity-0 transition-opacity group-hover/edit:opacity-100 hover:bg-black/80"
											title="Remove avatar"
											onclick={removeEditWebhookAvatar}
										>
											<TrashIcon class="size-2.5" />
										</button>
									{/if}
								</div>
							</div>
							<div class="flex min-w-0 flex-1 flex-col gap-2">
								<input
									type="text"
									class="text-duvet-ink bg-duvet-sunk shadow-duvet-press focus-visible:outline-duvet-accent w-full rounded-xl px-2 py-1 text-sm focus-visible:outline-2"
									bind:value={editingWebhookName}
									onkeydown={(e) => {
										if (e.key === "Enter") handleUpdateWebhook(wh);
										if (e.key === "Escape") cancelWebhookEdit();
									}}
								/>
							</div>
							<button
								class="text-duvet-alive hover:bg-duvet-ink/10 rounded p-1.5 transition-colors"
								onclick={() => handleUpdateWebhook(wh)}
								title="Save"
							>
								<CheckIcon class="size-4" />
							</button>
							<button
								class="text-duvet-ink2 hover:bg-duvet-ink/10 rounded p-1.5 transition-colors"
								onclick={cancelWebhookEdit}
								title="Cancel"
							>
								<XIcon class="size-4" />
							</button>
						{:else}
							<div class="min-w-0 flex-1">
								<p class="text-duvet-ink truncate text-sm font-medium">{wh.username}</p>
								<p class="text-duvet-ink2 truncate text-xs">
									{#if several}Posts in #{roomName(wh.room_id)}<span class="text-duvet-ink2/60 mx-1">&middot;</span
										>{/if}Created {new Date(wh.created_at).toLocaleDateString()}
								</p>
							</div>

							<button
								class="text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-ink rounded p-1.5 opacity-0 transition-all group-hover:opacity-100"
								onclick={() => startWebhookEdit(wh)}
								title="Rename"
							>
								<PencilIcon class="size-4" />
							</button>
							<button
								class="text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-warn rounded p-1.5 opacity-0 transition-all group-hover:opacity-100"
								onclick={() => handleResetWebhookToken(wh)}
								title="Reset Token"
							>
								<WebhookIcon class="size-4" />
							</button>
							<button
								class="text-duvet-ink2 hover:bg-duvet-ink/10 hover:text-duvet-danger rounded p-1.5 opacity-0 transition-all group-hover:opacity-100"
								onclick={() => handleDeleteWebhook(wh)}
								disabled={isDeletingWebhook[wh.id]}
								title="Delete"
							>
								<TrashIcon class="size-4" />
							</button>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
