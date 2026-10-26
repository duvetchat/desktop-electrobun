<script lang="ts">
	import { onMount } from "svelte";
	import { Popover } from "bits-ui";
	import {
		Smile as SmileIcon,
		Sticker as StickerIcon,
		Image as GifIcon,
		Plus,
		Mic,
		Square,
		Pause,
		Play,
		Hash as HashIcon,
		Volume2 as VoiceIcon,
	} from "@lucide/svelte";
	import EmojiPicker from "$lib/components/EmojiPicker.svelte";
	import StickerPicker from "$lib/components/StickerPicker.svelte";
	import GifPicker from "$lib/components/GifPicker.svelte";
	import { searchEmojis, toTwemojiUrl, EMOJI_REGEX, type EmojiEntry } from "$lib/emoji";
	import { commandOnceListed, matchingCommands } from "$lib/commands";
	import { escapeHtml } from "$lib/markdown";
	import { formatDuration } from "$lib/utils/time";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import type {
		ApplicationCommand,
		GatewayRoom,
		MemberOnSidebar,
		SpaceCommandApplication,
		SpaceCommands,
		SpaceEmoji,
		SpaceSticker,
	} from "$lib/types";
	import { roomNames, selectedMicId } from "$lib/stores.svelte";
	import { getAvatarURL, getHostURL } from "$lib/common/common";

	const ceHost = getHostURL();

	let {
		placeholder = "",
		initialValue = "",
		onSubmit,
		onVoiceNote,
		onRecording,
		onCancel,
		onValueChange,
		onArrowUpWhenEmpty,
		showActions = true,
		autofocus = false,
		members = [],
		rooms = [],
		customEmojis = [],
		spaceStickers = [],
		pendingFiles = $bindable<File[]>([]),
		loadCommands,
		onCommand,
	}: {
		placeholder?: string;
		initialValue?: string;
		onSubmit: (text: string, files?: File[], stickerAttachmentId?: string) => void;
		onVoiceNote?: (blob: Blob) => void;
		/** Called when a voice note's recording starts, and every second while it goes on. */
		onRecording?: () => void;
		onCancel?: () => void;
		onValueChange?: (text: string) => void;
		onArrowUpWhenEmpty?: () => void;
		showActions?: boolean;
		autofocus?: boolean;
		members?: MemberOnSidebar[];
		/** The rooms "#" suggests: those of the space the user can view. */
		rooms?: GatewayRoom[];
		customEmojis?: SpaceEmoji[];
		spaceStickers?: SpaceSticker[];
		pendingFiles?: File[];
		/** The commands "/" offers at the start of the message, where the user can use them (a room they can write in). */
		loadCommands?: () => Promise<SpaceCommands>;
		/** The command picked from the "/" menu, which the message box leaves for. */
		onCommand?: (command: ApplicationCommand, app: SpaceCommandApplication) => void;
	} = $props();

	let inputEl = $state<HTMLDivElement>(null!);
	let fileInputEl = $state<HTMLInputElement>(null!);
	let showEmojiPicker = $state(false);
	let showStickerPicker = $state(false);
	let showGifPicker = $state(false);
	let isEmpty = $state(true);
	// Empty means no characters at all, so a space hides the placeholder too (sending trims on its own). An
	// emptied contenteditable can still hold a phantom newline.
	const hasNoText = (raw: string) => raw === "" || raw === "\n";

	$effect(() => {
		isEmpty = hasNoText(initialValue);
	});

	// ── Voice recording ──────────────────────────────────────────────────────
	let recording = $state(false);
	let recordingDuration = $state(0);
	// A paused recording keeps what it has; the timer and the "recording" notices wait for it.
	let paused = $state(false);
	let mediaRecorder: MediaRecorder | null = null;
	let recordingInterval: ReturnType<typeof setInterval> | null = null;

	async function startRecording() {
		try {
			const micId = $selectedMicId;
			const rawStream = await navigator.mediaDevices.getUserMedia({
				audio: {
					...(micId ? { deviceId: { exact: micId } } : {}),
					noiseSuppression: true,
					echoCancellation: true,
					autoGainControl: true,
				},
			});
			const recordStream = rawStream;

			const chunks: Blob[] = [];
			mediaRecorder = new MediaRecorder(recordStream, { mimeType: "audio/webm;codecs=opus" });
			mediaRecorder.ondataavailable = (e) => {
				if (e.data.size > 0) chunks.push(e.data);
			};
			mediaRecorder.onstop = () => {
				rawStream.getTracks().forEach((t) => t.stop());
				if (chunks.length > 0) {
					const blob = new Blob(chunks, { type: "audio/webm;codecs=opus" });
					onVoiceNote?.(blob);
				}
			};
			mediaRecorder.start();
			recording = true;
			paused = false;
			recordingDuration = 0;
			onRecording?.();
			recordingInterval = setInterval(() => {
				if (paused) return;
				recordingDuration++;
				onRecording?.();
			}, 1000);
		} catch {
			// Permission denied or no mic
		}
	}

	function togglePause() {
		if (!mediaRecorder || mediaRecorder.state === "inactive") return;
		if (paused) {
			mediaRecorder.resume();
			paused = false;
			onRecording?.();
		} else {
			mediaRecorder.pause();
			paused = true;
		}
	}

	function stopRecording() {
		if (mediaRecorder && mediaRecorder.state !== "inactive") {
			mediaRecorder.stop();
		}
		recording = false;
		paused = false;
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
		paused = false;
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
			isEmpty = hasNoText(initialValue);
			// Undo goes back to the message being edited, not to an empty box.
			undoStack = [{ raw: initialValue, cursor: initialValue.length }];
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

	// ── Room mention autocomplete ───────────────────────────────────────────────
	let roomSuggestions = $state<GatewayRoom[]>([]);
	let roomSelectedIdx = $state(0);
	let roomQueryStart = $state(-1); // char offset of '#' in raw text

	// ── Command menu ────────────────────────────────────────────────────────────
	// What follows the "/" that starts the message while the menu is open (null when it's closed), and the
	// space's commands, asked for each time it opens (they're kept a few minutes).
	let commandQuery = $state<string | null>(null);
	let commandList = $state<SpaceCommands | null>(null);
	// The last request for the list: an older one that answers late isn't shown.
	let commandRequest: Promise<SpaceCommands> | null = null;
	// Enter on a command's name before the list came waits for it: one Enter at a time.
	let enterAwaitingList = false;
	let commandSelectedIdx = $state(0);
	let commandMenuEl = $state<HTMLDivElement>();
	// The keyboard's choice stays in view as the arrows move it.
	$effect(() => {
		commandMenuEl?.querySelectorAll('[role="option"]')[commandSelectedIdx]?.scrollIntoView({ block: "nearest" });
	});
	// The whole message as a command's name: "/" and no space, a phantom line break aside.
	const COMMAND_TEXT = /^\/(\S*)\n?$/u;
	const commandSuggestions = $derived(
		commandQuery === null || !commandList ? [] : matchingCommands(commandList, commandQuery),
	);

	function commandApp(command: ApplicationCommand): SpaceCommandApplication | undefined {
		return commandList?.applications.find((a) => a.id === command.application_id);
	}

	function pickCommand(command: ApplicationCommand | undefined) {
		const app = command && commandApp(command);
		if (!command || !app) return;
		commandQuery = null;
		inputEl.innerHTML = "";
		isEmpty = true;
		undoStack = [{ raw: "", cursor: 0 }];
		undoIndex = 0;
		onCommand?.(command, app);
	}

	function resolveMentionName(id: string): string {
		const m = members.find((m) => m.id === id);
		return m ? m.username || m.raw_username : id.slice(0, 8);
	}

	// As messages show it: a room the user can't view, or one that's gone, has no name to show.
	function roomMentionText(id: string): string {
		return `#${$roomNames[id] ?? "unknown"}`;
	}

	function resolveCustomEmojiName(id: string): string {
		const ce = customEmojis.find((e) => e.id === id);
		return ce ? ce.name : id.slice(0, 8);
	}

	function resolveCustomEmojiUrl(id: string): string {
		const ce = customEmojis.find((e) => e.id === id);
		return ce ? `${ceHost}/attachments/${ce.attachment_id}` : "";
	}

	// Names are whatever their owners chose, "<" and quotes included, so they go in escaped.
	function buildHtml(text: string): string {
		if (!text) return "";
		return text
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(
				/&lt;@([a-f0-9-]+)&gt;/g,
				(_, id) =>
					`<span class="mention-chip" contenteditable="false" data-mention="${id}">@${escapeHtml(resolveMentionName(id))}</span>`,
			)
			.replace(
				/&lt;#([a-f0-9-]+)&gt;/g,
				(_, id) =>
					`<span class="mention-chip" contenteditable="false" data-room="${id}">${escapeHtml(roomMentionText(id))}</span>`,
			)
			.replace(/&lt;:([a-f0-9-]+):&gt;/g, (_, id) => {
				const url = resolveCustomEmojiUrl(id);
				if (!url) return `&lt;:${id}:&gt;`;
				return `<img class="emoji-img custom-emoji-chip" src="${url}" alt=":${escapeHtml(resolveCustomEmojiName(id))}:" data-cemoji="${id}" draggable="false" contenteditable="false">`;
			})
			.replace(
				EMOJI_REGEX,
				(e) => `<span class="emoji-img" style="--tw:url('${toTwemojiUrl(e)}')" aria-label="${e}">${e}</span>`,
			)
			.replace(/\n/g, "<br>");
	}

	// ── DOM helpers ─────────────────────────────────────────────────────────────
	function getRaw(el: HTMLElement): string {
		return getRawFromChildren(el);
	}

	// Cursor position as UTF-16 offset in raw text. The caret can be in a text node or between an element's
	// children, the input's own included: a line break typed on an empty line leaves it there, and reading
	// that as the end of the text sent the caret to the end.
	function getOffset(): number {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return 0;
		const range = sel.getRangeAt(0);
		return measureRawOffset(range.startContainer, range.startOffset);
	}

	function setOffset(target: number): void {
		const sel = window.getSelection();
		if (!sel) return;
		let rem = target;
		const range = document.createRange();
		let placed = false;

		function atomicLen(n: Node): number {
			const tag = (n as Element).tagName;
			if (tag === "BR") return 1;
			const mention = (n as Element).getAttribute?.("data-mention");
			if (mention) return `<@${mention}>`.length;
			const room = (n as Element).getAttribute?.("data-room");
			if (room) return `<#${room}>`.length;
			const cemoji = (n as Element).getAttribute?.("data-cemoji");
			if (cemoji) return `<:${cemoji}:>`.length;
			if (tag === "IMG") return ((n as HTMLImageElement).alt ?? "").length;
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

	// merge: false makes a step of its own, for an insertion (a suggestion, an emoji, a paste) right after typing.
	function pushUndo(raw: string, cursor: number, merge = true) {
		const now = Date.now();
		// Debounce: merge if < 400ms and same-ish content
		if (merge && now - lastPushTime < 400 && undoIndex === undoStack.length - 1) {
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
		isEmpty = hasNoText(raw);
		onValueChange?.(raw);
	}

	function redo() {
		if (undoIndex >= undoStack.length - 1) return;
		undoIndex++;
		const { raw, cursor } = undoStack[undoIndex];
		rerender(raw, cursor);
		isEmpty = hasNoText(raw);
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

		// "/" opens the command menu while the whole message is a command's name: one typed before a draft
		// would make Enter pick a command, and lose the draft.
		const commandMatch = loadCommands ? COMMAND_TEXT.exec(raw) : null;
		if (commandMatch && loadCommands) {
			if (commandQuery === null) {
				// This box stays as the rooms change: another space's list isn't shown while this one's loads.
				commandList = null;
				const request = loadCommands();
				commandRequest = request;
				request
					.then((list) => {
						if (commandRequest === request) commandList = list;
					})
					.catch((err) => console.error("Failed to load the space's commands:", err));
			}
			commandQuery = commandMatch[1];
			commandSelectedIdx = 0;
			mentionSuggestions = [];
			mentionQueryStart = -1;
			roomSuggestions = [];
			roomQueryStart = -1;
			suggestions = [];
			emojiQueryStart = -1;
			return;
		}
		commandQuery = null;

		// @ and : start a suggestion only at a word's start, so an e-mail address, a time (10:30) or an emoticon (:D,
		// as an emoji's needs two letters) doesn't become a mention or an emoji on Enter.
		// Check @mention autocomplete first
		const mentionMatch = /(?<=^|\s)@([\p{L}\p{N}_]*)$/u.exec(before);
		if (mentionMatch && members.length > 0) {
			mentionQueryStart = before.length - mentionMatch[0].length;
			const query = mentionMatch[1].toLowerCase();
			mentionSuggestions = members
				.filter((m) => m.raw_username.toLowerCase().startsWith(query) || m.username.toLowerCase().startsWith(query))
				.slice(0, 10);
			mentionSelectedIdx = 0;
			// Clear emoji and room suggestions when mention is active
			roomSuggestions = [];
			roomQueryStart = -1;
			suggestions = [];
			emojiQueryStart = -1;
			return;
		}
		mentionSuggestions = [];
		mentionQueryStart = -1;

		// # suggests the space's rooms the same way, those whose name starts with what follows it first. A heading's
		// "# " closes it, as a space ends the query.
		const roomMatch = rooms.length > 0 ? /(?<=^|\s)#([\p{L}\p{N}_-]*)$/u.exec(before) : null;
		if (roomMatch) {
			roomQueryStart = before.length - roomMatch[0].length;
			const query = roomMatch[1].toLowerCase();
			const named = [...rooms].sort((a, b) => a.name.localeCompare(b.name));
			const starts = named.filter((r) => r.name.toLowerCase().startsWith(query));
			const contains = named.filter((r) => !starts.includes(r) && r.name.toLowerCase().includes(query));
			roomSuggestions = [...starts, ...contains].slice(0, 10);
			roomSelectedIdx = 0;
			suggestions = [];
			emojiQueryStart = -1;
			return;
		}
		roomSuggestions = [];
		roomQueryStart = -1;

		// Check :emoji autocomplete (custom + default)
		const m = /(?<=^|\s):([\w\d_]{2,})$/.exec(before);
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
		pushUndo(newRaw, newPos, false);
		isEmpty = hasNoText(newRaw);
		onValueChange?.(newRaw);
		mentionSuggestions = [];
		mentionQueryStart = -1;
		mentionSelectedIdx = 0;
		inputEl.focus();
	}

	function insertRoomSuggestion(room: GatewayRoom) {
		const raw = getRaw(inputEl);
		const cursor = getOffset();
		const before = raw.slice(0, roomQueryStart);
		const after = raw.slice(cursor);
		const mention = `<#${room.id}> `;
		const newRaw = before + mention + after;
		const newPos = roomQueryStart + mention.length;

		rerender(newRaw, newPos);
		pushUndo(newRaw, newPos, false);
		isEmpty = hasNoText(newRaw);
		onValueChange?.(newRaw);
		roomSuggestions = [];
		roomQueryStart = -1;
		roomSelectedIdx = 0;
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
		pushUndo(newRaw, newPos, false);
		isEmpty = hasNoText(newRaw);
		onValueChange?.(newRaw);
		suggestions = [];
		emojiQueryStart = -1;
		selectedIdx = 0;
		inputEl.focus();
	}

	// ── Event handlers ──────────────────────────────────────────────────────────
	let pendingOffset: number | null = null;
	// The caret's offset when the input last lost the focus, for the emoji picker, which takes it.
	let blurOffset: number | null = null;

	function rememberCaret() {
		blurOffset = getOffset();
	}

	// An IME composes its text in the input, and a rerender would commit what it has so far and start it over (日本
	// came out as ににほにほん日本), so the input waits for compositionend, which comes here too.
	function handleInput(e?: Event) {
		if ((e as InputEvent | undefined)?.isComposing) return;
		const raw = getRaw(inputEl);
		const offset = pendingOffset ?? getOffset();
		pendingOffset = null;
		isEmpty = hasNoText(raw);
		rerender(raw, offset);
		pushUndo(raw, offset);
		checkAutocomplete(raw, offset);
		onValueChange?.(raw);
	}

	function handleKeyDown(e: KeyboardEvent) {
		// While an IME composes, keys are its own: an Enter picks its text, and must not send.
		if (e.isComposing) return;
		// Capture start offset before browser modifies the DOM on delete with selection
		const sel = window.getSelection();
		if (sel && !sel.isCollapsed && (e.key === "Backspace" || e.key === "Delete")) {
			pendingOffset = getOffset();
		}
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

		// Navigate the command menu, while the message is still a command's name (an undo can bring a draft back).
		if (commandSuggestions.length > 0 && !COMMAND_TEXT.test(getRaw(inputEl))) commandQuery = null;
		if (commandSuggestions.length > 0) {
			if (e.key === "ArrowUp") {
				e.preventDefault();
				commandSelectedIdx = (commandSelectedIdx - 1 + commandSuggestions.length) % commandSuggestions.length;
				return;
			}
			if (e.key === "ArrowDown") {
				e.preventDefault();
				commandSelectedIdx = (commandSelectedIdx + 1) % commandSuggestions.length;
				return;
			}
			if (e.key === "Enter" || e.key === "Tab") {
				e.preventDefault();
				pickCommand(commandSuggestions[commandSelectedIdx]);
				return;
			}
			if (e.key === "Escape") {
				commandQuery = null;
				return;
			}
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

		// Navigate room autocomplete
		if (roomSuggestions.length > 0) {
			if (e.key === "ArrowUp") {
				e.preventDefault();
				roomSelectedIdx = (roomSelectedIdx - 1 + roomSuggestions.length) % roomSuggestions.length;
				return;
			}
			if (e.key === "ArrowDown") {
				e.preventDefault();
				roomSelectedIdx = (roomSelectedIdx + 1) % roomSuggestions.length;
				return;
			}
			if (e.key === "Enter" || e.key === "Tab") {
				e.preventDefault();
				insertRoomSuggestion(roomSuggestions[roomSelectedIdx]);
				return;
			}
			if (e.key === "Escape") {
				roomSuggestions = [];
				roomQueryStart = -1;
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
			const raw = getRaw(inputEl);
			const request = commandRequest;
			// A command's name typed before the space's commands came: Enter waits for them, then picks the first
			// match, as the menu would have, or sends the text when none matches.
			if (commandQuery !== null && !commandList && request && COMMAND_TEXT.test(raw)) {
				if (enterAwaitingList) return;
				enterAwaitingList = true;
				commandOnceListed(request, commandQuery).then((command) => {
					enterAwaitingList = false;
					// Another room's list by now, or other text: that Enter is over.
					if (commandRequest !== request || getRaw(inputEl) !== raw) return;
					if (command) pickCommand(command);
					else sendMessage();
				});
				return;
			}
			sendMessage();
			return;
		}

		// Edit last message on ArrowUp when input is empty
		if (e.key === "ArrowUp" && isEmpty && !e.ctrlKey) {
			onArrowUpWhenEmpty?.();
		}
	}

	// Sends what the box holds, with the files picked, and empties it.
	function sendMessage() {
		const raw = getRaw(inputEl).trim();
		if (!raw && pendingFiles.length === 0) return;
		const filesToSend = pendingFiles.length > 0 ? [...pendingFiles] : undefined;
		onSubmit(raw, filesToSend);
		inputEl.innerHTML = "";
		isEmpty = true;
		pendingFiles = [];
		// What was sent is no draft to undo back to.
		undoStack = [{ raw: "", cursor: 0 }];
		undoIndex = 0;
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
		const room = elem.getAttribute("data-room");
		if (room) return `<#${room}>`;
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
			const tag = el.tagName;
			if (tag === "BR") return 1;
			const mention = el.getAttribute?.("data-mention");
			if (mention) return `<@${mention}>`.length;
			const room = el.getAttribute?.("data-room");
			if (room) return `<#${room}>`.length;
			const cemoji = el.getAttribute?.("data-cemoji");
			if (cemoji) return `<:${cemoji}:>`.length;
			if (tag === "IMG") return ((n as HTMLImageElement).alt ?? "").length;
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

	// A copy or a cut gives other apps the text as it reads, with mentions as @name and #room and the space's custom
	// emojis as :name:, and keeps the raw text under this type, which a paste here prefers: mentions and emojis come back.
	const RAW_CLIPBOARD_TYPE = "application/x-duvet-message";

	function displayText(raw: string): string {
		return raw
			.replace(/<@([a-f0-9-]+)>/g, (_, id) => `@${resolveMentionName(id)}`)
			.replace(/<#([a-f0-9-]+)>/g, (_, id) => roomMentionText(id))
			.replace(/<:([a-f0-9-]+):>/g, (m, id) =>
				customEmojis.some((e) => e.id === id) ? `:${resolveCustomEmojiName(id)}:` : m,
			);
	}

	function copySelection(e: ClipboardEvent): boolean {
		const text = getSelectedRaw();
		if (text == null || !e.clipboardData) return false;
		e.preventDefault();
		e.clipboardData.setData("text/plain", displayText(text));
		e.clipboardData.setData(RAW_CLIPBOARD_TYPE, text);
		return true;
	}

	function handleCopy(e: ClipboardEvent) {
		copySelection(e);
	}

	function handleCut(e: ClipboardEvent) {
		if (!copySelection(e)) return;
		window.getSelection()?.deleteFromDocument();
		const raw = getRaw(inputEl);
		const pos = getOffset();
		rerender(raw, pos);
		pushUndo(raw, pos);
		isEmpty = hasNoText(raw);
		onValueChange?.(raw);
	}

	function handlePaste(e: ClipboardEvent) {
		e.preventDefault();
		if (e.clipboardData?.files && e.clipboardData.files.length > 0) {
			pendingFiles = [...pendingFiles, ...Array.from(e.clipboardData.files)];
		}
		const text = (e.clipboardData?.getData(RAW_CLIPBOARD_TYPE) || e.clipboardData?.getData("text/plain") || "").replace(
			/\r\n/g,
			"\n",
		);
		if (!text) return;
		const sel = window.getSelection();
		if (sel && !sel.isCollapsed) {
			sel.deleteFromDocument();
		}
		let raw = getRaw(inputEl);
		let pos = getOffset();
		// Empty contenteditable may have a phantom newline
		if (isEmpty || raw === "\n") {
			raw = "";
			pos = 0;
		}
		const newRaw = raw.slice(0, pos) + text + raw.slice(pos);
		const newPos = pos + text.length;
		rerender(newRaw, newPos);
		pushUndo(newRaw, newPos, false);
		isEmpty = hasNoText(newRaw);
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
		const raw = getRaw(inputEl);
		// The picker's search box has the focus by now: the emoji goes where the caret was when the input lost it.
		const sel = window.getSelection();
		const inInput = !!sel && sel.rangeCount > 0 && inputEl.contains(sel.anchorNode);
		const offset = inInput ? getOffset() : Math.min(blurOffset ?? raw.length, raw.length);
		const newRaw = raw.slice(0, offset) + emoji + raw.slice(offset);
		const newPos = offset + emoji.length;
		rerender(newRaw, newPos);
		pushUndo(newRaw, newPos, false);
		isEmpty = hasNoText(newRaw);
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
	<!-- Command menu -->
	{#if commandSuggestions.length > 0}
		<div
			class="absolute right-0 bottom-[calc(100%+6px)] left-0 z-90 max-h-75 overflow-hidden overflow-y-auto rounded-lg border border-[oklch(0.30_0.01_80)] bg-[oklch(0.19_0.008_80)] py-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
			role="listbox"
			aria-label="Commands"
			bind:this={commandMenuEl}
		>
			<div class="text-xxs px-3 pt-1.5 pb-1 font-bold tracking-wider text-[oklch(0.52_0.01_80)] uppercase">
				{#if commandQuery}
					Commands matching <strong>/{commandQuery}</strong>
				{:else}
					Commands
				{/if}
			</div>
			{#each commandSuggestions as command, i (command.id)}
				{@const bot = commandApp(command)?.bot}
				<button
					role="option"
					aria-selected={i === commandSelectedIdx}
					class="flex w-full cursor-pointer items-center gap-2.5 border-none bg-none px-3 py-1.5 text-left transition-[background] duration-100 {i ===
					commandSelectedIdx
						? 'bg-[oklch(0.28_0.01_80)]'
						: 'hover:bg-[oklch(0.28_0.01_80)]'}"
					onmousedown={(e) => {
						e.preventDefault();
						pickCommand(command);
					}}
					onmouseenter={() => (commandSelectedIdx = i)}
				>
					<span class="shrink-0 text-[13px] font-semibold text-[oklch(0.85_0.008_80)]">/{command.name}</span>
					<span class="min-w-0 flex-1 truncate text-[12px] text-[oklch(0.62_0.01_80)]">{command.description}</span>
					{#if bot}
						<span class="flex shrink-0 items-center gap-1.5 text-[11px] text-[oklch(0.52_0.01_80)]">
							<UserAvatar src={getAvatarURL(bot.id, bot.avatar)} name={bot.alias ?? bot.username} size={16} />
							{bot.alias ?? bot.username}
						</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}

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
						.match(/@([\p{L}\p{N}_]*)$/u)?.[1]}</strong
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

	<!-- Room mention autocomplete dropdown -->
	{#if roomSuggestions.length > 0}
		<div
			class="absolute right-0 bottom-[calc(100%+6px)] left-0 z-90 max-h-75 overflow-hidden overflow-y-auto rounded-lg border border-[oklch(0.30_0.01_80)] bg-[oklch(0.19_0.008_80)] py-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
			role="listbox"
			aria-label="Room suggestions"
		>
			<div class="text-xxs px-3 pt-1.5 pb-1 font-bold tracking-wider text-[oklch(0.52_0.01_80)] uppercase">
				Rooms matching <strong
					>#{getRaw(inputEl)
						.slice(0, getOffset())
						.match(/#([\p{L}\p{N}_-]*)$/u)?.[1]}</strong
				>
			</div>
			{#each roomSuggestions as room, i (room.id)}
				<button
					role="option"
					aria-selected={i === roomSelectedIdx}
					class="flex w-full cursor-pointer items-center gap-2.5 border-none bg-none px-3 py-1.5 text-left transition-[background] duration-100 {i ===
					roomSelectedIdx
						? 'bg-[oklch(0.28_0.01_80)]'
						: 'hover:bg-[oklch(0.28_0.01_80)]'}"
					onmousedown={(e) => {
						e.preventDefault();
						insertRoomSuggestion(room);
					}}
					onmouseenter={() => (roomSelectedIdx = i)}
				>
					{#if room.type === 2}
						<VoiceIcon class="size-4 shrink-0 text-[oklch(0.62_0.01_80)]" aria-label="Voice room" />
					{:else}
						<HashIcon class="size-4 shrink-0 text-[oklch(0.62_0.01_80)]" />
					{/if}
					<span class="truncate text-[13px] text-[oklch(0.85_0.008_80)]">{room.name}</span>
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
					<div class="size-2.5 rounded-full {paused ? 'bg-zinc-500' : 'animate-pulse bg-red-500'}"></div>
					<span class="text-sm font-medium text-zinc-300 tabular-nums">{formatDuration(recordingDuration)}</span>
					<span class="text-xs text-zinc-500">{paused ? "Paused" : "Recording..."}</span>
				</div>
			</div>
			<button
				type="button"
				class="ce-action-btn flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-[oklch(0.40_0.01_80/0.7)] bg-[oklch(0.22_0.01_80/0.7)] text-[oklch(0.70_0.01_80)] transition-colors duration-150 outline-none hover:bg-[oklch(0.28_0.01_80)] hover:text-[oklch(0.96_0.005_80)]"
				title={paused ? "Resume recording" : "Pause recording"}
				aria-label={paused ? "Resume recording" : "Pause recording"}
				onclick={togglePause}
			>
				{#if paused}
					<Play class="size-4" fill="currentColor" />
				{:else}
					<Pause class="size-4" fill="currentColor" />
				{/if}
			</button>
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
				class="pointer-events-auto flex flex-1 items-start gap-3 rounded-xl border-none bg-[oklch(0.22_0.01_80/0.8)] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
			>
				{#if showActions}
					<!-- File picker button, inside the box before the text as in Discord -->
					<button
						type="button"
						class="flex size-5 shrink-0 cursor-pointer items-center justify-center text-[oklch(0.70_0.01_80)] transition-colors duration-150 outline-none hover:text-[oklch(0.96_0.005_80)]"
						title="Attach files"
						aria-label="Attach files"
						onclick={() => fileInputEl?.click()}
					>
						<Plus class="size-5" />
					</button>
				{/if}
				<div
					bind:this={inputEl}
					contenteditable="true"
					role="textbox"
					tabindex="0"
					aria-multiline="false"
					aria-label={placeholder}
					class="ce-input focus-override block max-h-36 min-h-5 min-w-0 flex-1 overflow-y-auto text-sm leading-5 wrap-break-word whitespace-pre-wrap text-[oklch(0.96_0.005_80)] caret-[oklch(0.96_0.005_80)] outline-none select-text [scrollbar-width:thin] {isEmpty
						? 'ce-empty'
						: ''}"
					data-placeholder={placeholder}
					onkeydown={handleKeyDown}
					oninput={handleInput}
					oncompositionend={handleInput}
					onblur={rememberCaret}
					onpaste={handlePaste}
					oncopy={handleCopy}
					oncut={handleCut}
				></div>
			</div>

			{#if showActions}
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
