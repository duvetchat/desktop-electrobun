<script lang="ts">
	import { onMount } from "svelte";
	import { Popover } from "bits-ui";
	import { Smile as SmileIcon, Sticker as StickerIcon, Image as GifIcon, Paperclip, Mic, Square } from "@lucide/svelte";
	import EmojiPicker from "$lib/components/EmojiPicker.svelte";
	import StickerPicker from "$lib/components/StickerPicker.svelte";
	import GifPicker from "$lib/components/GifPicker.svelte";
	import { searchEmojis, toTwemojiUrl, type EmojiEntry } from "$lib/emoji";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import type { MemberOnSidebar, SpaceEmoji, SpaceSticker } from "$lib/types";
	import { getHostURL } from "$lib/common/common";

	const ceHost = getHostURL();

	// Module-level clipboard fallback shared across all ChatInput instances
	let internalClipboard: string | null = null;

	// Clear internal clipboard when window regains focus (user may have copied externally)
	if (typeof window !== "undefined") {
		window.addEventListener("focus", () => {
			internalClipboard = null;
		});
	}

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
		customEmojis = [],
		spaceStickers = [],
		pendingFiles = $bindable<File[]>([]),
	}: {
		placeholder?: string;
		initialValue?: string;
		onSubmit: (text: string, files?: File[], stickerAttachmentId?: string) => void;
		onVoiceNote?: (blob: Blob) => void;
		onCancel?: () => void;
		onValueChange?: (text: string) => void;
		onArrowUpWhenEmpty?: () => void;
		showActions?: boolean;
		autofocus?: boolean;
		members?: MemberOnSidebar[];
		customEmojis?: SpaceEmoji[];
		spaceStickers?: SpaceSticker[];
		pendingFiles?: File[];
	} = $props();

	let inputEl = $state<HTMLDivElement>(null!);
	let fileInputEl = $state<HTMLInputElement>(null!);
	let showEmojiPicker = $state(false);
	let showStickerPicker = $state(false);
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
			mediaRecorder.ondataavailable = (e) => {
				if (e.data.size > 0) chunks.push(e.data);
			};
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
			recordingInterval = setInterval(() => {
				recordingDuration++;
			}, 1000);
		} catch {
			// Permission denied or no mic
		}
	}

	function stopRecording() {
		if (mediaRecorder && mediaRecorder.state !== "inactive") {
			mediaRecorder.stop();
		}
		recording = false;
		if (recordingInterval) {
			clearInterval(recordingInterval);
			recordingInterval = null;
		}
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
		if (recordingInterval) {
			clearInterval(recordingInterval);
			recordingInterval = null;
		}
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

	// Re-render when customEmojis arrives (edit input may mount before emojis load)
	let hadCustomEmojis = $state(false);
	$effect(() => {
		const count = customEmojis.length;
		if (count > 0 && !hadCustomEmojis && inputEl) {
			hadCustomEmojis = true;
			const raw = getRaw(inputEl);
			if (raw.includes("<:")) {
				const pos = getOffset();
				rerender(raw, pos);
			}
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
		return m ? m.username || m.raw_username : id.slice(0, 8);
	}

	function resolveCustomEmojiName(id: string): string {
		const ce = customEmojis.find((e) => e.id === id);
		return ce ? ce.name : id.slice(0, 8);
	}

	function resolveCustomEmojiUrl(id: string): string {
		const ce = customEmojis.find((e) => e.id === id);
		return ce ? `${ceHost}/attachments/${ce.attachment_id}` : "";
	}

	function buildHtml(text: string): string {
		if (!text) return "";
		EMOJI_RE.lastIndex = 0;
		return text
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(
				/&lt;@([a-f0-9-]+)&gt;/g,
				(_, id) =>
					`<span class="mention-chip" contenteditable="false" data-mention="${id}">@${resolveMentionName(id)}</span>`,
			)
			.replace(/&lt;:([a-f0-9-]+):&gt;/g, (_, id) => {
				const url = resolveCustomEmojiUrl(id);
				if (!url) return `&lt;:${id}:&gt;`;
				return `<img class="emoji-img custom-emoji-chip" src="${url}" alt=":${resolveCustomEmojiName(id)}:" data-cemoji="${id}" draggable="false" contenteditable="false">`;
			})
			.replace(
				EMOJI_RE,
				(e) => `<span class="emoji-img" style="--tw:url('${toTwemojiUrl(e)}')" aria-label="${e}">${e}</span>`,
			)
			.replace(/\n/g, "<br>");
	}

	// ── DOM helpers ─────────────────────────────────────────────────────────────
	function getRaw(el: HTMLElement): string {
		return getRawFromChildren(el);
	}

	// Cursor position as UTF-16 offset in raw text
	function getOffset(): number {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return 0;
		const range = sel.getRangeAt(0);
		let off = 0;

		function rawLen(n: Node): number {
			const mention = (n as Element).getAttribute?.("data-mention");
			if (mention) return `<@${mention}>`.length;
			const cemoji = (n as Element).getAttribute?.("data-cemoji");
			if (cemoji) return `<:${cemoji}:>`.length;
			if ((n as Element).tagName === "IMG") return ((n as HTMLImageElement).alt ?? "").length;
			return -1; // not an atomic node
		}

		function walk(n: Node): boolean {
			if (n === range.startContainer) {
				off += range.startOffset;
				return true;
			}
			if (n.nodeType === Node.TEXT_NODE) {
				off += (n.textContent ?? "").length;
			} else {
				const len = rawLen(n);
				if (len >= 0) {
					off += len;
				} else {
					for (const c of Array.from(n.childNodes)) if (walk(c)) return true;
				}
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

		function atomicLen(n: Node): number {
			const mention = (n as Element).getAttribute?.("data-mention");
			if (mention) return `<@${mention}>`.length;
			const cemoji = (n as Element).getAttribute?.("data-cemoji");
			if (cemoji) return `<:${cemoji}:>`.length;
			if ((n as Element).tagName === "IMG") return ((n as HTMLImageElement).alt ?? "").length;
			return -1;
		}

		function walk(n: Node): boolean {
			if (n.nodeType === Node.TEXT_NODE) {
				const len = (n.textContent ?? "").length;
				if (rem <= len) {
					range.setStart(n, rem);
					range.collapse(true);
					return true;
				}
				rem -= len;
			} else {
				const len = atomicLen(n);
				if (len >= 0) {
					if (rem <= len) {
						range.setStartAfter(n);
						range.collapse(true);
						return true;
					}
					rem -= len;
				} else {
					for (const c of Array.from(n.childNodes)) if (walk(c)) return true;
				}
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

		// Check :emoji autocomplete (custom + default)
		const m = /:([\w\d_]{1,})$/.exec(before);
		if (m) {
			emojiQueryStart = before.length - m[0].length;
			const query = m[1].toLowerCase();
			const customScored = customEmojis
				.map((ce) => {
					const n = ce.name.toLowerCase();
					let score = 0;
					if (n === query) score = 100;
					else if (n.startsWith(query)) score = 80;
					else if (n.includes(query)) score = 50;
					return { ce, score };
				})
				.filter((s) => s.score > 0)
				.sort((a, b) => b.score - a.score || a.ce.name.length - b.ce.name.length)
				.map(
					(s) =>
						({
							emoji: `<:${s.ce.id}:>`,
							name: s.ce.name,
							customEmojiId: s.ce.id,
							customAttachmentId: s.ce.attachment_id,
						}) as EmojiEntry & { customEmojiId: string; customAttachmentId: string },
				);
			const defaultMatches = searchEmojis(m[1]);
			suggestions = [...customScored, ...defaultMatches].slice(0, 10);
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

	function getRawFromNode(n: Node): string {
		if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? "";
		const elem = n as HTMLElement;
		const tag = elem.tagName;
		const mention = elem.getAttribute("data-mention");
		if (mention) return `<@${mention}>`;
		const cemoji = elem.getAttribute("data-cemoji");
		if (cemoji) return `<:${cemoji}:>`;
		if (tag === "IMG") return (n as HTMLImageElement).alt ?? "";
		if (tag === "BR") return "\n";
		if (tag === "DIV" || tag === "P") return "\n" + getRawFromChildren(n);
		return getRawFromChildren(n);
	}

	function getRawFromChildren(parent: Node): string {
		let s = "";
		for (const c of Array.from(parent.childNodes)) s += getRawFromNode(c);
		return s;
	}

	function measureRawOffset(container: Node, offset: number): number {
		let count = 0;

		function nodeLen(n: Node): number {
			if (n.nodeType === Node.TEXT_NODE) return (n.textContent ?? "").length;
			const el = n as Element;
			const mention = el.getAttribute?.("data-mention");
			if (mention) return `<@${mention}>`.length;
			const cemoji = el.getAttribute?.("data-cemoji");
			if (cemoji) return `<:${cemoji}:>`.length;
			if (el.tagName === "IMG") return ((n as HTMLImageElement).alt ?? "").length;
			return -1; // has children
		}

		function walk(n: Node): boolean {
			if (n === container) {
				if (n.nodeType === Node.TEXT_NODE) {
					count += offset;
				} else {
					// offset is child index
					const children = Array.from(n.childNodes);
					for (let i = 0; i < offset && i < children.length; i++) {
						const len = nodeLen(children[i]);
						if (len >= 0) {
							count += len;
						} else {
							walkAll(children[i]);
						}
					}
				}
				return true;
			}
			const len = nodeLen(n);
			if (len >= 0) {
				count += len;
				return false;
			}
			for (const c of Array.from(n.childNodes)) {
				if (walk(c)) return true;
			}
			return false;
		}

		function walkAll(n: Node) {
			const len = nodeLen(n);
			if (len >= 0) {
				count += len;
				return;
			}
			for (const c of Array.from(n.childNodes)) walkAll(c);
		}

		walk(inputEl);
		return count;
	}

	function getSelectedRaw(): string | null {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
		const range = sel.getRangeAt(0);
		const raw = getRaw(inputEl);
		const s = measureRawOffset(range.startContainer, range.startOffset);
		const e = measureRawOffset(range.endContainer, range.endOffset);
		const start = Math.min(s, e);
		const end = Math.max(s, e);
		if (start === end) return null;
		return raw.slice(start, end);
	}

	function handleCopy(e: ClipboardEvent) {
		const text = getSelectedRaw();
		if (text == null) return;
		e.preventDefault();
		internalClipboard = text;
		if (e.clipboardData) {
			e.clipboardData.setData("text/plain", text);
		}
		navigator.clipboard.writeText(text).catch(() => {});
	}

	function handleCut(e: ClipboardEvent) {
		const text = getSelectedRaw();
		if (text == null) return;
		e.preventDefault();
		internalClipboard = text;
		if (e.clipboardData) {
			e.clipboardData.setData("text/plain", text);
		}
		navigator.clipboard.writeText(text).catch(() => {});
		window.getSelection()?.deleteFromDocument();
		const raw = getRaw(inputEl);
		const pos = getOffset();
		rerender(raw, pos);
		pushUndo(raw, pos);
		isEmpty = !raw.trim();
		onValueChange?.(raw);
	}

	function handlePaste(e: ClipboardEvent) {
		e.preventDefault();
		if (e.clipboardData?.files && e.clipboardData.files.length > 0) {
			pendingFiles = [...pendingFiles, ...Array.from(e.clipboardData.files)];
		}
		const osText = e.clipboardData?.getData("text/plain") ?? "";
		// Prefer internal clipboard if it matches what OS clipboard would give us (same copy session)
		const text = internalClipboard ?? osText;
		if (!text) return;
		const sel = window.getSelection();
		if (sel && !sel.isCollapsed) {
			sel.deleteFromDocument();
		}
		const raw = getRaw(inputEl);
		const pos = getOffset();
		const newRaw = raw.slice(0, pos) + text + raw.slice(pos);
		const newPos = pos + text.length;
		rerender(newRaw, newPos);
		pushUndo(newRaw, newPos);
		isEmpty = !newRaw.trim();
		checkAutocomplete(newRaw, newPos);
		onValueChange?.(newRaw);
	}

	function handleStickerPick(sticker: SpaceSticker) {
		showStickerPicker = false;
		onSubmit("", undefined, sticker.attachment_id);
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

	export function focusAndInsert(char: string) {
		if (!inputEl) return;
		inputEl.focus();
		const raw = getRaw(inputEl);
		const pos = raw.length;
		const newRaw = raw + char;
		rerender(newRaw, pos + char.length);
		pushUndo(newRaw, pos + char.length);
		isEmpty = false;
		onValueChange?.(newRaw);
	}
</script>

<!-- Wrapper with display:contents so children participate in parent flex -->
<div class="contents">
	<!-- Mention autocomplete dropdown -->
	{#if mentionSuggestions.length > 0}
		<div
			class="absolute right-0 bottom-[calc(100%+6px)] left-0 z-90 max-h-75 overflow-hidden overflow-y-auto rounded-lg border border-[oklch(0.30_0.01_80)] bg-[oklch(0.19_0.008_80)] py-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
			role="listbox"
			aria-label="Mention suggestions"
		>
			<div class="text-xxs px-3 pt-1.5 pb-1 font-bold tracking-wider text-[oklch(0.52_0.01_80)] uppercase">
				Members matching <strong
					>@{getRaw(inputEl)
						.slice(0, getOffset())
						.match(/@(\w*)$/)?.[1]}</strong
				>
			</div>
			{#each mentionSuggestions as member, i}
				<button
					role="option"
					aria-selected={i === mentionSelectedIdx}
					class="flex w-full cursor-pointer items-center gap-2.5 border-none bg-none px-3 py-1.5 text-left transition-[background] duration-100 {i ===
					mentionSelectedIdx
						? 'bg-[oklch(0.28_0.01_80)]'
						: 'hover:bg-[oklch(0.28_0.01_80)]'}"
					onmousedown={(e) => {
						e.preventDefault();
						insertMentionSuggestion(member);
					}}
					onmouseenter={() => (mentionSelectedIdx = i)}
				>
					<UserAvatar src={member.avatar_url} name={member.username} size={22} />
					<span class="text-[13px] text-[oklch(0.85_0.008_80)]">{member.username}</span>
					{#if member.raw_username !== member.username}
						<span class="text-[11px] text-[oklch(0.52_0.01_80)]">@{member.raw_username}</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}

	<!-- Emoji autocomplete dropdown -->
	{#if suggestions.length > 0}
		<div
			class="absolute right-0 bottom-[calc(100%+6px)] left-0 z-90 max-h-75 overflow-hidden overflow-y-auto rounded-lg border border-[oklch(0.30_0.01_80)] bg-[oklch(0.19_0.008_80)] py-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
			role="listbox"
			aria-label="Emoji suggestions"
		>
			<div class="text-xxs px-3 pt-1.5 pb-1 font-bold tracking-wider text-[oklch(0.52_0.01_80)] uppercase">
				Emoji matching <strong
					>:{getRaw(inputEl)
						.slice(0, getOffset())
						.match(/:([\w\d]*)$/)?.[1]}</strong
				>
			</div>
			{#each suggestions as entry, i}
				<button
					role="option"
					aria-selected={i === selectedIdx}
					class="flex w-full cursor-pointer items-center gap-2.5 border-none bg-none px-3 py-1.5 text-left transition-[background] duration-100 {i ===
					selectedIdx
						? 'bg-[oklch(0.28_0.01_80)]'
						: 'hover:bg-[oklch(0.28_0.01_80)]'}"
					onmousedown={(e) => {
						e.preventDefault();
						insertSuggestion(entry);
					}}
					onmouseenter={() => (selectedIdx = i)}
				>
					{#if "customAttachmentId" in entry}
						<img
							src="{ceHost}/attachments/{entry.customAttachmentId}"
							alt=":{entry.name}:"
							class="size-5.5 shrink-0 object-contain"
							loading="lazy"
						/>
					{:else}
						<img src={toTwemojiUrl(entry.emoji)} alt={entry.emoji} class="size-5.5 shrink-0" loading="lazy" />
					{/if}
					<span class="text-[13px] text-[oklch(0.85_0.008_80)]">:{entry.name.replace(/ /g, "_")}:</span>
				</button>
			{/each}
		</div>
	{/if}

	<!-- Hidden file input -->
	<input bind:this={fileInputEl} type="file" multiple class="hidden" onchange={handleFileSelect} />

	<!-- The contenteditable chat input -->
	<div class="contents">
		{#if recording}
			<div
				class="pointer-events-auto flex-1 rounded-xl border border-[oklch(0.4_0.15_25/0.4)] bg-[oklch(0.20_0.02_25/0.5)] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
			>
				<div class="flex h-5 items-center gap-3">
					<div class="size-2.5 animate-pulse rounded-full bg-red-500"></div>
					<span class="text-sm font-medium text-zinc-300 tabular-nums">{formatDuration(recordingDuration)}</span>
					<span class="text-xs text-zinc-500">Recording...</span>
				</div>
			</div>
			<button
				type="button"
				class="ce-action-btn flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-[oklch(0.40_0.01_80/0.7)] bg-[oklch(0.22_0.01_80/0.7)] text-[oklch(0.70_0.01_80)] transition-colors duration-150 outline-none hover:bg-[oklch(0.28_0.01_80)] hover:text-[oklch(0.96_0.005_80)]"
				title="Cancel recording"
				onclick={cancelRecording}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg
				>
			</button>
			<button
				type="button"
				class="ce-action-btn flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-[oklch(0.40_0.01_80/0.7)] bg-[oklch(0.22_0.01_80/0.7)] text-[oklch(0.7_0.15_25)] transition-colors duration-150 outline-none hover:bg-[oklch(0.28_0.02_25)] hover:text-[oklch(0.85_0.15_25)]"
				title="Send voice note"
				onclick={stopRecording}
			>
				<Square class="size-4" fill="currentColor" />
			</button>
		{:else}
			<div
				class="pointer-events-auto flex-1 rounded-xl border-none bg-[oklch(0.22_0.01_80/0.8)] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
			>
				<div
					bind:this={inputEl}
					contenteditable="true"
					role="textbox"
					tabindex="0"
					aria-multiline="false"
					aria-label={placeholder}
					class="ce-input focus-override block max-h-36 min-h-5 w-full overflow-y-auto text-sm leading-5 wrap-break-word whitespace-pre-wrap text-[oklch(0.96_0.005_80)] caret-[oklch(0.96_0.005_80)] outline-none [scrollbar-width:thin] {isEmpty
						? 'ce-empty'
						: ''}"
					data-placeholder={placeholder}
					onkeydown={handleKeyDown}
					oninput={handleInput}
					onpaste={handlePaste}
					oncopy={handleCopy}
					oncut={handleCut}
				></div>
			</div>

			{#if showActions}
				<!-- File picker button -->
				<button
					type="button"
					class="ce-action-btn flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-[oklch(0.40_0.01_80/0.7)] bg-[oklch(0.22_0.01_80/0.7)] text-[oklch(0.70_0.01_80)] transition-colors duration-150 outline-none hover:bg-[oklch(0.28_0.01_80)] hover:text-[oklch(0.96_0.005_80)]"
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
						class="ce-action-btn flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-[oklch(0.40_0.01_80/0.7)] bg-[oklch(0.22_0.01_80/0.7)] text-[oklch(0.70_0.01_80)] transition-colors duration-150 outline-none hover:bg-[oklch(0.28_0.01_80)] hover:text-[oklch(0.96_0.005_80)]"
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
						class="ce-action-btn flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-[oklch(0.40_0.01_80/0.7)] bg-[oklch(0.22_0.01_80/0.7)] text-[oklch(0.70_0.01_80)] transition-colors duration-150 outline-none hover:bg-[oklch(0.28_0.01_80)] hover:text-[oklch(0.96_0.005_80)]"
						title="Open emoji picker"
						aria-label="Open emoji picker"
					>
						<SmileIcon class="size-5" />
					</Popover.Trigger>
					<Popover.Portal>
						<Popover.Content side="top" align="end" sideOffset={10} class="z-80">
							<EmojiPicker onSelect={handleEmojiPick} {customEmojis} />
						</Popover.Content>
					</Popover.Portal>
				</Popover.Root>

				<!-- Sticker picker button -->
				{#if spaceStickers.length > 0}
					<Popover.Root bind:open={showStickerPicker}>
						<Popover.Trigger
							class="ce-action-btn flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-[oklch(0.40_0.01_80/0.7)] bg-[oklch(0.22_0.01_80/0.7)] text-[oklch(0.70_0.01_80)] transition-colors duration-150 outline-none hover:bg-[oklch(0.28_0.01_80)] hover:text-[oklch(0.96_0.005_80)]"
							title="Open sticker picker"
							aria-label="Open sticker picker"
						>
							<StickerIcon class="size-5" />
						</Popover.Trigger>
						<Popover.Portal>
							<Popover.Content side="top" align="end" sideOffset={10} class="z-80">
								<StickerPicker stickers={spaceStickers} onSelect={handleStickerPick} />
							</Popover.Content>
						</Popover.Portal>
					</Popover.Root>
				{/if}

				<!-- GIF picker button -->
				<Popover.Root bind:open={showGifPicker}>
					<Popover.Trigger
						class="ce-action-btn flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-[oklch(0.40_0.01_80/0.7)] bg-[oklch(0.22_0.01_80/0.7)] text-[oklch(0.70_0.01_80)] transition-colors duration-150 outline-none hover:bg-[oklch(0.28_0.01_80)] hover:text-[oklch(0.96_0.005_80)]"
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
	/* Placeholder via CSS ::before — can't be done with Tailwind */
	.ce-input.ce-empty::before {
		content: attr(data-placeholder);
		color: oklch(0.52 0.01 80);
		pointer-events: none;
		position: absolute;
	}

	/* Mention chip — :global because injected via innerHTML */
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
</style>
