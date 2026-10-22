<script lang="ts">
	import "../app.css";

	import favicon from "$lib/assets/favicon.svg";
	import Header from "$lib/components/Header.svelte";
	import Toast from "$lib/components/Toast.svelte";
	import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
	import PromptDialog from "$lib/components/PromptDialog.svelte";

	import { setupWindowControls } from "$lib/window-controls";
	import { setupExternalLinks } from "$lib/external-links";
	import { onMount } from "svelte";

	let { children } = $props();

	onMount(() => {
		setupWindowControls();
		setupExternalLinks();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="flex h-(--app-height) w-(--app-width) flex-col overflow-hidden bg-stone-950 text-stone-100">
	<Header />
	<div class="min-h-0 flex-1 overflow-hidden">
		{@render children()}
	</div>
</div>
<Toast />
<ConfirmDialog />
<PromptDialog />
