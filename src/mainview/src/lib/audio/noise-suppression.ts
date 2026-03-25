import { Rnnoise, type DenoiseState } from "@shiguredo/rnnoise-wasm";

let rnnoiseInstance: Rnnoise | null = null;
let rnnoiseLoading: Promise<Rnnoise> | null = null;

async function getRnnoise(): Promise<Rnnoise> {
	if (rnnoiseInstance) return rnnoiseInstance;
	if (rnnoiseLoading) return rnnoiseLoading;
	rnnoiseLoading = Rnnoise.load().then((r) => {
		rnnoiseInstance = r;
		return r;
	});
	return rnnoiseLoading;
}

/**
 * Takes a raw microphone MediaStream and returns a new MediaStream
 * with RNNoise noise suppression applied via AudioWorklet.
 *
 * The worklet buffers 480-sample frames and sends them to the main thread
 * where RNNoise processes them, then returns the denoised audio.
 *
 * Returns a cleanup function to release resources.
 */
export async function createDenoisedStream(
	inputStream: MediaStream,
	audioContext: AudioContext,
): Promise<{ stream: MediaStream; cleanup: () => void }> {
	const rnnoise = await getRnnoise();
	const denoiseState: DenoiseState = rnnoise.createDenoiseState();

	await audioContext.audioWorklet.addModule("/rnnoise-worklet-processor.js");

	const source = audioContext.createMediaStreamSource(inputStream);
	const destination = audioContext.createMediaStreamDestination();
	const workletNode = new AudioWorkletNode(audioContext, "rnnoise-worklet-processor", {
		numberOfInputs: 1,
		numberOfOutputs: 1,
		outputChannelCount: [1],
	});

	// Process frames from the worklet in the main thread
	workletNode.port.onmessage = (e) => {
		if (e.data.type === "process") {
			const frame = new Float32Array(e.data.samples);

			// Scale to 16-bit PCM range for RNNoise
			for (let i = 0; i < frame.length; i++) {
				frame[i] *= 32768;
			}

			denoiseState.processFrame(frame);

			// Scale back to -1..1
			for (let i = 0; i < frame.length; i++) {
				frame[i] /= 32768;
			}

			workletNode.port.postMessage({ type: "processed", samples: frame }, [frame.buffer]);
		}
	};

	source.connect(workletNode);
	workletNode.connect(destination);

	return {
		stream: destination.stream,
		cleanup: () => {
			workletNode.port.onmessage = null;
			workletNode.disconnect();
			source.disconnect();
			denoiseState.destroy();
		},
	};
}
