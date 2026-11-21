<script lang="ts">
	import { onMount, type Component } from "svelte";
	import { get } from "svelte/store";
	import {
		Copy,
		ExternalLink,
		Image as ImageIcon,
		Link as LinkIcon,
		Search,
		SquareTerminal,
		TextQuote,
	} from "@lucide/svelte";
	import { base64Bytes, pngBlob } from "$lib/activity-thumbnail";
	import { copyPicture } from "$lib/copy-picture";
	import {
		defaultMenuOf,
		isMenuKey,
		KeyMenuEcho,
		keyMenuPoint,
		menuSelection,
		pickSelection,
		readTarget,
		searchLabel,
		TEXT_FIELD,
		type DefaultItem,
	} from "$lib/default-menu";
	import { getElectrobunRpc, isElectrobunWindow } from "$lib/electrobun-rpc";
	import { openInBrowser } from "$lib/external-links";
	import { rawOf } from "$lib/message-box";
	import { canQuote, quoteIn } from "$lib/quotes";
	import { friendsReady, searchEverywhereRequest } from "$lib/stores.svelte";
	import { toast } from "$lib/stores/toast.svelte";
	import ContextMenu from "$lib/components/ui/ContextMenu.svelte";
	import MenuItem from "$lib/components/ui/MenuItem.svelte";
	import MenuSeparator from "$lib/components/ui/MenuSeparator.svelte";

	// Duvet's own menu for a right-click that no menu of the app's took (#423), in the desktop app, in place of the
	// webview's: for selected text, a link, a picture or a video (lib/default-menu.ts), and nothing anywhere else. A text
	// field keeps the webview's menu, whose spelling suggestions and Paste the page can't give. Shift+F10 and the
	// context-menu key open, for what has the focus, the menu a right-click there would.
	let {
		main,
		dev,
	}: {
		/** The app's main window, whose Bun side opens links and copies pictures (src/bun/index.ts). */
		main: boolean;
		/** A development build, whose main window has DevTools in the menu. */
		dev: boolean;
	} = $props();

	let open = $state(false);
	let groups = $state.raw<DefaultItem[][]>([]);
	// The menu's own trigger, hidden: a right-click anywhere is handed to it, which opens the menu at the pointer.
	let trigger = $state<HTMLElement>();
	// What the menu is about, as it opened: where the right-click was, the selection it's on, and what had the focus,
	// which gets it back as the menu closes, unless what was picked takes it (the message box, the search).
	let at: Element | null = null;
	let range: Range | null = null;
	let focusBefore: HTMLElement | null = null;
	let keepFocus = false;
	const echo = new KeyMenuEcho();

	function onContextMenu(e: MouseEvent) {
		if (e.defaultPrevented || e.target === trigger) return;
		const el = e.target instanceof Element ? e.target : null;
		// Inside a menu of the app's, open: no menu over it.
		if (el?.closest('[role="menu"]')) {
			e.preventDefault();
			return;
		}
		const picked = el && !el.closest(TEXT_FIELD) ? menuSelection(e) : null;
		const app = main && isElectrobunWindow();
		const menu = defaultMenuOf(readTarget(el, picked ? pickSelection(picked) : null, location.origin), {
			quote: (messageId) => !!el && canQuote(el, messageId),
			search: get(friendsReady),
			app,
			devTools: dev && app,
		});
		// A text field: the webview's own menu.
		if (menu === "native") return;
		e.preventDefault();
		if (!menu || !trigger) return;
		groups = menu;
		at = el;
		range = picked?.cloneRange() ?? null;
		const active = document.activeElement;
		focusBefore = active instanceof HTMLElement && active !== document.body ? active : null;
		keepFocus = false;
		// To the trigger, whose handler (bits-ui's) Svelte calls as the event bubbles through the page.
		trigger.dispatchEvent(
			new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY }),
		);
	}

	// The keyboard's menu, for what has the focus, or for the selected text: the menu event a right-click would send,
	// at its bottom left. One the webview sends too (Windows does, as the key goes up) is dropped (echo).
	function onKeyDown(e: KeyboardEvent) {
		if (e.defaultPrevented || !isMenuKey(e)) return;
		const active = document.activeElement;
		const focused = active instanceof HTMLElement && active !== document.body ? active : null;
		// In a text field the webview opens its own menu, as a right-click there does; in an open menu, the menu's keys.
		if (focused?.closest(`${TEXT_FIELD}, [role="menu"]`)) return;
		e.preventDefault();
		let target: Element = focused ?? document.body;
		let rect: { left: number; bottom: number } = target.getBoundingClientRect();
		const selection = window.getSelection();
		const selected = selection && !selection.isCollapsed && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
		if (selected && (!focused || focused.contains(selected.commonAncestorContainer))) {
			const last = [...selected.getClientRects()].at(-1);
			const end = selected.endContainer;
			const holder = end instanceof Element ? end : end.parentElement;
			if (last && holder) {
				rect = last;
				target = holder;
			}
		}
		const { x, y } = keyMenuPoint(rect, { width: window.innerWidth, height: window.innerHeight });
		echo.opened(performance.now());
		target.dispatchEvent(
			new MouseEvent("contextmenu", {
				bubbles: true,
				cancelable: true,
				clientX: x,
				clientY: y,
				button: 2,
				view: window,
			}),
		);
	}

	function dropEcho(e: MouseEvent) {
		if (!e.isTrusted || !echo.takes(performance.now())) return;
		e.preventDefault();
		e.stopImmediatePropagation();
	}

	function onPointerDown(e: PointerEvent) {
		if (e.button === 2) echo.pressed();
	}

	onMount(() => {
		window.addEventListener("pointerdown", onPointerDown, true);
		window.addEventListener("contextmenu", dropEcho, true);
		window.addEventListener("contextmenu", onContextMenu);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown, true);
			window.removeEventListener("contextmenu", dropEcho, true);
			window.removeEventListener("contextmenu", onContextMenu);
			window.removeEventListener("keydown", onKeyDown);
		};
	});

	function closeFocus(e: Event) {
		e.preventDefault();
		if (!keepFocus) focusBefore?.focus({ preventScroll: true });
	}

	const copyText = (text: string) =>
		navigator.clipboard.writeText(text).catch((err: unknown) => console.error("[menu] couldn't copy:", err));

	// Bun fetches the picture and the webview writes it, in the formats every app pastes (lib/copy-picture.ts, #450).
	// Called in the menu's pick, so the clipboard's write starts in the user's gesture.
	function copyImage(src: string) {
		void copyPicture(src, {
			fetch: async (url) => {
				const rpc = await getElectrobunRpc();
				const picture = rpc ? await rpc.request.pictureForCopy({ url }) : null;
				return picture ? base64Bytes(picture) : null;
			},
			toPng: pngBlob,
			item: (parts) => new ClipboardItem(parts),
			write: (items) => navigator.clipboard.write(items),
		}).then((copied) => {
			if (!copied) toast("Couldn't copy the image", "error");
		});
	}

	function act(item: DefaultItem) {
		switch (item.id) {
			case "copy-selection":
				// As a copy of it reads (rawOf): an emoji as its character, a custom one as :name:.
				if (range) void copyText(rawOf(range.cloneContents()));
				return;
			case "quote":
				keepFocus = true;
				if (at) quoteIn(at, item.messageId, item.text);
				return;
			case "search":
				keepFocus = true;
				searchEverywhereRequest.set({ id: crypto.randomUUID(), text: item.text.replace(/\s+/g, " ").trim() });
				return;
			case "open-link":
				openInBrowser(item.href);
				return;
			case "copy-link":
				void copyText(item.href);
				return;
			case "open-media":
				openInBrowser(item.src);
				return;
			case "copy-image":
				copyImage(item.src);
				return;
			case "copy-media-link":
				void copyText(item.src);
				return;
			case "devtools":
				void getElectrobunRpc().then((rpc) => rpc?.send.openDevTools());
				return;
		}
	}

	const ICONS: Record<DefaultItem["id"], Component<{ size?: number | string }>> = {
		"copy-selection": Copy,
		quote: TextQuote,
		search: Search,
		"open-link": ExternalLink,
		"copy-link": LinkIcon,
		"open-media": ExternalLink,
		"copy-image": ImageIcon,
		"copy-media-link": LinkIcon,
		devtools: SquareTerminal,
	};

	function labelOf(item: DefaultItem): string {
		switch (item.id) {
			case "copy-selection":
				return "Copy";
			case "quote":
				return "Quote in reply";
			case "search":
				return searchLabel(item.text);
			case "open-link":
				return "Open link";
			case "copy-link":
				return "Copy link";
			case "open-media":
				return item.type === "image" ? "Open image" : "Open video";
			case "copy-image":
				return "Copy image";
			case "copy-media-link":
				return item.type === "image" ? "Copy image link" : "Copy video link";
			case "devtools":
				return "Open DevTools";
		}
	}

	// The menu's name for a screen reader: what it's for, by its first group.
	const menuLabel = $derived.by(() => {
		const first = groups[0]?.[0];
		if (!first || first.id === "devtools") return "Developer";
		if (first.id === "copy-selection") return "Selected text";
		if (first.id === "open-link" || first.id === "copy-link") return "Link";
		return "type" in first && first.type === "video" ? "Video" : "Image";
	});
</script>

<ContextMenu bind:open label={menuLabel} onCloseAutoFocus={closeFocus}>
	{#snippet target(props)}
		<span {...props} bind:this={trigger} class="hidden" aria-hidden="true"></span>
	{/snippet}
	{#each groups as group, i (i)}
		{#if i > 0}<MenuSeparator />{/if}
		{#each group as item (item.id)}
			<MenuItem icon={ICONS[item.id]} onSelect={() => act(item)}>{labelOf(item)}</MenuItem>
		{/each}
	{/each}
</ContextMenu>
