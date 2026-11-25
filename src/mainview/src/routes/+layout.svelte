<script lang="ts">
	import "../app.css";

	import favicon from "$lib/assets/favicon.svg";
	import Header from "$lib/components/Header.svelte";
	import Toast from "$lib/components/Toast.svelte";
	import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
	import InteractionModal from "$lib/components/InteractionModal.svelte";
	import PromptDialog from "$lib/components/PromptDialog.svelte";
	import StorageTransferFailures from "$lib/components/StorageTransferFailures.svelte";
	import DefaultContextMenu from "$lib/components/DefaultContextMenu.svelte";

	import { setupExternalLinks } from "$lib/external-links";
	import { trackRightPresses } from "$lib/default-menu";
	import { setupDevToolsKeys } from "$lib/native-context-menu";
	import { getElectrobunRpc } from "$lib/electrobun-rpc";
	import { driftSpecksOnScreen } from "$lib/spoiler-specks";
	import { followSystemTheme } from "$lib/theme.svelte";
	import { followLocale } from "$lib/i18n";
	import { currentShell } from "$lib/platform";
	import { appChrome } from "$lib/stores/chrome.svelte";
	import { VIBRANT_CLASS, followWornTheme, showsGlass, watchClasses } from "$lib/vibrancy";
	import { onMount } from "svelte";

	let { children } = $props();

	// Whether this page has window chrome to draw is the platform switch's call (lib/platform.ts): none on the web,
	// where the browser has its own; the app's title bar in the desktop app, on every page, the sign-in ones included.
	// The app's other windows (the media controls' pop-out, Settings, a Space's settings: lib/app-windows.ts) draw their
	// own chrome: the title bar here is the main window's.
	const shell = currentShell();
	const titleBar = shell.window === "main" && shell.chrome !== "web";

	// The sidebar's glass on macOS (#374, lib/vibrancy.ts): while the app's shell is up, the page lets go of its own
	// backgrounds, here and on <html> and <body> (app.css), and the glass behind the window's page shows under the
	// sidebar. Set in the turn the shell draws in, so no frame has one without the other.
	const glass = $derived(showsGlass(shell, appChrome.shellUp));
	$effect(() => {
		document.documentElement.classList.toggle(VIBRANT_CLASS, glass);
	});

	// Duvet's own right-click menu where no menu of the app's takes it, in the desktop app (#423): the browser keeps its
	// own on the web, with what a page can't give (open in a new tab, save, spelling).
	const ownMenu = shell.chrome !== "web";
	// A development build (dev:hmr, start), whose menu opens DevTools; a packaged one's never does.
	const devBuild = VITE_APP_ENV === "development";

	onMount(() => {
		setupExternalLinks();
		// Which selection a right-click is on, as its press found it (lib/default-menu.ts): every menu reads it.
		const stopPresses = trackRightPresses(window);
		if (shell.os === "linux") {
			// Only the main window's Bun side opens DevTools; in the others the keys just do nothing.
			setupDevToolsKeys(
				shell.window === "main" ? () => void getElectrobunRpc().then((rpc) => rpc?.send.openDevTools()) : () => {},
			);
		}
		const stopSpecks = driftSpecksOnScreen(document);
		// app.html set the theme before the first paint; this keeps it with the system's while it's System.
		const stopTheme = followSystemTheme();
		// The root layout's load put the page in the user's language; this keeps it with a pick made in another window
		// and with the system's languages (lib/i18n.ts).
		const stopLocale = followLocale();
		// The glass behind the sidebar wears the theme the page does (lib/vibrancy.ts).
		const root = document.documentElement;
		const stopGlassTheme = shell.vibrancy
			? followWornTheme(
					root,
					(theme) => void getElectrobunRpc().then((rpc) => rpc?.send.windowTheme({ theme })),
					watchClasses(root),
				)
			: () => {};
		return () => {
			stopPresses();
			stopSpecks();
			stopTheme();
			stopGlassTheme();
			stopLocale();
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div
	class="text-duvet-ink flex h-(--app-height) w-(--app-width) flex-col overflow-hidden {glass ? '' : 'bg-duvet-sunk'}"
>
	{#if titleBar}
		<Header />
	{/if}
	<div class="min-h-0 flex-1 overflow-hidden">
		{@render children()}
	</div>
</div>
<Toast />
<ConfirmDialog />
<PromptDialog />
<InteractionModal />
<StorageTransferFailures />
{#if ownMenu}
	<DefaultContextMenu main={shell.window === "main"} dev={devBuild} />
{/if}
