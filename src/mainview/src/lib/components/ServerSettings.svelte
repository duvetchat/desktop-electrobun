<script lang="ts" module>
	import { lazy } from "$lib/lazy";

	// The screen is no part of the app's page: a page that can draw it loads it apart, once (lib/lazy.ts).
	const screen = lazy(() =>
		import("$lib/components/settings/SpaceSettingsScreen.svelte").then((module) => module.default),
	);
</script>

<script lang="ts">
	import { onMount } from "svelte";
	import { ownMobileOnly } from "$lib/api/ws/connection";
	import { isElectrobunWindow } from "$lib/electrobun-rpc";
	import { t } from "$lib/i18n";
	import { whenIdle } from "$lib/lazy";
	import { currentShell } from "$lib/platform";
	import { openAppWindow, startSettingsHost } from "$lib/stores/settings-host-link.svelte";
	import { toast } from "$lib/stores/toast.svelte";
	import type { GatewaySpace } from "$lib/types";

	// A Space's settings, as the app's page opens them (#357): the screen itself is settings/SpaceSettingsScreen.svelte.
	// On the web it is a sheet of this page. In the desktop app it is a window of its own, one per Space
	// (routes/space-settings): opening it here asks Bun for that window, and this page shares the Space with it. The main
	// window never draws the screen, so it never loads it; the web loads it once the page is idle, or at the first
	// opening.
	let {
		space = null,
		spaceId = null,
		open = $bindable(false),
	}: {
		space?: GatewaySpace | null;
		spaceId?: string | null;
		open?: boolean;
	} = $props();

	const inWindow = isElectrobunWindow() && currentShell().settingsInWindows;
	let Screen = $state.raw(screen.value);

	function show() {
		if (Screen) return;
		screen.load().then(
			(loaded) => (Screen = loaded),
			(err: unknown) => {
				console.error("[settings] The Space's screen didn't load:", err);
				// Only someone who asked for it is told; the next opening tries again.
				if (!open) return;
				open = false;
				toast(t("space_settings_open_failed"), "error");
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
			if (spaceId) void openAppWindow({ window: "space-settings", spaceId, name: space?.name ?? "" });
			return;
		}
		show();
	});
</script>

{#if !inWindow && Screen}
	<Screen {space} {spaceId} bind:open />
{/if}
