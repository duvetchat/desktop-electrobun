<script lang="ts">
	import { Search, X } from "@lucide/svelte";

	// The search field at the top of a picker (emoji, GIFs, stickers): 34 px tall on the field's fill, ringed in the
	// accent's tint while it has the focus, with a × that clears it once it holds text.
	let {
		value = $bindable(""),
		placeholder,
		label,
		maxlength = undefined,
		oninput = undefined,
		input = $bindable(null),
	}: {
		value?: string;
		placeholder: string;
		/** The field's name for a screen reader. */
		label: string;
		maxlength?: number;
		/** After the text changed, by typing or by the ×. */
		oninput?: () => void;
		input?: HTMLInputElement | null;
	} = $props();
</script>

<div
	class="bg-duvet-field mx-3 mt-3 mb-2 flex h-[34px] shrink-0 items-center gap-2 rounded-[11px] px-2.5 transition-shadow duration-[120ms] focus-within:shadow-[0_0_0_3px_var(--duvet-accent-tint)] motion-reduce:transition-none"
>
	<Search size={14} class="text-duvet-ink2 shrink-0" aria-hidden="true" />
	<input
		bind:this={input}
		bind:value
		type="text"
		{placeholder}
		{maxlength}
		aria-label={label}
		autocomplete="off"
		spellcheck="false"
		class="text-duvet-ink placeholder:text-duvet-ink2 focus-override min-w-0 flex-1 border-none bg-transparent text-[13px] outline-none"
		{oninput}
	/>
	{#if value}
		<button
			type="button"
			class="text-duvet-ink2 hover:text-duvet-ink grid size-5 shrink-0 place-items-center rounded-md"
			aria-label="Clear search"
			onclick={() => {
				value = "";
				oninput?.();
				input?.focus();
			}}
		>
			<X size={13} />
		</button>
	{/if}
</div>
