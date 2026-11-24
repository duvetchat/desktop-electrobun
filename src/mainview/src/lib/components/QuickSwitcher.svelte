<script lang="ts">
	import { claimLayer, layerStyle, releaseLayer } from "$lib/overlay-layers";
	import { Hash as HashIcon, Search as SearchIcon, Volume2 as SpeakerSimpleHighIcon } from "@lucide/svelte";
	import { Dialog } from "bits-ui";
	import { tick } from "svelte";
	import { getAvatarURL } from "$lib/common/common";
	import { friendUser } from "$lib/friends";
	import { t } from "$lib/i18n";
	import { formatNumber } from "$lib/i18n/format";
	import { canViewRoom, shownRooms } from "$lib/permissions";
	import { rankByQuery } from "$lib/nav";
	import { mentionsLabel } from "$lib/shell-layout";
	import { conversations, currentUser, friends, gatewaySpaces } from "$lib/stores.svelte";
	import { shownMentionCounts, shownUnreadConversations, shownUnreadRooms } from "$lib/notification-marks";
	import SpaceIcon from "$lib/components/ui/SpaceIcon.svelte";
	import GroupMark from "$lib/components/GroupMark.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import Kbd from "$lib/components/ui/Kbd.svelte";
	import { countBadgeClass, GLASS_STRONG } from "$lib/components/ui/recipes";

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
				/** Drawn with the group's mark rather than a face, as its tab is: a group, which has no picture (#376). */
				group: boolean;
				avatar: string | null;
				mentions: number;
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
					mentions: $shownMentionCounts[room.id] ?? 0,
					unread: $shownUnreadRooms.has(room.id) || !!$shownMentionCounts[room.id],
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
				name:
					conv.type === 2
						? (conv.name ?? t("shell_chat_group_untitled"))
						: (other?.user?.alias ?? other?.user?.username ?? t("shell_chat_dm_untitled")),
				sub: conv.type === 2 ? t("shell_group_members", { count: conv.members.length }) : t("shell_chat_kind_dm"),
				group: conv.type === 2 || !other,
				avatar: conv.type === 2 ? null : (getAvatarURL(other?.user_id ?? "", other?.user?.avatar) ?? null),
				mentions: $shownMentionCounts[conv.id] ?? 0,
				unread: $shownUnreadConversations.has(conv.id) || !!$shownMentionCounts[conv.id],
			});
		}
		// Friends without a conversation yet: picking one starts it.
		for (const friend of $friends) {
			const other = friendUser(friend, me);
			if (dmWith.has(other.id)) continue;
			items.push({
				kind: "friend",
				key: `friend:${other.id}`,
				userId: other.id,
				name: other.alias ?? other.username,
				avatar: getAvatarURL(other.id, other.avatar) ?? null,
			});
		}
		return items;
	});

	const MAX_RESULTS = 50;

	// With nothing typed: what has news first (mentions, then unread rooms and conversations), then the spaces.
	const results = $derived.by(() => {
		if (query.trim()) return rankByQuery(allItems, query, (item) => item.name).slice(0, MAX_RESULTS);
		const mentionsOf = (i: Item) => (i.kind === "room" || i.kind === "conversation" ? i.mentions : 0);
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

	// What opens last is in front, whatever opened it (lib/overlay-layers.ts).
	const layer = $derived(open ? claimLayer() : 0);
	$effect(() => {
		const mine = layer;
		if (mine) return () => releaseLayer(mine);
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay style={layerStyle(layer)} class="bg-duvet-scrim animate-scrim-in fixed inset-0 z-[900]" />
		<Dialog.Content
			style={layerStyle(layer)}
			class="{GLASS_STRONG} animate-pop text-duvet-ink fixed top-[11vh] left-1/2 z-[900] flex max-h-[66vh] w-[min(640px,calc(100%-48px))] origin-top -translate-x-1/2 flex-col overflow-hidden rounded-[20px] outline-none"
			onOpenAutoFocus={(e) => {
				e.preventDefault();
				inputEl?.focus();
			}}
		>
			<Dialog.Title class="sr-only">{t("shell_switcher_title")}</Dialog.Title>
			<div class="border-duvet-line flex shrink-0 items-center gap-3 border-b px-4 py-3.5">
				<SearchIcon size={18} class="text-duvet-ink2 shrink-0" />
				<input
					bind:this={inputEl}
					bind:value={query}
					type="text"
					class="text-duvet-ink placeholder:text-duvet-ink2 focus-override min-w-0 flex-1 bg-transparent text-[17px] leading-[1.2] outline-none"
					placeholder={t("shell_switcher_placeholder")}
					role="combobox"
					aria-label={t("shell_switcher_search")}
					aria-expanded="true"
					aria-controls="quick-switcher-list"
					aria-autocomplete="list"
					aria-activedescendant={results.length ? optionId(activeIndex) : undefined}
					autocomplete="off"
					spellcheck="false"
					onkeydown={handleKeydown}
				/>
				<Kbd>{t("keys_esc")}</Kbd>
			</div>
			<ul
				bind:this={listEl}
				id="quick-switcher-list"
				role="listbox"
				aria-label={t("shell_switcher_results")}
				class="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-2"
			>
				{#each results as item, index (item.key)}
					{@const isActive = index === activeIndex}
					<!-- The input keeps the focus: the keyboard moves the active option, the pointer picks one. -->
					<li
						id={optionId(index)}
						role="option"
						aria-selected={isActive}
						class="flex h-10 cursor-pointer items-center gap-2.5 rounded-[11px] px-2.5 {isActive
							? 'bg-duvet-accent-tint'
							: ''}"
						onmousemove={() => (activeIndex = index)}
						onmousedown={(e) => e.preventDefault()}
						onclick={() => choose(item)}
						onkeydown={() => {}}
					>
						{#if item.kind === "space"}
							<span class="contents" aria-hidden="true"><SpaceIcon src={item.icon} name={item.name} size={24} /></span>
						{:else if item.kind === "room"}
							<span
								class="bg-duvet-secondary-fill grid size-6 shrink-0 place-items-center rounded-[7px] {item.voice
									? 'text-duvet-alive-text'
									: 'text-duvet-ink2'}"
							>
								{#if item.voice}<SpeakerSimpleHighIcon size={15} />{:else}<HashIcon size={15} />{/if}
							</span>
						{:else if item.kind === "conversation" && item.group}
							<GroupMark size={24} />
						{:else}
							<UserAvatar src={item.avatar} name={item.name} size={24} />
						{/if}
						<span
							class="max-w-[60%] min-w-0 truncate text-[13.5px] {item.kind !== 'space' &&
							'unread' in item &&
							item.unread
								? 'font-bold'
								: 'font-medium'}"
						>
							{item.name}
						</span>
						<span class="text-duvet-ink2 min-w-0 flex-1 truncate text-xs">
							{#if item.kind === "space"}{t(
									"shell_switcher_kind_space",
								)}{:else if item.kind === "room"}{item.spaceName}{:else if item.kind === "conversation"}{item.sub}{:else}{t(
									"shell_switcher_kind_friend",
								)}{/if}
						</span>
						{#if (item.kind === "room" || item.kind === "conversation") && item.mentions}
							<span class={countBadgeClass("sm")} role="img" aria-label={mentionsLabel(item.mentions)}
								>{formatNumber(item.mentions)}</span
							>
						{/if}
						{#if isActive}
							<span class="text-duvet-accent-text shrink-0 text-[11.5px] font-medium" aria-hidden="true"
								>{t("shell_switcher_open")}</span
							>
						{/if}
					</li>
				{:else}
					<li class="px-3 py-8 text-center text-[13px] text-duvet-ink2" role="presentation">
						{query.trim() ? t("shell_switcher_no_match", { query: query.trim() }) : t("shell_switcher_empty")}
					</li>
				{/each}
			</ul>
			<p class="border-duvet-line text-duvet-ink2 shrink-0 border-t px-4 py-[9px] text-[11.5px]">
				{t("shell_switcher_help")}
			</p>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
