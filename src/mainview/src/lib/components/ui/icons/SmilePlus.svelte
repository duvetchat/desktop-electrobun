<script lang="ts">
	import { Icon, type IconProps } from "@lucide/svelte";
	import { smilePlus } from "$lib/icons";

	// Lucide's `smile-plus` as mobile draws it (lib/icons.ts), with the props of any icon of the package.
	let props: IconProps = $props();
</script>

<Icon name="smile-plus" {...props} iconNode={smilePlus} />
