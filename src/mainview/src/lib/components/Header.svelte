<script lang="ts">
	import { Button } from "bits-ui";
	import { Minus as MinusIcon, Square as SquareIcon, X as XIcon } from "@lucide/svelte";
	import { isElectrobunWindow } from "$lib/electrobun-rpc";

	const isDesktop = isElectrobunWindow();
</script>

{#if isDesktop}
	<header
		id="window-titlebar"
		class="electrobun-webkit-app-region-drag from-night-19 to-night-165 relative z-50 flex h-11 shrink-0 items-center justify-between border-b border-stone-800 bg-linear-to-b px-2.5 text-stone-200"
	>
		<div class="flex min-w-0 items-center">
			<span class="text-[11px] font-semibold tracking-[0.16em] text-stone-100 uppercase">Duvet</span>
		</div>

		<div class="titlebar-actions electrobun-webkit-app-region-no-drag flex items-center gap-1">
			<Button.Root
				id="window-minimize"
				class="flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-stone-400 transition-colors hover:border-stone-700 hover:bg-stone-900 hover:text-stone-100"
				aria-label="Minimize window"
			>
				<MinusIcon class="h-3.5 w-3.5" />
			</Button.Root>
			<Button.Root
				id="window-maximize"
				class="flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-stone-400 transition-colors hover:border-stone-700 hover:bg-stone-900 hover:text-stone-100"
				aria-label="Maximize window"
			>
				<SquareIcon class="h-3.5 w-3.5" />
			</Button.Root>
			<Button.Root
				id="window-close"
				class="hover:text-fixed-white flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-stone-400 transition-colors hover:border-red-500/30 hover:bg-red-500"
				aria-label="Close window"
			>
				<XIcon class="h-3.5 w-3.5" />
			</Button.Root>
		</div>
	</header>
{/if}
