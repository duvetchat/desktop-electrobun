<script lang="ts">
	import { Dialog } from "bits-ui";
	import { X as XIcon } from "@lucide/svelte";
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

	let file = $state<File | null>(null);
	let imgSrc = $state("");
	let naturalW = $state(0);
	let naturalH = $state(0);

	let cropX = $state(0);
	let cropY = $state(0);
	let cropW = $state(0);
	let cropH = $state(0);
	let dragging = $state(false);
	let dragStart = $state({ mx: 0, my: 0, cx: 0, cy: 0 });

	let containerEl: HTMLDivElement | undefined = $state();
	let scale = $derived(containerEl ? Math.min(400 / naturalW, 400 / naturalH, 1) : 1);
	let displayW = $derived(Math.round(naturalW * scale));
	let displayH = $derived(Math.round(naturalH * scale));

	function handleFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const f = input.files?.[0];
		if (!f) return;
		file = f;
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
		fitCrop();
	}

	function fitCrop() {
		let w = naturalW;
		let h = Math.round(w / aspect);
		if (h > naturalH) {
			h = naturalH;
			w = Math.round(h * aspect);
		}
		cropW = w;
		cropH = h;
		cropX = Math.round((naturalW - w) / 2);
		cropY = Math.round((naturalH - h) / 2);
	}

	function handleMouseDown(e: MouseEvent) {
		dragging = true;
		dragStart = { mx: e.clientX, my: e.clientY, cx: cropX, cy: cropY };
	}

	function handleMouseMove(e: MouseEvent) {
		if (!dragging) return;
		const dx = (e.clientX - dragStart.mx) / scale;
		const dy = (e.clientY - dragStart.my) / scale;
		cropX = Math.max(0, Math.min(naturalW - cropW, Math.round(dragStart.cx + dx)));
		cropY = Math.max(0, Math.min(naturalH - cropH, Math.round(dragStart.cy + dy)));
	}

	function handleMouseUp() {
		dragging = false;
	}

	function handleWheel(e: WheelEvent) {
		e.preventDefault();
		const delta = e.deltaY > 0 ? 20 : -20;
		const newW = Math.max(64, Math.min(naturalW, cropW + delta));
		const newH = Math.round(newW / aspect);
		if (newH > naturalH || newH < 32) return;
		const centerX = cropX + cropW / 2;
		const centerY = cropY + cropH / 2;
		cropW = newW;
		cropH = newH;
		cropX = Math.max(0, Math.min(naturalW - cropW, Math.round(centerX - cropW / 2)));
		cropY = Math.max(0, Math.min(naturalH - cropH, Math.round(centerY - cropH / 2)));
	}

	let imgEl: HTMLImageElement | undefined = $state();
	let processing = $state(false);

	async function handleConfirm() {
		processing = true;
		try {
		if (!file || !imgEl) return;

		const isAnimated = file.type === "image/gif" || file.type === "image/webp";

		let outputFile: File | null = null;

		if (isAnimated && "ImageDecoder" in window) {
			outputFile = await cropAnimated(file);
		}

		if (!outputFile) {
			const canvas = document.createElement("canvas");
			canvas.width = targetWidth;
			canvas.height = targetHeight;
			const ctx = canvas.getContext("2d")!;
			ctx.imageSmoothingEnabled = true;
			ctx.imageSmoothingQuality = "high";
			ctx.drawImage(imgEl, cropX, cropY, cropW, cropH, 0, 0, targetWidth, targetHeight);

			const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
			if (!blob) return;
			outputFile = new File([blob], "image.png", { type: "image/png" });
		}

		onConfirm(outputFile);
		open = false;
		file = null;
		imgSrc = "";
		} finally {
			processing = false;
		}
	}

	async function cropAnimated(inputFile: File): Promise<File | null> {
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
		const ctx = canvas.getContext("2d")!;

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
			ctx.drawImage(tempCanvas, cropX, cropY, cropW, cropH, 0, 0, targetWidth, targetHeight);

			const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
			const palette = quantize(imageData.data, 256);
			const indexed = applyPalette(imageData.data, palette);

			encoder.writeFrame(indexed, targetWidth, targetHeight, {
				palette,
				delay: delayMs,
				dispose: 2,
			});
		}

		encoder.finish();
		const gifBytes = encoder.bytes();
		decoder.close();

		return new File([new Blob([gifBytes])], "image.gif", { type: "image/gif" });
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
						<p class="mb-2 text-xs text-zinc-500">Drag to reposition. Scroll to resize.</p>
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<div
							class="relative mx-auto overflow-hidden rounded-lg bg-zinc-950 select-none"
							style="width: {displayW}px; height: {displayH}px;"
							bind:this={containerEl}
							role="application"
							tabindex="-1"
							onmousedown={handleMouseDown}
							onmousemove={handleMouseMove}
							onmouseup={handleMouseUp}
							onmouseleave={handleMouseUp}
							onwheel={handleWheel}
						>
							<img
								bind:this={imgEl}
								src={imgSrc}
								alt="Preview"
								class="block"
								style="width: {displayW}px; height: {displayH}px;"
								onload={onImageLoad}
								draggable="false"
							/>
							<div class="pointer-events-none absolute inset-0 bg-black/60"></div>
							<div
								class="pointer-events-none absolute border-2 border-white/40 {round ? 'rounded-full' : 'rounded-md'}"
								style="
									left: {cropX * scale}px;
									top: {cropY * scale}px;
									width: {cropW * scale}px;
									height: {cropH * scale}px;
									background: url('{imgSrc}') no-repeat;
									background-size: {displayW}px {displayH}px;
									background-position: -{cropX * scale}px -{cropY * scale}px;
								"
							></div>
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
