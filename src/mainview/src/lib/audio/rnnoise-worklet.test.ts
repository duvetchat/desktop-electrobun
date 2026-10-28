import { beforeAll, describe, expect, it } from "bun:test";
import { Rnnoise } from "@shiguredo/rnnoise-wasm";
import { readRnnoiseWasm, rnnoiseWasmBase64 } from "../../../rnnoise-wasm";

type Frames = { frame: Float32Array; filled: number; ready: Float32Array; queued: number };
type Processor = {
	port: { onmessage: ((event: { data: unknown }) => void) | null; posted: unknown[] };
	process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};
interface Worklet {
	frameDelay(frameSize: number, quantumSize: number): number;
	createFrames(frameSize: number, delay: number): Frames;
	passFrames(frames: Frames, input: Float32Array, output: Float32Array, processFrame: (f: Float32Array) => void): void;
	Processor: new (options: { processorOptions: { module: WebAssembly.Module } }) => Processor;
}

let loads = 0;

/**
 * Loads the worklet module, a fresh instance of it each call. It runs in AudioWorkletGlobalScope, whose two globals
 * it needs at load are stood in for while it loads; it isn't type-checked (the DOM lib has neither), hence the
 * specifier TypeScript can't follow.
 */
async function loadWorklet(): Promise<Worklet> {
	let Processor: Worklet["Processor"] | undefined;
	class AudioWorkletProcessor {
		port = {
			onmessage: null,
			posted: [] as unknown[],
			postMessage(message: unknown) {
				this.posted.push(message);
			},
		};
	}
	Object.assign(globalThis, {
		AudioWorkletProcessor,
		registerProcessor: (_name: string, processor: Worklet["Processor"]) => (Processor = processor),
	});
	try {
		const worklet = await import(`../../../static/rnnoise-worklet-processor.js?instance=${++loads}`);
		if (!Processor) throw new Error("the worklet registered no processor");
		return { ...worklet, Processor };
	} finally {
		Reflect.deleteProperty(globalThis, "AudioWorkletProcessor");
		Reflect.deleteProperty(globalThis, "registerProcessor");
	}
}

const worklet = await loadWorklet();

const FRAME = 480;
const QUANTUM = 128;

/** A signal no two samples of which are alike, so a sample out of place or a silent gap can't go unnoticed. */
const ramp = (length: number) => Float32Array.from({ length }, (_, i) => i + 1);

/** Passes `input` through the frames `quantum` samples at a time, as the audio thread does. */
function passAll(input: Float32Array, quantum: number, delay: number, processFrame: (f: Float32Array) => void) {
	const frames = worklet.createFrames(FRAME, delay);
	const output = new Float32Array(input.length);
	for (let at = 0; at < input.length; at += quantum) {
		const end = Math.min(at + quantum, input.length);
		worklet.passFrames(frames, input.subarray(at, end), output.subarray(at, end), processFrame);
	}
	return output;
}

/** Where `output` first differs from `input` processed by `f` and delayed by `delay` samples; -1 if nowhere. */
function firstMismatch(input: Float32Array, output: Float32Array, delay: number, f: (x: number) => number) {
	for (let i = 0; i < output.length; i++) {
		const expected = i < delay ? 0 : f(input[i - delay]);
		if (output[i] !== expected) return i;
	}
	return -1;
}

const negate = (frame: Float32Array) => {
	for (let i = 0; i < frame.length; i++) frame[i] = -frame[i];
};

describe("128-sample quanta meeting 480-sample frames", () => {
	it("delays the output 448 samples (9.3 ms at 48 kHz)", () => {
		expect(worklet.frameDelay(FRAME, QUANTUM)).toBe(448);
		expect(worklet.frameDelay(FRAME, FRAME)).toBe(0);
	});

	it("puts out every processed sample 448 behind, from the first quantum on, never a gap", () => {
		const input = ramp(40 * FRAME);
		const output = passAll(input, QUANTUM, 448, negate);
		expect(firstMismatch(input, output, 448, (x) => -x)).toBe(-1);
	});

	it("hands RNNoise each frame once, whole and in order", () => {
		const input = ramp(10 * FRAME);
		const seen: number[][] = [];
		passAll(input, QUANTUM, 448, (frame) => seen.push(Array.from(frame)));
		expect(seen).toEqual(Array.from({ length: 10 }, (_, k) => Array.from(input.subarray(k * FRAME, (k + 1) * FRAME))));
	});

	it("needs all 448: one sample less and a quantum asks for a frame that hasn't filled", () => {
		const input = ramp(40 * FRAME);
		const output = passAll(input, QUANTUM, 447, negate);
		expect(firstMismatch(input, output, 447, (x) => -x)).toBeGreaterThan(-1);
	});

	it("keeps up gapless at its delay with other quantum sizes too, without outgrowing its buffer", () => {
		for (const quantum of [1, 64, 100, 127, 129, 256, 441, 480, 512, 1000, 1024]) {
			const delay = worklet.frameDelay(FRAME, quantum);
			// Every way a quantum can fall across the frames comes round within lcm(480, quantum) samples.
			const period = (FRAME / (FRAME - delay)) * quantum;
			const input = ramp(period + 2 * FRAME);
			const output = passAll(input, quantum, delay, negate);
			expect({ quantum, mismatch: firstMismatch(input, output, delay, (x) => -x) }).toEqual({ quantum, mismatch: -1 });
		}
	});
});

