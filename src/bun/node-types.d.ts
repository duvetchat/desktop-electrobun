// What the type check of src/bun needs said about packages it doesn't own (tsconfig.json beside this).

// @types/node here is 17 (png-to-ico asks for it, and bun-types takes whichever is installed). Its Buffer was written
// before TypeScript's typed arrays took a buffer type, so TypeScript 5.9 no longer reads a Buffer as the Uint8Array it
// is, and bun:ffi and Bun.write refuse one. These are a Uint8Array's own signatures for the members that differ; a
// newer @types/node declares them itself, and then this block can go.
interface Buffer {
	slice(start?: number, end?: number): Buffer & Uint8Array<ArrayBuffer>;
	entries(): ArrayIterator<[number, number]>;
	keys(): ArrayIterator<number>;
	values(): ArrayIterator<number>;
}

// Electrobun's Bun entry imports three for its WebGPU helpers, which the app doesn't use; three has no types here.
declare module "three";
