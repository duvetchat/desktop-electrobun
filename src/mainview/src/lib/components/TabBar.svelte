<script lang="ts">
	import { countBadgeClass } from "$lib/components/ui/recipes";
	import {
		Columns2 as ColumnsIcon,
		Search as SearchIcon,
		Users as UsersIcon,
		Volume2 as SpeakerIcon,
		X as XIcon,
	} from "@lucide/svelte";
	import type { Tab } from "$lib/types";
	import { listStep } from "$lib/focus-wrap";
	import { tabDigit } from "$lib/keyboard";
	import { currentShell } from "$lib/platform";
	import { getAvatarURL } from "$lib/common/common";
	import { t } from "$lib/i18n";
	import { formatList } from "$lib/i18n/format";
	import { isConversationTab, tabDragData, tabFromDragData, tabNews, tabTitle, tabTooltip } from "$lib/pane";
	import { chipCount, mentionsLabel, stripDrop, tabDropTarget, type StripHalf } from "$lib/shell-layout";
	import { conversations, currentUser, gatewaySpaces, typingNow } from "$lib/stores.svelte";
	import { shownMentionCounts, shownUnreadConversations, shownUnreadRooms } from "$lib/notification-marks";
	import { typingSentence } from "$lib/typing";
	import { scrollSideways } from "$lib/sideways-scroll";
	import TabIcon from "$lib/components/TabIcon.svelte";
	import ContextMenu from "$lib/components/ui/ContextMenu.svelte";
	import MenuItem from "$lib/components/ui/MenuItem.svelte";
	import MenuSeparator from "$lib/components/ui/MenuSeparator.svelte";
	import MenuSub from "$lib/components/ui/MenuSub.svelte";

	// The tabs of the title bar's strip (#357, S-02): the focused pane's open chats, one row that scrolls sideways once
	// full. The pane tree is the app's (lib/pane.ts): each pane keeps its own tabs, and the strip shows the focused
	// one's. In a split, the active tab is drawn as the design's joined pair: a half for each pane of the split, the
	// focused one marked; a press on a half focuses its pane, and the strip then lists that pane's tabs. While the
	// Friends page shows, its tab leads the row, active.
	let {
		tabs,
		activeTabId,
		leafId,
		halves = [],
		friendsActive = false,
		closeKeys = undefined,
		onSelect,
		onClose,
		onReorder,
		onChannelDrop,
		onJoin,
		onFocusHalf = () => {},
		onSeparate = null,
		onSplitWith = null,
		onSplitWithChat = null,
	}: {
		tabs: Tab[];
		activeTabId: string | null;
		leafId: string;
		/** The panes of a split and what each shows (stripHalves); empty for a lone pane. */
		halves?: StripHalf[];
		friendsActive?: boolean;
		/** Close tab's shortcut, written for this system. */
		closeKeys?: string;
		onSelect: (channelId: string) => void;
		onClose: (channelIds: string[]) => void;
		onReorder: (newOrder: Tab[]) => void;
		/** A room or a conversation dropped between two tabs: it opens as a tab there (`at`), or at the end. */
		onChannelDrop: (tab: Tab, at: number | null) => void;
		/** A room or a conversation dropped on a tab's middle: it opens beside. */
		onJoin: (tab: Tab) => void;
		onFocusHalf?: (leafId: string) => void;
		/** Puts a split back into one pane, its chats as tabs; null without a split. */
		onSeparate?: (() => void) | null;
		/** Shows two of this pane's tabs side by side: the first stays, the second moves to a pane on its right. */
		onSplitWith?: ((keepId: string, moveId: string) => void) | null;
		/** Opens the quick switcher to pick a chat to open beside. */
		onSplitWithChat?: (() => void) | null;
	} = $props();

	let barEl: HTMLElement;
	let tabEls = $state<(HTMLElement | null)[]>([]);
	let dragSrcIndex = $state<number | null>(null);
	let dropIndex = $state<number | null>(null);
	// The tab something is dragged onto the middle of: dropped there, it opens beside.
	let joinTargetId = $state<string | null>(null);
	let sidebarDragOver = $state(false);

	// Where the pointer is over the strip (lib/shell-layout.ts: tabDropTarget), from where its tabs are drawn now.
	function dropTarget(clientX: number): { index: number; joinId: string | null } {
		return tabDropTarget(
			tabEls.map((el) => {
				if (!el) return null;
				const rect = el.getBoundingClientRect();
				return { id: el.dataset.tabId ?? null, left: rect.left, right: rect.right, width: rect.width };
			}),
			clientX,
		);
	}

	function handleTabDragStart(e: DragEvent, origIndex: number) {
		const tab = tabs[origIndex];
		if (!tab) return;
		dragSrcIndex = origIndex;
		e.dataTransfer!.effectAllowed = "move";
		e.dataTransfer!.setData("text/plain", tabDragData(tab, { type: "tab", index: origIndex, sourceLeafId: leafId }));
	}

	function handleBarDragOver(e: DragEvent) {
		// Files are the chat's to take, not the strip's.
		if (!e.dataTransfer?.types.includes("text/plain")) return;
		e.preventDefault();
		const target = dropTarget(e.clientX);
		if (dragSrcIndex !== null) {
			e.dataTransfer.dropEffect = "move";
			// A tab can't join itself.
			const self = tabs[dragSrcIndex]?.channelId;
			joinTargetId = target.joinId && target.joinId !== self ? target.joinId : null;
		} else {
			e.dataTransfer.dropEffect = "copy";
			sidebarDragOver = true;
			joinTargetId = target.joinId;
		}
		dropIndex = joinTargetId ? null : target.index;
	}

	function handleBarDragLeave(e: DragEvent) {
		const bar = e.currentTarget as HTMLElement;
		if (!bar.contains(e.relatedTarget as Node)) clearDrag(false);
	}

	function clearDrag(source = true) {
		if (source) dragSrcIndex = null;
		dropIndex = null;
		joinTargetId = null;
		sidebarDragOver = false;
	}

	function handleBarDrop(e: DragEvent) {
		e.preventDefault();
		const raw = e.dataTransfer?.getData("text/plain") ?? "";
		const at = dropIndex;
		const joinId = joinTargetId;
		const from = dragSrcIndex;
		clearDrag();
		let data: {
			type: string;
			index?: number;
			channelId?: string;
			channelName?: string;
			channelType?: string;
			spaceId?: string;
			kind?: unknown;
		};
		try {
			data = JSON.parse(raw);
		} catch {
			return;
		}
		const dropped = tabFromDragData(data);
		if (!dropped) return;

		// A tab of this strip: onto another's middle it joins it, side by side; between two it moves there. A room or a
		// conversation from the sidebar: on a tab's middle it opens beside, between two as a tab there.
		const drop = stripDrop(tabs, dropped, data.type === "tab", from, at, joinId);
		if (!drop) return;
		if (drop.kind === "split") onSplitWith?.(drop.keepId, drop.moveId);
		else if (drop.kind === "reorder") onReorder(drop.tabs);
		else if (drop.kind === "join") onJoin(drop.tab);
		else onChannelDrop(drop.tab, drop.at);
	}

	// The tabs stay on one row, which scrolls sideways once they don't fit: a mouse's wheel scrolls it
	// too, and the active tab is kept in view.
	function handleBarWheel(e: WheelEvent) {
		scrollSideways(e, barEl);
	}

	$effect(() => {
		void [activeTabId, tabs.length, friendsActive];
		barEl.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
	});

	function spaceOf(tab: Tab): { name: string; icon: string | null } | null {
		if (isConversationTab(tab)) return null;
		const space = $gatewaySpaces.find((s) => s.id === tab.spaceId);
		if (!space) return null;
		return { name: space.name, icon: space.icon ? (getAvatarURL(space.id, space.icon) ?? null) : null };
	}

	const previewTabs = $derived(
		(() => {
			const all = tabs.map((each, i) => ({ ...each, origIndex: i }));
			if (dragSrcIndex === null || dropIndex === null) return all;
			const arr = [...all];
			const [moved] = arr.splice(dragSrcIndex, 1);
			if (!moved) return all;
			let insertAt = dropIndex > dragSrcIndex ? dropIndex - 1 : dropIndex;
			insertAt = Math.max(0, Math.min(insertAt, arr.length));
			arr.splice(insertAt, 0, moved);
			return arr;
		})(),
	);

	// A split's halves stand in the active tab's place; a focused pane without tabs has them at the row's end.
	const paired = $derived(halves.length > 1 && !friendsActive);
	const halfTitle = (half: StripHalf) =>
		half.tab ? tabTitle(half.tab, $conversations, $currentUser?.id) : t("shell_new_tab");
	const pairTitles = $derived(halves.map(halfTitle));
	// The joined tab's name for a screen reader: its panes' chats as a list, in one sentence.
	const pairLabel = $derived(t("shell_split_pair", { chats: formatList(pairTitles) }));

	const tabBase =
		"group/tab relative flex h-[34px] min-w-28 shrink items-center gap-1 rounded-[10px] text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-duvet-accent";
	const tabActive = "bg-duvet-card text-duvet-ink shadow-duvet-raised ring-duvet-line ring-[0.5px]";
	const tabIdle = "text-duvet-ink2 hover:bg-duvet-hover hover:text-duvet-ink";
	const closeButton =
		"text-duvet-ink2 hover:bg-duvet-hover-strong hover:text-duvet-ink focus-visible:outline-duvet-accent col-start-1 row-start-1 grid size-5 shrink-0 place-items-center rounded-md focus-visible:opacity-100 focus-visible:outline-2";
	// A Close button that shows only once its tab is pointed at or has the focus.
	const closeOnHover = "opacity-0 group-focus-within/tab:opacity-100 group-hover/tab:opacity-100";
	const halfButton =
		"focus-visible:outline-duvet-accent flex h-[26px] min-w-0 flex-1 items-center gap-[7px] rounded-[7px] px-1.5 text-left focus-visible:outline-2";

	// A digit with ⌘ on macOS, or Ctrl elsewhere, picks a tab by its place (lib/keyboard.ts: tabDigit). In the app each
	// tab names its shortcut to assistive tech, and on macOS shows it (#420): always, where its Close button is, which
	// takes the place back while the tab is pointed at or has the focus. Not in a browser, which keeps those keys for its
	// own tabs.
	const shell = currentShell();
	const digitModifier = shell.chrome === "web" ? null : shell.os === "mac" ? "Meta" : "Control";
	const showsDigits = shell.chrome === "mac";
	const shortcutOf = (digit: number | null) => (digit && digitModifier ? `${digitModifier}+${digit}` : undefined);
	const keysOf = (digit: number | null) => (digit && showsDigits ? `⌘${digit}` : null);

	// The strip is one tab stop, as a tab list is: the open tab (or the first, when the open one is a split, whose
	// halves are buttons). Arrow Left and Right, Home and End move the focus between tabs; Enter or Space opens one.
	const noTabStop = $derived(!friendsActive && !previewTabs.some((each) => each.channelId === activeTabId && !paired));
	function tabKeys(e: KeyboardEvent, select?: () => void) {
		// A key on the tab's Close button is that button's.
		if (e.target !== e.currentTarget) return;
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			select?.();
			return;
		}
		const key = e.key === "ArrowRight" ? "ArrowDown" : e.key === "ArrowLeft" ? "ArrowUp" : e.key;
		if (e.key === "ArrowDown" || e.key === "ArrowUp") return;
		const all = [...(barEl?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
		const to = listStep(all.length, all.indexOf(e.currentTarget as HTMLElement), key);
		if (to === null) return;
		e.preventDefault();
		all[to]?.focus();
	}
</script>

{#snippet roomMark(tab: Tab)}
	{#if !isConversationTab(tab)}
		{#if tab.channelType === "voice"}
			<SpeakerIcon class="text-duvet-alive-text size-3.5 shrink-0" aria-hidden="true" />
		{:else}
			<span class="text-duvet-ink2" aria-hidden="true">#</span>
		{/if}
	{/if}
{/snippet}

<!-- A tab's trailing slot: its Close button, and over it the tab's shortcut where it shows one. `shown` keeps the
     button in view, as the open tab's is; under a shortcut it waits for the pointer or the focus, as the others do. -->
{#snippet closeSlot(channelId: string, shown: boolean, keys: string | null, slotClass = "")}
	<span class="grid shrink-0 place-items-center {slotClass}">
		{#if keys}
			<kbd
				class="text-duvet-ink2 col-start-1 row-start-1 font-sans text-[11px] leading-none font-normal tabular-nums group-focus-within/tab:opacity-0 group-hover/tab:opacity-0"
				aria-hidden="true">{keys}</kbd
			>
		{/if}
		<button
			type="button"
			class="{closeButton} {shown && !keys ? '' : closeOnHover}"
			onclick={(e) => {
				e.stopPropagation();
				onClose([channelId]);
			}}
			aria-label={t("shell_close_tab")}
		>
			<XIcon class="size-3" />
		</button>
	</span>
{/snippet}

<!-- A split's panes, side by side in one tab: a press on one focuses its pane. -->
{#snippet pairHalves()}
	{#each halves as half, at (half.leafId)}
		{#if at > 0}<span class="bg-duvet-line mx-0.5 h-4 w-px shrink-0" aria-hidden="true"></span>{/if}
		<button
			type="button"
			class="{halfButton} {half.focused ? 'bg-duvet-hover text-duvet-ink' : 'text-duvet-ink2 hover:text-duvet-ink'}"
			aria-pressed={half.focused}
			onclick={() => onFocusHalf(half.leafId)}
		>
			{#if half.tab}
				<span class="grid size-[18px] shrink-0 place-items-center">
					<TabIcon tab={half.tab} size={12} space={spaceOf(half.tab)} />
				</span>
				<span class="flex min-w-0 items-center gap-0.5 truncate">
					{@render roomMark(half.tab)}<span class="truncate">{halfTitle(half)}</span>
				</span>
			{:else}
				<span class="grid size-[18px] shrink-0 place-items-center"><SearchIcon class="size-3.5" /></span>
				<span class="truncate">{t("shell_new_tab")}</span>
			{/if}
		</button>
	{/each}
{/snippet}

<div
	bind:this={barEl}
	class="titlebar-actions flex h-full min-w-0 shrink items-center gap-1 overflow-x-auto overflow-y-hidden px-0.5 py-1 select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden {sidebarDragOver &&
	!joinTargetId
		? 'bg-duvet-accent-tint rounded-xl'
		: ''}"
	role="tablist"
	aria-label={t("shell_open_chats")}
	tabindex="-1"
	onwheel={handleBarWheel}
	ondragover={handleBarDragOver}
	ondragleave={handleBarDragLeave}
	ondrop={handleBarDrop}
>
	{#if friendsActive}
		<div
			class="{tabBase} {tabActive} w-36 pr-2.5 pl-2.5"
			role="tab"
			aria-selected="true"
			tabindex="0"
			onkeydown={(e) => tabKeys(e)}
		>
			<span class="grid size-[18px] shrink-0 place-items-center"><UsersIcon class="size-3.5" /></span>
			<span class="min-w-0 flex-1 truncate">{t("shell_friends")}</span>
		</div>
	{/if}

	{#each previewTabs as tab, i (tab.channelId)}
		{@const isActive = tab.channelId === activeTabId && !friendsActive}
		{@const news = tabNews(tab, $shownUnreadRooms, $shownUnreadConversations, $shownMentionCounts)}
		{@const mentions = news.mentions}
		{@const unread = !isActive && news.unread}
		{@const title = tabTitle(tab, $conversations, $currentUser?.id)}
		{@const typing = typingSentence($typingNow[tab.channelId])}
		{@const others = tabs.filter((each) => each.channelId !== tab.channelId)}
		{@const digit = tabDigit(i, previewTabs.length)}
		<!-- A right click opens the tab's own menu, not the webview's. -->
		<ContextMenu>
			{#snippet target(props)}
				{#if isActive && paired}
					<!-- The joined tab: each pane of the split, side by side. -->
					<div
						{...props}
						class="{tabBase} {tabActive} w-[340px] min-w-[200px] gap-0 pr-1 pl-1 {dragSrcIndex === tab.origIndex
							? 'opacity-40'
							: ''}"
						role="tab"
						tabindex="-1"
						aria-selected="true"
						aria-label={pairLabel}
						aria-keyshortcuts={shortcutOf(digit)}
						title={pairTitles.join(" · ")}
						data-tab-id={tab.channelId}
						draggable="true"
						ondragstart={(e) => handleTabDragStart(e, tab.origIndex)}
						ondragend={() => clearDrag()}
						onauxclick={(e) => e.button === 1 && onClose([tab.channelId])}
						bind:this={tabEls[i]}
					>
						{@render pairHalves()}
						{@render closeSlot(tab.channelId, true, keysOf(digit), "ml-0.5")}
					</div>
				{:else}
					<div
						{...props}
						class="{tabBase} w-[200px] pr-1 pl-2.5 {isActive ? tabActive : tabIdle} {dragSrcIndex === tab.origIndex
							? 'opacity-40'
							: ''} {joinTargetId === tab.channelId
							? 'bg-duvet-accent-tint ring-duvet-accent ring-[1.5px] ring-inset'
							: ''}"
						title={tabTooltip(tab, title, $gatewaySpaces, typing)}
						role="tab"
						tabindex={isActive || (noTabStop && i === 0) ? 0 : -1}
						aria-selected={isActive}
						aria-keyshortcuts={shortcutOf(digit)}
						data-tab-id={tab.channelId}
						draggable="true"
						ondragstart={(e) => handleTabDragStart(e, tab.origIndex)}
						ondragend={() => clearDrag()}
						onclick={() => onSelect(tab.channelId)}
						onauxclick={(e) => e.button === 1 && onClose([tab.channelId])}
						onkeydown={(e) => tabKeys(e, () => onSelect(tab.channelId))}
						bind:this={tabEls[i]}
					>
						<!-- Drop insertion indicator -->
						{#if dropIndex === i && (dragSrcIndex === null ? sidebarDragOver : dragSrcIndex !== tab.origIndex)}
							<div class="bg-duvet-accent absolute top-1.5 bottom-1.5 -left-[3px] w-0.5 rounded-full"></div>
						{/if}

						<span class="grid size-[18px] shrink-0 place-items-center">
							<TabIcon {tab} size={12} space={spaceOf(tab)} />
						</span>
						{#if typing}<span class="sr-only">{typing}</span>{/if}
						<span class="flex min-w-0 flex-1 items-center gap-0.5 {unread ? 'text-duvet-ink font-semibold' : ''}">
							{@render roomMark(tab)}<span class="truncate">{title}</span>
						</span>
						{#if mentions > 0 && !isActive}
							<span class={countBadgeClass("sm")} role="img" aria-label={mentionsLabel(mentions)}
								>{chipCount(mentions)}</span
							>
						{:else if unread}
							<span class="bg-duvet-accent size-1.5 shrink-0 rounded-full" role="img" aria-label={t("shell_unread")}
							></span>
						{/if}
						{@render closeSlot(tab.channelId, isActive, keysOf(digit))}
					</div>
				{/if}
			{/snippet}
			{#if halves.length > 1 && onSeparate}
				<MenuItem onSelect={onSeparate}>{t("shell_separate_split")}</MenuItem>
			{:else if onSplitWith}
				<MenuSub label={t("shell_split_with")} icon={ColumnsIcon}>
					{#each others as other (other.channelId)}
						<MenuItem onSelect={() => onSplitWith(tab.channelId, other.channelId)}>
							{tabTitle(other, $conversations, $currentUser?.id)}
						</MenuItem>
					{:else}
						<MenuItem disabled>{t("shell_no_other_tabs")}</MenuItem>
					{/each}
				</MenuSub>
			{/if}
			{#if onSplitWithChat}
				<MenuItem
					onSelect={() => {
						onSelect(tab.channelId);
						onSplitWithChat();
					}}>{t("shell_split_with_chat")}</MenuItem
				>
			{/if}
			<MenuSeparator />
			<MenuItem keys={closeKeys} onSelect={() => onClose([tab.channelId])}>{t("shell_close_tab")}</MenuItem>
			<MenuItem disabled={tabs.length < 2} onSelect={() => onClose(others.map((other) => other.channelId))}>
				{t("shell_close_other_tabs")}
			</MenuItem>
			<MenuItem
				disabled={tab.origIndex === 0}
				onSelect={() => onClose(tabs.slice(0, tab.origIndex).map((left) => left.channelId))}
			>
				{t("shell_close_tabs_left")}
			</MenuItem>
			<MenuItem
				disabled={tab.origIndex === tabs.length - 1}
				onSelect={() => onClose(tabs.slice(tab.origIndex + 1).map((right) => right.channelId))}
			>
				{t("shell_close_tabs_right")}
			</MenuItem>
			<MenuSeparator />
			<MenuItem onSelect={() => onClose(tabs.map((open) => open.channelId))}>{t("shell_close_all_tabs")}</MenuItem>
		</ContextMenu>
	{/each}

	<!-- A pane with no chat open: its tab says so, alone or as its half of a split. -->
	{#if !activeTabId && !friendsActive}
		{#if paired}
			<div
				class="{tabBase} {tabActive} w-[340px] min-w-[200px] gap-0 pr-1 pl-1"
				role="tab"
				tabindex="-1"
				aria-selected="true"
				aria-label={pairLabel}
				title={pairTitles.join(" · ")}
			>
				{@render pairHalves()}
			</div>
		{:else if tabs.length === 0}
			<div class="{tabBase} {tabActive} w-36 pr-2.5 pl-2.5" role="tab" aria-selected="true" tabindex="0">
				<span class="grid size-[18px] shrink-0 place-items-center"><SearchIcon class="size-3.5" /></span>
				<span class="min-w-0 flex-1 truncate">{t("shell_new_tab")}</span>
			</div>
		{/if}
	{/if}

	<!-- After-last-tab drop indicator -->
	{#if dropIndex === previewTabs.length && (dragSrcIndex !== null || sidebarDragOver)}
		<div class="flex h-full items-center px-0.5">
			<div class="bg-duvet-accent h-5/6 w-0.5 rounded-full"></div>
		</div>
	{/if}
	{#if sidebarDragOver && !joinTargetId}
		<span class="text-duvet-accent-text shrink-0 px-2 text-xs font-semibold whitespace-nowrap"
			>{t("shell_open_room")}</span
		>
	{/if}
</div>
