<script lang="ts">
	import { promptDialog } from "$lib/stores/prompt.svelte";
	import { confirmAction } from "$lib/stores/confirm.svelte";
	import {
		Plus as PlusIcon,
		ChevronDown as CaretDownIcon,
		FolderPlus as FolderPlusIcon,
		Users as UsersIcon,
	} from "@lucide/svelte";
	import { ContextMenu } from "bits-ui";
	import { onMount } from "svelte";
	import type { Guild } from "$lib/types";
	import { leaveSpace } from "$lib/api/spaces";
	import SpaceIcon from "$lib/components/SpaceIcon.svelte";
	import AddSpaceModal from "$lib/components/AddSpaceModal.svelte";
	import {
		currentUser,
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

	// ── Add server modal ───────────────────────────────────────────────────────
	let showModal = $state(false);

	function openModal() {
		showModal = true;
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

	// The spaces the user owns, which the API won't let them leave: they can only delete one.
	const ownedSpaceIds = $derived(
		new Set($gatewaySpaces.filter((s) => s.owner_id === $currentUser?.id).map((s) => s.id)),
	);

	// Leaving takes a confirmation, as the other actions that can't be undone do; the dialog shows a failure.
	function handleLeave(guild: Guild) {
		void confirmAction(`Leave "${guild.name}"? You'll need an invite to join it again.`, "Leave", () =>
			leaveSpace(guild.id),
		);
	}
</script>

<nav
	class="from-night-20 to-night-17 flex h-full w-full max-w-16 flex-col justify-start border-r border-stone-800 bg-linear-to-b"
>
	<div class="flex flex-col items-center justify-center gap-1.5 py-2">
		<button
			title="Friends"
			onclick={onFriendsSelect}
			class="relative flex size-9 items-center justify-center rounded-lg transition-all duration-150 {isFriendsActive
				? 'text-fixed-white bg-indigo-600'
				: 'bg-stone-900/65 text-stone-200 hover:bg-stone-800/80 hover:text-stone-100'}"
		>
			<UsersIcon class="size-4" />
			{#if friendsBadgeCount > 0}
				<span
					class="text-fixed-white absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold"
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
						{@const canLeave = !ownedSpaceIds.has(guild.id)}
						<ContextMenu.Root>
							<ContextMenu.Trigger disabled={folders.length === 0 && !canLeave}>
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
											class="text-fixed-white absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-red-600 text-[9px] font-bold ring-2 ring-stone-900"
											>{mentionCountBySpace[guild.id]}</span
										>
									{:else if spacesWithUnread.has(guild.id) && guild.id !== activeGuildId}
										<span
											class="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-stone-900 bg-white"
										></span>
									{/if}
								</button>
							</ContextMenu.Trigger>
							<!-- Nothing to offer the owner when there are no folders: they can't leave their space. The trigger is disabled
							     then, as a right-click would leave the menu open, to show by itself once it had items. -->
							{#if folders.length > 0 || canLeave}
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
											{#if canLeave}
												<div class="my-1 border-t border-zinc-800"></div>
											{/if}
										{/if}
										{#if canLeave}
											<ContextMenu.Item
												class="w-full px-3 py-2 text-left text-sm text-red-400 transition-colors hover:bg-red-500/10"
												onSelect={() => handleLeave(guild)}
											>
												Leave Server
											</ContextMenu.Item>
										{/if}
									</ContextMenu.Content>
								</ContextMenu.Portal>
							{/if}
						</ContextMenu.Root>
					{/each}
				</div>
			{/if}
		{/each}

		{#if ungroupedGuilds.length > 0}
			<div class="my-1.5 h-px w-8 bg-stone-800/80"></div>
			<div role="group" class="flex flex-col items-center gap-1 px-2 py-1">
				{#each ungroupedGuilds as guild}
					{@const canLeave = !ownedSpaceIds.has(guild.id)}
					<ContextMenu.Root>
						<ContextMenu.Trigger disabled={folders.length === 0 && !canLeave}>
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
										class="text-fixed-white absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-red-600 text-[9px] font-bold ring-2 ring-stone-900"
										>{mentionCountBySpace[guild.id]}</span
									>
								{:else if spacesWithUnread.has(guild.id) && guild.id !== activeGuildId}
									<span class="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-stone-900 bg-white"
									></span>
								{/if}
							</button>
						</ContextMenu.Trigger>
						<!-- Nothing to offer the owner when there are no folders: they can't leave their space. The trigger is disabled
						     then, as a right-click would leave the menu open, to show by itself once it had items. -->
						{#if folders.length > 0 || canLeave}
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
										{#if canLeave}
											<div class="my-1 border-t border-zinc-800"></div>
										{/if}
									{/if}
									{#if canLeave}
										<ContextMenu.Item
											class="w-full px-3 py-2 text-left text-sm text-red-400 transition-colors hover:bg-red-500/10"
											onSelect={() => handleLeave(guild)}
										>
											Leave Server
										</ContextMenu.Item>
									{/if}
								</ContextMenu.Content>
							</ContextMenu.Portal>
						{/if}
					</ContextMenu.Root>
				{/each}
			</div>
		{/if}
	</div>
</nav>

<AddSpaceModal bind:open={showModal} />
