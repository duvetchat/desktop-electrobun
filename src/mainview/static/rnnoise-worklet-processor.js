/**
 * AudioWorkletProcessor that runs RNNoise on the microphone in the audio thread itself, so no frame waits on
 * the main thread: before, the frames went there and back, and one that came back late went out as silence.
 *
 * This scope can neither fetch nor compile code, so the main thread compiles RNNoise's WebAssembly
 * (lib/audio/noise-suppression.ts) and hands the module over in processorOptions.module. Every processor of an
 * AudioContext shares one instance of it, each with an RNNoise state of its own.
 *
 * Messages: the processor answers { type: "ready" } once RNNoise runs, or { type: "failed", message }; it takes
 * { type: "destroy" }, which frees its state and lets the node go.
 */

/** Web Audio hands a processor its samples 128 at a time. */
const QUANTUM_SIZE = 128;

/** RNNoise takes 16-bit samples as floats: -32768 to 32767 where Web Audio has -1 to 1. */
const PCM_SCALE = 32768;

/**
 * How far the output trails the input, in samples, when quanta of `quantumSize` samples meet frames of
 * `frameSize`: the least delay at which no quantum asks for a sample whose frame hasn't filled yet, so the
 * output never runs dry. 448 samples (9.3 ms at 48 kHz) for 480-sample frames and 128-sample quanta.
 * @param {number} frameSize
 * @param {number} quantumSize
 */
export function frameDelay(frameSize, quantumSize) {
	let a = frameSize;
	let b = quantumSize;
	while (b) [a, b] = [b, a % b];
	return frameSize - a;
}

/**
 * The state of a stream cut into frames: `frame` gathers the input until it's full, and `ready` holds the
 * processed samples that haven't gone out yet, starting with `delay` samples of silence. `ready` has room for the
 * delay and two frames, more than it ever holds whatever the quanta: the delay and a frame at most, or two frames
 * less a sample once quanta it doesn't fit have run it dry.
 * @param {number} frameSize
 * @param {number} delay
 */
export function createFrames(frameSize, delay) {
	return {
		frame: new Float32Array(frameSize),
		filled: 0,
		ready: new Float32Array(delay + 2 * frameSize),
		queued: delay,
	};
}

/**
 * Passes one quantum through: its samples go into frames, `processFrame` processes each frame in place as soon
 * as it's full, and `output` gets the processed samples, as many as `input` brought, `delay` samples behind
 * them. What the frames can't cover yet goes out as silence, which a delay from frameDelay never leaves.
 * Allocates nothing, as it runs on the audio thread.
 * @param {ReturnType<typeof createFrames>} frames
 * @param {Float32Array} input
 * @param {Float32Array} output
 * @param {(frame: Float32Array) => void} processFrame
 */
export function passFrames(frames, input, output, processFrame) {
	const { frame, ready } = frames;
	for (let done = 0; done < input.length; ) {
		const take = Math.min(input.length - done, frame.length - frames.filled);
		frame.set(input.subarray(done, done + take), frames.filled);
		frames.filled += take;
		if (frames.filled === frame.length) {
			processFrame(frame);
			ready.set(frame, frames.queued);
			frames.queued += frame.length;
			frames.filled = 0;
		}
		const out = Math.min(take, frames.queued);
		output.set(ready.subarray(0, out), done);
		output.fill(0, done + out, done + take);
		ready.copyWithin(0, out, frames.queued);
		frames.queued -= out;
		done += take;
	}
}

/**
 * Instantiates RNNoise's module with the imports its Emscripten build asks for, and starts its runtime as the
 * package's own loader does.
 * @param {WebAssembly.Module} module
 */
