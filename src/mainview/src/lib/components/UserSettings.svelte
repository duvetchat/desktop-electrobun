<script lang="ts">
	import { onMount } from "svelte";
	import SettingsScreen from "$lib/components/settings/SettingsScreen.svelte";
	import { ownMobileOnly } from "$lib/api/ws/connection";
	import { isElectrobunWindow } from "$lib/electrobun-rpc";
	import { currentShell } from "$lib/platform";
	import { openAppWindow, startSettingsHost } from "$lib/stores/settings-host-link.svelte";

	// Settings, as the app's page opens them (#357): the screen itself is settings/SettingsScreen.svelte. On the web it is
	// a sheet of this page, which stays mounted while closed, so it reopens on the section viewed last. In the desktop
	// app it is a window of its own (routes/settings): opening it here asks Bun for that window, and this page shares
	// with it what the screen shows, starting with what the gateway connection knows of the user.
	let {
		open = $bindable(false),
	}: {
		open?: boolean;
	} = $props();

	const inWindow = isElectrobunWindow() && currentShell().settingsInWindows;

	onMount(() => {
		if (inWindow) startSettingsHost(ownMobileOnly);
	});

	$effect(() => {
		if (!inWindow || !open) return;
		open = false;
		void openAppWindow({ window: "settings" });
	});
</script>

{#if !inWindow}
	<SettingsScreen bind:open mobileOnly={$ownMobileOnly} />
{/if}
