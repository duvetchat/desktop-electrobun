<script lang="ts">
import { onMount } from "svelte";
import { Popover } from "bits-ui";
import { Smile as SmileIcon, Image as GifIcon, Paperclip, Mic, Square } from "@lucide/svelte";
import EmojiPicker from "$lib/components/EmojiPicker.svelte";
import GifPicker from "$lib/components/GifPicker.svelte";
import { searchEmojis, toTwemojiUrl, type EmojiEntry } from "$lib/emoji";
import UserAvatar from "$lib/components/UserAvatar.svelte";
import type { MemberOnSidebar } from "$lib/types";

const EMOJI_RE =
	/\p{Regional_Indicator}{2}|(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji})\uFE0F?|\uD83C[\uDFFB-\uDFFF])*|[\d#*]\uFE0F?\u20E3/gu;

let {
	placeholder = "",
	initialValue = "",
	onSubmit,
	onVoiceNote,
	onCancel,
	onValueChange,
	onArrowUpWhenEmpty,
	showActions = true,
	autofocus = false,
	members = [],
	pendingFiles = $bindable<File[]>([]),
}: {
	placeholder?: string;
	initialValue?: string;
	onSubmit: (text: string, files?: File[]) => void;
	onVoiceNote?: (blob: Blob) => void;
	onCancel?: () => void;
	onValueChange?: (text: string) => void;
	onArrowUpWhenEmpty?: () => void;
	showActions?: boolean;
	autofocus?: boolean;
	members?: MemberOnSidebar[];
	pendingFiles?: File[];
} = $props();

let inputEl = $state<HTMLDivElement>(null!);
let fileInputEl = $state<HTMLInputElement>(null!);
let showEmojiPicker = $state(false);
let showGifPicker = $state(false);
let isEmpty = $state(true);

$effect(() => {
	isEmpty = !initialValue.trim();
});

// ── Voice recording ──────────────────────────────────────────────────────
let recording = $state(false);
let recordingDuration = $state(0);
let mediaRecorder: MediaRecorder | null = null;
let recordingInterval: ReturnType<typeof setInterval> | null = null;

function formatDuration(secs: number): string {
	const m = Math.floor(secs / 60);
	const s = secs % 60;
	return `${m}:${s.toString().padStart(2, "0")}`;
}

async function startRecording() {
	try {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		const chunks: Blob[] = [];
		mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
		mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
		mediaRecorder.onstop = () => {
			stream.getTracks().forEach((t) => t.stop());
			if (chunks.length > 0) {
				const blob = new Blob(chunks, { type: "audio/webm;codecs=opus" });
				onVoiceNote?.(blob);
			}
		};
		mediaRecorder.start();
		recording = true;
		recordingDuration = 0;
		recordingInterval = setInterval(() => { recordingDuration++; }, 1000);
	} catch {
		// Permission denied or no mic
	}
}

function stopRecording() {
	if (mediaRecorder && mediaRecorder.state !== "inactive") {
		mediaRecorder.stop();
	}
	recording = false;
	if (recordingInterval) { clearInterval(recordingInterval); recordingInterval = null; }
}

function cancelRecording() {
	if (mediaRecorder && mediaRecorder.state !== "inactive") {
		mediaRecorder.ondataavailable = null;
		mediaRecorder.onstop = () => {
			mediaRecorder?.stream.getTracks().forEach((t) => t.stop());
		};
		mediaRecorder.stop();
	}
	recording = false;
	if (recordingInterval) { clearInterval(recordingInterval); recordingInterval = null; }
}

function handleFileSelect(e: Event) {
	const input = e.target as HTMLInputElement;
	if (input.files) {
		pendingFiles = [...pendingFiles, ...Array.from(input.files)];
	}
	input.value = "";
}

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

// ── Mention autocomplete ────────────────────────────────────────────────────
let mentionSuggestions = $state<MemberOnSidebar[]>([]);
let mentionSelectedIdx = $state(0);
let mentionQueryStart = $state(-1); // char offset of '@' in raw text

function resolveMentionName(id: string): string {
	const m = members.find((m) => m.id === id);
	return m ? (m.username || m.raw_username) : id.slice(0, 8);
}

function buildHtml(text: string): string {
	if (!text) return "";
	EMOJI_RE.lastIndex = 0;
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/&lt;@([a-f0-9-]+)&gt;/g, (_, id) =>
			`<span class="mention-chip" contenteditable="false" data-mention="${id}">@${resolveMentionName(id)}</span>`)
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
			const elem = n as HTMLElement;
			const tag = elem.tagName;
			if (elem.dataset?.mention) {
				s += `<@${elem.dataset.mention}>`;
			} else if (tag === "IMG") s += (n as HTMLImageElement).alt ?? "";
			else if (tag === "BR") s += "";
			else if (tag === "DIV" || tag === "P")
				s += "\n" + getRaw(elem);
			else s += getRaw(elem);
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
		} else if ((n as HTMLElement).dataset?.mention) {
			off += `<@${(n as HTMLElement).dataset.mention}>`.length;
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
		} else if ((n as HTMLElement).dataset?.mention) {
			const len = `<@${(n as HTMLElement).dataset.mention}>`.length;
			if (rem <= len) {
				range.setStartAfter(n);
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

// ── Undo stack ──────────────────────────────────────────────────────────────
type UndoEntry = { raw: string; cursor: number };
let undoStack: UndoEntry[] = [{ raw: "", cursor: 0 }];
let undoIndex = 0;
let lastPushTime = 0;

function pushUndo(raw: string, cursor: number) {
	const now = Date.now();
	// Debounce: merge if < 400ms and same-ish content
	if (now - lastPushTime < 400 && undoIndex === undoStack.length - 1) {
		undoStack[undoIndex] = { raw, cursor };
	} else {
		undoStack = undoStack.slice(0, undoIndex + 1);
		undoStack.push({ raw, cursor });
		undoIndex = undoStack.length - 1;
	}
	lastPushTime = now;
}

function undo() {
	if (undoIndex <= 0) return;
	undoIndex--;
	const { raw, cursor } = undoStack[undoIndex];
	rerender(raw, cursor);
	isEmpty = !raw.trim();
	onValueChange?.(raw);
}

function redo() {
	if (undoIndex >= undoStack.length - 1) return;
	undoIndex++;
	const { raw, cursor } = undoStack[undoIndex];
	rerender(raw, cursor);
	isEmpty = !raw.trim();
	onValueChange?.(raw);
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

	// Check @mention autocomplete first
	const mentionMatch = /@(\w*)$/.exec(before);
	if (mentionMatch && members.length > 0) {
		mentionQueryStart = before.length - mentionMatch[0].length;
		const query = mentionMatch[1].toLowerCase();
		mentionSuggestions = members
			.filter((m) => m.raw_username.toLowerCase().startsWith(query) || m.username.toLowerCase().startsWith(query))
			.slice(0, 10);
		mentionSelectedIdx = 0;
		// Clear emoji suggestions when mention is active
		suggestions = [];
		emojiQueryStart = -1;
		return;
	}
	mentionSuggestions = [];
	mentionQueryStart = -1;

	// Check :emoji autocomplete
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

function insertMentionSuggestion(member: MemberOnSidebar) {
	const raw = getRaw(inputEl);
	const cursor = getOffset();
	const before = raw.slice(0, mentionQueryStart);
	const after = raw.slice(cursor);
	const mention = `<@${member.id}> `;
	const newRaw = before + mention + after;
	const newPos = mentionQueryStart + mention.length;

	rerender(newRaw, newPos);
	isEmpty = !newRaw.trim();
	onValueChange?.(newRaw);
	mentionSuggestions = [];
	mentionQueryStart = -1;
	mentionSelectedIdx = 0;
	inputEl.focus();
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
	pushUndo(raw, offset);
	checkAutocomplete(raw, offset);
	onValueChange?.(raw);
}

function handleKeyDown(e: KeyboardEvent) {
	// Undo/Redo
	if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
		e.preventDefault();
		undo();
		return;
	}
	if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
		e.preventDefault();
		redo();
		return;
	}

	// Navigate mention autocomplete
	if (mentionSuggestions.length > 0) {
		if (e.key === "ArrowUp") {
			e.preventDefault();
			mentionSelectedIdx = (mentionSelectedIdx - 1 + mentionSuggestions.length) % mentionSuggestions.length;
			return;
		}
		if (e.key === "ArrowDown") {
			e.preventDefault();
			mentionSelectedIdx = (mentionSelectedIdx + 1) % mentionSuggestions.length;
			return;
		}
		if (e.key === "Enter" || e.key === "Tab") {
			e.preventDefault();
			insertMentionSuggestion(mentionSuggestions[mentionSelectedIdx]);
			return;
		}
		if (e.key === "Escape") {
			mentionSuggestions = [];
			mentionQueryStart = -1;
			return;
		}
	}

	// Navigate emoji autocomplete
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
		if (!raw && pendingFiles.length === 0) return;
		const filesToSend = pendingFiles.length > 0 ? [...pendingFiles] : undefined;
		onSubmit(raw, filesToSend);
		inputEl.innerHTML = "";
		isEmpty = true;
		pendingFiles = [];
		return;
	}

	// Edit last message on ArrowUp when input is empty
	if (e.key === "ArrowUp" && isEmpty && !e.ctrlKey) {
		onArrowUpWhenEmpty?.();
	}
}

