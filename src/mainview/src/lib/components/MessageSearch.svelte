<script lang="ts">
	import {
		Hash as HashIcon,
		MessageCircle as MessageCircleIcon,
		Search as SearchIcon,
		X as XIcon,
	} from "@lucide/svelte";
	import { tick } from "svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import MentionProfile from "$lib/components/MentionProfile.svelte";
	import MessagePreview from "$lib/components/MessagePreview.svelte";
	import ImagePreview from "$lib/components/ImagePreview.svelte";
	import { searchSpaceMessages, type MessageSearch } from "$lib/api/messages";
	import { searchConversationMessages, type DirectMessage } from "$lib/api/conversations";
	import { getApiError } from "$lib/api/api";
	import { friendUser } from "$lib/friends";
	import { conversationTitle } from "$lib/pane";
	import {
		conversations,
		currentUser,
		friends,
		gatewaySpaces,
		jumpToMessageRequest,
		spaceEmojis,
	} from "$lib/stores.svelte";
	import { gatewayMessageToMessage } from "$lib/types";
	import type { GatewaySpace, MemberOnSidebar, Message, SpaceEmoji } from "$lib/types";
	import type { MessageLink } from "$lib/urls";
	import { canViewRoom } from "$lib/permissions";
	import { customEmojiMapOf, escapeHtml, mentionMapOf, mentionNamesIn, sameNames } from "$lib/markdown";
	import { afterPress } from "$lib/press";
	import {
		isoDay,
		parseSearch,
		roomSlug as slug,
		searchEverywhere,
		SEARCH_HAS as HAS,
		type FoundMessage,
	} from "$lib/search";

	// The search box of a pane's bar (or a conversation's header), and the panel of its results. The panel is absolute:
	// it covers the right side of the nearest positioned ancestor, the pane, under its 3rem bar. In a narrow pane (its
	// container, under 48rem) the box folds to its icon until it's focused or holds a search, and its suggestions open
	// from its left edge, where the pane has room for them.
	let {
		space = null,
		conversationId = "",
		members = [],
		customEmojis = [],
		toDirectMessage,
		everywhere = false,
		onJump = (link) => jumpToMessageRequest.set({ id: crypto.randomUUID(), ...link }),
	}: {
		/** The space whose rooms are searched. A conversation's search passes conversationId instead. */
		space?: GatewaySpace | null;
		conversationId?: string;
		/** Whom from: and mentions: suggest, and the names mentions show in the results. */
		members?: MemberOnSidebar[];
		customEmojis?: SpaceEmoji[];
		/** How a conversation's results become messages. */
		toDirectMessage?: (m: DirectMessage) => Message;
		/**
		 * Searches every Space the user is in and their 5 newest conversations at once, as the mobile app's search does:
		 * the 20 newest messages found, newest first, each saying where it is. The filters that name a member or a room,
		 * which are a Space's or a conversation's, stay out of it.
		 */
		everywhere?: boolean;
		/** Opens a result's message. */
		onJump?: (link: MessageLink) => void;
	} = $props();

	const locale = typeof navigator !== "undefined" ? navigator.language : "en-US";
	const today = isoDay(new Date());

	type Filter = { key: string; description: string };
	const filters = $derived<Filter[]>([
		...(everywhere
			? []
			: [
					{ key: "from", description: "Messages by a member" },
					{ key: "mentions", description: "Messages that mention a member" },
				]),
		...(space ? [{ key: "in", description: "Messages in a room" }] : []),
		{ key: "has", description: "link, embed, file, image, video, sound or sticker" },
		{ key: "pinned", description: "true or false: pinned messages, or the others" },
		{ key: "before", description: `Messages before a date, like ${today}` },
		{ key: "after", description: "Messages after a date" },
		{ key: "during", description: "Messages on a date" },
	]);

	const rooms = $derived.by(() => {
		const s = space;
		return s ? s.rooms.filter((r) => r.type === 1 && canViewRoom(s, r)) : [];
	});
	// The names mentions show: a new map only when one of them changes, not with every change of the members (a
	// presence, a voice state), which drew every message's text again (#324).
	let mentionNames: Record<string, string> = {};
	const mentionMap = $derived.by(() => {
		const next = mentionMapOf(members);
		if (!sameNames(next, mentionNames)) mentionNames = next;
		return mentionNames;
	});
	const customEmojiMap = $derived(customEmojiMapOf(customEmojis));
	let mentionProfile: MentionProfile;

	// ── The box and its suggestions ──────────────────────────────────────────
	let input = $state<HTMLInputElement | null>(null);
	let text = $state("");
	let caret = $state(0);
	let focused = $state(false);
	// Escape and Enter hide the suggestions until the next keystroke.
	let dismissed = $state(false);
	// The suggestion the arrow keys are on; at -1, Enter searches.
	let selected = $state(-1);
	let box = $state<HTMLElement | null>(null);
	// A press elsewhere takes the focus from the empty box, which then shrinks (to its icon, in a narrow pane) and moves
	// what's left of it in the bar, the pins and members buttons among them, from under the pointer before the press
	// ends: the press would end on something else, and its click would be lost (#80). So the box keeps its width until
	// the press has ended and made its click.
	let pressHeld = $state(false);
	$effect(() => {
		if (!focused) return;
		const onPress = (e: PointerEvent) => {
			if (box?.contains(e.target as Node)) return;
			pressHeld = true;
			afterPress(window, () => (pressHeld = false));
		};
		window.addEventListener("pointerdown", onPress, true);
		return () => window.removeEventListener("pointerdown", onPress, true);
	});

	// The word the caret is in: where it starts, and its text up to the caret.
	const token = $derived.by(() => {
		const before = text.slice(0, caret);
		const start = before.search(/\S*$/);
		return { start, value: before.slice(start) };
	});

	type Suggestion = { key: string; label: string; detail?: string; insert: string; avatar?: string | null };
	const suggestions = $derived.by<Suggestion[]>(() => {
		if (!focused || dismissed) return [];
		const m = /^(\w+):(\S*)$/.exec(token.value);
		if (!m) {
			const typed = token.value.toLowerCase();
			return filters
				.filter((f) => f.key.startsWith(typed))
				.map((f) => ({ key: f.key, label: `${f.key}:`, detail: f.description, insert: `${f.key}:` }));
		}
		const key = m[1]!.toLowerCase();
		const value = m[2]!.toLowerCase();
		if (key === "from" || key === "mentions") {
			return members
				.filter((u) => u.raw_username.toLowerCase().startsWith(value) || u.username.toLowerCase().startsWith(value))
				.slice(0, 8)
				.map((u) => ({
					key: u.id,
					label: u.username,
					detail: u.raw_username === u.username ? undefined : u.raw_username,
					insert: `${key}:${u.raw_username} `,
					avatar: u.avatar_url,
				}));
		}
		if (key === "in") {
			return rooms
				.filter((r) => slug(r.name).startsWith(value))
				.slice(0, 8)
				.map((r) => ({ key: r.id, label: `#${r.name}`, insert: `in:${slug(r.name)} ` }));
		}
		if (key === "pinned") {
			return ["true", "false"]
				.filter((v) => v.startsWith(value))
				.map((v) => ({ key: v, label: v, insert: `pinned:${v} ` }));
		}
		if (key === "has") {
			return HAS.filter((v) => v.startsWith(value)).map((v) => ({ key: v, label: v, insert: `has:${v} ` }));
		}
		if ((key === "before" || key === "after" || key === "during") && today.startsWith(value)) {
			return [{ key: today, label: today, detail: "Today", insert: `${key}:${today} ` }];
		}
		return [];
	});

	function syncCaret() {
		caret = input?.selectionStart ?? text.length;
		syncScroll();
	}

	// The box's text again, with each filter in a label, as Discord shows them: a mirror under the
	// input, whose own text is transparent, so the input keeps the caret and the editing. Both use the
	// same font and padding, and the mirror scrolls with the input.
	const FILTER_KEY = /^(from|mentions|in|has|pinned|before|after|during):/i;
	const mirrorHtml = $derived(
		text
			.split(/(\s+)/)
			.map((part) => {
				const key = FILTER_KEY.exec(part)?.[0];
				if (!key) return escapeHtml(part);
				const value = escapeHtml(part.slice(key.length));
				return `<span class="rounded-sm bg-stone-700 shadow-[0_0_0_2px_var(--color-stone-700)]"><span class="text-stone-400">${escapeHtml(key)}</span>${value}</span>`;
			})
			.join(""),
	);
	let mirror = $state<HTMLElement | null>(null);
	function syncScroll() {
		if (mirror && input) mirror.scrollLeft = input.scrollLeft;
	}

	// Puts the suggestion in place of the word the caret is in.
	async function apply(s: Suggestion) {
		const rest = text.slice(caret + (text.slice(caret).match(/^\S*/)?.[0].length ?? 0));
		const at = token.start + s.insert.length;
		text = text.slice(0, token.start) + s.insert + (s.insert.endsWith(" ") ? rest.replace(/^ /, "") : rest);
		selected = -1;
		await tick();
		input?.focus();
		input?.setSelectionRange(at, at);
		caret = at;
	}

	function onkeydown(e: KeyboardEvent) {
		const n = suggestions.length;
		if (n && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
			e.preventDefault();
			selected = e.key === "ArrowDown" ? (selected + 1) % n : (selected - 1 + n) % n;
		} else if (n && (e.key === "Tab" || (e.key === "Enter" && selected >= 0))) {
			e.preventDefault();
			const pick = suggestions[Math.max(selected, 0)];
			if (pick) void apply(pick);
		} else if (e.key === "Enter") {
			e.preventDefault();
			dismissed = true;
			void run();
		} else if (e.key === "Escape") {
			if (n) dismissed = true;
			else {
				close();
				input?.blur();
			}
		}
	}

	// ── The search ───────────────────────────────────────────────────────────
	type Result = FoundMessage;
	let open = $state(false);
	let loading = $state(false);
	let failure = $state<string | null>(null);
	let results = $state.raw<Result[]>([]);
	let total = $state(0);
	// The search the panel shows, and its words for the highlights.
	let shown: MessageSearch | null = null;
	let hitWords = $state<string[]>([]);
	let controller: AbortController | null = null;

	async function run(more = false) {
		if (!more) {
			if (!text.trim()) return close();
			const parsed =
				everywhere && /(?:^|\s)(?:from|mentions|in):\S/i.test(text)
					? { error: "from:, mentions: and in: search a Space or a conversation" }
					: parseSearch(text, members, rooms);
			open = true;
			results = [];
			total = 0;
			if ("error" in parsed) {
				controller?.abort();
				loading = false;
				failure = parsed.error;
				return;
			}
			shown = parsed.search;
			hitWords = (shown.query ?? "")
				.split(/[^\p{L}\p{N}]+/u)
				.filter(Boolean)
				.map(fold);
		}
		if (!shown) return;
		controller?.abort();
		const ctl = (controller = new AbortController());
		const search = { ...shown, cursor: more ? results.at(-1)?.message.id : undefined };
		loading = true;
		failure = null;
		try {
			let page: Result[];
			if (everywhere) {
				({ found: page, total } = await searchEverywhere(search, $gatewaySpaces, $conversations, ctl.signal));
			} else if (space) {
				const res = await searchSpaceMessages(space.id, search, ctl.signal);
				page = res.messages.map((m) => ({ message: gatewayMessageToMessage(m, $gatewaySpaces), roomId: m.room_id }));
				total = res.total_results;
			} else {
				const res = await searchConversationMessages(conversationId, search, ctl.signal);
				const convert = toDirectMessage;
				page = convert ? res.messages.map((m) => ({ message: convert(m), roomId: null })) : [];
				total = res.total_results;
			}
			results = more ? [...results, ...page] : page;
		} catch (err) {
			if (ctl.signal.aborted) return;
			failure = getApiError(err, "The search failed");
		} finally {
			if (controller === ctl) loading = false;
		}
	}

	function close() {
		controller?.abort();
		open = false;
		loading = false;
		failure = null;
		results = [];
		total = 0;
		shown = null;
		hitWords = [];
	}

	function clear() {
		text = "";
		caret = 0;
		close();
		input?.focus();
	}

	// A result's image opens over the app.
	let previewSrc = $state("");
	let previewAlt = $state("");
	let previewOpen = $state(false);
	function openPreview(src: string, alt = "") {
		previewSrc = src;
		previewAlt = alt;
		previewOpen = true;
	}

	function jump(e: MouseEvent | KeyboardEvent, r: Result) {
		// A link, a button (like Show more) or a file in the message is its own: a click on it doesn't jump.
		if (e.target instanceof Element && e.target.closest("a, button, [data-attachments]")) return;
		const spaceId = r.spaceId ?? space?.id;
		onJump(
			spaceId && r.roomId
				? { spaceId, roomId: r.roomId, messageId: r.message.id }
				: { spaceId: "", roomId: "", messageId: r.message.id, conversationId: r.conversationId ?? conversationId },
		);
	}

	const roomName = (id: string) => space?.rooms.find((r) => r.id === id)?.name ?? "unknown-room";

	// Where a result found everywhere is: its room and Space, or its conversation.
	function whereOf(r: Result): string {
		if (r.conversationId) {
			const conversation = $conversations.find((c) => c.id === r.conversationId);
			return conversation ? conversationTitle(conversation, $currentUser?.id) : "Direct message";
		}
		const found = $gatewaySpaces.find((s) => s.id === r.spaceId);
		return `${found?.rooms.find((room) => room.id === r.roomId)?.name ?? "unknown-room"} · ${found?.name ?? "Space"}`;
	}
	// The names of the people results found everywhere mention, as the app knows them, and every custom emoji it has.
	const everyone = $derived(
		everywhere
			? [
					...$gatewaySpaces.flatMap((s) => s.users),
					...$conversations.flatMap((c) => c.members.flatMap((m) => m.user ?? [])),
					...$friends.map((f) => friendUser(f, $currentUser?.id)),
					...($currentUser ? [$currentUser] : []),
				]
			: [],
	);
	const everyEmoji = $derived(everywhere ? customEmojiMapOf(Object.values($spaceEmojis).flat()) : {});

	// ── Highlights ───────────────────────────────────────────────────────────
	// Each character folded about as the API's search_fold does (lower case, no accents), one for one
	// so a match's offsets are the text's.
	function fold(s: string): string {
		return Array.from(s, (ch) => {
			const base = ch.normalize("NFD")[0]!.toLowerCase();
			return base.length === ch.length ? base : ch;
		}).join("");
	}
	// The words where they start a word, through its end, as the API matches them (a one-letter word
	// only alone). They are letters and digits only, so nothing in them needs escaping.
	function hitPattern(words: string[]): RegExp | null {
		if (!words.length) return null;
		const alternatives = words.map((w) => ([...w].length > 1 ? `${w}[\\p{L}\\p{N}]*` : `${w}(?![\\p{L}\\p{N}])`));
		return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join("|")})`, "gu");
	}

	let resultsEl = $state<HTMLElement | null>(null);
	// The words found in the results, through the CSS Custom Highlight API (::highlight(search-hit) in
	// app.css). Every panel adds its ranges to the one Highlight, since split panes can show several.
	$effect(() => {
		const el = resultsEl;
		const pattern = hitPattern(hitWords);
		void results;
		if (!el || !pattern || typeof Highlight === "undefined") return;
		const ranges: Range[] = [];
		for (const content of el.querySelectorAll("[data-search-content]")) {
			const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				for (const m of fold(node.textContent ?? "").matchAll(pattern)) {
					const range = new Range();
					range.setStart(node, m.index);
					range.setEnd(node, m.index + m[0].length);
					ranges.push(range);
				}
			}
		}
		let hits = CSS.highlights.get("search-hit");
		if (!hits) {
			hits = new Highlight();
			CSS.highlights.set("search-hit", hits);
		}
		const highlight = hits;
		for (const r of ranges) highlight.add(r);
		return () => {
			for (const r of ranges) highlight.delete(r);
		};
	});
</script>

<div
	bind:this={box}
	class="border-duvet-line bg-duvet-sunk focus-within:border-duvet-accent relative flex h-8 shrink-0 items-center rounded-lg border transition-[width,border-color] motion-reduce:transition-none {open
		? 'w-64'
		: text
			? 'w-48'
			: pressHeld
				? 'w-64 @max-3xl/pane:w-44'
				: 'w-48 focus-within:w-64 @max-3xl/pane:w-8 @max-3xl/pane:not-focus-within:overflow-hidden @max-3xl/pane:focus-within:w-44'}"
>
	<SearchIcon class="text-duvet-ink2 pointer-events-none absolute left-2.5 size-3.5" />
	<!-- 2px wider on the left than the input's text so a first label's background shows whole -->
	<div aria-hidden="true" class="pointer-events-none absolute inset-0 pr-7 pl-7.5">
		<div
			bind:this={mirror}
			class="text-duvet-ink h-full overflow-hidden pl-0.5 text-xs leading-7.5 font-medium whitespace-pre"
		>
			{@html mirrorHtml}
		</div>
	</div>
	<input
		bind:this={input}
		bind:value={text}
		placeholder={everywhere ? "Search everywhere" : "Search messages"}
		aria-label={everywhere ? "Search messages everywhere" : "Search messages"}
		spellcheck="false"
		class="caret-duvet-ink placeholder:text-duvet-ink2 relative z-10 h-full w-full border-none bg-transparent pr-7 pl-8 text-xs font-medium text-transparent focus:ring-0 focus:outline-none"
		onscroll={syncScroll}
		oninput={() => {
			syncCaret();
			dismissed = false;
			selected = -1;
		}}
		onkeyup={syncCaret}
		onclick={syncCaret}
		onfocus={() => {
			focused = true;
			syncCaret();
		}}
		onblur={() => {
			focused = false;
			dismissed = false;
		}}
		{onkeydown}
	/>
	{#if text}
		<button
			class="absolute right-1.5 flex size-5 items-center justify-center rounded text-stone-500 hover:text-stone-200"
			aria-label="Clear the search"
			onclick={clear}
		>
			<XIcon class="size-3.5" />
		</button>
	{/if}

	{#if suggestions.length > 0}
		<!-- mousedown would blur the box before the click picks a suggestion -->
		<div
			role="listbox"
			tabindex="-1"
			class="absolute top-full right-0 z-40 mt-1 flex w-80 flex-col gap-0.5 rounded-lg border border-stone-800 bg-stone-950 p-1.5 font-normal shadow-xl @max-3xl/pane:right-auto @max-3xl/pane:left-0 @max-3xl/pane:w-64"
			onmousedown={(e) => e.preventDefault()}
		>
			{#each suggestions as s, i (s.key)}
				<button
					role="option"
					aria-selected={i === selected}
					class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs {i === selected
						? 'bg-stone-800'
						: 'hover:bg-stone-800/60'}"
					onclick={() => apply(s)}
				>
					{#if s.avatar !== undefined}
						<UserAvatar src={s.avatar} name={s.label} size={20} />
					{/if}
					<span class="shrink-0 font-semibold text-stone-100">{s.label}</span>
					{#if s.detail}
						<span class="truncate text-stone-500">{s.detail}</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>

{#if open}
	<aside
		class="absolute top-12 right-0 bottom-0 z-30 flex w-104 max-w-full flex-col border-l border-stone-800 bg-stone-950 font-normal shadow-2xl"
		aria-label="Search results"
	>
		<div class="flex h-10 shrink-0 items-center justify-between border-b border-stone-800 px-3">
			<span class="text-sm font-semibold text-stone-100">
				{#if failure}
					Search
				{:else if loading && results.length === 0}
					Searching…
				{:else}
					<!-- Everywhere, the newest found of them all -->
					{#if everywhere && results.length < total}{results.length} of{/if}
					{total >= 1000 ? "1,000+" : total.toLocaleString(locale)}
					{total === 1 ? "result" : "results"}
				{/if}
			</span>
			<button
				class="flex size-6 items-center justify-center rounded text-stone-400 hover:bg-stone-800 hover:text-stone-200"
				aria-label="Close the search"
				onclick={close}
			>
				<XIcon class="size-4" />
			</button>
		</div>
		<div
			bind:this={resultsEl}
			class="flex flex-1 flex-col gap-1.5 overflow-y-auto p-2"
			onclickcapture={(e) => mentionProfile.open(e)}
		>
			{#if failure}
				<p class="px-2 py-8 text-center text-xs text-red-400">{failure}</p>
			{:else if !loading && results.length === 0}
				<p class="px-2 py-8 text-center text-xs text-stone-500">No messages match this search</p>
			{/if}
			{#each results as r (r.message.id)}
				<div
					role="button"
					tabindex="0"
					class="flex shrink-0 cursor-pointer flex-col gap-1 rounded-md border border-stone-800/80 bg-stone-900/60 px-3 py-2 text-left transition-colors hover:border-stone-700 hover:bg-stone-900"
					onclick={(e) => jump(e, r)}
					onkeydown={(e) => {
						if (e.key === "Enter") jump(e, r);
					}}
				>
					{#if everywhere}
						<!-- As a room's result names its room: here its Space too, or its conversation -->
						<div class="text-xxs flex items-center gap-0.5 font-semibold text-stone-500">
							{#if r.conversationId}
								<MessageCircleIcon class="size-3" />
							{:else}
								<HashIcon class="size-3" />
							{/if}
							{whereOf(r)}
						</div>
					{/if}
					<MessagePreview
						message={r.message}
						spaceId={r.spaceId ?? space?.id ?? ""}
						channelId={r.roomId ?? r.conversationId ?? conversationId}
						roomName={!everywhere && r.roomId ? roomName(r.roomId) : null}
						members={everywhere ? [] : members}
						mentionMap={everywhere ? mentionNamesIn(r.message.content ?? "", everyone) : mentionMap}
						customEmojiMap={everywhere ? everyEmoji : customEmojiMap}
						onPreview={openPreview}
					/>
				</div>
			{/each}
			{#if !everywhere && !failure && results.length > 0 && results.length < total}
				<button
					class="shrink-0 rounded-md py-2 text-xs font-medium text-stone-400 hover:bg-stone-900 hover:text-stone-200 disabled:opacity-50"
					disabled={loading}
					onclick={() => run(true)}
				>
					{loading ? "Loading…" : "More results"}
				</button>
			{/if}
		</div>
	</aside>
{/if}

<ImagePreview src={previewSrc} alt={previewAlt} bind:open={previewOpen} />
<MentionProfile bind:this={mentionProfile} {members} {space} />
