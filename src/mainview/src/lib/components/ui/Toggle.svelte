<script lang="ts">
	import { Switch } from "bits-ui";

	// A switch: on or off, at once. `label` names it for a screen reader when no visible label points at it (`id`).
	let {
		checked = $bindable(false),
		onCheckedChange = undefined,
		disabled = false,
		label = undefined,
		id = undefined,
		class: className = "",
	}: {
		checked?: boolean;
		onCheckedChange?: (checked: boolean) => void;
		disabled?: boolean;
		label?: string;
		id?: string;
		class?: string;
	} = $props();
</script>

<Switch.Root
	bind:checked
	{onCheckedChange}
	{disabled}
	{id}
	aria-label={label}
	class="bg-duvet-toggle-off data-[state=checked]:bg-duvet-accent relative h-6 w-10 shrink-0 rounded-xl transition-colors duration-200 data-disabled:opacity-50 motion-reduce:transition-none {className}"
>
	<Switch.Thumb
		class="bg-fixed-white ease-overshoot absolute top-[3px] left-[3px] block size-[18px] rounded-[7px] shadow-[0_1px_3px_rgba(0,0,0,0.22)] transition-transform duration-[250ms] data-[state=checked]:translate-x-4 motion-reduce:transition-none"
	/>
</Switch.Root>