describe("the worklet's processor, running RNNoise", () => {
	let module: WebAssembly.Module;
	let rnnoise: Rnnoise;

	beforeAll(async () => {
		// The WebAssembly the app's build takes out of the package (vite.config.ts's rnnoise-wasm plugin).
		module = await WebAssembly.compile(Buffer.from((await readRnnoiseWasm()).base64, "base64"));
		// The package's loader refuses to run anywhere but a window or a worker: let Bun pass for a window meanwhile.
		Object.assign(globalThis, { window: globalThis });
		try {
			rnnoise = await Rnnoise.load();
		} finally {
			Reflect.deleteProperty(globalThis, "window");
		}
	});

	it("gives RNNoise's WebAssembly exactly the imports it asks for", () => {
		expect(WebAssembly.Module.imports(module)).toEqual([
			{ module: "env", name: "__assert_fail", kind: "function" },
			{ module: "env", name: "emscripten_resize_heap", kind: "function" },
			{ module: "wasi_snapshot_preview1", name: "fd_write", kind: "function" },
		]);
	});

	it("puts out what the package's own RNNoise made of each frame, 448 samples later", () => {
		const processor = new worklet.Processor({ processorOptions: { module } });
		expect(processor.port.posted).toEqual([{ type: "ready" }]);

		// Half a second of tone, then half a second of it under noise, for 3 seconds.
		let seed = 1;
		const noise = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32 - 0.5;
		const input = Float32Array.from({ length: 3 * 48000 }, (_, i) => {
			const tone = 0.3 * Math.sin((2 * Math.PI * 220 * i) / 48000);
			return i % 48000 < 24000 ? tone : tone + 0.2 * noise();
		});
		const output = new Float32Array(input.length);
		for (let at = 0; at < input.length; at += QUANTUM) {
			const out = output.subarray(at, at + QUANTUM);
			expect(processor.process([[input.subarray(at, at + QUANTUM)]], [[out]])).toBe(true);
		}

		// What the main thread used to do with each frame, through the package's own wrapper.
		const state = rnnoise.createDenoiseState();
		const expected = new Float32Array(input.length);
		for (let k = 0; 448 + k * FRAME < input.length; k++) {
			const frame = input.slice(k * FRAME, (k + 1) * FRAME);
			for (let i = 0; i < FRAME; i++) frame[i] *= 32768;
			state.processFrame(frame);
			for (let i = 0; i < FRAME; i++) frame[i] /= 32768;
			const at = 448 + k * FRAME;
			expected.set(frame.subarray(0, input.length - at), at);
		}
		state.destroy();

		expect(expected.some((x) => x !== 0)).toBe(true);
		expect(firstMismatch(expected, output, 0, (x) => x)).toBe(-1);
	});

	it("leaves the output alone (silent) for a quantum that brings no input, and keeps going", () => {
		const processor = new worklet.Processor({ processorOptions: { module } });
		const output = new Float32Array(QUANTUM).fill(1);
		expect(processor.process([[]], [[output]])).toBe(true);
		expect(output.every((x) => x === 1)).toBe(true);
	});

	it("lets the node go once destroyed", () => {
		const processor = new worklet.Processor({ processorOptions: { module } });
		processor.port.onmessage?.({ data: { type: "destroy" } });
		expect(processor.process([[new Float32Array(QUANTUM)]], [[new Float32Array(QUANTUM)]])).toBe(false);
	});

	it("says it failed when the module isn't RNNoise's, and processes nothing", async () => {
		const fresh = await loadWorklet();
		const empty = await WebAssembly.compile(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
		const processor = new fresh.Processor({ processorOptions: { module: empty } });
		expect(processor.port.posted).toEqual([{ type: "failed", message: expect.any(String) }]);
		expect(processor.process([[new Float32Array(QUANTUM)]], [[new Float32Array(QUANTUM)]])).toBe(false);
	});
});

describe("reading RNNoise's WebAssembly out of the package", () => {
	it("takes the one inline module, and fails the build on none or two", () => {
		expect(rnnoiseWasmBase64(`x = FA("AGFzbQEAAAA=");`)).toBe("AGFzbQEAAAA=");
		expect(() => rnnoiseWasmBase64(`x = 1;`)).toThrow();
		expect(() => rnnoiseWasmBase64(`a("AGFzbQEAAAA="); b("AGFzbQEAAAA=");`)).toThrow();
	});
});
