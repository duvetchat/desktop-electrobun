import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
	// at() reads its group as possibly missing whatever the tsconfig: oxlint types this file outside src/'s.
	const base64 = found.length === 1 ? found.at(0)?.at(1) : undefined;
	if (base64 === undefined) {
		throw new Error(`@shiguredo/rnnoise-wasm: expected one inline WebAssembly module, found ${found.length}`);
	}
	return base64;
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
 * Serves "virtual:rnnoise-wasm" as the URL of RNNoise's WebAssembly, read out of the package and written to a file of
 * its own in Vite's cache folder, which Vite serves in development and emits as an asset in a build
 * (_app/immutable/assets, which the packaged app copies with _app). The noise-suppression worklet can't fetch it, and
 * compiling it there would hold up the audio thread, so the main thread fetches and compiles it and hands the module
 * over; the package's own loader compiles and instantiates in one step and gives the module to nobody. As a base64
 * string in its chunk, its 4.8 MB stayed in memory from the first call on (#330).
 */
export function rnnoiseWasm(): Plugin {
	let cacheDir = "";
	return {
		name: "rnnoise-wasm",
		configResolved(config) {
			cacheDir = config.cacheDir;
		},
		resolveId: (source) => (source === ID ? RESOLVED : undefined),
		async load(id) {
			if (id !== RESOLVED) return;
			const { bundle, code } = await writeRnnoiseWasm(cacheDir);
			this.addWatchFile(bundle);
			return code;
		},
	};
}

/** Writes the WebAssembly to a file of its own in a folder (Vite's cache), and gives the virtual module that's its URL,
 * with the package's bundle it came from, for Vite to watch. */
export async function writeRnnoiseWasm(dir: string): Promise<{ bundle: string; code: string }> {
	const { file, base64 } = await readRnnoiseWasm();
	const wasm = join(dir, "rnnoise.wasm");
	await mkdir(dir, { recursive: true });
	await writeFile(wasm, new Uint8Array(Buffer.from(base64, "base64")));
	return { bundle: file, code: `export { default } from ${JSON.stringify(wasm.replaceAll("\\", "/") + "?url")};` };
}
