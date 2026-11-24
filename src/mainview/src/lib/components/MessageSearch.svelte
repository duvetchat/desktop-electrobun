<script lang="ts" module>
	// The last Search Duvet the search everywhere took: once each, though the friends view mounts its box anew.
	let takenSearch: string | null = null;
</script>

<script lang="ts">
	import { claimLayer, layerStyle, releaseLayer } from "$lib/overlay-layers";
	import {
		Hash as HashIcon,
		MessageCircle as MessageCircleIcon,
		Search as SearchIcon,
		X as XIcon,
	} from "@lucide/svelte";
	import { Popover } from "bits-ui";
	import { tick, untrack } from "svelte";
	import { GLASS, iconButtonClass } from "$lib/components/ui/recipes";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import MentionProfile from "$lib/components/MentionProfile.svelte";
	import MessagePreview from "$lib/components/MessagePreview.svelte";
	import ImagePreview from "$lib/components/ImagePreview.svelte";
	import { searchSpaceMessages, type MessageSearch } from "$lib/api/messages";
	import { searchConversationMessages, type DirectMessage } from "$lib/api/conversations";
	import { getApiError } from "$lib/api/api";
	import { friendUser } from "$lib/friends";
	import { t, type MessageKey } from "$lib/i18n";
	import { conversationTitle } from "$lib/pane";
	import {
		conversations,
		currentUser,
		friends,
		gatewaySpaces,
		jumpToMessageRequest,
		everyEmoji,
		searchEverywhereRequest,
	} from "$lib/stores.svelte";
	import { gatewayMessageToMessage } from "$lib/types";
	import type { GatewaySpace, MemberOnSidebar, Message } from "$lib/types";
	import type { MessageLink } from "$lib/urls";
	import { canViewRoom } from "$lib/permissions";
	import { escapeHtml, mentionMapOf, mentionNamesIn, sameNames } from "$lib/markdown";
	import { afterPress } from "$lib/press";
	import {
		isoDay,
		parseSearch,
		roomSlug as slug,
		searchEverywhere,
		SEARCH_HAS as HAS,
		type FoundMessage,
	} from "$lib/search";

	// The search box of a pane's bar (or a conversation's header), and the popover that drops from it: the suggestions
	// for the word being typed, then the results. Nothing is docked beside the chat (#357): the popover is in the page's
	// top layer, under the box and aligned to its end, kept inside the window. In a narrow pane (its container, under
	// 48rem) the box folds to its icon until it's focused or holds a search.
	let {
		space = null,
		conversationId = "",
		members = [],
		toDirectMessage,
		everywhere = false,
		onJump = (link) => jumpToMessageRequest.set({ id: crypto.randomUUID(), ...link }),
	}: {
		/** The space whose rooms are searched. A conversation's search passes conversationId instead. */
		space?: GatewaySpace | null;
		conversationId?: string;
		/** Whom from: and mentions: suggest, and the names mentions show in the results. */
		members?: MemberOnSidebar[];
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

	// Names the suggestions' list and its rows, which the box points a screen reader at: the focus stays in the box
	// while the arrows move through them. The box stays a text box (not a combobox): its results aren't a list to pick
	// from, and Enter searches.
	const uid = $props.id();

	const today = isoDay(new Date());

	// The filters, typed as they are in any language, and what each finds: its message.
	type Filter = { key: string; description: MessageKey };
	const filters = $derived<Filter[]>([
		...(everywhere
			? []
			: [
					{ key: "from", description: "chat_search_filter_from" as const },
					{ key: "mentions", description: "chat_search_filter_mentions" as const },
				]),
		...(space ? [{ key: "in", description: "chat_search_filter_in" as const }] : []),
		{ key: "has", description: "chat_search_filter_has" },
		{ key: "pinned", description: "chat_search_filter_pinned" },
		{ key: "before", description: "chat_search_filter_before" },
		{ key: "after", description: "chat_search_filter_after" },
		{ key: "during", description: "chat_search_filter_during" },
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
				.map((f) => ({
					key: f.key,
					label: `${f.key}:`,
					detail: t(f.description, { date: today }),
					insert: `${f.key}:`,
				}));
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
			return [{ key: today, label: today, detail: t("chat_search_today"), insert: `${key}:${today} ` }];
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
				return `<span class="rounded-sm bg-duvet-secondary-fill shadow-[0_0_0_2px_var(--duvet-secondary-fill)]"><span class="text-duvet-ink2">${escapeHtml(key)}</span>${value}</span>`;
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
	// The results put away without being forgotten: a press outside them, or a jump to one, hides them until the box is
	// focused again. Their × forgets them.
	let hidden = $state(false);
	let panel = $state<HTMLElement | null>(null);
	let loading = $state(false);
	// The API's answer to a search that failed, in its words (getApiError).
	let failure = $state<string | null>(null);
	// A search that couldn't be read keeps what it was read with, not its sentence, which is said as the panel draws, in
	// the language of the moment: Settings, its own window, can switch it while the panel is open.
	let unparsed = $state.raw<{ text: string; members: MemberOnSidebar[]; rooms: typeof rooms } | null>(null);
	const parseError = $derived.by(() => {
		if (!unparsed) return null;
		const parsed = readSearch(unparsed.text, unparsed.members, unparsed.rooms);
		return "error" in parsed ? parsed.error : null;
	});
	const shownFailure = $derived(parseError ?? failure);
	let results = $state.raw<Result[]>([]);
	let total = $state(0);
	// What the results' head says: how many were found, 1,000 and more as 1,000+, and how many of them show (some: the
	// search everywhere shows the newest only).
	const resultsKey = (some: boolean, over: boolean): MessageKey =>
		some
			? over
				? "chat_search_results_some_over"
				: "chat_search_results_some"
			: over
				? "chat_search_results_over"
				: "chat_search_results";
	const resultsHead = $derived.by(() => {
		const some = everywhere && results.length < total;
		const over = total >= 1000;
		return t(resultsKey(some, over), { shown: results.length, count: Math.min(total, 1000) });
	});
	// The search the panel shows, and its words for the highlights.
	let shown: MessageSearch | null = null;
	let hitWords = $state<string[]>([]);
	let controller: AbortController | null = null;

	/** A search's text read with these members and rooms, or why it can't be. */
	function readSearch(
		query: string,
		people: MemberOnSidebar[],
		places: { id: string; name: string }[],
	): ReturnType<typeof parseSearch> {
		return everywhere && /(?:^|\s)(?:from|mentions|in):\S/i.test(query)
			? { error: t("chat_search_everywhere_filters") }
			: parseSearch(query, people, places);
	}

	async function run(more = false) {
		unparsed = null;
		if (!more) {
			if (!text.trim()) return close();
			const parsed = readSearch(text, members, rooms);
			open = true;
			hidden = false;
			results = [];
			total = 0;
			if ("error" in parsed) {
				controller?.abort();
				loading = false;
				failure = null;
				unparsed = { text, members, rooms };
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
			failure = getApiError(err, t("chat_search_failed"));
		} finally {
			if (controller === ctl) loading = false;
		}
	}

	function close() {
		controller?.abort();
		open = false;
		hidden = false;
		loading = false;
		failure = null;
		unparsed = null;
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

	// Search Duvet, on selected text (the default right-click menu, #423): the text, searched everywhere, as if typed
	// and sent. The app's page shows the friends view, where this box is, as it asks.
	$effect(() => {
		const request = $searchEverywhereRequest;
		if (!everywhere || !request || request.id === takenSearch) return;
		takenSearch = request.id;
		untrack(() => void searchFor(request.text));
	});
	async function searchFor(words: string) {
		text = words;
		caret = words.length;
		selected = -1;
		dismissed = true;
		await tick();
		input?.focus();
		input?.setSelectionRange(caret, caret);
		void run();
	}

	// A result's image opens over the app.
	let previewSrc = $state("");
	let previewAlt = $state("");
	let previewOpen = $state(false);
	function openPreview(src: string, alt = "") {
		// The viewer isn't one of the layered overlays: the results step aside for it, as the pins close for theirs.
		hidden = true;
		previewSrc = src;
		previewAlt = alt;
		previewOpen = true;
	}

	function jump(e: MouseEvent | KeyboardEvent, r: Result) {
		// A link, a button (like Show more) or a file in the message is its own: a click on it doesn't jump.
		if (e.target instanceof Element && e.target.closest("a, button, [data-attachments]")) return;
		const spaceId = r.spaceId ?? space?.id;
		// The results are over the chat the message is in: they step aside for it.
		hidden = true;
		onJump(
			spaceId && r.roomId
				? { spaceId, roomId: r.roomId, messageId: r.message.id }
				: { spaceId: "", roomId: "", messageId: r.message.id, conversationId: r.conversationId ?? conversationId },
		);
	}

	// A result's room's name; "" for a room the app doesn't know, which MessagePreview names, and the voice note bar too,
	// in the language of the moment.
	const roomName = (id: string) => space?.rooms.find((r) => r.id === id)?.name ?? "";

	// Where a result found everywhere is: its room and Space, or its conversation.
	function whereOf(r: Result): string {
		if (r.conversationId) {
			const conversation = $conversations.find((c) => c.id === r.conversationId);
			return conversation ? conversationTitle(conversation, $currentUser?.id) : t("chat_search_direct_message");
		}
		const found = $gatewaySpaces.find((s) => s.id === r.spaceId);
		const room = found?.rooms.find((candidate) => candidate.id === r.roomId)?.name ?? t("chat_search_room_unknown");
		return `${room} · ${found?.name ?? t("chat_search_space_unknown")}`;
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

	// What opens last is in front, whatever opened it (lib/overlay-layers.ts).
	// Whether the popover shows, as one value: the layer is claimed as that turns true, not at each suggestion.
	const popoverOpen = $derived(suggestions.length > 0 || (open && !hidden));
	const layer = $derived(popoverOpen ? claimLayer() : 0);
	$effect(() => {
		const mine = layer;
		if (mine) return () => releaseLayer(mine);
	});
</script>

<div
	bind:this={box}
	class="bg-duvet-field focus-within:bg-duvet-card relative mx-1 flex h-[30px] shrink-0 items-center rounded-[9px] transition-[width,background-color,box-shadow] duration-[220ms] focus-within:shadow-[0_0_0_3px_var(--duvet-accent-tint),0_0_0_1px_var(--duvet-accent)] motion-reduce:transition-none {open
		? 'w-64'
		: text
			? 'w-48'
			: pressHeld
				? 'w-64 @max-3xl/pane:w-44'
				: 'w-48 focus-within:w-64 @max-3xl/pane:w-[30px] @max-3xl/pane:not-focus-within:overflow-hidden @max-3xl/pane:focus-within:w-44'}"
>
	<SearchIcon size={14} class="text-duvet-ink2 pointer-events-none absolute left-2" />
	<!-- 2px wider on the left than the input's text so a first label's background shows whole -->
	<div aria-hidden="true" class="pointer-events-none absolute inset-0 pr-7 pl-7.5">
		<div
			bind:this={mirror}
			class="text-duvet-ink h-full overflow-hidden pl-0.5 text-[12.5px] leading-[30px] font-medium whitespace-pre"
		>
			{@html mirrorHtml}
		</div>
	</div>
	<input
		bind:this={input}
		bind:value={text}
		placeholder={everywhere ? t("chat_search_everywhere_placeholder") : t("chat_search_placeholder")}
		aria-label={everywhere ? t("chat_search_everywhere_label") : t("chat_search_label")}
		aria-autocomplete="list"
		aria-controls={suggestions.length > 0 ? `${uid}-suggestions` : undefined}
		aria-activedescendant={suggestions.length > 0 && selected >= 0 ? `${uid}-suggestion-${selected}` : undefined}
		spellcheck="false"
		class="caret-duvet-ink placeholder:text-duvet-ink2 focus-override relative z-10 h-full w-full border-none bg-transparent pr-7 pl-8 text-[12.5px] font-medium text-transparent focus:ring-0 focus:outline-none"
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
			hidden = false;
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
			class="text-duvet-ink2 hover:text-duvet-ink absolute right-1.5 z-10 flex size-5 items-center justify-center rounded-md"
			aria-label={t("chat_search_clear")}
			onclick={clear}
		>
			<XIcon size={14} />
		</button>
	{/if}
</div>

<!-- One popover under the box, for the suggestions and the results. The box keeps the focus while one types: the
     popover takes none as it opens and gives none back, a press in the box isn't a press outside it, and Escape in
     the box is the box's (it hides the suggestions first, then the results). -->
<Popover.Root
	bind:open={
		() => suggestions.length > 0 || (open && !hidden),
		(next) => {
			if (!next) hidden = true;
		}
	}
>
	<Popover.Portal>
		{#if layer}
			<!-- The panel's positioner takes no layer of its own: this holds it, at the overlay's (lib/overlay-layers.ts). -->
			<div class="fixed top-0 left-0" style={layerStyle(layer)}>
				<Popover.Content
					customAnchor={box}
					side="bottom"
					align="end"
					sideOffset={8}
					collisionPadding={10}
					updatePositionStrategy="always"
					trapFocus={false}
					onOpenAutoFocus={(e) => e.preventDefault()}
					onCloseAutoFocus={(e) => e.preventDefault()}
					onInteractOutside={(e) => {
						if (e.target instanceof Node && box?.contains(e.target)) e.preventDefault();
					}}
					onFocusOutside={(e) => e.preventDefault()}
					onEscapeKeydown={(e) => {
						if (document.activeElement === input) e.preventDefault();
						else if (panel?.contains(document.activeElement)) close();
					}}
					role="dialog"
					aria-label={open && !hidden ? t("chat_search_results_label") : t("chat_search_suggestions")}
					class="{GLASS} animate-float-in text-duvet-ink z-[1000] flex max-h-[min(560px,72vh)] w-[min(420px,calc(100vw-20px))] origin-(--bits-floating-transform-origin) flex-col overflow-hidden rounded-[18px] font-normal outline-none"
				>
					<div bind:this={panel} class="contents">
						{#if suggestions.length > 0}
							<!-- mousedown would blur the box before the click picks a suggestion -->
							<div
								id="{uid}-suggestions"
								role="listbox"
								tabindex="-1"
								aria-label={t("chat_search_suggestions")}
								class="flex shrink-0 flex-col gap-0.5 p-1.5 {open && !hidden ? 'border-duvet-line border-b' : ''}"
								onmousedown={(e) => e.preventDefault()}
							>
								{#each suggestions as s, i (s.key)}
									<button
										id="{uid}-suggestion-{i}"
										role="option"
										aria-selected={i === selected}
										class="flex min-h-8 w-full items-center gap-2 rounded-[9px] px-2 py-1.5 text-left text-[12.5px] {i ===
										selected
											? 'bg-duvet-accent-tint'
											: 'hover:bg-duvet-hover'}"
										onclick={() => apply(s)}
									>
										{#if s.avatar !== undefined}
											<UserAvatar src={s.avatar} name={s.label} size={22} />
										{/if}
										<span class="text-duvet-ink shrink-0 font-semibold">{s.label}</span>
										{#if s.detail}
											<span class="text-duvet-ink2 truncate">{s.detail}</span>
										{/if}
									</button>
								{/each}
							</div>
						{/if}
						{#if open && !hidden}
							<div class="flex shrink-0 items-center justify-between pt-2.5 pr-2 pb-1 pl-3.5">
								<span class="text-duvet-ink2 text-xs font-medium">
									{#if shownFailure}
										{t("chat_search_title")}
									{:else if loading && results.length === 0}
										{t("chat_search_searching")}
									{:else}
										<!-- Everywhere, the newest found of them all; 1,000 and more as 1,000+ -->
										{resultsHead}
									{/if}
								</span>
								<button class={iconButtonClass("sm")} aria-label={t("chat_search_close")} onclick={close}>
									<XIcon size={14} />
								</button>
							</div>
							<div
								bind:this={resultsEl}
								class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1.5 pb-2"
								onclickcapture={(e) => mentionProfile.open(e)}
							>
								{#if shownFailure}
									<p class="text-duvet-danger px-2 py-8 text-center text-xs">{shownFailure}</p>
								{:else if !loading && results.length === 0}
									<p class="text-duvet-ink2 px-2 py-8 text-center text-xs">{t("chat_search_no_results")}</p>
								{/if}
								{#each results as r (r.message.id)}
									<div
										role="button"
										tabindex="0"
										class="hover:bg-duvet-hover focus-visible:bg-duvet-hover flex shrink-0 cursor-pointer flex-col gap-1 rounded-xl p-2 text-left transition-colors motion-reduce:transition-none"
										onclick={(e) => jump(e, r)}
										onkeydown={(e) => {
											if (e.key === "Enter") jump(e, r);
										}}
									>
										{#if everywhere}
											<!-- As a room's result names its room: here its Space too, or its conversation -->
											<div class="text-duvet-ink2 flex items-center gap-0.5 text-[11.5px] font-semibold">
												{#if r.conversationId}
													<MessageCircleIcon size={12} />
												{:else}
													<HashIcon size={12} />
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
											customEmojiMap={$everyEmoji}
											onPreview={openPreview}
										/>
									</div>
								{/each}
								{#if !everywhere && !shownFailure && results.length > 0 && results.length < total}
									<button
										class="text-duvet-accent-text hover:bg-duvet-hover shrink-0 rounded-xl py-2 text-xs font-medium disabled:opacity-45"
										disabled={loading}
										onclick={() => run(true)}
									>
										{loading ? t("chat_search_loading") : t("chat_search_more")}
									</button>
								{/if}
							</div>
						{/if}
					</div>
				</Popover.Content>
			</div>
		{/if}
	</Popover.Portal>
</Popover.Root>

<ImagePreview src={previewSrc} alt={previewAlt} bind:open={previewOpen} />
<MentionProfile bind:this={mentionProfile} {members} {space} />
