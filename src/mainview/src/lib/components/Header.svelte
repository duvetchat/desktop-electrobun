<script lang="ts">
	import { Button } from "bits-ui";
	import { Minus as MinusIcon, Square as SquareIcon, X as XIcon } from "@lucide/svelte";
	import { isElectrobunWindow } from "$lib/electrobun-rpc";

	const isDesktop = isElectrobunWindow();
</script>

{#if isDesktop}
	<header
		id="window-titlebar"
		class="electrobun-webkit-app-region-drag from-duvet-bg to-duvet-sunk border-duvet-line text-duvet-ink relative z-50 flex h-11 shrink-0 items-center justify-between border-b bg-linear-to-b px-2.5"
	>
		<div class="flex min-w-0 items-center">
			<span class="text-duvet-ink text-[11px] font-semibold tracking-[0.16em] uppercase">Duvet</span>
		</div>

		<div class="titlebar-actions electrobun-webkit-app-region-no-drag flex items-center gap-1">
			<Button.Root
				id="window-minimize"
				class="text-duvet-ink2 hover:border-duvet-line hover:bg-duvet-bg hover:text-duvet-ink flex h-8 w-8 items-center justify-center rounded-md border border-transparent transition-colors"
				aria-label="Minimize window"
			>
				<MinusIcon class="h-3.5 w-3.5" />
			</Button.Root>
			<Button.Root
				id="window-maximize"
				class="text-duvet-ink2 hover:border-duvet-line hover:bg-duvet-bg hover:text-duvet-ink flex h-8 w-8 items-center justify-center rounded-md border border-transparent transition-colors"
				aria-label="Maximize window"
			>
				<SquareIcon class="h-3.5 w-3.5" />
			</Button.Root>
			<Button.Root
				id="window-close"
				class="hover:text-duvet-on-accent text-duvet-ink2 hover:border-duvet-danger/30 hover:bg-duvet-danger flex h-8 w-8 items-center justify-center rounded-md border border-transparent transition-colors"
				aria-label="Close window"
			>
				<XIcon class="h-3.5 w-3.5" />
			</Button.Root>
		</div>
	</header>
{/if}
