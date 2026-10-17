<script lang="ts">
	import { promptDialog } from "$lib/stores/prompt.svelte";
	import {
		Plus as PlusIcon,
		ChevronDown as CaretDownIcon,
		FolderPlus as FolderPlusIcon,
		Users as UsersIcon,
	} from "@lucide/svelte";
	import { ContextMenu, Dialog, Tabs } from "bits-ui";
	import { onMount } from "svelte";
	import type { Guild } from "$lib/types";
	import { createSpace, leaveSpace } from "$lib/api/spaces";
	import SpaceIcon from "$lib/components/SpaceIcon.svelte";
	import JoinInviteModal from "$lib/components/JoinInviteModal.svelte";
	import {
		pendingFriendRequests,
		unreadChannels,
		unreadConversations,
		gatewaySpaces,
		mentionCounts,
	} from "$lib/stores.svelte";

	let {
		guilds,
		activeGuildId = null,
		onSelect = () => {},
		isFriendsActive = false,
		onFriendsSelect = () => {},
	}: {
		guilds: Guild[];
		activeGuildId?: string | null;
		onSelect?: (guildId: string) => void;
		isFriendsActive?: boolean;
		onFriendsSelect?: () => void;
	} = $props();

	const selectGuild = (guild: Guild) => onSelect(guild.id);

	type FolderGroup = {
		id: string;
		name: string;
		guildIds: string[];
		collapsed: boolean;
	};

	const FOLDERS_KEY = "duvet.guildFolders.v1";
	let folders = $state<FolderGroup[]>([]);

	onMount(() => {
		try {
			const raw = localStorage.getItem(FOLDERS_KEY);
			if (raw) {
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					folders = parsed.filter((f) => f && typeof f.id === "string");
				}
			}
		} catch {
			folders = [];
		}
	});

	function persistFolders() {
		localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
	}

	async function createFolder() {
		const name = await promptDialog("Folder name", "My folder");
		if (!name?.trim()) return;
		folders = [
			...folders,
			{
				id: crypto.randomUUID(),
				name: name.trim(),
				guildIds: [],
				collapsed: false,
			},
		];
		persistFolders();
	}

	function toggleFolder(folderId: string) {
		folders = folders.map((f) => (f.id === folderId ? { ...f, collapsed: !f.collapsed } : f));
		persistFolders();
	}

	function moveGuildToFolder(guildId: string, folderId: string | null) {
		folders = folders.map((f) => ({
			...f,
			guildIds: f.guildIds.filter((id) => id !== guildId),
		}));
		if (folderId) {
			folders = folders.map((f) => (f.id === folderId ? { ...f, guildIds: [...f.guildIds, guildId] } : f));
		}
		persistFolders();
	}

	$effect(() => {
		const validGuildIds = new Set(guilds.map((g) => g.id));
		let changed = false;
		const next = folders.map((f) => {
			const filtered = f.guildIds.filter((id) => validGuildIds.has(id));
			if (filtered.length !== f.guildIds.length) {
				changed = true;
				return { ...f, guildIds: filtered };
			}
			return f;
		});
		if (changed) {
			folders = next;
			persistFolders();
		}
	});

	const groupedGuilds = $derived(
		folders
			.map((folder) => ({
				...folder,
				guilds: folder.guildIds.map((id) => guilds.find((g) => g.id === id)).filter(Boolean) as Guild[],
			}))
			.filter((folder) => folder.guilds.length > 0),
	);

	const groupedIds = $derived(new Set(groupedGuilds.flatMap((group) => group.guilds.map((g) => g.id))));
	const ungroupedGuilds = $derived(guilds.filter((g) => !groupedIds.has(g.id)));

	function initials(name?: string | null) {
		if (!name) return "?";
		return name
			.split(" ")
			.map((p) => p.at(0))
			.slice(0, 2)
			.join("")
			.toUpperCase();
	}

	// ── Create server modal ────────────────────────────────────────────────────
	let showModal = $state(false);
	let modalTab = $state<"create" | "join">("create");
	let serverName = $state("");
	let serverDescription = $state("");
	let creating = $state(false);
	let createError = $state("");

	// ── Join server modal ──────────────────────────────────────────────────────
	let joinInputValue = $state("");
	let showJoinPreview = $state(false);
	let joinCode = $state<string | null>(null);

	function extractCode(input: string): string {
		const value = input.trim();
		if (!value) return "";

		const htmlMatch = value.match(/[?&]code=([^&#\s]+)/);
		if (htmlMatch?.[1]) return decodeURIComponent(htmlMatch[1]);

		const pathMatch = value.match(/\/invite\/([^/?#\s]+)/);
		if (pathMatch?.[1]) return pathMatch[1];

		const hashMatch = value.match(/#invite:([^\s]+)/);
		if (hashMatch?.[1]) return decodeURIComponent(hashMatch[1]);

		return value;
	}

	function openModal() {
		modalTab = "create";
		serverName = "";
		serverDescription = "";
		createError = "";
		joinInputValue = "";
		showModal = true;
	}

	function handleJoinSubmit() {
		const code = extractCode(joinInputValue);
		if (!code) return;
		joinCode = code;
		showModal = false;
		showJoinPreview = true;
	}

	async function handleCreate() {
		if (!serverName.trim()) return;
		creating = true;
		createError = "";
		try {
			await createSpace(serverName.trim(), serverDescription.trim() || undefined);
			showModal = false;
		} catch (e) {
			createError = e instanceof Error ? e.message : "Unknown error";
		} finally {
			creating = false;
		}
	}

	const friendsBadgeCount = $derived($pendingFriendRequests.length + $unreadConversations.size);
	const spacesWithUnread = $derived(
		new Set($gatewaySpaces.filter((s) => s.rooms.some((r) => $unreadChannels.has(r.id))).map((s) => s.id)),
	);

	// Total mention count per space — sum mention counts for all rooms in each space.
	const mentionCountBySpace = $derived.by(() => {
		const counts: Record<string, number> = {};
		const mc = $mentionCounts;
		for (const space of $gatewaySpaces) {
			let total = 0;
			for (const room of space.rooms) {
				total += mc[room.id] ?? 0;
			}
			if (total > 0) counts[space.id] = total;
		}
		return counts;
	});

	let leavingGuildId = $state<string | null>(null);
	let leaveError = $state("");

	async function handleLeave(guildId: string) {
		leavingGuildId = guildId;
		leaveError = "";
		try {
			await leaveSpace(guildId);
		} catch (e) {
			leaveError = e instanceof Error ? e.message : "Failed to leave server";
		} finally {
			leavingGuildId = null;
		}
	}
</script>

<nav
	class="flex h-full w-full max-w-16 flex-col justify-start border-r border-stone-800 bg-[linear-gradient(180deg,oklch(0.2_0.01_80),oklch(0.17_0.008_80))]"
>
	<div class="flex flex-col items-center justify-center gap-1.5 py-2">
		<button
			title="Friends"
			onclick={onFriendsSelect}
			class="relative flex size-9 items-center justify-center rounded-lg transition-all duration-150 {isFriendsActive
				? 'bg-indigo-600 text-white'
				: 'bg-stone-900/65 text-stone-200 hover:bg-stone-800/80 hover:text-stone-100'}"
		>
			<UsersIcon class="size-4" />
			{#if friendsBadgeCount > 0}
				<span
					class="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white"
				>
					{friendsBadgeCount > 9 ? "9+" : friendsBadgeCount}
				</span>
			{/if}
		</button>
		<button
			title="Add server"
			onclick={openModal}
			class="flex size-9 items-center justify-center rounded-lg bg-stone-700 text-stone-100 hover:bg-stone-600"
		>
			<PlusIcon class="size-4" />
		</button>
		<button
			title="Create folder"
			onclick={createFolder}
			class="flex size-9 items-center justify-center rounded-lg border border-stone-700 bg-stone-900 text-stone-200 hover:bg-stone-800"
		>
			<FolderPlusIcon class="size-4" />
		</button>
	</div>

	<div role="list" class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-2">
		{#each groupedGuilds as group}
			<button
				title={group.name}
				class="mx-auto mt-1 flex size-9 items-center justify-center rounded-md border border-stone-700 bg-stone-900 text-[11px] font-bold text-stone-200 hover:bg-stone-800"
				onclick={() => toggleFolder(group.id)}
				aria-expanded={!group.collapsed}
			>
				{group.name.slice(0, 1).toUpperCase()}
			</button>
			{#if !group.collapsed}
				<div role="group" class="flex flex-col items-center gap-1 px-2 py-1">
					{#each group.guilds as guild}
						<ContextMenu.Root>
							<ContextMenu.Trigger>
								<button
									title={guild.name}
									aria-pressed={guild.id === activeGuildId}
									onclick={() => selectGuild(guild)}
									class="group/btn relative size-10 rounded-lg transition-all duration-150 select-none"
								>
									<SpaceIcon
										src={guild.icon_url || null}
										name={guild.name}
										size={40}
										class="transition-transform duration-150 group-hover/btn:scale-105"
									/>
									{#if mentionCountBySpace[guild.id] && guild.id !== activeGuildId}
										<span
											class="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-red-600 text-[9px] font-bold text-white ring-2 ring-stone-900"
											>{mentionCountBySpace[guild.id]}</span
										>
									{:else if spacesWithUnread.has(guild.id) && guild.id !== activeGuildId}
										<span
											class="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-stone-900 bg-white"
										></span>
									{/if}
								</button>
							</ContextMenu.Trigger>
							<ContextMenu.Portal>
								<ContextMenu.Content
									class="z-50 min-w-44 rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-2xl"
								>
									{#if folders.length > 0}
										<div class="text-xxs px-3 py-1.5 font-semibold tracking-wide text-zinc-500 uppercase">
											Move to folder
										</div>
										<ContextMenu.Item
											class="w-full px-3 py-2 text-left text-sm text-zinc-200 transition-colors hover:bg-zinc-800"
											onSelect={() => moveGuildToFolder(guild.id, null)}
										>
											Ungrouped
										</ContextMenu.Item>
										{#each folders as folder}
											<ContextMenu.Item
												class="w-full px-3 py-2 text-left text-sm text-zinc-200 transition-colors hover:bg-zinc-800"
												onSelect={() => moveGuildToFolder(guild.id, folder.id)}
											>
												{folder.name}
											</ContextMenu.Item>
										{/each}
										<div class="my-1 border-t border-zinc-800"></div>
									{/if}
									<ContextMenu.Item
										class="w-full px-3 py-2 text-left text-sm text-red-400 transition-colors hover:bg-red-500/10"
										disabled={leavingGuildId === guild.id}
										onSelect={() => handleLeave(guild.id)}
									>
										{leavingGuildId === guild.id ? "Leaving…" : "Leave Server"}
									</ContextMenu.Item>
								</ContextMenu.Content>
							</ContextMenu.Portal>
						</ContextMenu.Root>
					{/each}
				</div>
			{/if}
		{/each}

		{#if ungroupedGuilds.length > 0}
			<div class="my-1.5 h-px w-8 bg-stone-800/80"></div>
			<div role="group" class="flex flex-col items-center gap-1 px-2 py-1">
				{#each ungroupedGuilds as guild}
					<ContextMenu.Root>
						<ContextMenu.Trigger>
							<button
								title={guild.name}
								aria-pressed={guild.id === activeGuildId}
								onclick={() => selectGuild(guild)}
								class="group/btn relative size-10 rounded-lg transition-all duration-150 select-none"
							>
								<SpaceIcon
									src={guild.icon_url || null}
									name={guild.name}
									size={40}
									class="transition-transform duration-150 group-hover/btn:scale-105"
								/>
								{#if mentionCountBySpace[guild.id] && guild.id !== activeGuildId}
									<span
										class="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-red-600 text-[9px] font-bold text-white ring-2 ring-stone-900"
										>{mentionCountBySpace[guild.id]}</span
									>
								{:else if spacesWithUnread.has(guild.id) && guild.id !== activeGuildId}
									<span class="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-stone-900 bg-white"
									></span>
								{/if}
							</button>
						</ContextMenu.Trigger>
						<ContextMenu.Portal>
							<ContextMenu.Content class="z-50 min-w-44 rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-2xl">
								{#if folders.length > 0}
									<div class="text-xxs px-3 py-1.5 font-semibold tracking-wide text-zinc-500 uppercase">
										Move to folder
									</div>
									<ContextMenu.Item
										class="w-full px-3 py-2 text-left text-sm text-zinc-200 transition-colors hover:bg-zinc-800"
										onSelect={() => moveGuildToFolder(guild.id, null)}
									>
										Ungrouped
									</ContextMenu.Item>
									{#each folders as folder}
										<ContextMenu.Item
											class="w-full px-3 py-2 text-left text-sm text-zinc-200 transition-colors hover:bg-zinc-800"
											onSelect={() => moveGuildToFolder(guild.id, folder.id)}
										>
											{folder.name}
										</ContextMenu.Item>
									{/each}
									<div class="my-1 border-t border-zinc-800"></div>
								{/if}
								<ContextMenu.Item
									class="w-full px-3 py-2 text-left text-sm text-red-400 transition-colors hover:bg-red-500/10"
									disabled={leavingGuildId === guild.id}
									onSelect={() => handleLeave(guild.id)}
								>
									{leavingGuildId === guild.id ? "Leaving…" : "Leave Server"}
								</ContextMenu.Item>
							</ContextMenu.Content>
						</ContextMenu.Portal>
					</ContextMenu.Root>
				{/each}
			</div>
		{/if}
	</div>
</nav>

<Dialog.Root bind:open={showModal}>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-50 bg-black/60" />
		<Dialog.Content class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<div
				class="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-zinc-700 bg-zinc-900 p-6 text-zinc-100 shadow-2xl"
			>
				<Dialog.Title class="text-center text-lg font-bold text-white">Add a Server</Dialog.Title>
				<p class="-mt-2 text-center text-sm text-zinc-300">Create your own or join one with an invite code.</p>

				<Tabs.Root bind:value={modalTab}>
					<Tabs.List class="grid grid-cols-2 gap-2 rounded-lg bg-stone-800/80 p-1">
						<Tabs.Trigger
							value="create"
							class="rounded-md px-3 py-2 text-sm font-semibold text-zinc-300 data-[state=active]:bg-stone-600 data-[state=active]:text-white"
						>
							Create
						</Tabs.Trigger>
						<Tabs.Trigger
							value="join"
							class="rounded-md px-3 py-2 text-sm font-semibold text-zinc-300 data-[state=active]:bg-stone-600 data-[state=active]:text-white"
						>
							Join
						</Tabs.Trigger>
					</Tabs.List>

					<Tabs.Content value="create" class="mt-4 space-y-3">
						<div class="flex flex-col gap-1">
							<label for="server-name" class="text-xs font-semibold tracking-wider text-zinc-400 uppercase"
								>Server Name <span class="text-red-400">*</span></label
							>
							<input
								id="server-name"
								type="text"
								bind:value={serverName}
								placeholder="My awesome server"
								class="rounded-md bg-zinc-800 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-stone-500"
								maxlength={100}
							/>
						</div>
						<div class="flex flex-col gap-1">
							<label for="server-desc" class="text-xs font-semibold tracking-wider text-zinc-400 uppercase"
								>Description <span class="text-zinc-500">(optional)</span></label
							>
							<input
								id="server-desc"
								type="text"
								bind:value={serverDescription}
								placeholder="What's this server about?"
								class="rounded-md bg-zinc-800 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-stone-500"
								maxlength={300}
							/>
						</div>
						{#if createError}
							<p class="text-xs text-red-400">{createError}</p>
						{/if}
						<div class="flex justify-end">
							<button
								onclick={handleCreate}
								disabled={creating || !serverName.trim()}
								class="rounded-md bg-stone-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-stone-500 disabled:cursor-not-allowed disabled:opacity-50"
								>{creating ? "Creating…" : "Create"}</button
							>
						</div>
					</Tabs.Content>

					<Tabs.Content value="join" class="mt-4 space-y-3">
						<div class="flex flex-col gap-1">
							<label for="join-code" class="text-xs font-semibold tracking-wider text-zinc-400 uppercase"
								>Invite Code or Link</label
							>
							<input
								id="join-code"
								type="text"
								bind:value={joinInputValue}
								placeholder="abc123 or invite?code=abc123"
								class="rounded-md bg-zinc-800 px-3 py-2 font-mono text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-stone-500"
							/>
						</div>
						<div class="flex justify-end">
							<button
								onclick={handleJoinSubmit}
								disabled={!joinInputValue.trim()}
								class="rounded-md bg-stone-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-stone-500 disabled:cursor-not-allowed disabled:opacity-50"
								>Preview</button
							>
						</div>
					</Tabs.Content>
				</Tabs.Root>

				<div class="mt-1 flex justify-center">
					<Dialog.Close
						class="rounded-md px-4 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
						>Cancel</Dialog.Close
					>
				</div>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<JoinInviteModal bind:open={showJoinPreview} code={joinCode} />

{#if leaveError}
	<div
		class="fixed right-4 bottom-4 z-50 rounded-lg border border-red-700 bg-red-900/90 px-4 py-3 text-sm text-red-200 shadow-xl"
	>
		{leaveError}
		<button onclick={() => (leaveError = "")} class="ml-3 text-red-400 hover:text-white">✕</button>
	</div>
{/if}
