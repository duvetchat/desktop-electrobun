<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import { X as XIcon } from "@lucide/svelte";
	import {
		isTyping,
		markLabels,
		navigationCommand,
		nextUnread,
		shortcutCommand,
		stepIndex,
		tabAt,
		type KeyCommand,
	} from "$lib/keyboard";
	import { keyboard, messagesIn, openNavigating, placeCursor, requestChat, shownPane } from "$lib/keyboard.svelte";
	import { layoutPrefs } from "$lib/layout-prefs.svelte";
	import { toast } from "$lib/stores/toast.svelte";
	import MascotPeek from "$lib/components/MascotPeek.svelte";

	// The app's keyboard (see keyboard.ts): the shortcuts with a modifier, the single keys of keyboard navigation, the
	// shortcuts sheet and the jump marks. It listens before the chats do, so a key it takes doesn't also go to a
	// message box; every other key goes on as before.
	let {
		isMac,
		tabs,
		activeId,
		onActivate,
		unreadOrder,
		unread,
		onOpenChat,
	}: {
		isMac: boolean;
		/** The focused pane's open chats, by their channel or conversation ID. */
		tabs: string[];
		activeId: string | null;
		onActivate: (id: string) => void;
		/** Every room and conversation, in the spaces column's order, and those with unread messages. */
		unreadOrder: string[];
		unread: ReadonlySet<string>;
		onOpenChat: (id: string) => void;
	} = $props();

	let help = $state(false);
	type Mark = { label: string; x: number; y: number; el: HTMLElement; message: boolean };
	let marks = $state<Mark[] | null>(null);
	let typed = $state("");

	const mod = $derived(isMac ? "⌘" : "Ctrl");
	const alt = $derived(isMac ? "⌥" : "Alt");
	const shift = $derived(isMac ? "⇧" : "Shift");
	// Each action with its keys: the single keys of keyboard navigation (`nav`), and the shortcut with a modifier that
	// works always, when there's one.
	type Action = { what: string; nav?: string[]; always?: string[] };
	const groups = $derived<{ title: string; actions: Action[] }[]>([
		{
			title: "Go to",
			actions: [
				{ what: "Anything, by name", always: [mod, "K"] },
				{ what: "Open chat 1 to 8, or the last", nav: ["1–9"], always: [mod, "1–9"] },
				{ what: "Chat after or before", nav: ["J", "K"], always: [alt, "↓", "↑"] },
				{ what: "Next unread chat", nav: ["u"], always: [alt, shift, "↓"] },
				{ what: "A row or a message, by its mark", nav: ["f"] },
			],
		},
		{
			title: "Messages",
			actions: [
				{ what: "Leave the message box", nav: ["Esc"] },
				{ what: "Next or previous", nav: ["j", "k"] },
				{ what: "Newest", nav: ["G"] },
				{ what: "Reply", nav: ["r"] },
				{ what: "Edit yours", nav: ["e"] },
				{ what: "Back to writing", nav: ["i"] },
			],
		},
	]);

	const dialogOpen = () => !!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]');
	// Enter, Space and the arrows belong to a focused control (a button, a menu item, a slider).
	const controlKeys = new Set(["Enter", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
	const onControl = () => {
		const el = document.activeElement;
		return (
			!!el && el !== document.body && !!el.closest("button, a, [role=button], [role=option], [role=slider], [tabindex]")
		);
	};

	function take(e: KeyboardEvent) {
		e.preventDefault();
		e.stopPropagation();
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.isComposing) return;
		if (marks) {
			if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(e.key)) return;
			take(e);
			pickMark(e.key);
			return;
		}
		const shortcut = shortcutCommand(e, isMac);
		if (shortcut) {
			if (dialogOpen()) return;
			take(e);
			run(shortcut, false);
			return;
		}
		if (help && e.key === "Escape") {
			take(e);
			help = false;
			return;
		}
		if (!layoutPrefs.keyboardNavigation || isTyping(document.activeElement) || dialogOpen()) return;
		if (controlKeys.has(e.key) && onControl()) return;
		const command = navigationCommand(e);
		if (!command || (command.kind === "clear" && !keyboard.cursor)) return;
		take(e);
		run(command, true);
	}

	// A chat opened by a shortcut leaves the user writing in it, as a click does; by navigation, navigating.
	function run(command: KeyCommand, navigating: boolean) {
		const open = (id: string, how: (id: string) => void) => {
			if (navigating) openNavigating(() => how(id));
			else {
				keyboard.cursor = null;
				how(id);
			}
		};
		const pane = shownPane();
		switch (command.kind) {
			case "message": {
				if (!pane) return;
				const list = messagesIn(pane);
				const at = list.findIndex((el) => el.dataset.messageId === keyboard.cursor);
				const next = at < 0 ? list.length - 1 : Math.max(0, Math.min(list.length - 1, at + command.step));
				placeCursor(list[next]);
				return;
			}
			case "newest":
				if (pane) placeCursor(messagesIn(pane).at(-1));
				return;
			case "chat": {
				const next = tabs[stepIndex(tabs.length, activeId ? tabs.indexOf(activeId) : -1, command.step)];
				if (next) open(next, onActivate);
				return;
			}
			case "tab": {
				const tab = tabAt(tabs, command.index);
				if (tab) open(tab, onActivate);
				return;
			}
			case "unread": {
				const id = nextUnread(unreadOrder, unread, activeId);
				if (id) open(id, onOpenChat);
				else toast("Nothing unread", "info", 2000);
				return;
			}
			case "reply":
			case "edit":
				if (!pane || !keyboard.cursor) return;
				requestChat(command.kind, keyboard.cursor, pane);
				keyboard.cursor = null;
				return;
			case "write":
				if (!pane) return;
				requestChat("write", null, pane);
				keyboard.cursor = null;
				return;
			case "marks":
				showMarks(pane);
				return;
			case "help":
				help = !help;
				return;
			case "clear":
				keyboard.cursor = null;
				return;
		}
	}

	// ── Jump marks: a label on each row of the spaces column and each message in view, typed to jump there ──
	function inView(el: HTMLElement): { x: number; y: number } | null {
		const r = el.getBoundingClientRect();
		if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth)
			return null;
		const x = Math.min(Math.max(r.left + 6, 0), innerWidth - 1);
		const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
		// What a scrolling list clips, or something over it hides, can't be jumped to.
		const top = document.elementFromPoint(x + 4, y);
		return top && (el === top || el.contains(top)) ? { x, y } : null;
	}

	function showMarks(pane: HTMLElement | null) {
		const rows = [...document.querySelectorAll<HTMLElement>("[data-jump]")].map((el) => ({ el, message: false }));
		const messages = pane ? messagesIn(pane).map((el) => ({ el, message: true })) : [];
		const shown = [...rows, ...messages].flatMap(({ el, message }) => {
			const at = inView(el);
			return at ? [{ el, message, ...at }] : [];
		});
		if (shown.length === 0) return;
		const labels = markLabels(shown.length);
		marks = shown.flatMap((m, i) => {
			const label = labels[i];
			return label ? [{ ...m, label }] : [];
		});
		typed = "";
	}

	function pickMark(key: string) {
		if (!marks || key.length !== 1 || !/[a-z]/i.test(key)) {
			marks = null;
			return;
		}
		typed += key.toLowerCase();
		const found = marks.find((m) => m.label === typed);
		if (found) {
			marks = null;
			if (found.message) placeCursor(found.el);
			else openNavigating(() => found.el.click());
		} else if (!marks.some((m) => m.label.startsWith(typed))) {
			marks = null;
		}
	}

	// Writing anywhere ends navigation: the cursor goes.
	function onFocusIn(e: FocusEvent) {
		if (keyboard.cursor && e.target instanceof Element && isTyping(e.target)) keyboard.cursor = null;
	}

	onMount(() => {
		window.addEventListener("keydown", onKeydown, true);
		window.addEventListener("focusin", onFocusIn);
	});
	onDestroy(() => {
		if (typeof window === "undefined") return;
		window.removeEventListener("keydown", onKeydown, true);
		window.removeEventListener("focusin", onFocusIn);
	});
