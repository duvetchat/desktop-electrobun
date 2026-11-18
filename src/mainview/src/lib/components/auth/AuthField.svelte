<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLInputAttributes } from "svelte/elements";

	// A field of the sign-in pages, as mobile's DuvetTextField at the desktop's density: its label over a recessed
	// card 38 tall (the well and a hairline; the accent's ring while focused, danger's edge while it reads wrong), with
	// a line under it for a rule or what's wrong. `trailing` sits inside the field's right end (the eye of a password).
	let {
		id,
		label,
		value = $bindable(""),
		hint = undefined,
		error = undefined,
		invalid = false,
		aside = undefined,
		trailing = undefined,
		"aria-describedby": describedElsewhere = undefined,
		inert = false,
		class: className = "",
		...rest
	}: Omit<HTMLInputAttributes, "class" | "id" | "value" | "inert"> & {
		/** Not there yet: nothing of the field, its eye included, can be reached. */
		inert?: boolean;
		id: string;
		label: string;
		value?: string;
		/** A rule, in the second ink; it turns to danger while `invalid`. */
		hint?: string;
		/** What's wrong with what was typed, announced as it appears. */
		error?: string;
		invalid?: boolean;
		/** Beside the label, at the right: a link about this field. */
		aside?: Snippet;
		trailing?: Snippet;
		class?: string;
	} = $props();

	const wrong = $derived(invalid || !!error);
	const described = $derived(
		[describedElsewhere, hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined,
	);
</script>

<div class={className} {inert}>
	<div class="mb-1.5 flex items-baseline justify-between gap-3">
		<label for={id} class="text-duvet-ink text-[13px] leading-[1.2] font-medium">{label}</label>
		{@render aside?.()}
	</div>
	<div class="relative">
		<!-- Its ring is its focus mark, so it takes no global outline (focus-override). -->
		<input
			{...rest}
			{id}
			bind:value
			aria-invalid={wrong ? true : undefined}
			aria-describedby={described}
			class="focus-override bg-duvet-card text-duvet-ink placeholder:text-duvet-ink2 block h-[38px] w-full rounded-xl px-3 text-[14px] shadow-[var(--duvet-shadow-well),0_0_0_1px_var(--duvet-line)] transition-shadow duration-[120ms] outline-none focus:shadow-[var(--duvet-shadow-well),0_0_0_1px_var(--duvet-accent),0_0_0_4px_var(--duvet-accent-tint)] disabled:opacity-60 aria-invalid:shadow-[var(--duvet-shadow-well),0_0_0_1px_var(--duvet-danger)] motion-reduce:transition-none {trailing
				? 'pr-11'
				: ''}"
		/>
		{#if trailing}
			<div class="absolute inset-y-0 right-1 flex items-center">{@render trailing()}</div>
		{/if}
	</div>
	{#if hint}
		<p id="{id}-hint" class="mt-1.5 text-[12.5px] leading-[1.3] {invalid ? 'text-duvet-danger' : 'text-duvet-ink2'}">
			{hint}
		</p>
	{/if}
	{#if error}
		<p id="{id}-error" class="text-duvet-danger mt-1.5 text-[12.5px] leading-[1.3]" role="status">{error}</p>
	{/if}
</div>
