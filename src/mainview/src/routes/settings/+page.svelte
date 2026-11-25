<script lang="ts">
	import { onMount } from "svelte";
	import SettingsScreen from "$lib/components/settings/SettingsScreen.svelte";
	import { route } from "$lib/common/common";
	import { isElectrobunWindow } from "$lib/electrobun-rpc";
	import { t } from "$lib/i18n";
	import { currentShell } from "$lib/platform";
	import { closesSettingsWindow, pressIn } from "$lib/settings-keys";
	import { askedSection } from "$lib/settings-windows";
	import { startSettingsGuest, type SettingsGuest } from "$lib/stores/settings-guest-link.svelte";

	// Settings' own window in the desktop app (#357, lib/app-windows.ts). Its page opens no gateway connection: the
	// main window shares what the screen shows, and is asked for what only it can do. On the web Settings is a sheet of
	// the app's page, and this address goes there.
	const shell = currentShell();
	let guest = $state<SettingsGuest | null>(null);
	// The section asked for as the window opened, then each one asked of it while it is open.
	const section = $derived(guest ? askedSection(guest.args) : undefined);
	const asked = $derived(
		guest?.asked
			? { section: askedSection({ spaceId: null, section: guest.asked.section }), at: guest.asked.at }
			: null,
	);

	onMount(() => {
		if (!isElectrobunWindow()) {
			location.replace(route("/app.html"));
			return;
		}
		guest = startSettingsGuest();
	});
</script>

<svelte:head>
	<title>{t("public_settings_window_title")}</title>
</svelte:head>

<svelte:window
	onkeydown={(event) => {
		if (guest && closesSettingsWindow(pressIn(event, document), shell.os === "mac")) {
			event.preventDefault();
			guest.close();
		}
	}}
/>

{#if guest?.ready}
	<SettingsScreen
		mode="window"
		chrome={shell.chrome}
		open
		mobileOnly={guest.mobileOnly}
		host={guest.host}
		{section}
		{asked}
	/>
{/if}
