<script lang="ts">
	import SettingsScreen from "$lib/components/settings/SettingsScreen.svelte";
	import { ownMobileOnly } from "$lib/api/ws/connection";

	// Settings, as the app's page opens them (#357): the screen itself is settings/SettingsScreen.svelte, which the
	// Settings window's page shows too. This is the part only the app's page has: what the gateway connection knows of
	// the user. It stays mounted while closed, so the sheet reopens on the section viewed last.
	let {
		open = $bindable(false),
	}: {
		open?: boolean;
	} = $props();
</script>

<SettingsScreen bind:open mobileOnly={$ownMobileOnly} />
