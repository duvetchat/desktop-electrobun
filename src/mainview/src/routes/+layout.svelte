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
	import { followSystemTheme } from "$lib/theme.svelte";
	import { onMount } from "svelte";

	let { children } = $props();

	onMount(() => {
		setupExternalLinks();
		// app.html set the theme before the first paint; this keeps it with the system's while it's System.
		return followSystemTheme();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="bg-duvet-sunk text-duvet-ink flex h-(--app-height) w-(--app-width) flex-col overflow-hidden">
	<Header />
	<div class="min-h-0 flex-1 overflow-hidden">
		{@render children()}
	</div>
</div>
<Toast />
<ConfirmDialog />
<PromptDialog />
<InteractionModal />
<StorageTransferFailures />
