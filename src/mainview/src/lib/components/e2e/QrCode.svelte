<script lang="ts">
	import qrcodeGenerator from "qrcode-generator";

	// A QR code of `text` (Ruling 21: qrcode-generator, MIT, no dependencies): a new device's, the core's `qr` as its
	// text, which Android scans. Its dark modules are the black behind one path of white rows (the light modules and the
	// four of quiet zone the standard asks for), so it reads as dark on light in either theme.
	let { text, label }: { text: string; label: string } = $props();

	const QUIET = 4;

	const drawn = $derived.by(() => {
		const code = qrcodeGenerator(0, "M");
		code.addData(text);
		code.make();
		const size = code.getModuleCount();
		const side = size + 2 * QUIET;
		const light = (x: number, y: number) => {
			const [row, col] = [y - QUIET, x - QUIET];
			return row < 0 || col < 0 || row >= size || col >= size || !code.isDark(row, col);
		};
		let path = "";
		for (let y = 0; y < side; y++) {
			for (let x = 0; x < side; ) {
				if (!light(x, y)) {
					x++;
					continue;
				}
				let run = 1;
				while (x + run < side && light(x + run, y)) run++;
				path += `M${x} ${y}h${run}v1h-${run}z`;
				x += run;
			}
		}
		return { side, path };
	});
</script>

<svg
	role="img"
	aria-label={label}
	viewBox="0 0 {drawn.side} {drawn.side}"
	shape-rendering="crispEdges"
	class="size-48 shrink-0 rounded-lg bg-black"
>
	<path class="fill-fixed-white" d={drawn.path} />
</svg>
