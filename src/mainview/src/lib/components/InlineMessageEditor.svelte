<script lang="ts">
	import { onMount, tick, untrack } from "svelte";
	import { Check, X } from "@lucide/svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import IconButton from "$lib/components/ui/IconButton.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { t } from "$lib/i18n";
	import { roomNames } from "$lib/stores.svelte";
	import { getHostURL } from "$lib/common/common";
	import { caretAt, rawOf, rawOffsetOf } from "$lib/message-box";
	import { richTextHtml } from "$lib/message-rich";
	import { emojiDataNow, loadEmojiData } from "$lib/emoji";
	import { emojiSuggestions, type PickerGroup } from "$lib/space-emojis";
	import type { CustomEmojiMap } from "$lib/markdown";
	import type { GatewayRoom, MemberOnSidebar, SpaceEmoji } from "$lib/types";

	// A message's own text, edited where it is (#357): a rich box on the message's place, with Save and Discard beside
	// it. Its mentions, rooms, custom emoji and Unicode emoji draw as the message draws them, and the raw text they stand
	// for is what Save keeps. Typing @, # or : suggests the same people, rooms and emoji the composer does. Esc discards;
	// Ctrl or ⌘ with Enter saves, as the message box's own edit did.
	type Suggestion =
		| { kind: "mention"; member: MemberOnSidebar }
		| { kind: "room"; room: GatewayRoom }
		| { kind: "emoji"; token: string; name: string; glyph: string; customUrl?: string };

	let {
		content,
		mentionMap = {},
		customEmojiMap = {},
		members = [],
		rooms = [],
		emojiGroups = [],
		spaceId = null,
		onSave,
		onCancel,
	}: {
		content: string;
		/** What each mentioned member reads, by user ID. */
		mentionMap?: Record<string, string>;
		customEmojiMap?: CustomEmojiMap;
		/** The people @ suggests. */
		members?: MemberOnSidebar[];
		/** The rooms # suggests, those the user can view. */
		rooms?: GatewayRoom[];
		/** Every Space's custom emoji, the one being written in first. */
		emojiGroups?: PickerGroup<SpaceEmoji>[];
		/** The Space the message is in, whose custom emoji : suggests first; none in a conversation. */
		spaceId?: string | null;
		onSave: (text: string) => void;
		onCancel: () => void;
	} = $props();

	const attachmentHost = getHostURL();
	const uid = $props.id();
	const customEmojis = $derived(emojiGroups.flatMap((group) => group.items));
	let text = $state(untrack(() => content));
	let editor: HTMLDivElement | null = $state(null);
	let suggestions = $state<Suggestion[]>([]);
	let selected = $state(0);
	let queryStart = $state(-1);
	let queryKind = $state<"mention" | "room" | "emoji" | null>(null);

	function html(raw: string): string {
		return richTextHtml(raw, {
			mentionText: (id) => `@${mentionMap[id] ?? id.slice(0, 8)}`,
			roomText: (id) => `#${$roomNames[id] ?? t("chat_room_unknown")}`,
			customEmoji: (id) => {
				const emoji = customEmojiMap[id];
				return emoji ? { name: emoji.name, url: `${attachmentHost}/attachments/${emoji.attachment_id}` } : null;
			},
		});
	}

	function read() {
		if (editor) text = rawOf(editor);
	}

	function closeSuggestions() {
		suggestions = [];
		selected = 0;
		queryStart = -1;
		queryKind = null;
	}

	function suggestionLabel(): string {
		return queryKind === "mention"
			? t("chat_mention_suggestions")
			: queryKind === "room"
				? t("chat_room_suggestions")
				: t("chat_emoji_suggestions");
	}

	function caretOffset(): number | null {
		if (!editor) return null;
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return null;
		const range = selection.getRangeAt(0);
		if (!editor.contains(range.startContainer)) return null;
		return rawOffsetOf(editor, range.startContainer, range.startOffset);
	}

	function setCaret(offset: number) {
		if (!editor) return;
		const range = document.createRange();
		const place = caretAt<Node>(editor, offset);
		if (!place) {
			range.selectNodeContents(editor);
			range.collapse(false);
		} else if (place.at === "before") {
			range.setStartBefore(place.node);
			range.collapse(true);
		} else if (place.at === "after") {
			range.setStartAfter(place.node);
			range.collapse(true);
		} else {
			range.setStart(place.node, place.at);
			range.collapse(true);
		}
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	}

	function checkAutocomplete() {
		if (!editor) return;
		const offset = caretOffset();
		if (offset === null) return closeSuggestions();
		const raw = rawOf(editor);
		const before = raw.slice(0, offset);

		const mention = /(?<=^|\s)@([\p{L}\p{N}_]*)$/u.exec(before);
		if (mention && members.length > 0) {
			const query = mention[1]!.toLowerCase();
			const matches = members
				.filter((m) => m.raw_username.toLowerCase().startsWith(query) || m.username.toLowerCase().startsWith(query))
				.slice(0, 8)
				.map((member): Suggestion => ({ kind: "mention", member }));
			if (matches.length > 0) {
				suggestions = matches;
				selected = 0;
				queryStart = before.length - mention[0].length;
				queryKind = "mention";
				return;
			}
		}

		const room = /(?<=^|\s)#([\p{L}\p{N}_-]*)$/u.exec(before);
		if (room && rooms.length > 0) {
			const query = room[1]!.toLowerCase();
			const named = [...rooms].sort((a, b) => a.name.localeCompare(b.name));
			const starts = named.filter((r) => r.name.toLowerCase().startsWith(query));
			const contains = named.filter((r) => !starts.includes(r) && r.name.toLowerCase().includes(query));
			const matches = [...starts, ...contains].slice(0, 8).map((r): Suggestion => ({ kind: "room", room: r }));
			if (matches.length > 0) {
				suggestions = matches;
				selected = 0;
				queryStart = before.length - room[0].length;
				queryKind = "room";
				return;
			}
		}

		const emoji = /(?<=^|\s):([\w\d_]{2,})$/.exec(before);
		if (emoji) {
			const query = emoji[1]!;
			const custom = emojiSuggestions(query, customEmojis, spaceId).map(
				(e): Suggestion => ({
					kind: "emoji",
					token: `<:${e.id}:>`,
					name: e.name,
					glyph: "",
					customUrl: `${attachmentHost}/attachments/${e.attachment_id}`,
				}),
			);
			const data = emojiDataNow();
			if (!data) void loadEmojiData().then(() => editor && checkAutocomplete());
			const standard = (data?.searchEmojis(query) ?? []).map(
				(e): Suggestion => ({ kind: "emoji", token: e.emoji, name: e.name, glyph: e.emoji }),
			);
			const matches = [...custom, ...standard].slice(0, 10);
			if (matches.length > 0) {
				suggestions = matches;
				selected = 0;
				queryStart = before.length - emoji[0].length;
				queryKind = "emoji";
				return;
			}
		}

		closeSuggestions();
	}

	function applySuggestion(suggestion: Suggestion) {
		if (!editor || queryStart < 0) return;
		const raw = rawOf(editor);
		const offset = caretOffset() ?? raw.length;
		const token =
			suggestion.kind === "mention"
				? `<@${suggestion.member.id}> `
				: suggestion.kind === "room"
					? `<#${suggestion.room.id}> `
					: suggestion.token;
		const next = raw.slice(0, queryStart) + token + raw.slice(offset);
		text = next;
		editor.innerHTML = html(next);
		editor.focus();
		setCaret(queryStart + token.length);
		closeSuggestions();
	}

	function save() {
		read();
		closeSuggestions();
		onSave(text);
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.isComposing) return;
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			if (suggestions.length > 0) closeSuggestions();
			else onCancel();
			return;
		}
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			save();
			return;
		}
		if (event.key === "Enter" && event.shiftKey) {
			closeSuggestions();
			return;
		}
		if (suggestions.length > 0) {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				const step = event.key === "ArrowDown" ? 1 : -1;
				selected = (selected + step + suggestions.length) % suggestions.length;
				return;
			}
			if (event.key === "Enter" || event.key === "Tab") {
				event.preventDefault();
				const picked = suggestions[selected];
				if (picked) applySuggestion(picked);
			}
		}
	}

	function handleInput(event?: Event) {
		if ((event as InputEvent | undefined)?.isComposing) return;
		read();
		checkAutocomplete();
	}

	function placeCaretAtEnd() {
		if (!editor) return;
		const range = document.createRange();
		range.selectNodeContents(editor);
		range.collapse(false);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	}

	onMount(async () => {
		await tick();
		if (!editor) return;
		editor.innerHTML = html(text);
		editor.focus();
		placeCaretAtEnd();
	});
