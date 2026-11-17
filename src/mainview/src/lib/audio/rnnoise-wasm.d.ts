/** The URL of RNNoise's WebAssembly, a file of its own: the rnnoise-wasm Vite plugin (rnnoise-wasm.ts) reads it out of
 * the package and writes it. */
declare module "virtual:rnnoise-wasm" {
	const url: string;
	export default url;
}
