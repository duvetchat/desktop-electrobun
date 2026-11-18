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
	import { driftSpecksOnScreen } from "$lib/spoiler-specks";
	import { followSystemTheme } from "$lib/theme.svelte";
	import { currentShell } from "$lib/platform";
	import { onMount } from "svelte";

	let { children } = $props();

	// Whether this page has window chrome to draw is the platform switch's call (lib/platform.ts): none on the web,
	// where the browser has its own; the app's title bar in the desktop app, on every page, the sign-in ones included.
	// The app's other windows (the media controls' pop-out, Settings, a Space's settings: lib/app-windows.ts) draw their
	// own chrome: the title bar here is the main window's.
	const shell = currentShell();
	const titleBar = shell.window === "main" && shell.chrome !== "web";

	onMount(() => {
		setupExternalLinks();
		const stopSpecks = driftSpecksOnScreen(document);
		// app.html set the theme before the first paint; this keeps it with the system's while it's System.
		const stopTheme = followSystemTheme();
		return () => {
			stopSpecks();
			stopTheme();
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="bg-duvet-sunk text-duvet-ink flex h-(--app-height) w-(--app-width) flex-col overflow-hidden">
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
