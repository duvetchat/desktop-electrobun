<script lang="ts">
	import { onMount } from "svelte";
	import BanDialog from "$lib/components/BanDialog.svelte";
	import SpaceSettingsScreen from "$lib/components/settings/SpaceSettingsScreen.svelte";
	import { route } from "$lib/common/common";
	import { isElectrobunWindow } from "$lib/electrobun-rpc";
	import { t } from "$lib/i18n";
	import { currentShell } from "$lib/platform";
	import { closesSettingsWindow, pressIn } from "$lib/settings-keys";
	import { spaceSection } from "$lib/space-settings";
	import { startSettingsGuest, type SettingsGuest } from "$lib/stores/settings-guest-link.svelte";
	import { gatewaySpaces } from "$lib/stores.svelte";

	// A Space's settings in a window of their own in the desktop app, one per Space (#357, lib/app-windows.ts). The page
	// opens no gateway connection: the main window shares the Space as it has it, live, and is asked for what only it
	// can do. The window closes by itself when its Space is deleted or left. On the web a Space's settings are a sheet of
	// the app's page, and this address goes there.
	const shell = currentShell();
	let guest = $state<SettingsGuest | null>(null);
	const spaceId = $derived(guest?.args.spaceId ?? null);
	const space = $derived($gatewaySpaces.find((candidate) => candidate.id === spaceId) ?? null);
	const section = $derived(spaceSection(guest?.args.section));
	const asked = $derived(guest?.asked ? { section: spaceSection(guest.asked.section), at: guest.asked.at } : null);

	onMount(() => {
		if (!isElectrobunWindow()) {
			location.replace(route("/app.html"));
			return;
		}
		guest = startSettingsGuest();
	});
</script>

<svelte:head>
	<title
		>{space
			? t("public_space_settings_window_title_named", { space: space.name })
			: t("public_space_settings_window_title")}</title
	>
</svelte:head>

<svelte:window
	onkeydown={(event) => {
		if (guest && closesSettingsWindow(pressIn(event, document), shell.os === "mac")) {
			event.preventDefault();
			guest.close();
		}
	}}
/>

{#if guest?.ready && space}
	<SpaceSettingsScreen mode="window" chrome={shell.chrome} open {space} {spaceId} host={guest.host} {section} {asked} />
	<!-- Member details' Ban asks its reason here: the app's page has its own. -->
	<BanDialog />
{/if}
