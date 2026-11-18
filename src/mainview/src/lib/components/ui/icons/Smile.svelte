<script lang="ts">
	import { Icon, type IconProps } from "@lucide/svelte";
	import { smile } from "$lib/icons";

	// Lucide's `smile` as mobile draws it (lib/icons.ts), with the props of any icon of the package.
	let props: IconProps = $props();
</script>

<Icon name="smile" {...props} iconNode={smile} />
