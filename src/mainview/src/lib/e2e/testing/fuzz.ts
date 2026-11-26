// Seeded inputs for the fuzz tests (PLAN-E2E-CLIENTES.md, «Lo que el paso 5 revisa»): a PRNG of its own, and bytes,
// text, JSON, base64 and CBOR as another device or the server could write them, valid and mutated. Bun's fuzz test
// reads it too (src/bun/e2e/fuzz.test.ts), hence no $lib.

/** How many inputs each reader takes: DUVET_FUZZ_RUNS for a long run, else what CI runs. */
export const runs = (ci: number) => Number(process.env.DUVET_FUZZ_RUNS) || ci;
/** The seed of every generator: DUVET_FUZZ_SEED for another run, else CI's. */
export const SEED = Number(process.env.DUVET_FUZZ_SEED) || 0x5eed;
/** The most one input may take a reader, in ms: every reader here is linear in what it reads. */
export const BUDGET_MS = 250;

/**
 * What `read` answers, failing past the budget, with the input it took (`input`, made only then). An input past it is
 * read once more: a loaded machine's pause comes once, and a reader slow on an input is slow each time it reads it.
 */
export function timed<T>(read: () => T, input: () => unknown): T {
	const once = (): [T, number] => {
		const started = performance.now();
		const answer = read();
		return [answer, performance.now() - started];
	};
	let [answer, took] = once();
	if (took > BUDGET_MS) [answer, took] = once();
	if (took > BUDGET_MS) throw new Error(`took ${took.toFixed(0)} ms on ${JSON.stringify(input()).slice(0, 300)}`);
	return answer;
}

