<script lang="ts">
	import type { StorageBucket } from "$lib/api/user";
	import BucketFilesDialog from "$lib/components/BucketFilesDialog.svelte";
	import Dialog from "../Dialog.svelte";
	import Menu from "../Menu.svelte";
	import Popover from "../Popover.svelte";
	import Sheet from "../Sheet.svelte";

	// For overlay-stack.test.ts: overlays opened one from another, in the order the app opens them. A profile's
	// popover opens a sheet (Ban), the sheet a menu and then a dialog, and a storage dialog arrives over them all.
	let { storage = false }: { storage?: boolean } = $props();
	const bucket = { id: "b1", name: "Attic" } as StorageBucket;
</script>

<Popover open label="Profile">
	{#snippet trigger(props)}<button {...props}>Profile</button>{/snippet}
	<p>Profile</p>
</Popover>
<Sheet open title="Ban Ana">
	<Menu open label="Length">
		{#snippet trigger(props)}<button {...props}>Length</button>{/snippet}
		<p>Items</p>
	</Menu>
</Sheet>
<Dialog open title="Ban Ana for good?">
	{#snippet actions()}<button>Cancel</button>{/snippet}
</Dialog>
{#if storage}
	<BucketFilesDialog request={{ bucket, files: 3 }} onMove={() => {}} onDelete={() => Promise.resolve()} />
{/if}
