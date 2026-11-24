<script lang="ts">
	import { t } from "$lib/i18n";
	import { currentShell } from "$lib/platform";
	import { closeWindow, maximizeWindow, minimizeWindow } from "$lib/window-controls";
	import { TRAFFIC_LIGHTS_INSET } from "$lib/shell-layout";
	import DragRegion from "$lib/components/DragRegion.svelte";

	// The window's own controls, as each system has them (#357, S-01), decided by the platform switch alone:
	//   - macOS: the system draws its traffic lights in the window's top left corner. `side="start"` keeps that corner
	//     free (and draggable); nothing shows at the end. Where the lights aren't the system's (a preview under the dev
	//     server, or a window Bun hid them in), the page draws them in that corner;
	//   - Windows: minimize, maximize and close at the end, flush with the window's edge, as tall as the title line;
	//   - Linux: GNOME's three round buttons at the end;
	//   - the web: nothing on either side.
	// The maximize button looks the same maximized or not: the page isn't told the window's state.
	let { side }: { side: "start" | "end" } = $props();

	const shell = currentShell();
	const lights = shell.chrome === "mac";
	// The system's own lights are there in the app; a preview, or a window without them, draws them.
	const drawnLights = lights && (shell.preview || !shell.nativeTrafficLights);

	const focus = "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-duvet-accent";
	const windowsButton = `text-duvet-ink hover:bg-duvet-hover-strong grid h-full w-[46px] place-items-center transition-colors duration-[120ms] motion-reduce:transition-none ${focus}`;
	const linuxButton = `bg-duvet-hover-strong text-duvet-ink grid size-6 place-items-center rounded-full transition-[filter] duration-[120ms] hover:brightness-90 motion-reduce:transition-none ${focus}`;
	const light =
		"grid size-3 place-items-center rounded-full text-duvet-media-scrim focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-duvet-accent";
</script>

{#snippet glyph(kind: "minimize" | "maximize" | "close", stroke: number)}
	<svg
		width="10"
		height="10"
		viewBox="0 0 10 10"
		fill="none"
		stroke="currentColor"
		stroke-width={stroke}
		aria-hidden="true"
	>
		{#if kind === "minimize"}
			<path d="M0.5 5h9" />
		{:else if kind === "maximize"}
			<rect x="0.75" y="0.75" width="8.5" height="8.5" rx="1" />
		{:else}
			<path d="M0.75 0.75l8.5 8.5M9.25 0.75l-8.5 8.5" />
		{/if}
	</svg>
{/snippet}

{#if side === "start" && lights}
	{#if drawnLights}
		<div
			class="titlebar-actions group/lights flex h-full shrink-0 items-center gap-2 pr-3 pl-[18px]"
			style="min-width: {TRAFFIC_LIGHTS_INSET}px"
		>
			<button
				type="button"
				class="{light} bg-duvet-tl-close"
				aria-label={t("shell_window_close")}
				onclick={closeWindow}
			>
				<span class="opacity-0 group-hover/lights:opacity-100">{@render glyph("close", 1.4)}</span>
			</button>
			<button
				type="button"
				class="{light} bg-duvet-tl-minimize"
				aria-label={t("shell_window_minimize")}
				onclick={minimizeWindow}
			>
				<span class="opacity-0 group-hover/lights:opacity-100">{@render glyph("minimize", 1.4)}</span>
			</button>
			<button
				type="button"
				class="{light} bg-duvet-tl-zoom"
				aria-label={t("shell_window_maximize")}
				onclick={maximizeWindow}
			>
				<span class="opacity-0 group-hover/lights:opacity-100">{@render glyph("maximize", 1.4)}</span>
			</button>
		</div>
	{:else}
		<!-- The system's traffic lights sit here: the corner stays empty, and drags the window like the rest. -->
		<div class="flex h-full shrink-0" style="width: {TRAFFIC_LIGHTS_INSET}px" data-traffic-lights>
			<DragRegion class="h-full flex-1" />
		</div>
	{/if}
{:else if side === "end" && shell.chrome === "windows"}
	<div class="titlebar-actions flex h-full shrink-0 items-stretch">
		<button type="button" class={windowsButton} aria-label={t("shell_window_minimize")} onclick={minimizeWindow}>
			{@render glyph("minimize", 1)}
		</button>
		<button type="button" class={windowsButton} aria-label={t("shell_window_maximize")} onclick={maximizeWindow}>
			{@render glyph("maximize", 1)}
		</button>
		<button
			type="button"
			class="{windowsButton} hover:bg-duvet-win-close hover:text-fixed-white"
			aria-label={t("shell_window_close")}
			onclick={closeWindow}
		>
			{@render glyph("close", 1)}
		</button>
	</div>
{:else if side === "end" && shell.chrome === "linux"}
	<div class="titlebar-actions mr-1 ml-2.5 flex h-full shrink-0 items-center gap-2.5">
		<button type="button" class={linuxButton} aria-label={t("shell_window_minimize")} onclick={minimizeWindow}>
			{@render glyph("minimize", 1.4)}
		</button>
		<button type="button" class={linuxButton} aria-label={t("shell_window_maximize")} onclick={maximizeWindow}>
			{@render glyph("maximize", 1.4)}
		</button>
		<button type="button" class={linuxButton} aria-label={t("shell_window_close")} onclick={closeWindow}>
			{@render glyph("close", 1.4)}
		</button>
	</div>
{/if}