</script>

<div
	class="bg-duvet-card shadow-duvet-raised ring-duvet-accent/35 flex w-full max-w-[760px] flex-col gap-1 rounded-2xl p-2 ring-1"
>
	<div
		bind:this={editor}
		contenteditable="true"
		role="textbox"
		tabindex="0"
		aria-multiline="true"
		aria-label={t("chat_edit_message")}
		aria-autocomplete="list"
		aria-controls={suggestions.length > 0 ? `${uid}-suggestions` : undefined}
		aria-activedescendant={suggestions.length > 0 ? `${uid}-suggestion-${selected}` : undefined}
		data-placeholder={t("chat_edit_placeholder")}
		oninput={handleInput}
		oncompositionend={handleInput}
		onkeydown={onKeydown}
		onblur={closeSuggestions}
		class="focus-override font-content text-duvet-ink caret-duvet-ink relative block max-h-[45vh] min-h-14 w-full overflow-y-auto bg-transparent px-1 py-1 text-[16px] leading-[1.45] wrap-anywhere whitespace-pre-wrap outline-none select-text {text ===
		''
			? 'before:text-duvet-ink2 before:pointer-events-none before:absolute before:top-1 before:left-1 before:content-[attr(data-placeholder)]'
			: ''}"
	></div>

	{#if suggestions.length > 0}
		<div
			id="{uid}-suggestions"
			role="listbox"
			aria-label={suggestionLabel()}
			class="bg-duvet-bg border-duvet-line rounded-panel max-h-56 overflow-y-auto border p-1.5"
		>
			{#each suggestions as suggestion, i}
				<button
					type="button"
					id="{uid}-suggestion-{i}"
					role="option"
					aria-selected={i === selected}
					class="rounded-tile flex min-h-8 w-full items-center gap-2 px-2 py-1.5 text-left {i === selected
						? 'bg-duvet-accent-tint'
						: ''}"
					onmousedown={(event) => {
						event.preventDefault();
						applySuggestion(suggestion);
					}}
					onmouseenter={() => (selected = i)}
				>
					{#if suggestion.kind === "mention"}
						<UserAvatar src={suggestion.member.avatar_url} name={suggestion.member.username} size={22} />
						<span class="text-duvet-ink min-w-0 flex-1 truncate text-[13px] font-semibold"
							>{suggestion.member.username}</span
						>
						{#if suggestion.member.raw_username !== suggestion.member.username}
							<span class="text-duvet-ink2 shrink-0 text-xs">@{suggestion.member.raw_username}</span>
						{/if}
					{:else if suggestion.kind === "room"}
						<span class="text-duvet-ink2 shrink-0 text-[13px]">#</span>
						<span class="text-duvet-ink min-w-0 flex-1 truncate text-[13px] font-medium">{suggestion.room.name}</span>
					{:else}
						{#if suggestion.customUrl}
							<img
								src={suggestion.customUrl}
								alt={suggestion.name}
								class="size-5 shrink-0 object-contain"
								loading="lazy"
								draggable="false"
							/>
						{:else}
							<span class="shrink-0 text-[16px] leading-none">{suggestion.glyph}</span>
						{/if}
						<span class="text-duvet-ink min-w-0 flex-1 truncate text-[13px] font-medium">{suggestion.name}</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}

	<div class="flex items-center gap-1">
		<span class="text-duvet-ink2 min-w-0 flex-1 truncate px-1 text-[11px]">{t("chat_edit_keys")}</span>
		<IconButton label={t("chat_edit_cancel")} title={t("chat_edit_discard")} size="sm" onclick={onCancel}>
			<X size={15} />
		</IconButton>
		<Button size="sm" onclick={save}>
			<Check size={14} />
			{t("chat_edit_save")}
		</Button>
	</div>
</div>
