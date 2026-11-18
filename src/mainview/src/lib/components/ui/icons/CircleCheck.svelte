<script lang="ts">
	import { Icon, type IconProps } from "@lucide/svelte";
	import { circleCheck } from "$lib/icons";

	// Lucide's `circle-check` as mobile draws it (lib/icons.ts), with the props of any icon of the package.
	let props: IconProps = $props();
</script>

<Icon name="circle-check" {...props} iconNode={circleCheck} />
