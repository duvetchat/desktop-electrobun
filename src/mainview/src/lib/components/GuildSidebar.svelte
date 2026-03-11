<script lang="ts">
import {
	Plus as PlusIcon,
	ChevronDown as CaretDownIcon,
	FolderPlus as FolderPlusIcon,
} from "@lucide/svelte";
import { ContextMenu, Dialog, Tabs } from "bits-ui";
import { onMount } from "svelte";
import type { Guild } from "$lib/types";
import { createSpace } from "$lib/api/spaces";
import { leaveSpace } from "$lib/api/spaces";
import JoinInviteModal from "$lib/components/JoinInviteModal.svelte";

let {
	guilds,
	activeGuildId = null,
	onSelect = () => {},
}: {
	guilds: Guild[];
	activeGuildId?: string | null;
	onSelect?: (guildId: string) => void;
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

function createFolder() {
	const name = window.prompt("Folder name");
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
	folders = folders.map((f) =>
		f.id === folderId ? { ...f, collapsed: !f.collapsed } : f,
	);
	persistFolders();
}

function moveGuildToFolder(guildId: string, folderId: string | null) {
	folders = folders.map((f) => ({
		...f,
		guildIds: f.guildIds.filter((id) => id !== guildId),
	}));
	if (folderId) {
		folders = folders.map((f) =>
			f.id === folderId ? { ...f, guildIds: [...f.guildIds, guildId] } : f,
		);
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

const groupedGuilds = $derived(folders
	.map((folder) => ({
		...folder,
		guilds: folder.guildIds
			.map((id) => guilds.find((g) => g.id === id))
			.filter(Boolean) as Guild[],
	}))
	.filter((folder) => folder.guilds.length > 0));

const groupedIds = $derived(
	new Set(groupedGuilds.flatMap((group) => group.guilds.map((g) => g.id))),
);
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
	class="h-full w-full max-w-16 border-r border-stone-800 bg-[linear-gradient(180deg,oklch(0.2_0.01_80),oklch(0.17_0.008_80))] flex flex-col justify-start"
>
	<div class="flex flex-col items-center justify-center gap-1.5 py-2">
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

	<div role="list" class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-2">
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
									{#if guild.icon_url}
										<img src={guild.icon_url} alt={guild.name} class="size-10 rounded-lg object-cover transition-transform duration-150 group-hover/btn:scale-105" />
									{:else}
										<div class="flex size-10 items-center justify-center rounded-lg text-sm font-bold {guild.id === activeGuildId ? 'bg-stone-700 text-stone-100 ring-1 ring-stone-500/50' : 'bg-stone-900/65 text-stone-200 group-hover/btn:bg-stone-800/80 group-hover/btn:text-stone-100'} transition-all duration-150">{initials(guild.name)}</div>
									{/if}
								</button>
							</ContextMenu.Trigger>
							<ContextMenu.Portal>
								<ContextMenu.Content class="z-50 min-w-44 rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-2xl">
									{#if folders.length > 0}
										<div class="px-3 py-1.5 text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">Move to folder</div>
										<ContextMenu.Item class="w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800 transition-colors" onSelect={() => moveGuildToFolder(guild.id, null)}>
											Ungrouped
										</ContextMenu.Item>
										{#each folders as folder}
											<ContextMenu.Item class="w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800 transition-colors" onSelect={() => moveGuildToFolder(guild.id, folder.id)}>
												{folder.name}
											</ContextMenu.Item>
										{/each}
										<div class="my-1 border-t border-zinc-800"></div>
									{/if}
									<ContextMenu.Item class="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-red-500/10 transition-colors" disabled={leavingGuildId === guild.id} onSelect={() => handleLeave(guild.id)}>
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
								{#if guild.icon_url}
									<img src={guild.icon_url} alt={guild.name} class="size-10 rounded-lg object-cover transition-transform duration-150 group-hover/btn:scale-105" />
								{:else}
									<div class="flex size-10 items-center justify-center rounded-lg text-sm font-bold {guild.id === activeGuildId ? 'bg-stone-700 text-stone-100 ring-1 ring-stone-500/50' : 'bg-stone-900/65 text-stone-200 group-hover/btn:bg-stone-800/80 group-hover/btn:text-stone-100'} transition-all duration-150">{initials(guild.name)}</div>
								{/if}
							</button>
						</ContextMenu.Trigger>
						<ContextMenu.Portal>
							<ContextMenu.Content class="z-50 min-w-44 rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-2xl">
								{#if folders.length > 0}
									<div class="px-3 py-1.5 text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">Move to folder</div>
									<ContextMenu.Item class="w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800 transition-colors" onSelect={() => moveGuildToFolder(guild.id, null)}>
										Ungrouped
									</ContextMenu.Item>
									{#each folders as folder}
										<ContextMenu.Item class="w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800 transition-colors" onSelect={() => moveGuildToFolder(guild.id, folder.id)}>
											{folder.name}
										</ContextMenu.Item>
									{/each}
									<div class="my-1 border-t border-zinc-800"></div>
								{/if}
								<ContextMenu.Item class="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-red-500/10 transition-colors" disabled={leavingGuildId === guild.id} onSelect={() => handleLeave(guild.id)}>
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
			<div class="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4 text-zinc-100">
				<Dialog.Title class="text-white font-bold text-lg text-center">Add a Server</Dialog.Title>
				<p class="text-sm text-zinc-300 text-center -mt-2">Create your own or join one with an invite code.</p>

				<Tabs.Root bind:value={modalTab}>
					<Tabs.List class="grid grid-cols-2 gap-2 p-1 rounded-lg bg-stone-800/80">
						<Tabs.Trigger value="create" class="px-3 py-2 rounded-md text-sm font-semibold data-[state=active]:bg-stone-600 data-[state=active]:text-white text-zinc-300">
							Create
						</Tabs.Trigger>
						<Tabs.Trigger value="join" class="px-3 py-2 rounded-md text-sm font-semibold data-[state=active]:bg-stone-600 data-[state=active]:text-white text-zinc-300">
							Join
						</Tabs.Trigger>
					</Tabs.List>

					<Tabs.Content value="create" class="mt-4 space-y-3">
						<div class="flex flex-col gap-1">
							<label for="server-name" class="text-xs font-semibold uppercase text-zinc-400 tracking-wider">Server Name <span class="text-red-400">*</span></label>
							<input id="server-name" type="text" bind:value={serverName} placeholder="My awesome server" class="bg-zinc-800 text-white rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-stone-500 placeholder:text-zinc-500" maxlength={100} />
						</div>
						<div class="flex flex-col gap-1">
							<label for="server-desc" class="text-xs font-semibold uppercase text-zinc-400 tracking-wider">Description <span class="text-zinc-500">(optional)</span></label>
							<input id="server-desc" type="text" bind:value={serverDescription} placeholder="What's this server about?" class="bg-zinc-800 text-white rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-stone-500 placeholder:text-zinc-500" maxlength={300} />
						</div>
						{#if createError}
							<p class="text-red-400 text-xs">{createError}</p>
						{/if}
						<div class="flex justify-end">
							<button onclick={handleCreate} disabled={creating || !serverName.trim()} class="px-4 py-2 text-sm rounded-md bg-stone-600 hover:bg-stone-500 text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed">{creating ? "Creating…" : "Create"}</button>
						</div>
					</Tabs.Content>

					<Tabs.Content value="join" class="mt-4 space-y-3">
						<div class="flex flex-col gap-1">
							<label for="join-code" class="text-xs font-semibold uppercase text-zinc-400 tracking-wider">Invite Code or Link</label>
							<input id="join-code" type="text" bind:value={joinInputValue} placeholder="abc123 or invite.html?code=abc123" class="bg-zinc-800 text-white rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-stone-500 placeholder:text-zinc-500 font-mono" />
						</div>
						<div class="flex justify-end">
							<button onclick={handleJoinSubmit} disabled={!joinInputValue.trim()} class="px-4 py-2 text-sm rounded-md bg-stone-600 hover:bg-stone-500 text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Preview</button>
						</div>
					</Tabs.Content>
				</Tabs.Root>

				<div class="flex justify-center mt-1">
					<Dialog.Close class="px-4 py-2 text-sm rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors">Cancel</Dialog.Close>
				</div>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<JoinInviteModal bind:open={showJoinPreview} code={joinCode} />

{#if leaveError}
	<div
		class="fixed bottom-4 right-4 z-50 bg-red-900/90 border border-red-700 text-red-200 text-sm rounded-lg px-4 py-3 shadow-xl"
	>
		{leaveError}
		<button
			onclick={() => (leaveError = "")}
			class="ml-3 text-red-400 hover:text-white">✕</button
		>
	</div>
{/if}
