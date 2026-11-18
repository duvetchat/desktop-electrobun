<script lang="ts">
	import { onMount } from "svelte";
	import SpaceSettingsScreen from "$lib/components/settings/SpaceSettingsScreen.svelte";
	import { ownMobileOnly } from "$lib/api/ws/connection";
	import { isElectrobunWindow } from "$lib/electrobun-rpc";
	import { currentShell } from "$lib/platform";
	import { openAppWindow, startSettingsHost } from "$lib/stores/settings-host-link.svelte";
	import type { GatewaySpace } from "$lib/types";

	// A Space's settings, as the app's page opens them (#357): the screen itself is settings/SpaceSettingsScreen.svelte.
	// On the web it is a sheet of this page. In the desktop app it is a window of its own, one per Space
	// (routes/space-settings): opening it here asks Bun for that window, and this page shares the Space with it.
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

	onMount(() => {
		if (inWindow) startSettingsHost(ownMobileOnly);
	});

	$effect(() => {
		if (!inWindow || !open) return;
		open = false;
		if (spaceId) void openAppWindow({ window: "space-settings", spaceId, name: space?.name ?? "" });
	});
</script>

{#if !inWindow}
	<SpaceSettingsScreen {space} {spaceId} bind:open />
{/if}
