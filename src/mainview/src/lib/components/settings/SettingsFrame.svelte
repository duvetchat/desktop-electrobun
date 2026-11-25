<script lang="ts" generics="Section extends string">
	import type { Snippet } from "svelte";
	import { Dialog } from "bits-ui";
	import { Search as SearchIcon, X as XIcon } from "@lucide/svelte";
	import DragRegion from "$lib/components/DragRegion.svelte";
	import WindowControls from "$lib/components/WindowControls.svelte";
	import { countBadgeClass, iconButtonClass } from "$lib/components/ui/recipes";
	import { filterNav, navItemClass, navLabel, NAV_TILE, type SettingsNavGroup } from "./recipes";

	// The chassis of Settings and of a Space's settings (#357, DESIGN-MAP.md S-47, S-58): a side panel that lists the
	// sections, and the page of the one picked under a toolbar that names it. On the web it is a sheet over the app; in
	// the desktop app it fills a window of its own, whose chrome it draws: on macOS a strip at the top of the side
	// panel for the system's traffic lights, on Windows and Linux a title bar with the window's name and the window's
	// buttons, which are the shell's own (WindowControls.svelte). What drags the window is a DragRegion beside or under
	// what it shares a line with, never around it: Electrobun starts a move on any press inside a drag element, so a
	// button in one would move the window as it is pressed.
	let {
		mode,
		chrome = "web",
		open = $bindable(false),
		name,
		groups,
		active = $bindable(),
		wide = false,
		head,
		foot = undefined,
		bars = undefined,
		children,
	}: {
		mode: "sheet" | "window";
		/** Whose window chrome to draw, in a window. */
		chrome?: "mac" | "windows" | "linux" | "web";
		open?: boolean;
		/** What the screen is: the sheet's name for a screen reader, and the title bar's text on Windows and Linux. */
		name: string;
		groups: readonly SettingsNavGroup<Section>[];
		active: Section;
		/** A page up to 940 wide instead of 760: the sections that are lists with their own columns. */
		wide?: boolean;
		/** The top of the side panel: who or what the settings are of. */
		head: Snippet;
		/** The foot of the side panel. */
		foot?: Snippet;
		/** Bars under the page: unsaved changes, files picked. */
		bars?: Snippet;
		children: Snippet;
	} = $props();

	let query = $state("");
	const shown = $derived(filterNav(groups, query));
	const title = $derived(navLabel(groups, active) ?? "");
</script>

{#snippet side()}
	<aside
		class="bg-duvet-sb-bg border-duvet-sb-edge flex w-[272px] shrink-0 flex-col border-r px-3 pb-4 {mode === 'window' &&
		chrome === 'mac'
			? ''
			: mode === 'window'
				? 'pt-3'
				: 'pt-3.5'}"
	>
		{#if mode === "window" && chrome === "mac"}
			<!-- Where macOS draws the window's traffic lights; the strip drags the window. -->
			<DragRegion class="h-[52px] shrink-0" />
		{/if}
		{@render head()}
		<label
			class="bg-duvet-sb-field ring-duvet-sb-edge text-duvet-ink2 focus-within:ring-duvet-accent rounded-tile mt-3 flex h-9 shrink-0 items-center gap-2 px-2.5 ring-[0.5px] focus-within:ring-2"
		>
			<SearchIcon size={15} class="shrink-0" />
			<input
				type="search"
				bind:value={query}
				placeholder="Search"
				aria-label="Search settings"
				class="focus-override text-duvet-ink placeholder:text-duvet-ink2 min-w-0 flex-1 bg-transparent text-[13.5px] outline-none"
			/>
		</label>
		<nav class="mt-3 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto" aria-label={name}>
			{#each shown as group, index (index)}
				<div class="flex flex-col gap-1">
					{#if group.title}
						<p class="text-duvet-ink2 px-2.5 pt-3 pb-2 text-[12px] font-semibold">{group.title}</p>
					{/if}
					{#each group.items as item (item.id)}
						<button
							type="button"
							class={navItemClass(active === item.id)}
							aria-current={active === item.id ? "page" : undefined}
							onclick={() => (active = item.id)}
						>
							<span class={NAV_TILE} style="background: {item.tile};" aria-hidden="true">
								<item.icon size={16} />
							</span>
							<span class="min-w-0 flex-1 truncate">{item.label}</span>
							{#if item.count}
								<span class={countBadgeClass("md")}>{item.count}</span>
							{/if}
						</button>
					{/each}
				</div>
			{:else}
				<p class="text-duvet-ink2 px-2.5 py-2 text-[13px]">Nothing matches</p>
			{/each}
		</nav>
		{#if foot}
			<div class="mt-3 shrink-0">{@render foot()}</div>
		{/if}
	</aside>
{/snippet}

{#snippet page()}
	<div class="bg-duvet-bg flex min-w-0 flex-1 flex-col">
		<div class="border-duvet-line relative flex h-[60px] shrink-0 items-center gap-2 border-b pr-5 pl-8">
			{#if mode === "sheet"}
				<!-- A plain heading, not the dialog's title: the sheet's name is `name` ("Duvet settings"), and a title would
				     name it after its section instead. -->
				<h2 class="min-w-0 flex-1 truncate text-[18px] font-semibold">{title}</h2>
				<Dialog.Close aria-label="Close" class={iconButtonClass()}>
					<XIcon size={16} />
				</Dialog.Close>
			{:else}
				<!-- The toolbar drags the window, through its title: the region lies under it. -->
				<DragRegion class="absolute inset-0" />
				<h2 class="pointer-events-none relative min-w-0 flex-1 truncate text-[18px] font-semibold">
					{title}
				</h2>
			{/if}
		</div>
		<div class="min-h-0 flex-1 overflow-y-auto px-8 pt-7 pb-12">
			{#key active}
				<div
					class="animate-fade-up mx-auto flex w-full flex-col gap-7 {wide ? 'max-w-[940px]' : 'max-w-[760px]'}"
					data-settings-page={active}
				>
					{@render children()}
				</div>
			{/key}
		</div>
		{#if bars}
			<div class="flex shrink-0 flex-col gap-2 empty:hidden">{@render bars()}</div>
		{/if}
	</div>
{/snippet}

{#if mode === "sheet"}
	<Dialog.Root bind:open>
		<Dialog.Portal>
			<Dialog.Overlay class="bg-duvet-scrim animate-scrim-in fixed inset-0 z-500" />
			<Dialog.Content
				aria-label={name}
				class="text-duvet-ink shadow-duvet-glass animate-sheet-in fixed top-1/2 left-1/2 z-501 flex h-[min(760px,calc(100%-48px))] w-[min(1040px,calc(100%-48px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-3xl outline-none"
			>
				{@render side()}
				{@render page()}
			</Dialog.Content>
		</Dialog.Portal>
	</Dialog.Root>
{:else}
	<main class="text-duvet-ink flex size-full flex-col overflow-hidden" aria-label={name}>
		{#if chrome === "windows" || chrome === "linux"}
			<header class="bg-duvet-bg border-duvet-line relative flex h-10 shrink-0 items-stretch border-b" data-title-bar>
				<DragRegion class="absolute inset-0" />
				<span
					class="text-duvet-ink2 pointer-events-none relative min-w-0 flex-1 self-center truncate pl-3.5 text-[12.5px] font-medium"
					>{name}</span
				>
				<div class="relative flex h-full shrink-0">
					<WindowControls side="end" />
				</div>
			</header>
		{/if}
		<div class="flex min-h-0 flex-1">
			{@render side()}
			{@render page()}
		</div>
	</main>
{/if}
