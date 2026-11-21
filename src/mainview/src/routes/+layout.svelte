<script lang="ts">
	import "../app.css";

	import favicon from "$lib/assets/favicon.svg";
	import Header from "$lib/components/Header.svelte";
	import Toast from "$lib/components/Toast.svelte";
	import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
	import InteractionModal from "$lib/components/InteractionModal.svelte";
	import PromptDialog from "$lib/components/PromptDialog.svelte";
	import StorageTransferFailures from "$lib/components/StorageTransferFailures.svelte";

	import { setupExternalLinks } from "$lib/external-links";
	import { setupDevToolsKeys, setupNativeContextMenu } from "$lib/native-context-menu";
	import { getElectrobunRpc } from "$lib/electrobun-rpc";
	import { driftSpecksOnScreen } from "$lib/spoiler-specks";
	import { followSystemTheme } from "$lib/theme.svelte";
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

	onMount(() => {
		setupExternalLinks();
		if (shell.os === "linux") {
			setupNativeContextMenu();
			// Only the main window's Bun side opens DevTools; in the others the keys just do nothing.
			setupDevToolsKeys(
				shell.window === "main" ? () => void getElectrobunRpc().then((rpc) => rpc?.send.openDevTools()) : () => {},
			);
		}
		const stopSpecks = driftSpecksOnScreen(document);
		// app.html set the theme before the first paint; this keeps it with the system's while it's System.
		const stopTheme = followSystemTheme();
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
			stopSpecks();
			stopTheme();
			stopGlassTheme();
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
