<script lang="ts">
	import { Select } from "bits-ui";
	import {
		Check as CheckIcon,
		ChevronDown as ChevronDownIcon,
		Languages as LanguageIcon,
		Monitor as SystemIcon,
	} from "@lucide/svelte";
	import { claimLayer, layerStyle, releaseLayer } from "$lib/overlay-layers";
	import { MENU_PANEL, menuItemClass } from "$lib/components/ui/recipes";
	import { LOCALE_FLAGS, LOCALE_NAMES, flagEmoji, type LocalePref, type UiLocale } from "$lib/i18n/locale";
	import { SELECT } from "./recipes";

	// Appearance's Language (#464): Match system, then each language by its flag and its name in itself (#565). The list
	// is drawn in the page, not by a native select, whose options hold only text: a flag there is the system's emoji, and
	// Windows has none, so it shows the two letters. Here the flags are Twemoji, as every emoji in the app is. bits-ui's
	// Select keeps what the native one did: the arrow keys, Home and End, typing a name to reach it, and a listbox for a
	// screen reader, which reads the name and not the flag.
	let {
		id,
		value,
		offered,
		systemLabel,
		open = $bindable(false),
		onValueChange,
	}: {
		/** The trigger's ID, for the row's label. */
		id: string;
		value: LocalePref;
		offered: readonly UiLocale[];
		/** Match system's label, naming the language it comes to. */
		systemLabel: string;
		open?: boolean;
		onValueChange: (value: string) => void;
	} = $props();

	const items = $derived([
		{ value: "system", label: systemLabel },
		...offered.map((locale) => ({ value: locale, label: LOCALE_NAMES[locale] })),
	]);
	const chosen = $derived(items.find((item) => item.value === value) ?? items[0]!);

	// What opens last is in front, whatever opened it (lib/overlay-layers.ts).
	const layer = $derived(open ? claimLayer() : 0);
	$effect(() => {
		const mine = layer;
		if (mine) return () => releaseLayer(mine);
	});
</script>

<!-- A language's flag, or for Match system the system's icon; a language with no flag has the language icon. -->
{#snippet mark(pref: string)}
	{@const region = pref === "system" ? null : LOCALE_FLAGS[pref as UiLocale]}
	<span class="text-duvet-ink2 grid w-[18px] shrink-0 place-items-center" aria-hidden="true">
		{#if pref === "system"}
			<SystemIcon size={16} />
		{:else if region}
			<span class="font-emoji text-[16px] leading-none" data-flag={region}>{flagEmoji(region)}</span>
		{:else}
			<LanguageIcon size={16} />
		{/if}
	</span>
{/snippet}

<!-- Each language's name is marked as that language, for the system to read it right. -->
{#snippet name(item: { value: string; label: string })}
	<span class="min-w-0 flex-1 truncate" lang={item.value === "system" ? undefined : item.value}>{item.label}</span>
{/snippet}

<Select.Root type="single" {value} {onValueChange} {items} bind:open>
	<!-- A combobox, as the native select was: the row's label names it and its text is the language chosen. A plain
	     button (bits-ui's own role) would take its name from the label alone, and the language chosen would go unread. -->
	<Select.Trigger {id} role="combobox" class="{SELECT} relative flex w-56 items-center gap-2 text-left">
		{@render mark(chosen.value)}
		{@render name(chosen)}
		<ChevronDownIcon
			size={16}
			aria-hidden="true"
			class="text-duvet-ink2 absolute top-1/2 right-2.5 -translate-y-1/2 transition-transform motion-reduce:transition-none {open
				? 'rotate-180'
				: ''}"
		/>
	</Select.Trigger>
	<Select.Portal>
		{#if layer}
			<!-- The panel's positioner takes no layer of its own: this holds it, at the overlay's (lib/overlay-layers.ts). -->
			<div class="fixed top-0 left-0" style={layerStyle(layer)}>
				<Select.Content
					side="bottom"
					align="start"
					sideOffset={6}
					collisionPadding={10}
					class="{MENU_PANEL} max-h-[min(20rem,var(--bits-floating-available-height))] min-w-(--bits-floating-anchor-width) origin-(--bits-floating-transform-origin) overflow-y-auto"
				>
					<Select.Viewport>
						{#each items as item (item.value)}
							<Select.Item value={item.value} label={item.label} class={menuItemClass()}>
								{#snippet children({ selected })}
									{@render mark(item.value)}
									{@render name(item)}
									{#if selected}<CheckIcon size={15} aria-hidden="true" class="text-duvet-accent-text shrink-0" />{/if}
								{/snippet}
							</Select.Item>
						{/each}
					</Select.Viewport>
				</Select.Content>
			</div>
		{/if}
	</Select.Portal>
</Select.Root>
