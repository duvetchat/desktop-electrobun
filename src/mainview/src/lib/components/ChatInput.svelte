<script lang="ts">
	import { onDestroy, onMount, untrack } from "svelte";
	import { Popover } from "bits-ui";
	import SmilePlusIcon from "$lib/components/ui/icons/SmilePlus.svelte";
	import {
		ArrowUp as SendIcon,
		Check as SaveIcon,
		Sticker as StickerIcon,
		ImagePlay as GifIcon,
		Paperclip as AttachIcon,
		Plus,
		Mic,
		Pause,
		Play,
		Trash2 as DiscardIcon,
		Hash as HashIcon,
		Volume2 as VoiceIcon,
	} from "@lucide/svelte";
	import Menu from "$lib/components/ui/Menu.svelte";
	import MenuItem from "$lib/components/ui/MenuItem.svelte";
	import Segmented from "$lib/components/ui/Segmented.svelte";
	import { claimLayer, layerStyle, releaseLayer } from "$lib/overlay-layers";
	import EmojiPicker from "$lib/components/EmojiPicker.svelte";
	import StickerPicker from "$lib/components/StickerPicker.svelte";
	import GifPicker from "$lib/components/GifPicker.svelte";
	import { emojiDataNow, loadEmojiData, toTwemojiUrl, EMOJI_REGEX, type EmojiEntry } from "$lib/emoji";
	import { emojiSuggestions, type PickerGroup } from "$lib/space-emojis";
	import { emojiUsed } from "$lib/recent-emoji";
	import {
		commandOnceListed,
		commandQuery as commandQueryOf,
		matchingCommands,
		type CommandEntry,
	} from "$lib/commands";
	import { changeDraft, chatDrafts, draftOf } from "$lib/drafts";
	import { breakLine, caretAt, enterKey, lineBreaksHtml, rawOf, rawOffsetOf } from "$lib/message-box";
	import { escapeHtml } from "$lib/markdown";
	import { formatDuration } from "$lib/utils/time";
	import MemberBanner from "$lib/components/MemberBanner.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import type {
		GatewayRoom,
		MemberOnSidebar,
		SpaceCommandApplication,
		SpaceCommands,
		SpaceEmoji,
		SpaceSticker,
	} from "$lib/types";
	import { roomNames, selectedMicId } from "$lib/stores.svelte";
	import { getAvatarURL, getHostURL } from "$lib/common/common";
	import { messageTooLarge } from "$lib/api/messages";
	import { toast } from "$lib/stores/toast.svelte";

	const ceHost = getHostURL();

	let {
		placeholder = "",
		initialValue = "",
		draftChat,
		onSubmit,
		onVoiceNote,
		onRecording,
		onCancel,
		onValueChange,
		onArrowUpWhenEmpty,
		editing = false,
		autofocus = false,
		members = [],
		rooms = [],
		emojiGroups = [],
		stickerGroups = [],
		spaceId = null,
		pendingFiles = $bindable<File[]>([]),
		loadCommands,
		onCommand,
	}: {
		placeholder?: string;
		initialValue?: string;
		/** The chat whose draft the box holds (lib/drafts.ts), for as long as it lives: it starts from that draft, keeps
		 * it as it changes, and shows what another pane's box of the chat writes to it. */
		draftChat?: string;
		onSubmit: (text: string, files?: File[], stickerAttachmentId?: string) => void;
		onVoiceNote?: (blob: Blob) => void;
		/** Called when a voice note's recording starts, and every second while it goes on. */
		onRecording?: () => void;
		onCancel?: () => void;
		onValueChange?: (text: string) => void;
		/** Arrow Up in the empty box: starts editing the user's last message, and says whether it did. */
		onArrowUpWhenEmpty?: () => boolean;
		/** The box edits a message rather than writing one: it has no + menu, sends no GIF, sticker or voice note, and
		 * its send button saves. */
		editing?: boolean;
		autofocus?: boolean;
		members?: MemberOnSidebar[];
		/** The rooms "#" suggests: those of the space the user can view. */
		rooms?: GatewayRoom[];
		/** The custom emojis of every Space the user is in, by Space, as the emoji picker shows them. */
		emojiGroups?: PickerGroup<SpaceEmoji>[];
		/** The stickers of every Space the user is in, by Space: the sticker picker shows wherever there is one. */
		stickerGroups?: PickerGroup<SpaceSticker>[];
		/** The Space the box writes in, whose emojis ":" suggests first; none in a conversation. */
		spaceId?: string | null;
		pendingFiles?: File[];
		/** The commands "/" offers at the start of the message, where the user can use them (a room they can write in). */
		loadCommands?: () => Promise<SpaceCommands>;
		/** What was picked from the "/" menu (a command, or one of its subcommands), which the message box leaves for. */
		onCommand?: (entry: CommandEntry, app: SpaceCommandApplication) => void;
	} = $props();

	// Names the suggestion lists and their rows, for the box to point a screen reader at (suggesting, below).
	const uid = $props.id();

	let inputEl = $state<HTMLDivElement>(null!);
	let fileInputEl = $state<HTMLInputElement>(null!);
	// The one picker of the box, behind its emoji button: emoji, GIFs, and the stickers of the user's Spaces when one has
	// some. The + menu opens it on GIFs or on stickers.
	type PickerTab = "emoji" | "gif" | "sticker";
	let showPicker = $state(false);
	// The pickers' layer, claimed as they open (lib/overlay-layers.ts): the thread's message box is in a sheet, and
	// its pickers open in front of it.
	const pickerLayer = $derived(showPicker ? claimLayer() : 0);
	$effect(() => {
		const mine = pickerLayer;
		if (mine) return () => releaseLayer(mine);
	});
	let pickerTab = $state<PickerTab>("emoji");
	let showPlusMenu = $state(false);
	const pickerTabs = $derived<{ value: PickerTab; label: string }[]>(
		editing
			? [{ value: "emoji", label: "Emoji" }]
			: [
					{ value: "emoji", label: "Emoji" },
					{ value: "gif", label: "GIFs" },
					...(stickerGroups.length > 0 ? [{ value: "sticker" as const, label: "Stickers" }] : []),
				],
	);
	// Once the + menu has closed and given the focus back: the picker opening under it would close with it.
	function openPicker(tab: PickerTab) {
		pickerTab = tab;
		setTimeout(() => {
			if (!destroyed) showPicker = true;
		});
	}
	let isEmpty = $state(true);
	// Empty means no characters at all, so a space or a line break hides the placeholder too (sending trims on its
	// own). The break a web view leaves in a box it emptied isn't read as text (rawOf, lib/message-box.ts).
	const hasNoText = (raw: string) => raw === "";

	$effect(() => {
		isEmpty = hasNoText(initialValue);
	});

	// Read once: what comes after the user left this box's chat (an event of its element going away) writes that chat's
	// draft, never the one they went to.
	const chat = untrack(() => draftChat);
	// The text this box last wrote to its chat's draft, or showed from it: any other text there is another box's.
	let kept = "";
	// What the box still waits for once it's gone (the commands list, the microphone, a file dialog) comes to nothing.
	let destroyed = false;
	onDestroy(() => {
		destroyed = true;
		cancelRecording();
	});

	function keepDraft(raw: string) {
		if (!chat) return;
		kept = hasNoText(raw) ? "" : raw;
		changeDraft(chat, { text: kept });
	}

	function changed(raw: string) {
		keepDraft(raw);
		onValueChange?.(raw);
	}

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
			if (destroyed) {
				rawStream.getTracks().forEach((t) => t.stop());
				return;
			}
			const recordStream = rawStream;

			const chunks: Blob[] = [];
			mediaRecorder = new MediaRecorder(recordStream, { mimeType: "audio/webm;codecs=opus" });
			mediaRecorder.ondataavailable = (e) => {
				if (e.data.size > 0) chunks.push(e.data);
			};
			mediaRecorder.onstop = () => {
				rawStream.getTracks().forEach((t) => t.stop());
				if (chunks.length > 0 && !destroyed) {
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
		if (input.files && !destroyed) {
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
				if (destroyed) return;
				takeFocus();
				// A draft that is a command's name opens its menu again: Enter picks the command there, rather than post
				// its name.
				const raw = chat && document.activeElement === inputEl ? getRaw(inputEl) : "";
				if (raw && commandQueryOf(raw, null) !== null) checkAutocomplete(raw, raw.length);
			});
		}
	});

	// Every emoji of the user's Spaces, whatever chat this is: the chips' names and what ":" suggests.
	const customEmojis = $derived(emojiGroups.flatMap((g) => g.items));

	// Re-render when customEmojis arrives (edit input may mount before emojis load)
	let hadCustomEmojis = $state(false);
	$effect(() => {
		const count = customEmojis.length;
		if (count > 0 && !hadCustomEmojis && inputEl) {
			hadCustomEmojis = true;
			const raw = getRaw(inputEl);
			if (raw.includes("<:")) {
				if (selectionInBox()) rerender(raw, getOffset());
				else inputEl.innerHTML = buildHtml(raw);
			}
		}
	});

	// A draft can come back before its space's members and rooms do (a READY brings them again): its chips follow them,
	// in place, as rebuilding the text would end a composition.
	$effect(() => {
		void [members, $roomNames];
		untrack(() => {
			for (const chip of inputEl?.querySelectorAll<HTMLElement>("[data-mention], [data-room]") ?? []) {
				const { mention, room } = chip.dataset;
				const text = mention ? `@${resolveMentionName(mention)}` : roomMentionText(room ?? "");
				if (chip.textContent !== text) chip.textContent = text;
			}
		});
	});

	// Shows the chat's draft: as the box starts, as its element comes back after a recording, and when another pane's
	// box of the chat writes or sends it. The caret stays where it is: in that other box, or this one places it as it
	// takes the focus. Undo starts over from here: what the other box sent or wrote isn't this one's to undo.
	let filledEl: HTMLElement | null = null;
	$effect(() => {
		const el = inputEl;
		if (!chat || !el) return;
		const text = draftOf($chatDrafts, chat).text;
		if (el === filledEl && text === kept) return;
		filledEl = el;
		kept = text;
		untrack(() => {
			el.innerHTML = buildHtml(text);
			isEmpty = hasNoText(text);
			undoStack = [{ raw: text, cursor: text.length }];
			undoIndex = 0;
			closeSuggestions();
		});
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
	// What runs: each command, or each of its subcommands, by its whole name (lib/commands.ts).
	const commandSuggestions = $derived(
		commandQuery === null || !commandList ? [] : matchingCommands(commandList, commandQuery),
	);

	function commandApp(entry: CommandEntry): SpaceCommandApplication | undefined {
		return commandList?.applications.find((a) => a.id === entry.command.application_id);
	}

	function pickCommand(entry: CommandEntry | undefined) {
		const app = entry && commandApp(entry);
		if (!entry || !app) return;
		commandQuery = null;
		inputEl.innerHTML = "";
		isEmpty = true;
		undoStack = [{ raw: "", cursor: 0 }];
		undoIndex = 0;
		keepDraft("");
		onCommand?.(entry, app);
	}

	function closeSuggestions() {
		commandQuery = null;
		mentionSuggestions = [];
		mentionQueryStart = -1;
		roomSuggestions = [];
		roomQueryStart = -1;
		suggestions = [];
		emojiQueryStart = -1;
	}

	function resolveMentionName(id: string): string {
		const m = members.find((member) => member.id === id);
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

	// A member's or a room's chip, as buildHtml writes it into the box: its classes are in this file, so the build has them.
	const MENTION_CHIP =
		"inline cursor-default rounded px-1 py-px font-medium select-all bg-duvet-accent-tint text-duvet-accent-text";

	// Names are whatever their owners chose, "<" and quotes included, so they go in escaped.
	function buildHtml(text: string): string {
		if (!text) return "";
		const html = text
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(
				/&lt;@([a-f0-9-]+)&gt;/g,
				(_, id) =>
					`<span class="${MENTION_CHIP}" contenteditable="false" data-mention="${id}">@${escapeHtml(resolveMentionName(id))}</span>`,
			)
			.replace(
				/&lt;#([a-f0-9-]+)&gt;/g,
				(_, id) =>
					`<span class="${MENTION_CHIP}" contenteditable="false" data-room="${id}">${escapeHtml(roomMentionText(id))}</span>`,
			)
			.replace(/&lt;:([a-f0-9-]+):&gt;/g, (_, id) => {
				const url = resolveCustomEmojiUrl(id);
				if (!url) return `&lt;:${id}:&gt;`;
				return `<img class="emoji-img custom-emoji-chip" src="${url}" alt=":${escapeHtml(resolveCustomEmojiName(id))}:" data-cemoji="${id}" draggable="false" contenteditable="false">`;
			})
			.replace(
				EMOJI_REGEX,
				(e) => `<span class="emoji-img" style="--tw:url('${toTwemojiUrl(e)}')" aria-label="${e}">${e}</span>`,
			);
		return lineBreaksHtml(html);
	}

	// ── DOM helpers ─────────────────────────────────────────────────────────────
	function getRaw(el: HTMLElement): string {
		return rawOf(el);
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
		const range = document.createRange();
		const place = caretAt<Node>(inputEl, target);
		if (!place) {
			range.selectNodeContents(inputEl);
			range.collapse(false);
		} else {
			if (place.at === "before") range.setStartBefore(place.node);
			else if (place.at === "after") range.setStartAfter(place.node);
			else range.setStart(place.node, place.at);
			range.collapse(true);
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
		const entry = undoStack[undoIndex];
		if (!entry) return;
		const { raw, cursor } = entry;
		rerender(raw, cursor);
		isEmpty = hasNoText(raw);
		changed(raw);
	}

	function redo() {
		if (undoIndex >= undoStack.length - 1) return;
		undoIndex++;
		const entry = undoStack[undoIndex];
		if (!entry) return;
		const { raw, cursor } = entry;
		rerender(raw, cursor);
		isEmpty = hasNoText(raw);
		changed(raw);
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

		// "/" opens the command menu while the whole message names something to run (lib/commands.ts): a command's
		// name, or one with subcommands and the words of its subcommand. One typed before a draft would make Enter
		// pick a command, and lose the draft.
		const typedCommand = loadCommands ? commandQueryOf(raw, commandList) : null;
		if (typedCommand !== null && loadCommands) {
			if (commandQuery === null) {
				// Asked for each time the menu opens: an earlier list isn't shown while this one loads.
				commandList = null;
				const request = loadCommands();
				commandRequest = request;
				request
					.then((list) => {
						if (commandRequest === request) commandList = list;
					})
					.catch((err) => console.error("Failed to load the space's commands:", err));
			}
			commandQuery = typedCommand;
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
			const query = mentionMatch[1]!.toLowerCase();
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
			const query = roomMatch[1]!.toLowerCase();
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
			// Every Space's emojis, the current Space's first (emojiSuggestions).
			const customScored = emojiSuggestions(m[1]!, customEmojis, spaceId).map(
				(ce) =>
					({
						emoji: `<:${ce.id}:>`,
						name: ce.name,
						customEmojiId: ce.id,
						customAttachmentId: ce.attachment_id,
					}) as EmojiEntry & { customEmojiId: string; customAttachmentId: string },
			);
			// The emoji dataset, once the app has it; asked for now otherwise, as the picker does (#318), and these
			// suggestions show again with it.
			const emojiData = emojiDataNow();
			if (!emojiData)
				void loadEmojiData().then(() => {
					if (!destroyed && emojiQueryStart !== -1) checkAutocomplete(getRaw(inputEl), getOffset());
				});
			const defaultMatches = emojiData?.searchEmojis(m[1]!) ?? [];
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
		changed(newRaw);
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
		changed(newRaw);
		roomSuggestions = [];
		roomQueryStart = -1;
		roomSelectedIdx = 0;
		inputEl.focus();
	}

	function insertSuggestion(entry: EmojiEntry) {
		// A pick counts as a use of its emoji, as one in the picker does (lib/recent-emoji.ts).
		emojiUsed(entry.emoji);
		const raw = getRaw(inputEl);
		const cursor = getOffset();
		const before = raw.slice(0, emojiQueryStart);
		const after = raw.slice(cursor);
		const newRaw = before + entry.emoji + after;
		const newPos = emojiQueryStart + entry.emoji.length;

		rerender(newRaw, newPos);
		pushUndo(newRaw, newPos, false);
		isEmpty = hasNoText(newRaw);
		changed(newRaw);
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
		if ((e as InputEvent | undefined)?.isComposing || !inputEl) return;
		const raw = getRaw(inputEl);
		const offset = pendingOffset ?? getOffset();
		pendingOffset = null;
		isEmpty = hasNoText(raw);
		rerender(raw, offset);
		pushUndo(raw, offset);
		checkAutocomplete(raw, offset);
		changed(raw);
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

		// Shift+Enter starts a new line, whatever is open over the box: the suggestions close as their query ends.
		if (enterKey(e) === "break") {
			e.preventDefault();
			insertLineBreak();
			return;
		}

		// Navigate the command menu, while the message is still a command's name (an undo can bring a draft back).
		if (commandSuggestions.length > 0 && commandQueryOf(getRaw(inputEl), commandList) === null) commandQuery = null;
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
				const member = mentionSuggestions[mentionSelectedIdx];
				if (member) insertMentionSuggestion(member);
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
				const room = roomSuggestions[roomSelectedIdx];
				if (room) insertRoomSuggestion(room);
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
				const entry = suggestions[selectedIdx];
				if (entry) insertSuggestion(entry);
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
		if (enterKey(e) === "send") {
			e.preventDefault();
			const raw = getRaw(inputEl);
			const request = commandRequest;
			// A command's name typed before the space's commands came: Enter waits for them, then picks the first
			// match, as the menu would have, or sends the text when none matches.
			if (commandQuery !== null && !commandList && request && commandQueryOf(raw, null) !== null) {
				if (enterAwaitingList) return;
				enterAwaitingList = true;
				commandOnceListed(request, commandQuery).then((entry) => {
					enterAwaitingList = false;
					// Another room's list by now, or other text: that Enter is over.
					if (destroyed || commandRequest !== request || getRaw(inputEl) !== raw) return;
					if (entry) pickCommand(entry);
					else sendMessage();
				});
				return;
			}
			sendMessage();
			return;
		}

		// Arrow Up in the empty box edits the user's last message. Its edit box has the caret at the message's end by then,
		// and the key's own move would carry it up a line there, or to the start of a single one (Chromium).
		if (e.key === "ArrowUp" && isEmpty && !e.ctrlKey && onArrowUpWhenEmpty?.()) e.preventDefault();
	}

	// A line break at the caret, or over the selection (#415). Made here, in the text, rather than left to the web view:
	// each makes its own. WebKit starts a paragraph, whose line the caret's offset didn't count, so the break showed and
	// the caret stayed where it was; Chromium's left a second break behind, in the text, once the first was deleted.
	function insertLineBreak() {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return;
		const range = sel.getRangeAt(0);
		const next = breakLine(
			getRaw(inputEl),
			measureRawOffset(range.startContainer, range.startOffset),
			measureRawOffset(range.endContainer, range.endOffset),
		);
		rerender(next.raw, next.caret);
		revealCaret();
		pushUndo(next.raw, next.caret);
		isEmpty = hasNoText(next.raw);
		checkAutocomplete(next.raw, next.caret);
		changed(next.raw);
	}

	// Brings the caret's line into view in a box with more lines than it shows. A web view does it after an edit of its
	// own; after one made here, nothing does.
	function revealCaret() {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return;
		const range = sel.getRangeAt(0);
		let line: DOMRect | undefined = range.getClientRects()[0];
		// A caret between two of the box's nodes has no rectangle of its own (Chromium): the node after it is on its
		// line. With none after it, or only the break that shows the last line, it is on the last line.
		if (!line && range.startContainer === inputEl) {
			const after = inputEl.childNodes[range.startOffset];
			if (!after || (after.nodeName === "BR" && !after.nextSibling)) {
				inputEl.scrollTop = inputEl.scrollHeight;
				return;
			}
			if (after instanceof Element) line = after.getBoundingClientRect();
			else {
				const around = document.createRange();
				around.selectNode(after);
				line = around.getClientRects()[0];
			}
		}
		if (!line || line.height === 0) return;
		const shown = inputEl.getBoundingClientRect();
		if (line.bottom > shown.bottom) inputEl.scrollTop += line.bottom - shown.bottom;
		else if (line.top < shown.top) inputEl.scrollTop -= shown.top - line.top;
	}

	// Sends what the box holds, with the files picked, and empties it. A message too large for the API stays in the box,
	// its text and files with it, and says so: nothing is sent (#182).
	function sendMessage() {
		const raw = getRaw(inputEl).trim();
		if (!raw && pendingFiles.length === 0) return;
		const tooLarge = messageTooLarge(raw, pendingFiles);
		if (tooLarge) {
			toast(tooLarge, "error");
			return;
		}
		const filesToSend = pendingFiles.length > 0 ? [...pendingFiles] : undefined;
		onSubmit(raw, filesToSend);
		inputEl.innerHTML = "";
		isEmpty = true;
		pendingFiles = [];
		// What was sent is no draft to undo back to.
		undoStack = [{ raw: "", cursor: 0 }];
		undoIndex = 0;
		keepDraft("");
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

	function measureRawOffset(container: Node, offset: number): number {
		return rawOffsetOf(inputEl, container, offset);
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
		changed(raw);
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
		const raw = getRaw(inputEl);
		const pos = getOffset();
		const newRaw = raw.slice(0, pos) + text + raw.slice(pos);
		const newPos = pos + text.length;
		rerender(newRaw, newPos);
		pushUndo(newRaw, newPos, false);
		isEmpty = hasNoText(newRaw);
		checkAutocomplete(newRaw, newPos);
		changed(newRaw);
	}

	function handleStickerPick(sticker: SpaceSticker) {
		showPicker = false;
		onSubmit("", undefined, sticker.attachment_id);
	}

	function handleGifPick(url: string) {
		showPicker = false;
		onSubmit(url);
	}

	// Called externally by the emoji picker popover (in this component)
	function handleEmojiPick(emoji: string) {
		showPicker = false;
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
		changed(newRaw);

		requestAnimationFrame(() => {
			inputEl.focus();
			setOffset(newPos);
		});
	}

	function selectionInBox(): boolean {
		const sel = window.getSelection();
		return !!sel?.anchorNode && !!inputEl?.contains(sel.anchorNode);
	}

	// Takes the focus. The caret stays where it was in the box; one that was elsewhere goes after the text, as the box
	// comes back with a draft.
	function takeFocus() {
		if (!inputEl) return;
		const caretHere = selectionInBox();
		inputEl.focus();
		if (caretHere || document.activeElement !== inputEl) return;
		setOffset(getRaw(inputEl).length);
		inputEl.scrollTop = inputEl.scrollHeight;
	}

	export function focus() {
		requestAnimationFrame(takeFocus);
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
		changed(newRaw);
	}

	// The suggestions' list that is open over the box (commands, mentions, rooms or emoji) and its chosen row, which the
	// box names for a screen reader: the focus stays in the box while the arrows move through them.
	const suggesting = $derived(
		commandSuggestions.length > 0
			? { list: `${uid}-commands`, at: commandSelectedIdx }
			: mentionSuggestions.length > 0
				? { list: `${uid}-mentions`, at: mentionSelectedIdx }
				: roomSuggestions.length > 0
					? { list: `${uid}-rooms`, at: roomSelectedIdx }
					: suggestions.length > 0
						? { list: `${uid}-emoji`, at: selectedIdx }
						: null,
	);
</script>

<!-- The message box: its suggestions over it, and the field that holds +, the text, the pickers' button and send -->
<div class="relative min-w-0 flex-1">
	<!-- Command menu -->
	{#if commandSuggestions.length > 0}
		<div
			class="bg-duvet-bg border-duvet-line absolute bottom-[calc(100%+6px)] left-0 z-90 max-h-75 w-[min(100%,560px)] overflow-hidden overflow-y-auto rounded-[14px] border p-1.5"
			id="{uid}-commands"
			role="listbox"
			aria-label="Commands"
			bind:this={commandMenuEl}
		>
			<div
				class="text-duvet-ink2 px-2 pt-1.5 pb-1.5 text-[10.5px] leading-none font-semibold tracking-[0.06em] uppercase"
			>
				{#if commandQuery}
					Commands matching <strong>/{commandQuery}</strong>
				{:else}
					Commands
				{/if}
			</div>
			{#each commandSuggestions as entry, i (`${entry.command.id} ${entry.name}`)}
				{@const bot = commandApp(entry)?.bot}
				<button
					id="{uid}-commands-{i}"
					role="option"
					aria-selected={i === commandSelectedIdx}
					class="relative flex min-h-[34px] w-full cursor-pointer items-center gap-2 overflow-hidden rounded-[9px] px-2 py-1.5 text-left {i ===
					commandSelectedIdx
						? 'bg-duvet-accent-tint'
						: ''}"
					onmousedown={(e) => {
						e.preventDefault();
						pickCommand(entry);
					}}
					onmouseenter={() => (commandSelectedIdx = i)}
				>
					<span class="relative flex min-w-0 flex-1 items-center gap-2.5">
						<span class="text-duvet-ink shrink-0 text-[13px] font-semibold">/{entry.name}</span>
						<span class="text-duvet-ink2 min-w-0 flex-1 truncate text-[12px]">{entry.description}</span>
						{#if bot}
							<span class="text-duvet-ink2 flex shrink-0 items-center gap-1.5 text-[11px]">
								<UserAvatar src={getAvatarURL(bot.id, bot.avatar)} name={bot.alias ?? bot.username} size={16} />
								{bot.alias ?? bot.username}
							</span>
						{/if}
					</span>
				</button>
			{/each}
		</div>
	{/if}

	<!-- Mention autocomplete dropdown -->
	{#if mentionSuggestions.length > 0}
		<div
			class="bg-duvet-bg border-duvet-line absolute bottom-[calc(100%+6px)] left-0 z-90 max-h-75 w-80 max-w-full overflow-hidden overflow-y-auto rounded-[14px] border p-1.5"
			id="{uid}-mentions"
			role="listbox"
			aria-label="Mention suggestions"
		>
			<div
				class="text-duvet-ink2 px-2 pt-1.5 pb-1.5 text-[10.5px] leading-none font-semibold tracking-[0.06em] uppercase"
			>
				Members matching <strong
					>@{getRaw(inputEl)
						.slice(0, getOffset())
						.match(/@([\p{L}\p{N}_]*)$/u)?.[1]}</strong
				>
			</div>
			{#each mentionSuggestions as member, i}
				<button
					id="{uid}-mentions-{i}"
					role="option"
					aria-selected={i === mentionSelectedIdx}
					class="relative flex h-[34px] w-full cursor-pointer items-center gap-2 overflow-hidden rounded-[9px] px-2 text-left {i ===
					mentionSelectedIdx
						? 'bg-duvet-accent-tint'
						: ''}"
					onmousedown={(e) => {
						e.preventDefault();
						insertMentionSuggestion(member);
					}}
					onmouseenter={() => (mentionSelectedIdx = i)}
				>
					<MemberBanner src={member.banner_url} offline={member.status === "offline"} />
					<span class="relative flex min-w-0 flex-1 items-center gap-2">
						<UserAvatar src={member.avatar_url} name={member.username} size={22} />
						<span class="text-duvet-ink truncate text-[13px] font-semibold">{member.username}</span>
						{#if member.raw_username !== member.username}
							<span class="{member.banner_url ? 'text-duvet-ink' : 'text-duvet-ink2'} ml-auto shrink-0 text-xs"
								>@{member.raw_username}</span
							>
						{/if}
					</span>
				</button>
			{/each}
		</div>
	{/if}

	<!-- Room mention autocomplete dropdown -->
	{#if roomSuggestions.length > 0}
		<div
			class="bg-duvet-bg border-duvet-line absolute bottom-[calc(100%+6px)] left-0 z-90 max-h-75 w-80 max-w-full overflow-hidden overflow-y-auto rounded-[14px] border p-1.5"
			id="{uid}-rooms"
			role="listbox"
			aria-label="Room suggestions"
		>
			<div
				class="text-duvet-ink2 px-2 pt-1.5 pb-1.5 text-[10.5px] leading-none font-semibold tracking-[0.06em] uppercase"
			>
				Rooms matching <strong
					>#{getRaw(inputEl)
						.slice(0, getOffset())
						.match(/#([\p{L}\p{N}_-]*)$/u)?.[1]}</strong
				>
			</div>
			{#each roomSuggestions as room, i (room.id)}
				<button
					id="{uid}-rooms-{i}"
					role="option"
					aria-selected={i === roomSelectedIdx}
					class="flex h-[34px] w-full cursor-pointer items-center gap-2 rounded-[9px] px-2 text-left {i ===
					roomSelectedIdx
						? 'bg-duvet-accent-tint'
						: ''}"
					onmousedown={(e) => {
						e.preventDefault();
						insertRoomSuggestion(room);
					}}
					onmouseenter={() => (roomSelectedIdx = i)}
				>
					{#if room.type === 2}
						<VoiceIcon class="text-duvet-ink2 size-4 shrink-0" role="img" aria-label="Voice room" />
					{:else}
						<HashIcon class="text-duvet-ink2 size-4 shrink-0" />
					{/if}
					<span class="text-duvet-ink truncate text-[13px] font-semibold">{room.name}</span>
				</button>
			{/each}
		</div>
	{/if}

	<!-- Emoji autocomplete dropdown -->
	{#if suggestions.length > 0}
		<div
			class="bg-duvet-bg border-duvet-line absolute bottom-[calc(100%+6px)] left-0 z-90 max-h-75 w-80 max-w-full overflow-hidden overflow-y-auto rounded-[14px] border p-1.5"
			id="{uid}-emoji"
			role="listbox"
			aria-label="Emoji suggestions"
		>
			<div
				class="text-duvet-ink2 px-2 pt-1.5 pb-1.5 text-[10.5px] leading-none font-semibold tracking-[0.06em] uppercase"
			>
				Emoji matching <strong
					>:{getRaw(inputEl)
						.slice(0, getOffset())
						.match(/:([\w\d]*)$/)?.[1]}</strong
				>
			</div>
			{#each suggestions as entry, i}
				<button
					id="{uid}-emoji-{i}"
					role="option"
					aria-selected={i === selectedIdx}
					class="flex h-[34px] w-full cursor-pointer items-center gap-2 rounded-[9px] px-2 text-left {i === selectedIdx
						? 'bg-duvet-accent-tint'
						: ''}"
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
					<span class="text-duvet-ink truncate font-mono text-[12.5px]">:{entry.name.replace(/ /g, "_")}:</span>
				</button>
			{/each}
		</div>
	{/if}

	<!-- Hidden file input -->
	<input bind:this={fileInputEl} type="file" multiple class="hidden" onchange={handleFileSelect} />

	<!-- The field. Its ring shows the focus, as the text inside it has no outline of its own. -->
	<div
		class="bg-duvet-card pointer-events-auto flex min-h-[42px] rounded-[20px] px-1 shadow-[var(--duvet-shadow-well),0_0_0_1px_var(--duvet-line)] transition-shadow duration-150 focus-within:shadow-[var(--duvet-shadow-well),0_0_0_1px_var(--duvet-accent),0_0_0_4px_var(--duvet-accent-tint)] motion-reduce:transition-none {recording
			? 'items-center gap-2'
			: 'items-end'}"
	>
		{#if recording}
			<!-- A voice note being recorded: discard it, how long it is, pause it, or send it -->
			<button
				type="button"
				class="text-duvet-danger hover:bg-duvet-hover my-1 grid size-[34px] shrink-0 place-items-center rounded-xl transition-colors motion-reduce:transition-none"
				title="Cancel recording"
				aria-label="Cancel recording"
				onclick={cancelRecording}
			>
				<DiscardIcon size={18} />
			</button>
			<span
				class="size-[9px] shrink-0 rounded-full {paused ? 'bg-duvet-ink2' : 'bg-duvet-call-red animate-rec-pulse'}"
				aria-hidden="true"
			></span>
			<span class="text-duvet-ink shrink-0 text-[12.5px] font-semibold tabular-nums"
				>{formatDuration(recordingDuration)}</span
			>
			<span
				class="text-duvet-accent-text flex h-[22px] min-w-0 flex-1 items-center gap-0.5 overflow-hidden"
				aria-hidden="true"
			>
				{#each { length: 36 } as _, i}
					<span
						class="h-1.5 w-[2.5px] shrink-0 rounded-full bg-current {paused ? '' : 'animate-rec-bar'}"
						style="animation-delay: {(i % 9) * -80}ms"
					></span>
				{/each}
			</span>
			<span class="text-duvet-ink2 shrink-0 text-xs max-sm:hidden">{paused ? "Paused" : "Recording a voice note"}</span>
			<button
				type="button"
				class="text-duvet-ink2 hover:bg-duvet-hover hover:text-duvet-ink my-1 grid size-[34px] shrink-0 place-items-center rounded-xl transition-colors motion-reduce:transition-none"
				title={paused ? "Resume recording" : "Pause recording"}
				aria-label={paused ? "Resume recording" : "Pause recording"}
				onclick={togglePause}
			>
				{#if paused}
					<Play size={16} fill="currentColor" />
				{:else}
					<Pause size={16} fill="currentColor" />
				{/if}
			</button>
			<button
				type="button"
				class="bg-duvet-accent text-duvet-on-accent shadow-duvet-control active:shadow-duvet-press my-1 grid size-[34px] shrink-0 place-items-center rounded-xl transition-transform active:scale-[0.94] motion-reduce:transition-none"
				title="Send voice note"
				aria-label="Send voice note"
				onclick={stopRecording}
			>
				<SendIcon size={18} />
			</button>
		{:else}
			{#if !editing}
				<!-- Files, and the pickers for a sticker or a GIF, which send at once -->
				<Menu bind:open={showPlusMenu} side="top" align="start" label="Add files and more">
					{#snippet trigger(props)}
						<button
							{...props}
							type="button"
							class="text-duvet-ink2 hover:bg-duvet-hover hover:text-duvet-ink my-1 grid size-[34px] shrink-0 place-items-center rounded-xl transition-colors motion-reduce:transition-none"
							title="Add files and more"
							aria-label="Add files and more"
						>
							<Plus size={18} />
						</button>
					{/snippet}
					<MenuItem icon={AttachIcon} onSelect={() => fileInputEl?.click()}>Attach files</MenuItem>
					{#if stickerGroups.length > 0}
						<MenuItem icon={StickerIcon} onSelect={() => openPicker("sticker")}>Sticker</MenuItem>
					{/if}
					<MenuItem icon={GifIcon} onSelect={() => openPicker("gif")}>GIF</MenuItem>
				</Menu>
			{/if}
			<div
				bind:this={inputEl}
				contenteditable="true"
				role="textbox"
				tabindex="0"
				aria-multiline="false"
				aria-label={placeholder}
				aria-autocomplete="list"
				aria-controls={suggesting?.list}
				aria-activedescendant={suggesting ? `${suggesting.list}-${suggesting.at}` : undefined}
				class="focus-override font-content text-duvet-ink caret-duvet-ink block max-h-[132px] min-h-5 min-w-0 flex-1 overflow-y-auto px-1.5 py-2.5 text-[16px] leading-[1.45] wrap-break-word whitespace-pre-wrap outline-none select-text {isEmpty
					? 'before:text-duvet-ink2 before:pointer-events-none before:absolute before:content-[attr(data-placeholder)]'
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

			<!-- The pickers, behind one button: an emoji goes into the text; a GIF and a sticker send at once -->
			<Popover.Root bind:open={showPicker} onOpenChange={(open) => !open && (pickerTab = "emoji")}>
				<Popover.Trigger
					class="text-duvet-ink2 hover:bg-duvet-hover hover:text-duvet-ink data-[state=open]:bg-duvet-accent-tint data-[state=open]:text-duvet-accent-text my-1 grid size-[34px] shrink-0 place-items-center rounded-xl transition-colors motion-reduce:transition-none"
					title={editing ? "Emoji" : "Emoji, GIFs and stickers"}
					aria-label={editing ? "Emoji" : "Emoji, GIFs and stickers"}
				>
					<SmilePlusIcon size={18} />
				</Popover.Trigger>
				<Popover.Portal>
					<div class="fixed top-0 left-0" style={layerStyle(pickerLayer)}>
						<Popover.Content
							side="top"
							align="end"
							sideOffset={10}
							collisionPadding={10}
							class="outline-none"
							role="dialog"
							aria-label={editing ? "Emoji" : "Emoji, GIFs and stickers"}
						>
							<div class="flex flex-col gap-2">
								{#if pickerTabs.length > 1}
									<Segmented options={pickerTabs} bind:value={pickerTab} label="What to pick" size="sm" />
								{/if}
								{#if pickerTab === "gif" && !editing}
									<GifPicker onSelect={handleGifPick} />
								{:else if pickerTab === "sticker" && !editing && stickerGroups.length > 0}
									<StickerPicker groups={stickerGroups} onSelect={handleStickerPick} />
								{:else}
									<EmojiPicker onSelect={handleEmojiPick} groups={emojiGroups} />
								{/if}
							</div>
						</Popover.Content>
					</div>
				</Popover.Portal>
			</Popover.Root>

			<!-- Send. An empty box records a voice note instead, where the chat takes one; an edit saves. -->
			{#if editing}
				<button
					type="button"
					class="bg-duvet-accent text-duvet-on-accent shadow-duvet-control active:shadow-duvet-press my-1 grid size-[34px] shrink-0 place-items-center rounded-xl transition-transform active:scale-[0.94] motion-reduce:transition-none"
					title="Save"
					aria-label="Save"
					onclick={sendMessage}
				>
					<SaveIcon size={18} />
				</button>
			{:else if isEmpty && pendingFiles.length === 0 && onVoiceNote}
				<button
					type="button"
					class="text-duvet-ink2 hover:bg-duvet-hover hover:text-duvet-ink my-1 grid size-[34px] shrink-0 place-items-center rounded-xl transition-colors motion-reduce:transition-none"
					title="Record voice note"
					aria-label="Record voice note"
					onclick={startRecording}
				>
					<Mic size={18} />
				</button>
			{:else}
				{@const ready = !isEmpty || pendingFiles.length > 0}
				<button
					type="button"
					class="my-1 grid size-[34px] shrink-0 place-items-center rounded-xl transition-[background-color,color,transform] motion-reduce:transition-none {ready
						? 'bg-duvet-accent text-duvet-on-accent shadow-duvet-control active:shadow-duvet-press active:scale-[0.94]'
						: 'text-duvet-ink2'}"
					title="Send"
					aria-label="Send"
					disabled={!ready}
					onmousedown={(e) => e.preventDefault()}
					onclick={sendMessage}
				>
					<SendIcon size={18} />
				</button>
			{/if}
		{/if}
	</div>
</div>
