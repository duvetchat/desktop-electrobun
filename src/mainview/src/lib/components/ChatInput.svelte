<script lang="ts">
import { onMount } from "svelte";
import { Popover } from "bits-ui";
import { Smile as SmileIcon, Image as GifIcon } from "@lucide/svelte";
import EmojiPicker from "$lib/components/EmojiPicker.svelte";
import GifPicker from "$lib/components/GifPicker.svelte";
import { searchEmojis, toTwemojiUrl, type EmojiEntry } from "$lib/emoji";

const EMOJI_RE =
	/\p{Regional_Indicator}{2}|(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji})\uFE0F?|\uD83C[\uDFFB-\uDFFF])*|[\d#*]\uFE0F?\u20E3/gu;

let {
	placeholder = "",
	initialValue = "",
	onSubmit,
	onCancel,
	onValueChange,
	onArrowUpWhenEmpty,
	showActions = true,
	autofocus = false,
}: {
	placeholder?: string;
	initialValue?: string;
	onSubmit: (text: string) => void;
	onCancel?: () => void;
	onValueChange?: (text: string) => void;
	onArrowUpWhenEmpty?: () => void;
	showActions?: boolean;
	autofocus?: boolean;
} = $props();

let inputEl = $state<HTMLDivElement>(null!);
let showEmojiPicker = $state(false);
let showGifPicker = $state(false);
let isEmpty = $state(!initialValue.trim());

onMount(() => {
	if (initialValue) {
		rerender(initialValue, initialValue.length);
		isEmpty = !initialValue.trim();
	}
	if (autofocus) {
		requestAnimationFrame(() => {
			inputEl?.focus();
			if (initialValue) setOffset(initialValue.length);
		});
	}
});

// ── Autocomplete ────────────────────────────────────────────────────────────
let suggestions = $state<EmojiEntry[]>([]);
let selectedIdx = $state(0);
let emojiQueryStart = $state(-1); // char offset (UTF-16) of ':' in raw text

function buildHtml(text: string): string {
	if (!text) return "";
	EMOJI_RE.lastIndex = 0;
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(
			EMOJI_RE,
			(e) =>
				`<span class="emoji-img" style="--tw:url('${toTwemojiUrl(e)}')" aria-label="${e}">${e}</span>`,
		);
}

// ── DOM helpers ─────────────────────────────────────────────────────────────
function getRaw(el: HTMLElement): string {
	let s = "";
	for (const n of Array.from(el.childNodes)) {
		if (n.nodeType === Node.TEXT_NODE) {
			s += n.textContent ?? "";
		} else {
			const tag = (n as Element).tagName;
			if (tag === "IMG") s += (n as HTMLImageElement).alt ?? "";
			else if (tag === "BR") s += ""; // ignore trailing Chrome placeholder BR
			else if (tag === "DIV" || tag === "P")
				s += "\n" + getRaw(n as HTMLElement);
			else s += getRaw(n as HTMLElement);
		}
	}
	return s;
}

// Cursor position as UTF-16 offset in raw text
function getOffset(): number {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return 0;
	const range = sel.getRangeAt(0);
	let off = 0;

	function walk(n: Node): boolean {
		if (n === range.startContainer) {
			off += range.startOffset;
			return true;
		}
		if (n.nodeType === Node.TEXT_NODE) {
			off += (n.textContent ?? "").length;
		} else if ((n as Element).tagName === "IMG") {
			off += ((n as HTMLImageElement).alt ?? "").length;
		} else {
			for (const c of Array.from(n.childNodes)) if (walk(c)) return true;
		}
		return false;
	}
	for (const c of Array.from(inputEl.childNodes)) if (walk(c)) break;
	return off;
}

function setOffset(target: number): void {
	const sel = window.getSelection();
	if (!sel) return;
	let rem = target;
	const range = document.createRange();
	let placed = false;

	function walk(n: Node): boolean {
		if (n.nodeType === Node.TEXT_NODE) {
			const len = (n.textContent ?? "").length;
			if (rem <= len) {
				range.setStart(n, rem);
				range.collapse(true);
				return true;
			}
			rem -= len;
		} else if ((n as Element).tagName === "IMG") {
			const len = ((n as HTMLImageElement).alt ?? "").length;
			if (rem <= 0) {
				range.setStartBefore(n);
				range.collapse(true);
				return true;
			}
			rem -= len;
		} else {
			for (const c of Array.from(n.childNodes)) if (walk(c)) return true;
		}
		return false;
	}

	for (const c of Array.from(inputEl.childNodes)) {
		if (walk(c)) {
			placed = true;
			break;
		}
	}
	if (!placed) {
		range.selectNodeContents(inputEl);
		range.collapse(false);
	}
	sel.removeAllRanges();
	sel.addRange(range);
}

// ── Re-render helpers ───────────────────────────────────────────────────────
function rerender(raw: string, cursorOffset: number) {
	const html = buildHtml(raw);
	inputEl.innerHTML = html;
	if (html) setOffset(cursorOffset);
}

// ── Autocomplete ────────────────────────────────────────────────────────────
function checkAutocomplete(raw: string, cursor: number) {
	const before = raw.slice(0, cursor);
	const m = /:([\w\d]{1,})$/.exec(before);
	if (m) {
		emojiQueryStart = before.length - m[0].length;
		suggestions = searchEmojis(m[1]).slice(0, 10);
		selectedIdx = 0;
	} else {
		suggestions = [];
		emojiQueryStart = -1;
	}
}

function insertSuggestion(entry: EmojiEntry) {
	const raw = getRaw(inputEl);
	const cursor = getOffset();
	const before = raw.slice(0, emojiQueryStart);
	const after = raw.slice(cursor);
	const newRaw = before + entry.emoji + after;
	const newPos = emojiQueryStart + entry.emoji.length;

	rerender(newRaw, newPos);
	isEmpty = !newRaw.trim();
	onValueChange?.(newRaw);
	suggestions = [];
	emojiQueryStart = -1;
	selectedIdx = 0;
	inputEl.focus();
}

// ── Event handlers ──────────────────────────────────────────────────────────
function handleInput() {
	const offset = getOffset();
	const raw = getRaw(inputEl);
	isEmpty = !raw.trim();
	rerender(raw, offset);
	checkAutocomplete(raw, offset);
	onValueChange?.(raw);
}

function handleKeyDown(e: KeyboardEvent) {
	// Navigate autocomplete with arrows
	if (suggestions.length > 0) {
		if (e.key === "ArrowUp") {
			e.preventDefault();
			selectedIdx = (selectedIdx - 1 + suggestions.length) % suggestions.length;
			return;
		}
		if (e.key === "ArrowDown") {
			e.preventDefault();
			selectedIdx = (selectedIdx + 1) % suggestions.length;
			return;
		}
		if (e.key === "Enter" || e.key === "Tab") {
			e.preventDefault();
			insertSuggestion(suggestions[selectedIdx]);
			return;
		}
		if (e.key === "Escape") {
			suggestions = [];
			emojiQueryStart = -1;
			return;
		}
	}

	if (e.key === "Escape") {
		onCancel?.();
		return;
	}

	// Send on Enter
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		const raw = getRaw(inputEl).trim();
		if (!raw) return;
		onSubmit(raw);
		inputEl.innerHTML = "";
		isEmpty = true;
		return;
	}

	// Edit last message on ArrowUp when input is empty
	if (e.key === "ArrowUp" && isEmpty) {
		onArrowUpWhenEmpty?.();
	}
}

