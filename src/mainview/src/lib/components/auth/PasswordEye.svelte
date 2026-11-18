<script lang="ts">
	import { Eye, EyeOff } from "@lucide/svelte";
	import IconButton from "$lib/components/ui/IconButton.svelte";

	// The eye at the end of a password field: shows what was typed, or hides it again. One eye rules every password
	// field of its form.
	let { shown = $bindable(false), disabled = false }: { shown?: boolean; disabled?: boolean } = $props();
</script>

<IconButton
	label={shown ? "Hide password" : "Show password"}
	aria-pressed={shown}
	{disabled}
	onclick={() => (shown = !shown)}
>
	{#if shown}
		<EyeOff size={16} />
	{:else}
		<Eye size={16} />
	{/if}
</IconButton>
