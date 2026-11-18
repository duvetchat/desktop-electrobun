<script lang="ts" generics="Section extends string">
	import type { Snippet } from "svelte";
	import { Dialog } from "bits-ui";
	import { Minus as MinusIcon, Search as SearchIcon, Square as SquareIcon, X as XIcon } from "@lucide/svelte";
	import { iconButtonClass } from "$lib/components/ui/recipes";
	import { filterNav, navLabel, type SettingsNavGroup } from "./recipes";

	// The chassis of Settings and of a Space's settings (#357, DESIGN-MAP.md S-47, S-58): a side panel that lists the
	// sections, and the page of the one picked under a toolbar that names it. On the web it is a sheet over the app; in
	// the desktop app it fills a window of its own, whose chrome it draws: on macOS a strip at the top of the side
	// panel for the system's traffic lights, on Windows and Linux a title bar with the window's name and buttons
	// (lib/window-controls.ts binds them by their IDs).
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
		/** A page up to 860 wide instead of 640: the sections that are lists with their own columns. */
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
	const DRAG = "electrobun-webkit-app-region-drag";
	const NO_DRAG = "electrobun-webkit-app-region-no-drag";
	const windowButton =
		"text-duvet-ink2 hover:bg-duvet-hover hover:text-duvet-ink flex h-full w-[46px] items-center justify-center transition-colors";
</script>

{#snippet side()}
	<aside
		class="bg-duvet-sb-bg border-duvet-sb-edge flex w-[236px] shrink-0 flex-col border-r px-2.5 pb-3 {mode ===
			'window' && chrome === 'mac'
			? ''
			: mode === 'window'
				? 'pt-3'
				: 'pt-3.5'}"
	>
		{#if mode === "window" && chrome === "mac"}
			<!-- Where macOS draws the window's traffic lights; the strip drags the window. -->
			<div class="{DRAG} h-[52px] shrink-0"></div>
		{/if}
		{@render head()}
		<label
			class="bg-duvet-sb-field ring-duvet-sb-edge text-duvet-ink2 focus-within:ring-duvet-accent mt-2 flex h-[30px] shrink-0 items-center gap-1.5 rounded-[9px] px-2 ring-[0.5px] focus-within:ring-2"
		>
			<SearchIcon size={13} class="shrink-0" />
			<input
				type="search"
				bind:value={query}
				placeholder="Search"
				aria-label="Search settings"
				class="focus-override text-duvet-ink placeholder:text-duvet-ink2 min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
			/>
		</label>
		<nav class="mt-2.5 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto" aria-label={name}>
			{#each shown as group, index (index)}
				<div class="flex flex-col gap-px">
					{#if group.title}
						<p class="text-duvet-ink2 px-2 pt-2 pb-1.5 text-[11px] font-semibold">{group.title}</p>
					{/if}
					{#each group.items as item (item.id)}
						<button
							type="button"
							class="flex h-8 shrink-0 items-center gap-[9px] rounded-[9px] px-2 text-left text-[13px] font-medium transition-colors duration-[120ms] motion-reduce:transition-none {active ===
							item.id
								? 'bg-duvet-accent-tint text-duvet-ink'
								: 'text-duvet-ink hover:bg-duvet-sb-hover'}"
							aria-current={active === item.id ? "page" : undefined}
							onclick={() => (active = item.id)}
						>
							<span
								class="text-fixed-white grid size-[22px] shrink-0 place-items-center rounded-[7px]"
								style="background: {item.tile};"
								aria-hidden="true"
							>
								<item.icon size={14} />
							</span>
							<span class="min-w-0 flex-1 truncate">{item.label}</span>
							{#if item.count}
								<span
									class="bg-duvet-accent text-duvet-on-accent flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums"
									>{item.count}</span
								>
							{/if}
						</button>
					{/each}
				</div>
			{:else}
				<p class="text-duvet-ink2 px-2 py-1 text-xs">Nothing matches</p>
			{/each}
		</nav>
		{#if foot}
			<div class="mt-2 shrink-0">{@render foot()}</div>
		{/if}
	</aside>
{/snippet}

{#snippet page()}
	<div class="bg-duvet-bg flex min-w-0 flex-1 flex-col">
		<div
			class="border-duvet-line flex h-[52px] shrink-0 items-center gap-2 border-b pr-4 pl-6 {mode === 'window'
				? DRAG
				: ''}"
		>
			{#if mode === "sheet"}
				<Dialog.Title level={2} class="min-w-0 flex-1 truncate font-serif text-[17px] font-medium">{title}</Dialog.Title
				>
				<Dialog.Close aria-label="Close" class={iconButtonClass()}>
					<XIcon size={16} />
				</Dialog.Close>
			{:else}
				<h2 class="min-w-0 flex-1 truncate font-serif text-[17px] font-medium">{title}</h2>
			{/if}
		</div>
		<div class="min-h-0 flex-1 overflow-y-auto px-[26px] pt-5 pb-10">
			{#key active}
				<div
					class="animate-fade-up mx-auto flex w-full flex-col gap-5 {wide ? 'max-w-[860px]' : 'max-w-[640px]'}"
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
				class="text-duvet-ink shadow-duvet-glass animate-sheet-in fixed top-1/2 left-1/2 z-501 flex h-[min(660px,calc(100%-48px))] w-[min(920px,calc(100%-48px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-3xl outline-none"
			>
				{@render side()}
				{@render page()}
			</Dialog.Content>
		</Dialog.Portal>
	</Dialog.Root>
{:else}
	<main class="text-duvet-ink flex size-full flex-col overflow-hidden" aria-label={name}>
		{#if chrome === "windows" || chrome === "linux"}
			<header
				id="window-titlebar"
				class="{DRAG} bg-duvet-bg border-duvet-line flex h-10 shrink-0 items-center border-b pl-3.5"
			>
				<span class="text-duvet-ink2 min-w-0 flex-1 truncate text-[12.5px] font-medium">{name}</span>
				<div class="titlebar-actions {NO_DRAG} flex h-full items-stretch">
					<button id="window-minimize" type="button" class={windowButton} aria-label="Minimize window">
						<MinusIcon size={14} />
					</button>
					<button id="window-maximize" type="button" class={windowButton} aria-label="Maximize window">
						<SquareIcon size={12} />
					</button>
					<button
						id="window-close"
						type="button"
						class="text-duvet-ink2 hover:bg-duvet-win-close hover:text-fixed-white flex h-full w-[46px] items-center justify-center transition-colors"
						aria-label="Close window"
					>
						<XIcon size={15} />
					</button>
				</div>
			</header>
		{/if}
		<div class="flex min-h-0 flex-1">
			{@render side()}
			{@render page()}
		</div>
	</main>
{/if}
