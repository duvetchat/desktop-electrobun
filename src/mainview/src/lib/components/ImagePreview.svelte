<script lang="ts">
	import { X as XIcon, ZoomIn, ZoomOut, RotateCcw, RotateCw } from "@lucide/svelte";

	let {
		src,
		alt = "",
		open = $bindable(false),
	}: {
		src: string;
		alt?: string;
		open?: boolean;
	} = $props();

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
		if (e.key === "Escape") {
			open = false;
		} else if (e.key === "+" || e.key === "=") {
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

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="fixed inset-0 z-200 flex items-center justify-center bg-black/85 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		onclick={handleBackdropClick}
		onkeydown={handleKeyDown}
		onwheel={handleWheel}
	>
		<!-- Toolbar -->
		<div
			class="absolute top-4 right-4 z-10 flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900/80 p-1"
		>
			<button
				class="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-white"
				onclick={zoomIn}
				title="Zoom in (+)"
			>
				<ZoomIn class="size-4" />
			</button>
			<button
				class="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-white"
				onclick={zoomOut}
				title="Zoom out (-)"
			>
				<ZoomOut class="size-4" />
			</button>
			<button
				class="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-white"
				onclick={() => rotateLeft(90)}
				title="Rotate left 90° ([)"
			>
				<RotateCcw class="size-4" />
			</button>
			<button
				class="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-white"
				onclick={() => rotateRight(90)}
				title="Rotate right 90° (])"
			>
				<RotateCw class="size-4" />
			</button>
			<button
				class="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-white"
				onclick={reset}
				title="Reset (0)"
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
			<div class="h-5 w-px bg-zinc-700"></div>
			<button
				class="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-white"
				onclick={() => (open = false)}
				title="Close (Esc)"
			>
				<XIcon class="size-4" />
			</button>
		</div>

		<!-- Zoom label -->
		{#if scale !== 1}
			<div
				class="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-zinc-700 bg-zinc-900/80 px-3 py-1 text-xs text-zinc-300 select-none"
			>
				{Math.round(scale * 100)}%
			</div>
		{/if}

		<!-- Image -->
		<img
			{src}
			{alt}
			class="max-h-[90vh] max-w-[90vw] object-contain select-none"
			style="transform: scale({scale}) rotate({rotation}deg) translate({translateX / scale}px, {translateY /
				scale}px); cursor: {dragging ? 'grabbing' : 'grab'}; transition: {dragging ? 'none' : 'transform 0.15s ease'};"
			draggable="false"
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerUp}
			onpointercancel={handlePointerUp}
		/>
	</div>
{/if}