/** mulberry32: small, fast, and the same sequence for the same seed everywhere. */
export class Random {
	#state: number;
	constructor(seed: number) {
		this.#state = seed | 0;
	}
	u32(): number {
		this.#state = (this.#state + 0x6d2b79f5) | 0;
		let t = Math.imul(this.#state ^ (this.#state >>> 15), 1 | this.#state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return (t ^ (t >>> 14)) >>> 0;
	}
	/** An integer in [0, below). */
	int(below: number): number {
		return Math.floor((this.u32() / 2 ** 32) * below);
	}
	chance(p = 0.5): boolean {
		return this.u32() / 2 ** 32 < p;
	}
	pick<T>(items: readonly T[]): T {
		return items[this.int(items.length)]!;
	}
	/** A length up to a little past `most`: mostly small, at times at an edge of it. */
	size(most: number): number {
		if (this.chance(0.15)) return this.pick([0, 1, 2, most - 1, most, most + 1].filter((n) => n >= 0));
		return this.chance(0.7) ? this.int(Math.min(most, 32) + 1) : this.int(most + 2);
	}
	bytes(length: number): Uint8Array {
		const bytes = new Uint8Array(length);
		for (let i = 0; i < length; i++) bytes[i] = this.u32() & 0xff;
		return bytes;
	}
	/** A UUID's text, lowercase, as the API writes one. */
	uuid(): string {
		const hex = Array.from(this.bytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("");
		return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
	}
}

const span = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
/** Code points by kind: what names, frames and JSON hold, the hidden ones above all, and their neighbours. */
export const CODE_POINTS: Record<string, readonly number[]> = {
	ascii: span(0x20, 0x7e),
	controls: [...span(0, 0x1f), ...span(0x7f, 0x9f)],
	separators: [0x2f, 0x5c],
	dots: [0x2e, 0x20],
	spaces: [0xa0, 0x1680, ...span(0x2000, 0x200a), 0x202f, 0x205f, 0x3000],
	lines: [0x2028, 0x2029, 0x0a, 0x0d],
	// Every format character, as Unicode 16 has them.
	format: [
		...[0xad, ...span(0x600, 0x605), 0x61c, 0x6dd, 0x70f, 0x890, 0x891, 0x8e2, 0x180e, ...span(0x200b, 0x200f)],
		...[...span(0x202a, 0x202e), ...span(0x2060, 0x2064), ...span(0x2066, 0x206f), 0xfeff, ...span(0xfff9, 0xfffb)],
		...[0x110bd, 0x110cd, ...span(0x13430, 0x1343f), ...span(0x1bca0, 0x1bca3), ...span(0x1d173, 0x1d17a)],
		...[0xe0001, ...span(0xe0020, 0xe007f)],
	],
	joiner: [0x200d],
	surrogates: [0xd800, 0xdb40, 0xdbff, 0xdc00, 0xdc01, 0xdfff],
	emoji: [...span(0x1f600, 0x1f64f), 0x2764, 0xfe0f, 0x1f3fb],
	marks: span(0x300, 0x36f),
	letters: [...span(0x5d0, 0x5ea), ...span(0x627, 0x64a), ...span(0x430, 0x44f), ...span(0x4e00, 0x4e3f)],
	odd: [0xfffd, 0xfffe, 0xffff, 0x10ffff, 0x1fffe],
};
const KINDS = Object.keys(CODE_POINTS);

/** One code point's text, a surrogate's as a lone half. */
const charOf = (code: number) =>
	code >= 0xd800 && code <= 0xdfff ? String.fromCharCode(code) : String.fromCodePoint(code);

/** Text of up to a little past `most` code points, of a few kinds at once, at times of any code point. */
export function text(rng: Random, most = 24): string {
	const kinds = Array.from({ length: 1 + rng.int(3) }, () => rng.pick(KINDS));
	let out = "";
	for (let n = rng.size(most); n > 0; n--) {
		out += charOf(rng.chance(0.1) ? rng.int(0x110000) : rng.pick(CODE_POINTS[rng.pick(kinds)]!));
	}
	return out;
}

/** Standard base64, padded, as the core and the API write it. */
export function base64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

/** The bytes `atob` reads in base64, or null where it throws. */
export function unbase64(value: string): Uint8Array | null {
	try {
		return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
	} catch {
		return null;
	}
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * The bytes' base64 as one writer or another could put it: canonical, or without its padding, with a space or a line
 * break in it, in the URL's alphabet, with stray bits in its last character, with its padding escaped, cut, or padded
 * once too many.
 */
export function base64As(rng: Random, bytes: Uint8Array): string {
	const canonical = base64(bytes);
	const padding = canonical.length - canonical.replace(/=+$/, "").length;
	switch (rng.int(10)) {
		case 0:
			return canonical.replace(/=+$/, "");
		case 1: {
			const at = rng.int(canonical.length + 1);
			return canonical.slice(0, at) + rng.pick([" ", "\n", "\r\n", "\t"]) + canonical.slice(at);
		}
		case 2:
			return canonical.replace(/.{76}/g, "$&\n");
		case 3:
			return canonical.replaceAll("+", "-").replaceAll("/", "_");
		case 4: {
			if (!padding) return canonical;
			// The last character's bits past the bytes, which a canonical writer leaves at zero.
			const at = canonical.length - padding - 1;
			const stray = padding === 2 ? 1 + rng.int(15) : 1 + rng.int(3);
			return canonical.slice(0, at) + ALPHABET[(ALPHABET.indexOf(canonical[at]!) | stray) & 63] + "=".repeat(padding);
		}
		case 5:
			return canonical.replaceAll("=", "%3D");
		case 6:
			return canonical.slice(0, Math.max(0, canonical.length - 1 - rng.int(3)));
		case 7:
			return `${canonical}=`;
		default:
			return canonical;
	}
}

const INTERESTING = [0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff, 0x18, 0x19, 0x1a, 0x1b, 0x1f, 0x3b, 0x5b, 0x7b, 0x9b, 0xbb];

/** The bytes changed a few times over: bits flipped, bytes set, put in, taken out, repeated, cut, or another's spliced. */
export function mutate(rng: Random, input: Uint8Array, others: readonly Uint8Array[] = []): Uint8Array {
	let bytes = Array.from(input);
	for (let rounds = 1 + rng.int(4); rounds > 0; rounds--) {
		const at = rng.int(bytes.length + 1);
		switch (rng.int(9)) {
			case 0:
				if (at < bytes.length) bytes[at]! ^= 1 << rng.int(8);
				break;
			case 1:
				if (at < bytes.length) bytes[at] = rng.pick(INTERESTING);
				break;
			case 2:
				bytes.splice(at, 0, ...rng.bytes(1 + rng.int(8)));
				break;
			case 3:
				bytes.splice(at, 1 + rng.int(8));
				break;
			case 4:
				bytes.splice(at, 0, ...bytes.slice(at, at + 1 + rng.int(16)));
				break;
			case 5:
				bytes = bytes.slice(0, at);
				break;
			case 6:
				bytes.push(...rng.bytes(1 + rng.int(16)));
				break;
			case 7: {
				if (!others.length) break;
				const other = rng.pick(others);
				const from = rng.int(other.length + 1);
				bytes.splice(at, rng.int(8), ...other.subarray(from, from + 1 + rng.int(32)));
				break;
			}
			default:
				// A length that lies: big-endian bytes in place, as CBOR, EBML and image headers hold their counts.
				for (let i = 0; i < 1 + rng.int(8) && at + i < bytes.length; i++) {
					bytes[at + i] = rng.chance() ? 0xff : rng.u32() & 0xff;
				}
		}
	}
	return Uint8Array.from(bytes);
}

/** Text changed a few times over, by UTF-16 unit: text put in, taken out, repeated, or the rest cut. */
export function mutateText(rng: Random, input: string): string {
	let out = input;
	for (let rounds = 1 + rng.int(3); rounds > 0; rounds--) {
		const at = rng.int(out.length + 1);
		const cut = [0, 1 + rng.int(4), 1 + rng.int(8)];
		switch (rng.int(4)) {
			case 0:
				out = out.slice(0, at) + text(rng, 4) + out.slice(at);
				break;
			case 1:
				out = out.slice(0, at) + out.slice(at + cut[1]!);
				break;
			case 2:
				out = out.slice(0, at) + out.slice(at, at + cut[2]!) + out.slice(at);
				break;
			default:
				out = out.slice(0, at);
		}
	}
	return out;
}

const KEYS = [
	"duvet",
	"step",
	"data",
	"name",
	"id",
	"type",
	"seq",
	"entry",
	"",
	"__proto__",
	"constructor",
	"toString",
];
const NUMBERS = [0, -0, 1, -1, 0.5, 2 ** 31, 2 ** 32, 2 ** 53 - 1, 2 ** 53 + 2, -(2 ** 53), 1e300, 65_535, 86_400_000];

/** A JSON value of any kind, nested up to `depth`: numbers at their edges, text of every kind, keys that trip readers. */
export function json(rng: Random, depth = 3): unknown {
	switch (rng.int(depth > 0 ? 8 : 6)) {
		case 0:
			return null;
		case 1:
			return rng.chance();
		case 2:
			return rng.pick(NUMBERS);
		case 3:
			return rng.int(1000);
		case 4:
		case 5:
			return text(rng);
		case 6:
			return Array.from({ length: rng.int(4) }, () => json(rng, depth - 1));
		default: {
			const entries = Array.from({ length: rng.int(5) }, () => [
				rng.chance(0.7) ? rng.pick(KEYS) : text(rng, 6),
				json(rng, depth - 1),
			]);
			return Object.fromEntries(entries);
		}
	}
}

/** A CBOR value as the readers give it. */
export type CborValue = number | string | boolean | null | Uint8Array | CborValue[] | Map<string, CborValue>;

/** A value's CBOR as the core writes it: definite lengths, each head at its shortest, or wider where `wide` says. */
export function cborBytes(value: CborValue, wide?: Random): Uint8Array {
	const out: number[] = [];
	const head = (major: number, n: number) => {
		const shortest = n < 24 ? 0 : n < 0x100 ? 1 : n < 0x10000 ? 2 : n < 2 ** 32 ? 4 : 8;
		const width = wide?.chance(0.2) ? wide.pick([1, 2, 4, 8].filter((w) => w >= shortest)) : shortest;
		if (width === 0) {
			out.push((major << 5) | n);
			return;
		}
		out.push((major << 5) | (24 + Math.log2(width)));
		for (let i = width - 1; i >= 0; i--) out.push(Math.floor(n / 256 ** i) % 256);
	};
	const write = (v: CborValue): void => {
		if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
		if (typeof v === "boolean" || v === null) {
			out.push(v === null ? 0xf6 : v ? 0xf5 : 0xf4);
		} else if (typeof v === "string") {
			const bytes = new TextEncoder().encode(v);
			head(3, bytes.length);
			out.push(...bytes);
		} else if (v instanceof Uint8Array) {
			head(2, v.length);
			out.push(...v);
		} else if (Array.isArray(v)) {
			head(4, v.length);
			for (const item of v) write(item);
		} else {
			head(5, v.size);
			for (const [key, item] of v) {
				write(key);
				write(item);
			}
		}
	};
	write(value);
	return Uint8Array.from(out);
}

const CBOR_KEYS = ["body", "sig", "device", "devices", "version", "v", "user"];

/** A CBOR value the core could write, nested up to `depth`: whole numbers JS holds exactly, text, bytes, lists, maps. */
export function cborValue(rng: Random, depth = 3): CborValue {
	switch (rng.int(depth > 0 ? 9 : 7)) {
		case 0:
			return rng.pick([0, 23, 24, 255, 256, 65_535, 65_536, 2 ** 32 - 1, 2 ** 32, 2 ** 53 - 1]);
		case 1:
			return -1 - rng.pick([0, 23, 24, 255, 256, 65_535, 2 ** 32, 2 ** 53 - 2]);
		case 2:
			return rng.chance();
		case 3:
			return null;
		case 4:
			return text(rng, 8).toWellFormed();
		case 5:
		case 6:
			return rng.bytes(rng.pick([0, 1, 16, 23, 24, 32, 64]));
		case 7:
			return Array.from({ length: rng.int(4) }, () => cborValue(rng, depth - 1));
		default: {
			const map = new Map<string, CborValue>();
			for (let n = rng.int(4); n > 0; n--) {
				map.set(rng.chance() ? rng.pick(CBOR_KEYS) : text(rng, 6).toWellFormed(), cborValue(rng, depth - 1));
			}
			return map;
		}
	}
}

/** How deep a value's lists and maps go: 1 for one holding no other, 0 for anything else. */
export function cborDepth(value: CborValue): number {
	if (Array.isArray(value)) return 1 + Math.max(0, ...value.map(cborDepth));
	if (value instanceof Map) return 1 + Math.max(0, ...[...value.values()].map(cborDepth));
	return 0;
}

/** Every length a value holds: its texts' in UTF-8, its bytes', its lists' and its maps'. */
export function cborLengths(value: CborValue): number[] {
	if (typeof value === "string") return [new TextEncoder().encode(value).length];
	if (value instanceof Uint8Array) return [value.length];
	if (Array.isArray(value)) return [value.length, ...value.flatMap(cborLengths)];
	if (value instanceof Map) return [value.size, ...[...value.values()].flatMap(cborLengths)];
	return [];
}

/**
 * What a fuzz run keeps for the corpus: every hand-picked input, and of each reader the first generated input of each
 * kind of answer and input (its signature), `most` of them at most.
 */
export class Kept {
	readonly cases: Record<string, unknown[]> = {};
	readonly #seen = new Map<string, Set<string>>();
	readonly #found = new Map<string, number>();
	constructor(readonly most = 40) {}
	keep(reader: string, signature: string, item: unknown, picked = false) {
		const seen = this.#seen.get(reader) ?? new Set<string>();
		this.#seen.set(reader, seen);
		if (!picked) {
			const found = this.#found.get(reader) ?? 0;
			if (seen.has(signature) || found >= this.most) return;
			this.#found.set(reader, found + 1);
		}
		seen.add(signature);
		(this.cases[reader] ??= []).push(item);
	}
}
