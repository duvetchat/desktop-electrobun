import rnnoiseWasm from "virtual:rnnoise-wasm";

let rnnoiseModule: Promise<WebAssembly.Module> | null = null;

/** RNNoise's WebAssembly, compiled once, here: compiling it in the worklet would hold up the audio thread. */
function getRnnoiseModule(): Promise<WebAssembly.Module> {
	if (!rnnoiseModule) {
		const text = atob(rnnoiseWasm);
		const bytes = new Uint8Array(text.length);
		for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
		rnnoiseModule = WebAssembly.compile(bytes);
	}
	return rnnoiseModule;
}

/** Resolves once the worklet has RNNoise running, and rejects if it couldn't start it. */
function rnnoiseStarted(node: AudioWorkletNode): Promise<void> {
	return new Promise((resolve, reject) => {
		node.port.onmessage = (e) => {
			node.port.onmessage = null;
			node.onprocessorerror = null;
			if (e.data?.type === "ready") resolve();
			else reject(new Error(`RNNoise couldn't start: ${e.data?.message}`));
		};
		node.onprocessorerror = () => {
			node.port.onmessage = null;
			node.onprocessorerror = null;
			reject(new Error("RNNoise's worklet failed to start"));
		};
	});
}

/**
 * Takes a raw microphone MediaStream and returns a new MediaStream
 * with RNNoise noise suppression applied via AudioWorklet.
 *
 * RNNoise runs in the worklet itself, on the audio thread: the main thread only compiles its WebAssembly, so
 * no frame waits on it.
 *
 * Returns a cleanup function to release resources.
 */
export async function createDenoisedStream(
	inputStream: MediaStream,
	audioContext: AudioContext,
): Promise<{ stream: MediaStream; cleanup: () => void }> {
	const module = await getRnnoiseModule();

	await audioContext.audioWorklet.addModule("/rnnoise-worklet-processor.js");

	const source = audioContext.createMediaStreamSource(inputStream);
	const destination = audioContext.createMediaStreamDestination();
	const workletNode = new AudioWorkletNode(audioContext, "rnnoise-worklet-processor", {
		numberOfInputs: 1,
		numberOfOutputs: 1,
		outputChannelCount: [1],
		processorOptions: { module },
	});
	await rnnoiseStarted(workletNode);
	workletNode.onprocessorerror = () => console.error("[Voice] Noise suppression stopped: its worklet failed");

	source.connect(workletNode);
	workletNode.connect(destination);

	return {
		stream: destination.stream,
		cleanup: () => {
			workletNode.onprocessorerror = null;
			// Frees the worklet's RNNoise state; the node stops processing and can go.
			workletNode.port.postMessage({ type: "destroy" });
			workletNode.disconnect();
			source.disconnect();
		},
	};
}