</script>

{#if marks}
	<div class="pointer-events-none fixed inset-0 z-[400]" aria-hidden="true">
		{#each marks as mark (mark.label)}
			<span
				class="bg-duvet-accent text-duvet-on-accent absolute -translate-y-1/2 rounded-md px-1.5 py-0.5 font-mono text-xs font-bold shadow-md {typed &&
				!mark.label.startsWith(typed)
					? 'opacity-0'
					: ''}"
				style="left: {mark.x}px; top: {mark.y}px">{mark.label}</span
			>
		{/each}
	</div>
{/if}

{#snippet keycaps(keys: string[], dim: boolean)}
	<span class="flex items-center gap-1 {dim ? 'opacity-40' : ''}">
		{#each keys as k, i (i)}
			<kbd
				class="bg-duvet-card text-duvet-ink shadow-duvet-raised border-duvet-line inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-b-[3px] border-b-black/30 px-1.5 font-sans text-xs leading-none font-bold"
				>{k}</kbd
			>
		{/each}
	</span>
{/snippet}

{#if help}
	<!-- At the top, over the oldest messages: the cursor starts at the newest, at the bottom. The mascot peeks over
	     its edge. -->
	<section
		class="rounded-card bg-duvet-card text-duvet-ink shadow-duvet-float animate-fade-in fixed top-24 left-1/2 z-[350] w-[min(760px,calc(100vw-2rem))] -translate-x-1/2 px-5 pt-5 pb-4 motion-reduce:animate-none"
		aria-label="Keyboard shortcuts"
	>
		<MascotPeek class="pointer-events-none absolute -top-11 left-7 w-16" mood="awake" look={0.4} />
		<div class="mb-4 flex items-start gap-3">
			<div class="min-w-0 flex-1">
				<h2 class="text-base font-bold">Keyboard shortcuts</h2>
				<p class="text-duvet-ink2 mt-0.5 text-[13px]">
					{#if layoutPrefs.keyboardNavigation}
						Press Esc in the message box to move around with single keys. Any other key goes back to writing.
					{:else}
						The faded keys work once keyboard navigation is on, in Settings, Appearance.
					{/if}
				</p>
			</div>
			<button
				type="button"
				class="text-duvet-ink2 hover:bg-duvet-bg hover:text-duvet-ink focus-visible:outline-duvet-accent flex size-8 shrink-0 items-center justify-center rounded-lg focus-visible:outline-2"
				aria-label="Close the shortcuts"
				onclick={() => (help = false)}
			>
				<XIcon class="size-4" />
			</button>
		</div>
		<div class="grid gap-3 sm:grid-cols-2">
			{#each groups as group (group.title)}
				<div class="bg-duvet-sunk shadow-duvet-press rounded-[14px] p-3">
					<h3 class="text-duvet-ink2 mb-2 px-1 text-[13px] font-bold">{group.title}</h3>
					<dl class="flex flex-col">
						{#each group.actions as action (action.what)}
							<div class="flex min-h-9 items-center gap-3 px-1">
								<dt class="text-duvet-ink min-w-0 flex-1 text-[13px]">{action.what}</dt>
								<dd class="flex shrink-0 items-center gap-1.5">
									{#if action.nav}{@render keycaps(action.nav, !layoutPrefs.keyboardNavigation)}{/if}
									{#if action.nav && action.always}<span class="text-duvet-ink2 text-[11px]">or</span>{/if}
									{#if action.always}{@render keycaps(action.always, false)}{/if}
								</dd>
							</div>
						{/each}
					</dl>
				</div>
			{/each}
		</div>
		<p class="text-duvet-ink2 mt-3 flex items-center justify-end gap-1.5 text-xs">
			{@render keycaps(["?"], !layoutPrefs.keyboardNavigation)}
			<span>or</span>
			{@render keycaps([mod, "/"], false)}
			<span>opens this again</span>
		</p>
	</section>
{/if}
