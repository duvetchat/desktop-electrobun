<script>
	import { onMount } from "svelte";

	onMount(() => {
		console.log("@duvet/desktop is loaded!");
	});
</script>

<!-- Discord's card for a link to duvet.chat (routes/link-preview.json); every page has the Open Graph tags of app.html. -->
<svelte:head>
	<link rel="discord:component-embed" type="application/json" href="https://duvet.chat/link-preview.json" />
</svelte:head>
