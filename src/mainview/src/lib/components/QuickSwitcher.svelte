<script lang="ts">
	import { Hash as HashIcon, Search as SearchIcon, Volume2 as SpeakerSimpleHighIcon } from "@lucide/svelte";
	import { Dialog } from "bits-ui";
	import { tick } from "svelte";
	import { getAvatarURL } from "$lib/common/common";
	import { canViewRoom, shownRooms } from "$lib/permissions";
	import { rankByQuery } from "$lib/nav";
	import {
		conversations,
		currentUser,
		friends,
		gatewaySpaces,
		mentionCounts,
		unreadChannels,
		unreadConversations,
	} from "$lib/stores.svelte";
	import SpaceIcon from "$lib/components/SpaceIcon.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";

	/** Jumping to a space, a room of any space, a conversation or a friend by typing part of its name. */
	let {
		open = $bindable(false),
		onSpace,
		onRoom,
		onConversation,
		onFriend,
	}: {
		open?: boolean;
		onSpace: (spaceId: string) => void;
		onRoom: (spaceId: string, roomId: string) => void;
		onConversation: (conversationId: string) => void;
		onFriend: (userId: string) => void;
	} = $props();

	type Item =
		| { kind: "space"; key: string; id: string; name: string; icon: string | null }
		| {
				kind: "room";
				key: string;
				id: string;
				spaceId: string;
				name: string;
				spaceName: string;
				voice: boolean;
				mentions: number;
				unread: boolean;
		  }
		| {
				kind: "conversation";
				key: string;
				id: string;
				name: string;
				sub: string;
				avatar: string | null;
				unread: boolean;
		  }
		| { kind: "friend"; key: string; userId: string; name: string; avatar: string | null };

	let query = $state("");
	let activeIndex = $state(0);
	let inputEl = $state<HTMLInputElement | null>(null);
	let listEl = $state<HTMLElement | null>(null);

	const allItems = $derived.by((): Item[] => {
		const me = $currentUser?.id;
		const items: Item[] = [];
		for (const space of $gatewaySpaces) {
			items.push({
				kind: "space",
				key: `space:${space.id}`,
				id: space.id,
				name: space.name,
				icon: space.icon ? (getAvatarURL(space.id, space.icon) ?? null) : null,
			});
		}
		for (const space of $gatewaySpaces) {
			// A room the user can view shows, as in the sidebar; categories aren't places to go.
			for (const room of shownRooms(space)) {
				if (room.type === 3 || !canViewRoom(space, room)) continue;
				items.push({
					kind: "room",
					key: `room:${room.id}`,
					id: room.id,
					spaceId: space.id,
					name: room.name,
					spaceName: space.name,
					voice: room.type === 2,
					mentions: $mentionCounts[room.id] ?? 0,
					unread: $unreadChannels.has(room.id) || !!$mentionCounts[room.id],
				});
			}
		}
		const dmWith = new Set<string>();
		for (const conv of $conversations) {
			const other = conv.members.find((m) => m.user_id !== me);
			if (conv.type === 1 && other) dmWith.add(other.user_id);
			items.push({
				kind: "conversation",
				key: `conv:${conv.id}`,
				id: conv.id,
				name: conv.type === 2 ? (conv.name ?? "Group") : (other?.user?.alias ?? other?.user?.username ?? "DM"),
				sub: conv.type === 2 ? `${conv.members.length} members` : "Direct message",
				avatar: conv.type === 2 ? null : (getAvatarURL(other?.user_id ?? "", other?.user?.avatar) ?? null),
				unread: $unreadConversations.has(conv.id),
			});
		}
		// Friends without a conversation yet: picking one starts it.
		for (const friend of $friends) {
			const userId = friend.sender_id === me ? friend.recipient_id : friend.sender_id;
			if (dmWith.has(userId)) continue;
			items.push({
				kind: "friend",
				key: `friend:${userId}`,
				userId,
				name: friend.user_alias ?? friend.user_username,
				avatar: getAvatarURL(userId, friend.user_avatar) ?? null,
			});
		}
		return items;
	});

	const MAX_RESULTS = 50;

	// With nothing typed: what has news first (mentions, then unread rooms and conversations), then the spaces.
	const results = $derived.by(() => {
		if (query.trim()) return rankByQuery(allItems, query, (item) => item.name).slice(0, MAX_RESULTS);
		const mentionsOf = (i: Item) => (i.kind === "room" ? i.mentions : 0);
		const withNews = allItems
			.filter((i) => (i.kind === "room" || i.kind === "conversation") && i.unread)
			.sort((a, b) => mentionsOf(b) - mentionsOf(a));
		return [...withNews, ...allItems.filter((i) => i.kind === "space")].slice(0, MAX_RESULTS);
	});

	// Each time it opens, it opens empty, on the first result.
	let wasOpen = false;
	$effect(() => {
		if (open && !wasOpen) {
			query = "";
			activeIndex = 0;
		}
		wasOpen = open;
	});

	$effect(() => {
		void query;
		activeIndex = 0;
	});

	$effect(() => {
		if (activeIndex >= results.length) activeIndex = Math.max(0, results.length - 1);
	});

	async function scrollActiveIntoView() {
		await tick();
		listEl?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
	}

	function choose(item: Item | undefined) {
		if (!item) return;
		open = false;
		if (item.kind === "space") onSpace(item.id);
		else if (item.kind === "room") onRoom(item.spaceId, item.id);
		else if (item.kind === "conversation") onConversation(item.id);
		else onFriend(item.userId);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
			e.preventDefault();
			if (results.length) activeIndex = (activeIndex + 1) % results.length;
			void scrollActiveIntoView();
		} else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
			e.preventDefault();
			if (results.length) activeIndex = (activeIndex - 1 + results.length) % results.length;
			void scrollActiveIntoView();
		} else if (e.key === "Enter" && !e.isComposing) {
			e.preventDefault();
			choose(results[activeIndex]);
		}
	}

	const optionId = (index: number) => `quick-switcher-option-${index}`;
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-300 bg-black/50" />
		<Dialog.Content
			class="rounded-card bg-duvet-card text-duvet-ink shadow-duvet-float fixed top-[14vh] left-1/2 z-300 flex max-h-[70vh] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden"
			onOpenAutoFocus={(e) => {
				e.preventDefault();
				inputEl?.focus();
			}}
		>
			<Dialog.Title class="sr-only">Jump to a space, room or conversation</Dialog.Title>
			<div class="border-duvet-line flex shrink-0 items-center gap-2.5 border-b px-4">
				<SearchIcon class="text-duvet-ink2 size-4 shrink-0" />
				<input
					bind:this={inputEl}
					bind:value={query}
					type="text"
					class="text-duvet-ink placeholder:text-duvet-ink2 focus-override h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none"
					placeholder="Where to?"
					role="combobox"
					aria-label="Search spaces, rooms and conversations"
					aria-expanded="true"
					aria-controls="quick-switcher-list"
					aria-autocomplete="list"
					aria-activedescendant={results.length ? optionId(activeIndex) : undefined}
					autocomplete="off"
					spellcheck="false"
					onkeydown={handleKeydown}
				/>
			</div>
			<ul
				bind:this={listEl}
				id="quick-switcher-list"
				role="listbox"
				aria-label="Results"
				class="min-h-0 flex-1 overflow-y-auto p-2"
			>
				{#each results as item, index (item.key)}
					{@const isActive = index === activeIndex}
					<!-- The input keeps the focus: the keyboard moves the active option, the pointer picks one. -->
					<li
						id={optionId(index)}
						role="option"
						aria-selected={isActive}
						class="rounded-row flex cursor-pointer items-center gap-3 px-2.5 py-2 {isActive
							? 'bg-duvet-chosen text-duvet-chosen-ink'
							: ''}"
						onmousemove={() => (activeIndex = index)}
						onmousedown={(e) => e.preventDefault()}
						onclick={() => choose(item)}
						onkeydown={() => {}}
					>
						{#if item.kind === "space"}
							<span class="contents" aria-hidden="true"
								><SpaceIcon src={item.icon} name={item.name} size={24} class="rounded-lg" /></span
							>
						{:else if item.kind === "room"}
							<span
								class="flex size-6 shrink-0 items-center justify-center {item.voice
									? 'text-duvet-alive'
									: 'text-duvet-ink2'}"
							>
								{#if item.voice}<SpeakerSimpleHighIcon class="size-4" />{:else}<HashIcon class="size-4" />{/if}
							</span>
						{:else}
							<UserAvatar src={item.avatar} name={item.name} size={24} />
						{/if}
						<span
							class="min-w-0 flex-1 truncate text-sm {item.kind !== 'space' && 'unread' in item && item.unread
								? 'font-bold'
								: 'font-medium'}"
						>
							{item.name}
						</span>
						<span class="shrink-0 truncate text-xs {isActive ? 'text-duvet-chosen-ink/70' : 'text-duvet-ink2'}">
							{#if item.kind === "space"}Space{:else if item.kind === "room"}{item.spaceName}{:else if item.kind === "conversation"}{item.sub}{:else}Friend{/if}
						</span>
						{#if item.kind === "room" && item.mentions}
							<span
								class="bg-duvet-accent text-duvet-on-accent flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-bold"
								aria-label="{item.mentions} mentions">{item.mentions}</span
							>
						{/if}
					</li>
				{:else}
					<li class="px-3 py-6 text-center text-sm text-duvet-ink2" role="presentation">
						{query.trim() ? `Nothing matches “${query.trim()}”` : "No spaces or conversations yet"}
					</li>
				{/each}
			</ul>
			<p class="border-duvet-line text-duvet-ink2 shrink-0 border-t px-4 py-2 text-xs">
				<kbd class="font-mono">↑</kbd> <kbd class="font-mono">↓</kbd> to move · <kbd class="font-mono">Enter</kbd> to
				open · <kbd class="font-mono">Esc</kbd> to close
			</p>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
