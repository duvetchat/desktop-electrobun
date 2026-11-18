<script lang="ts" module>
	import { lazy } from "$lib/lazy";

	// The screen is no part of the app's page: a page that can draw it loads it apart, once (lib/lazy.ts).
	const screen = lazy(() => import("$lib/components/settings/SettingsScreen.svelte").then((module) => module.default));
</script>

<script lang="ts">
	import { onMount } from "svelte";
	import { ownMobileOnly } from "$lib/api/ws/connection";
	import { isElectrobunWindow } from "$lib/electrobun-rpc";
	import { whenIdle } from "$lib/lazy";
	import { currentShell } from "$lib/platform";
	import { openAppWindow, startSettingsHost } from "$lib/stores/settings-host-link.svelte";
	import { toast } from "$lib/stores/toast.svelte";

	// Settings, as the app's page opens them (#357): the screen itself is settings/SettingsScreen.svelte. On the web it is
	// a sheet of this page, which stays mounted while closed, so it reopens on the section viewed last. In the desktop
	// app it is a window of its own (routes/settings): opening it here asks Bun for that window, and this page shares
	// with it what the screen shows, starting with what the gateway connection knows of the user. The main window never
	// draws the screen, so it never loads it; the web loads it once the page is idle, or at the first opening.
	let {
		open = $bindable(false),
	}: {
		open?: boolean;
	} = $props();

	const inWindow = isElectrobunWindow() && currentShell().settingsInWindows;
	let Screen = $state.raw(screen.value);

	function show() {
		if (Screen) return;
		screen.load().then(
			(loaded) => (Screen = loaded),
			(err: unknown) => {
				console.error("[settings] The screen didn't load:", err);
				// Only someone who asked for it is told; the next opening tries again.
				if (!open) return;
				open = false;
				toast("Couldn't open Settings", "error");
			},
		);
	}

	onMount(() => {
		if (inWindow) {
			startSettingsHost(ownMobileOnly);
			return;
		}
		return whenIdle(show);
	});

	$effect(() => {
		if (!open) return;
		if (inWindow) {
			open = false;
			void openAppWindow({ window: "settings" });
			return;
		}
		show();
	});
</script>

{#if !inWindow && Screen}
	<Screen bind:open mobileOnly={$ownMobileOnly} />
{/if}
