<script lang="ts">
	import { Dialog } from "bits-ui";
	import { X as XIcon, ZoomIn as ZoomInIcon, ZoomOut as ZoomOutIcon } from "@lucide/svelte";
	import {
		coverCrop,
		cropView,
		frameSize,
		maxZoom,
		panCrop,
		sliderZoom,
		wheelZoom,
		zoomCrop,
		zoomOf,
		zoomSlider,
		type Crop,
	} from "$lib/image-crop";
	let GIFEncoder: any, quantize: any, applyPalette: any;

	let {
		open = $bindable(false),
		title = "Upload Image",
		aspect = 1,
		round = false,
		targetWidth = 256,
		targetHeight = 256,
		onConfirm,
	}: {
		open?: boolean;
		title?: string;
		aspect?: number;
		round?: boolean;
		targetWidth?: number;
		targetHeight?: number;
		onConfirm: (file: File) => void;
	} = $props();

	// The frame stays in the middle of the view, which shows the rest of the image dimmed around it.
	const VIEW_WIDTH = 400;
	const FRAME_MARGIN = 32;
	let frameBox = $derived(frameSize(aspect, { width: VIEW_WIDTH - 2 * FRAME_MARGIN, height: 280 }));
	let frameLeft = $derived((VIEW_WIDTH - frameBox.width) / 2);

	let file = $state<File | null>(null);
	let imgSrc = $state("");
	let naturalW = $state(0);
	let naturalH = $state(0);
	let image = $derived({ width: naturalW, height: naturalH });

	// The part of the image the frame shows, in the image's pixels: what Apply keeps. It's replaced, never changed.
	let crop = $state.raw<Crop>({ x: 0, y: 0, width: 0, height: 0 });
	let zoom = $derived(zoomOf(crop, image, aspect));
	let zoomLimit = $derived(maxZoom(image, aspect, { width: targetWidth, height: targetHeight }));
	let view = $derived(cropView(crop, frameBox));
	let dragStart: { mx: number; my: number; crop: Crop } | null = null;

	function handleFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const f = input.files?.[0];
		if (!f) return;
		file = f;
		naturalW = 0;
		naturalH = 0;
		const reader = new FileReader();
		reader.onload = () => {
			imgSrc = reader.result as string;
		};
		reader.readAsDataURL(f);
	}

	function onImageLoad(e: Event) {
		const img = e.target as HTMLImageElement;
		naturalW = img.naturalWidth;
		naturalH = img.naturalHeight;
		crop = coverCrop(image, aspect);
	}

	function handlePointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		dragStart = { mx: e.clientX, my: e.clientY, crop };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function handlePointerMove(e: PointerEvent) {
		if (!dragStart) return;
		// The image follows the pointer, so the part of it in the frame moves the other way.
		const dx = (dragStart.mx - e.clientX) / view.scale;
		const dy = (dragStart.my - e.clientY) / view.scale;
		crop = panCrop(dragStart.crop, image, dx, dy);
	}

	function handlePointerUp() {
		dragStart = null;
	}

	function handleWheel(e: WheelEvent) {
		e.preventDefault();
		// The point of the image under the pointer stays under it.
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const focus = {
			x: (e.clientX - rect.left - frameLeft) / frameBox.width,
			y: (e.clientY - rect.top - FRAME_MARGIN) / frameBox.height,
		};
		crop = zoomCrop(crop, image, aspect, wheelZoom(zoom, e.deltaY, zoomLimit), focus);
	}

	function handleZoomSlider(e: Event) {
		const value = Number((e.target as HTMLInputElement).value);
		crop = zoomCrop(crop, image, aspect, sliderZoom(value, zoomLimit));
	}

	// The result's name: the chosen file's, with the result's extension.
	function renamed(name: string, ext: string): string {
		return `${name.replace(/\.[^.]*$/, "") || "image"}.${ext}`;
	}

	let imgEl: HTMLImageElement | undefined = $state();
	let processing = $state(false);

	async function handleConfirm() {
		processing = true;
		try {
			if (!file || !imgEl) return;
			// What the frame shows now, even if the image is moved while the result is made.
			const area = crop;

			let outputFile: File | null = null;

			// An animated image stays animated, as a GIF (cropAnimated gives null for a still one).
			if ("ImageDecoder" in window && file.type.startsWith("image/")) {
				try {
					if (await ImageDecoder.isTypeSupported(file.type)) outputFile = await cropAnimated(file, area);
				} catch (err) {
					console.error("Failed to crop the animation, keeping a still image:", err);
				}
			}

			if (!outputFile) {
				const canvas = document.createElement("canvas");
				canvas.width = targetWidth;
				canvas.height = targetHeight;
				const ctx = canvas.getContext("2d")!;
				ctx.imageSmoothingEnabled = true;
				ctx.imageSmoothingQuality = "high";
				ctx.drawImage(imgEl, area.x, area.y, area.width, area.height, 0, 0, targetWidth, targetHeight);

				const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
				if (!blob) return;
				outputFile = new File([blob], renamed(file.name, "png"), { type: "image/png" });
			}

			onConfirm(outputFile);
			open = false;
			file = null;
			imgSrc = "";
		} finally {
			processing = false;
		}
	}

	async function cropAnimated(inputFile: File, area: Crop): Promise<File | null> {
		const buffer = await inputFile.arrayBuffer();
		// @ts-ignore — ImageDecoder is available in Chromium
		const decoder = new ImageDecoder({ type: inputFile.type, data: buffer });
		await decoder.tracks.ready;

		const frameCount = decoder.tracks.selectedTrack?.frameCount ?? 1;

		// If only 1 frame, fall back to static PNG crop (no animation to preserve)
		if (frameCount <= 1) {
			decoder.close();
			return null;
		}

		// Lazy-load gifenc (avoids SSR issues with CJS module)
		if (!GIFEncoder) {
			const mod = await import("gifenc");
			GIFEncoder = mod.GIFEncoder ?? mod.default?.GIFEncoder ?? mod.default;
			quantize = mod.quantize ?? mod.default?.quantize;
			applyPalette = mod.applyPalette ?? mod.default?.applyPalette;
		}

		const canvas = document.createElement("canvas");
		canvas.width = targetWidth;
		canvas.height = targetHeight;
		// Every frame is read back to be encoded.
		const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

		const encoder = GIFEncoder();

		for (let i = 0; i < frameCount; i++) {
			const { image: frame, complete } = await decoder.decode({ frameIndex: i });
			if (!complete) continue;

			const durationUs = frame.duration ?? 0;
			let delayMs = Math.round(durationUs / 1000);
			if (delayMs <= 10) delayMs = 100;

			// Draw frame onto a temp canvas at natural size
			const tempCanvas = document.createElement("canvas");
			tempCanvas.width = frame.displayWidth;
			tempCanvas.height = frame.displayHeight;
			const tempCtx = tempCanvas.getContext("2d")!;
			tempCtx.drawImage(frame, 0, 0);
			frame.close();

			// Crop + resize onto output canvas
			ctx.clearRect(0, 0, targetWidth, targetHeight);
			ctx.imageSmoothingEnabled = true;
			ctx.imageSmoothingQuality = "high";
			ctx.drawImage(tempCanvas, area.x, area.y, area.width, area.height, 0, 0, targetWidth, targetHeight);

			const { data } = ctx.getImageData(0, 0, targetWidth, targetHeight);
			// A GIF's pixels are opaque or clear: one under half opacity turns clear, and any other opaque.
			let firstClear = -1;
			for (let p = 0; p < data.length; p += 4) {
				if (data[p + 3] < 128) {
					data[p] = data[p + 1] = data[p + 2] = data[p + 3] = 0;
					if (firstClear < 0) firstClear = p / 4;
				} else {
					data[p + 3] = 255;
				}
			}
			const format = firstClear < 0 ? "rgb565" : "rgba4444";
			const palette = quantize(data, 256, { format, oneBitAlpha: true });
			const indexed = applyPalette(data, palette, format);

			encoder.writeFrame(indexed, targetWidth, targetHeight, {
				palette,
				delay: delayMs,
				dispose: 2,
				// The clear pixels all took one color of the palette, which the frame makes its transparent one.
				transparent: firstClear >= 0,
				transparentIndex: firstClear < 0 ? 0 : indexed[firstClear],
			});
		}

		encoder.finish();
		const gifBytes = encoder.bytes();
		decoder.close();

		return new File([new Blob([gifBytes])], renamed(inputFile.name, "gif"), { type: "image/gif" });
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-500 bg-black/70 backdrop-blur-sm" />
		<Dialog.Content class="fixed inset-0 z-501 flex items-center justify-center p-4">
			<div
				class="w-full max-w-lg overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-100 shadow-2xl"
			>
				<div class="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
					<h2 class="text-sm font-semibold text-white">{title}</h2>
					<Dialog.Close
						class="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
					>
						<XIcon class="size-4" />
					</Dialog.Close>
				</div>

				<div class="p-5">
					{#if !imgSrc}
						<label
							class="flex h-48 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-700 transition-colors hover:border-zinc-500 hover:bg-zinc-800/30"
						>
							<span class="text-sm text-zinc-400">Click to choose an image</span>
							<span class="mt-1 text-xs text-zinc-600">PNG, JPG, GIF — max 10MB</span>
							<input type="file" accept="image/*" class="hidden" onchange={handleFileChange} />
						</label>
					{:else}
						<p class="mb-2 text-xs text-zinc-500">Drag to reposition. Scroll to zoom.</p>
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<div
							class="relative mx-auto cursor-grab touch-none overflow-hidden rounded-lg bg-zinc-950 select-none active:cursor-grabbing"
							style="width: {VIEW_WIDTH}px; height: {frameBox.height + 2 * FRAME_MARGIN}px;"
							role="application"
							tabindex="-1"
							onpointerdown={handlePointerDown}
							onpointermove={handlePointerMove}
							onpointerup={handlePointerUp}
							onpointercancel={handlePointerUp}
							onwheel={handleWheel}
						>
							<img
								bind:this={imgEl}
								src={imgSrc}
								alt="Preview"
								class="absolute block max-w-none {naturalW ? '' : 'invisible'}"
								style="
									left: {frameLeft + view.x}px;
									top: {FRAME_MARGIN + view.y}px;
									width: {naturalW * view.scale}px;
									height: {naturalH * view.scale}px;
								"
								onload={onImageLoad}
								draggable="false"
							/>
							<!-- The frame shows the result; its shadow dims the rest of the image. -->
							<div
								class="pointer-events-none absolute shadow-[0_0_0_9999px_rgb(0_0_0/0.6)] ring-2 ring-white/40 {round
									? 'rounded-full'
									: 'rounded-md'}"
								style="left: {frameLeft}px; top: {FRAME_MARGIN}px; width: {frameBox.width}px; height: {frameBox.height}px;"
							></div>
						</div>

						<div class="mx-auto mt-3 flex items-center gap-3" style="width: {VIEW_WIDTH}px;">
							<ZoomOutIcon class="size-4 shrink-0 text-zinc-500" />
							<input
								type="range"
								min="0"
								max="1"
								step="0.01"
								value={zoomSlider(zoom, zoomLimit)}
								oninput={handleZoomSlider}
								disabled={zoomLimit <= 1}
								aria-label="Zoom"
								class="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-700 accent-stone-500 disabled:cursor-default disabled:opacity-40 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-stone-400"
							/>
							<ZoomInIcon class="size-4 shrink-0 text-zinc-500" />
						</div>

						<div class="mt-4 flex justify-between gap-3">
							<button
								class="rounded-md px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
								onclick={() => {
									file = null;
									imgSrc = "";
								}}>Change image</button
							>
							<button
								class="rounded-md bg-stone-600 px-5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-stone-500"
								onclick={handleConfirm}
								disabled={processing}>{processing ? "Processing..." : "Apply"}</button
							>
						</div>
					{/if}
				</div>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
