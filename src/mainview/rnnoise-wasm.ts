import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

// The module an `import ... from "virtual:rnnoise-wasm"` gets (src/lib/audio/rnnoise-wasm.d.ts types it).
const ID = "virtual:rnnoise-wasm";
const RESOLVED = "\0" + ID;

/**
 * The WebAssembly that @shiguredo/rnnoise-wasm's bundle carries inline, base64-encoded: the only form the package
 * ships it in. Throws unless the bundle has exactly one such literal, so a release that ships it otherwise fails
 * the build instead of the voice.
 */
export function rnnoiseWasmBase64(bundle: string): string {
	// "AGFzbQ" is the base64 of WebAssembly's magic number, "\0asm".
	const found = [...bundle.matchAll(/"(AGFzbQ[A-Za-z0-9+/]*={0,2})"/g)];
	if (found.length !== 1) {
		throw new Error(`@shiguredo/rnnoise-wasm: expected one inline WebAssembly module, found ${found.length}`);
	}
	return found[0][1];
}

/** The package's bundle on disk, and the WebAssembly in it. */
export async function readRnnoiseWasm(): Promise<{ file: string; base64: string }> {
	// Node's own resolution: Vite's would leave the package external in the server build. The await is for the
	// installed @types/node (17), which types import.meta.resolve as it was then; Node and Bun return a string.
	const url = await import.meta.resolve?.("@shiguredo/rnnoise-wasm");
	if (!url) throw new Error("import.meta.resolve is missing: Node 20.6 or later is needed");
	const file = fileURLToPath(url);
	return { file, base64: rnnoiseWasmBase64(await readFile(file, "utf8")) };
}

/**
 * Serves "virtual:rnnoise-wasm", RNNoise's WebAssembly as a base64 string read out of the package at build time.
 * The noise-suppression worklet can't fetch or compile code, so the main thread compiles this and hands the module
 * over; the package's own loader compiles and instantiates in one step and gives the module to nobody.
 */
export function rnnoiseWasm(): Plugin {
	return {
		name: "rnnoise-wasm",
		resolveId: (source) => (source === ID ? RESOLVED : undefined),
		async load(id) {
			if (id !== RESOLVED) return;
			const { file, base64 } = await readRnnoiseWasm();
			this.addWatchFile(file);
			return `export default ${JSON.stringify(base64)};`;
		},
	};
}