function handlePaste(e: ClipboardEvent) {
	e.preventDefault();
	const text = e.clipboardData?.getData("text/plain") ?? "";
	// Insert as plain text at cursor, then re-render
	const offset = getOffset();
	const raw = getRaw(inputEl);
	const newRaw = raw.slice(0, offset) + text + raw.slice(offset);
	const newPos = offset + text.length;
	rerender(newRaw, newPos);
	isEmpty = !newRaw.trim();
	checkAutocomplete(newRaw, newPos);
	onValueChange?.(newRaw);
}

function handleGifPick(url: string) {
	showGifPicker = false;
	onSubmit(url);
}

// Called externally by the emoji picker popover (in this component)
function handleEmojiPick(emoji: string) {
	showEmojiPicker = false;
	if (!inputEl) return;
	const offset = getOffset();
	const raw = getRaw(inputEl);
	const newRaw = raw.slice(0, offset) + emoji + raw.slice(offset);
	const newPos = offset + emoji.length;
	rerender(newRaw, newPos);
	isEmpty = !newRaw.trim();
	onValueChange?.(newRaw);

	requestAnimationFrame(() => {
		inputEl.focus();
		setOffset(newPos);
	});
}
</script>

<!-- Wrapper so the autocomplete dropdown can be absolutely positioned -->
<div class="chat-input-wrapper">
	<!-- Autocomplete dropdown -->
	{#if suggestions.length > 0}
		<div class="emoji-ac-dropdown" role="listbox" aria-label="Emoji suggestions">
			<div class="emoji-ac-label">Emoji matching <strong>:{getRaw(inputEl).slice(0, getOffset()).match(/:([\w\d]*)$/)?.[1]}</strong></div>
			{#each suggestions as entry, i}
				<button
					role="option"
					aria-selected={i === selectedIdx}
					class="emoji-ac-item"
					class:selected={i === selectedIdx}
					onmousedown={(e) => {
						e.preventDefault();
						insertSuggestion(entry);
					}}
					onmouseenter={() => (selectedIdx = i)}
				>
					<img
						src={toTwemojiUrl(entry.emoji)}
						alt={entry.emoji}
						class="emoji-ac-img"
						loading="lazy"
					/>
					<span class="emoji-ac-name">:{entry.name.replace(/ /g, "_")}:</span>
				</button>
			{/each}
		</div>
	{/if}

	<!-- The contenteditable chat input -->
	<div class="ce-input-row">
		<div
			class="ce-input-area"
		>
			<div
				bind:this={inputEl}
				contenteditable="true"
				role="textbox"
				tabindex="0"
				aria-multiline="false"
				aria-label={placeholder}
				class="ce-input"
				class:ce-empty={isEmpty}
				data-placeholder={placeholder}
				onkeydown={handleKeyDown}
				oninput={handleInput}
				onpaste={handlePaste}
			></div>
		</div>

		{#if showActions}
			<!-- Emoji picker button -->
			<Popover.Root bind:open={showEmojiPicker}>
				<Popover.Trigger
					class="ce-action-btn"
					title="Open emoji picker"
					aria-label="Open emoji picker"
				>
					<SmileIcon class="size-5" />
				</Popover.Trigger>
				<Popover.Portal>
					<Popover.Content side="top" align="end" sideOffset={10} class="z-80">
						<EmojiPicker onSelect={handleEmojiPick} />
					</Popover.Content>
				</Popover.Portal>
			</Popover.Root>

			<!-- GIF picker button -->
			<Popover.Root bind:open={showGifPicker}>
				<Popover.Trigger
					class="ce-action-btn"
					title="Open GIF picker"
					aria-label="Open GIF picker"
				>
					<GifIcon class="size-5" />
				</Popover.Trigger>
				<Popover.Portal>
					<Popover.Content side="top" align="end" sideOffset={10} class="z-80">
						<GifPicker onSelect={handleGifPick} />
					</Popover.Content>
				</Popover.Portal>
			</Popover.Root>
		{/if}
	</div>
</div>

<style>
	.chat-input-wrapper {
		position: relative;
		display: contents;
	}

	/* ── Autocomplete dropdown ─────────────────────── */
	.emoji-ac-dropdown {
		position: absolute;
		bottom: calc(100% + 6px);
		left: 0;
		right: 0;
		background: oklch(0.19 0.008 80);
		border: 1px solid oklch(0.30 0.01 80);
		border-radius: 8px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
		overflow: hidden;
		z-index: 90;
		padding: 4px 0;
	}
	.emoji-ac-label {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: oklch(0.52 0.01 80);
		padding: 6px 12px 4px;
	}
	.emoji-ac-item {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 6px 12px;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
		transition: background 0.1s;
	}
	.emoji-ac-item.selected,
	.emoji-ac-item:hover {
		background: oklch(0.28 0.01 80);
	}
	.emoji-ac-img {
		width: 22px;
		height: 22px;
		flex-shrink: 0;
	}
	.emoji-ac-name {
		font-size: 13px;
		color: oklch(0.85 0.008 80);
	}

	/* ── Input row ────────────────────────────────── */
	.ce-input-row {
		display: contents;
	}

	/* ── Contenteditable div ──────────────────────── */
	.ce-input-area {
		pointer-events: auto;
		flex: 1;
		border-radius: 0.75rem;
		border: 1px solid oklch(0.40 0.01 80 / 0.7);
		background: oklch(0.22 0.01 80 / 0.8);
		padding: 0.625rem 0.75rem;
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
	}
	.ce-input {
		display: block;
		width: 100%;
		min-height: 1.25rem;
		max-height: 9rem;
		overflow-y: auto;
		font-size: 0.875rem;
		line-height: 1.25rem;
		color: oklch(0.96 0.005 80);
		outline: none;
		white-space: pre-wrap;
		word-break: break-word;
		caret-color: oklch(0.96 0.005 80);
		scrollbar-width: thin;
	}
	/* Placeholder via CSS ::before */
	.ce-input.ce-empty::before {
		content: attr(data-placeholder);
		color: oklch(0.52 0.01 80);
		pointer-events: none;
		position: absolute;
	}

	/* Emoji picker button — :global because Popover.Trigger renders the DOM element */
	:global(.ce-action-btn) {
		display: flex;
		height: 2.5rem;
		width: 2.5rem;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		border-radius: 0.75rem;
		border: 1px solid oklch(0.40 0.01 80 / 0.7);
		background: oklch(0.22 0.01 80 / 0.7);
		color: oklch(0.70 0.01 80);
		transition: background 0.15s, color 0.15s;
		cursor: pointer;
		outline: none;
	}
	:global(.ce-action-btn:hover) {
		background: oklch(0.28 0.01 80);
		color: oklch(0.96 0.005 80);
	}
</style>
