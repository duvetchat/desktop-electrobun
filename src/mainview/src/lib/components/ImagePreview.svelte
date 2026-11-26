<script lang="ts">
	import { Dialog } from "bits-ui";
	import { X as XIcon, ZoomIn, ZoomOut, RotateCcw, RotateCw } from "@lucide/svelte";
	import { claimLayer, layerStyle, releaseLayer } from "$lib/overlay-layers";
	import { t } from "$lib/i18n";
	import { formatNumber } from "$lib/i18n/format";

	// An image, whole, over the page: zoom, rotate and drag it. It is a dialog of its own (bits-ui's), so it comes in
	// front of whatever opened it, a Settings sheet included, and that one holds its focus and its presses while this
	// is open. It opens on the image, covers the window, and Esc or the close button puts it away.
	let {
		src,
		alt = "",
		open = $bindable(false),
	}: {
		src: string;
		alt?: string;
		open?: boolean;
	} = $props();

	// The dialog's own layer, above what opened it (lib/overlay-layers.ts).
	const layer = $derived(open ? claimLayer() : 0);
	$effect(() => {
		const mine = layer;
		if (mine) return () => releaseLayer(mine);
	});

	let scale = $state(1);
	let rotation = $state(0);
	let translateX = $state(0);
	let translateY = $state(0);
	let dragging = $state(false);
	let startX = 0;
	let startY = 0;
	let lastTx = 0;
	let lastTy = 0;

	function reset() {
		scale = 1;
		rotation = 0;
		translateX = 0;
		translateY = 0;
	}

	function zoomIn() {
		scale = Math.min(scale * 1.3, 8);
	}

	function zoomOut() {
		scale = Math.max(scale / 1.3, 0.25);
	}

	function rotateRight(deg = 10) {
		rotation += deg;
	}

	function rotateLeft(deg = 10) {
		rotation -= deg;
	}

	function handleWheel(e: WheelEvent) {
		e.preventDefault();
		if (e.ctrlKey && e.shiftKey) {
			if (e.deltaY < 0) rotateLeft();
			else rotateRight();
			return;
		}
		if (e.deltaY < 0) {
			scale = Math.min(scale * 1.15, 8);
		} else {
			scale = Math.max(scale / 1.15, 0.25);
		}
	}

	function handlePointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		dragging = true;
		startX = e.clientX;
		startY = e.clientY;
		lastTx = translateX;
		lastTy = translateY;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function handlePointerMove(e: PointerEvent) {
		if (!dragging) return;
		translateX = lastTx + (e.clientX - startX);
		translateY = lastTy + (e.clientY - startY);
	}

	function handlePointerUp() {
		dragging = false;
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "+" || e.key === "=") {
			zoomIn();
		} else if (e.key === "-") {
			zoomOut();
		} else if (e.key === "0") {
			reset();
		} else if (e.key === "ArrowRight" || e.key === "]") {
			rotateRight();
		} else if (e.key === "ArrowLeft" || e.key === "[") {
			rotateLeft();
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			open = false;
		}
	}

	$effect(() => {
		if (open) {
			reset();
		}
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Content
			style={layerStyle(layer)}
			class="bg-duvet-viewer animate-scrim-in fixed inset-0 z-200 flex items-center justify-center backdrop-blur-sm outline-none"
			onclick={handleBackdropClick}
			onkeydown={handleKeyDown}
			onwheel={handleWheel}
		>
			<Dialog.Title class="sr-only">{alt ? t("media_image_named", { name: alt }) : t("media_image")}</Dialog.Title>

			<!-- Toolbar -->
			<div
				class="bg-duvet-media-scrim absolute top-4 right-4 z-10 flex items-center gap-0.5 rounded-xl p-1 backdrop-blur-md"
			>
				<button
					class="text-duvet-media-ink/80 hover:text-duvet-media-ink hover:bg-fixed-white/12 rounded-lg p-1.5 transition-colors motion-reduce:transition-none"
					onclick={zoomIn}
					title={t("media_image_zoom_in")}
				>
					<ZoomIn class="size-4" />
				</button>
				<button
					class="text-duvet-media-ink/80 hover:text-duvet-media-ink hover:bg-fixed-white/12 rounded-lg p-1.5 transition-colors motion-reduce:transition-none"
					onclick={zoomOut}
					title={t("media_image_zoom_out")}
				>
					<ZoomOut class="size-4" />
				</button>
				<button
					class="text-duvet-media-ink/80 hover:text-duvet-media-ink hover:bg-fixed-white/12 rounded-lg p-1.5 transition-colors motion-reduce:transition-none"
					onclick={() => rotateLeft(90)}
					title={t("media_image_rotate_left")}
				>
					<RotateCcw class="size-4" />
				</button>
				<button
					class="text-duvet-media-ink/80 hover:text-duvet-media-ink hover:bg-fixed-white/12 rounded-lg p-1.5 transition-colors motion-reduce:transition-none"
					onclick={() => rotateRight(90)}
					title={t("media_image_rotate_right")}
				>
					<RotateCw class="size-4" />
				</button>
				<button
					class="text-duvet-media-ink/80 hover:text-duvet-media-ink hover:bg-fixed-white/12 rounded-lg p-1.5 transition-colors motion-reduce:transition-none"
					onclick={reset}
					title={t("media_image_reset")}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg
					>
				</button>
				<div class="bg-fixed-white/15 mx-0.5 h-5 w-px"></div>
				<button
					class="text-duvet-media-ink/80 hover:text-duvet-media-ink hover:bg-fixed-white/12 rounded-lg p-1.5 transition-colors motion-reduce:transition-none"
					onclick={() => (open = false)}
					title={t("media_image_close")}
				>
					<XIcon class="size-4" />
				</button>
			</div>

			<!-- Zoom label -->
			{#if scale !== 1}
				<div
					class="bg-duvet-media-scrim text-duvet-media-ink absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-lg px-2.5 py-1 text-[11px] font-semibold tabular-nums backdrop-blur-md select-none"
				>
					{formatNumber(scale, { style: "percent", maximumFractionDigits: 0 })}
				</div>
			{/if}

			<!-- Image -->
			<img
				{src}
				{alt}
				class="max-h-[90vh] max-w-[90vw] object-contain select-none"
				style="transform: scale({scale}) rotate({rotation}deg) translate({translateX / scale}px, {translateY /
					scale}px); cursor: {dragging ? 'grabbing' : 'grab'}; transition: {dragging
					? 'none'
					: 'transform 0.15s ease'};"
				draggable="false"
				onpointerdown={handlePointerDown}
				onpointermove={handlePointerMove}
				onpointerup={handlePointerUp}
				onpointercancel={handlePointerUp}
			/>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