function getSelectionRange(): { start: number; end: number } {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
		const off = getOffset();
		return { start: off, end: off };
	}
	// Save and measure both endpoints
	const range = sel.getRangeAt(0);
	const savedEnd = range.endContainer;
	const savedEndOff = range.endOffset;

	// Get start offset
	const startOff = getOffset();

	// Collapse to end and measure
	range.collapse(false);
	const endOff = getOffset();

	// Restore
	range.setEnd(savedEnd, savedEndOff);

	return { start: Math.min(startOff, endOff), end: Math.max(startOff, endOff) };
}

function handlePaste(e: ClipboardEvent) {
	e.preventDefault();
	if (e.clipboardData?.files && e.clipboardData.files.length > 0) {
		pendingFiles = [...pendingFiles, ...Array.from(e.clipboardData.files)];
	}
	const text = e.clipboardData?.getData("text/plain") ?? "";
	if (!text) return;
	const raw = getRaw(inputEl);
	const { start, end } = getSelectionRange();
	const newRaw = raw.slice(0, start) + text + raw.slice(end);
	const newPos = start + text.length;
	rerender(newRaw, newPos);
	pushUndo(newRaw, newPos);
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

export function focus() {
	requestAnimationFrame(() => inputEl?.focus());
}
</script>

<!-- Wrapper so the autocomplete dropdown can be absolutely positioned -->
<div class="chat-input-wrapper">
	<!-- Mention autocomplete dropdown -->
	{#if mentionSuggestions.length > 0}
		<div class="ac-dropdown" role="listbox" aria-label="Mention suggestions">
			<div class="ac-label">Members matching <strong>@{getRaw(inputEl).slice(0, getOffset()).match(/@(\w*)$/)?.[1]}</strong></div>
			{#each mentionSuggestions as member, i}
				<button
					role="option"
					aria-selected={i === mentionSelectedIdx}
					class="ac-item"
					class:selected={i === mentionSelectedIdx}
					onmousedown={(e) => {
						e.preventDefault();
						insertMentionSuggestion(member);
					}}
					onmouseenter={() => (mentionSelectedIdx = i)}
				>
					<UserAvatar src={member.avatar_url} name={member.username} size={22} />
					<span class="ac-primary">{member.username}</span>
					{#if member.raw_username !== member.username}
						<span class="ac-secondary">@{member.raw_username}</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}

	<!-- Emoji autocomplete dropdown -->
	{#if suggestions.length > 0}
		<div class="ac-dropdown" role="listbox" aria-label="Emoji suggestions">
			<div class="ac-label">Emoji matching <strong>:{getRaw(inputEl).slice(0, getOffset()).match(/:([\w\d]*)$/)?.[1]}</strong></div>
			{#each suggestions as entry, i}
				<button
					role="option"
					aria-selected={i === selectedIdx}
					class="ac-item"
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
						class="ac-img"
						loading="lazy"
					/>
					<span class="ac-primary">:{entry.name.replace(/ /g, "_")}:</span>
				</button>
			{/each}
		</div>
	{/if}

	<!-- Hidden file input -->
	<input
		bind:this={fileInputEl}
		type="file"
		multiple
		class="hidden"
		onchange={handleFileSelect}
	/>

	<!-- The contenteditable chat input -->
	<div class="ce-input-row">
		{#if recording}
			<div class="ce-input-area ce-recording">
				<div class="flex items-center gap-3 h-5">
					<div class="size-2.5 rounded-full bg-red-500 animate-pulse"></div>
					<span class="text-sm text-zinc-300 font-medium tabular-nums">{formatDuration(recordingDuration)}</span>
					<span class="text-xs text-zinc-500">Recording...</span>
				</div>
			</div>
			<button type="button" class="ce-action-btn" title="Cancel recording" onclick={cancelRecording}>
				<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
			</button>
			<button type="button" class="ce-action-btn ce-send-voice" title="Send voice note" onclick={stopRecording}>
				<Square class="size-4" fill="currentColor" />
			</button>
		{:else}
			<div class="ce-input-area">
				<div
					bind:this={inputEl}
					contenteditable="true"
					role="textbox"
					tabindex="0"
					aria-multiline="false"
					aria-label={placeholder}
					class="ce-input focus-override"
					class:ce-empty={isEmpty}
					data-placeholder={placeholder}
					onkeydown={handleKeyDown}
					oninput={handleInput}
					onpaste={handlePaste}
				></div>
			</div>

			{#if showActions}
				<!-- File picker button -->
				<button
					type="button"
					class="ce-action-btn"
					title="Attach files"
					aria-label="Attach files"
					onclick={() => fileInputEl?.click()}
				>
					<Paperclip class="size-5" />
				</button>

				<!-- Voice note button -->
				{#if onVoiceNote}
					<button
						type="button"
						class="ce-action-btn"
						title="Record voice note"
						aria-label="Record voice note"
						onclick={startRecording}
					>
						<Mic class="size-5" />
					</button>
				{/if}

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
		{/if}
	</div>
</div>

<style>
	.chat-input-wrapper {
		position: relative;
		display: contents;
	}

	/* ── Autocomplete dropdown ─────────────────────── */
	.ac-dropdown {
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
		max-height: 300px;
		overflow-y: auto;
	}
	.ac-label {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: oklch(0.52 0.01 80);
		padding: 6px 12px 4px;
	}
	.ac-item {
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
	.ac-item.selected,
	.ac-item:hover {
		background: oklch(0.28 0.01 80);
	}
	.ac-img {
		width: 22px;
		height: 22px;
		flex-shrink: 0;
	}
	.ac-primary {
		font-size: 13px;
		color: oklch(0.85 0.008 80);
	}
	.ac-secondary {
		font-size: 11px;
		color: oklch(0.52 0.01 80);
	}

	/* ── Mention chip ────────────────────────────── */
	:global(.mention-chip) {
		display: inline;
		padding: 1px 4px;
		border-radius: 4px;
		background: oklch(0.55 0.15 250 / 0.2);
		color: oklch(0.75 0.12 250);
		font-weight: 500;
		cursor: default;
		user-select: all;
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
		border: none;
		background: oklch(0.22 0.01 80 / 0.8);
		padding: 0.625rem 0.75rem;
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
	}
	.ce-recording {
		border: 1px solid oklch(0.4 0.15 25 / 0.4);
		background: oklch(0.20 0.02 25 / 0.5);
	}
	:global(.ce-send-voice) {
		color: oklch(0.7 0.15 25) !important;
	}
	:global(.ce-send-voice:hover) {
		color: oklch(0.85 0.15 25) !important;
		background: oklch(0.28 0.02 25) !important;
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