export function instantiateRnnoise(module) {
	/** @type {any} */
	let exports;
	const text = (/** @type {number} */ at) => {
		const bytes = new Uint8Array(exports.memory.buffer);
		let s = "";
		for (let i = at; bytes[i]; i++) s += String.fromCharCode(bytes[i]);
		return s;
	};
	const imports = {
		env: {
			__assert_fail: (
				/** @type {number} */ condition,
				/** @type {number} */ file,
				/** @type {number} */ line,
				/** @type {number} */ fn,
			) => {
				throw new Error(`RNNoise assertion failed: ${text(condition)} (${text(file)}:${line}, ${text(fn)})`);
			},
			emscripten_resize_heap: (/** @type {number} */ size) => {
				const memory = exports.memory;
				try {
					memory.grow(Math.max(0, Math.ceil(((size >>> 0) - memory.buffer.byteLength) / 65536)));
					return 1;
				} catch {
					return 0;
				}
			},
		},
		wasi_snapshot_preview1: {
			fd_write: (
				/** @type {number} */ fd,
				/** @type {number} */ iov,
				/** @type {number} */ iovcnt,
				/** @type {number} */ pnum,
			) => {
				const words = new Uint32Array(exports.memory.buffer);
				const bytes = new Uint8Array(exports.memory.buffer);
				let written = 0;
				let s = "";
				for (let i = 0; i < iovcnt; i++) {
					const at = words[(iov >> 2) + 2 * i];
					const length = words[(iov >> 2) + 2 * i + 1];
					for (let j = 0; j < length; j++) s += String.fromCharCode(bytes[at + j]);
					written += length;
				}
				words[pnum >> 2] = written;
				if (fd === 2) console.error("[RNNoise]", s);
				else console.log("[RNNoise]", s);
				return 0;
			},
		},
	};
	exports = new WebAssembly.Instance(module, imports).exports;
	exports.emscripten_stack_init();
	exports.__wasm_call_ctors();
	return exports;
}

/**
 * An RNNoise state in `rnnoise`'s memory, with the two frame buffers it reads from and writes to.
 * @param {any} rnnoise the exports of instantiateRnnoise
 */
export function createDenoiser(rnnoise) {
	const frameSize = rnnoise.rnnoise_get_frame_size();
	const state = rnnoise.rnnoise_create(0);
	const input = rnnoise.malloc(frameSize * 4);
	const output = rnnoise.malloc(frameSize * 4);
	const destroy = () => {
		if (state) rnnoise.rnnoise_destroy(state);
		if (input) rnnoise.free(input);
		if (output) rnnoise.free(output);
	};
	if (!state || !input || !output) {
		destroy();
		throw new Error("RNNoise couldn't allocate its state");
	}
	let heap = new Float32Array(rnnoise.memory.buffer);
	return {
		frameSize,
		destroy,
		/** Denoises a frame of `frameSize` samples in place. @param {Float32Array} frame */
		denoise(frame) {
			if (heap.buffer !== rnnoise.memory.buffer) heap = new Float32Array(rnnoise.memory.buffer);
			const from = input >> 2;
			for (let i = 0; i < frameSize; i++) heap[from + i] = frame[i] * PCM_SCALE;
			rnnoise.rnnoise_process_frame(state, output, input);
			if (heap.buffer !== rnnoise.memory.buffer) heap = new Float32Array(rnnoise.memory.buffer);
			const to = output >> 2;
			for (let i = 0; i < frameSize; i++) frame[i] = heap[to + i] / PCM_SCALE;
		},
	};
}

/** The RNNoise instance the processors of this AudioContext share. @type {any} */
let rnnoise = null;

class RnnoiseWorkletProcessor extends AudioWorkletProcessor {
	/** @param {{ processorOptions: { module: WebAssembly.Module } }} options */
	constructor(options) {
		super();
		/** @type {ReturnType<typeof createDenoiser> | null} */
		this.denoiser = null;
		this.port.onmessage = (/** @type {MessageEvent} */ event) => {
			if (event.data?.type === "destroy") {
				this.denoiser?.destroy();
				this.denoiser = null;
			}
		};
		try {
			rnnoise ??= instantiateRnnoise(options.processorOptions.module);
			const denoiser = createDenoiser(rnnoise);
			this.denoiser = denoiser;
			this.frames = createFrames(denoiser.frameSize, frameDelay(denoiser.frameSize, QUANTUM_SIZE));
			// A frame RNNoise throws on goes out as silence, as it did when the main thread ran it.
			let reported = false;
			this.processFrame = (/** @type {Float32Array} */ frame) => {
				try {
					denoiser.denoise(frame);
				} catch (err) {
					frame.fill(0);
					if (!reported) console.error("[RNNoise] Couldn't denoise a frame:", err);
					reported = true;
				}
			};
			this.port.postMessage({ type: "ready" });
		} catch (err) {
			this.port.postMessage({ type: "failed", message: String(err) });
		}
	}

	/**
	 * @param {Float32Array[][]} inputs
	 * @param {Float32Array[][]} outputs
	 */
	process(inputs, outputs) {
		// Destroyed, or never set up: nothing more to do, and the node can go.
		if (!this.denoiser || !this.frames || !this.processFrame) return false;
		const input = inputs[0]?.[0];
		const output = outputs[0]?.[0];
		if (!input || !output) return true;
		passFrames(this.frames, input, output, this.processFrame);
		return true;
	}
}

registerProcessor("rnnoise-worklet-processor", RnnoiseWorkletProcessor);
