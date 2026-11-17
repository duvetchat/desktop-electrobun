import rnnoiseWasmUrl from "virtual:rnnoise-wasm";

// RNNoise's WebAssembly, compiled here: compiling it in the worklet would hold up the audio thread. It's fetched from its
// file as voice opens the mic, and let go of once no denoised stream uses it: as a base64 string in this chunk, it
// stayed in memory for the session from the first call on (#330).
let rnnoiseModule: Promise<WebAssembly.Module> | null = null;
let rnnoiseUsers = 0;

/** RNNoise's compiled WebAssembly, fetched and compiled once while denoised streams use it; doneWithRnnoise lets go of
 * each use. One that fails is fetched again by the next use. */
export function useRnnoise(): Promise<WebAssembly.Module> {
	rnnoiseUsers++;
	if (!rnnoiseModule) {
		const compiling = fetch(rnnoiseWasmUrl)
			.then((res) => {
				if (!res.ok) throw new Error(`RNNoise's WebAssembly: HTTP ${res.status}`);
				return res.arrayBuffer();
			})
			.then((bytes) => WebAssembly.compile(bytes));
		rnnoiseModule = compiling;
		compiling.catch(() => {
			if (rnnoiseModule === compiling) rnnoiseModule = null;
		});
	}
	return rnnoiseModule;
}

/** Lets go of a use of RNNoise's module (useRnnoise): the last one drops it. */
export function doneWithRnnoise() {
	rnnoiseUsers = Math.max(0, rnnoiseUsers - 1);
	if (rnnoiseUsers === 0) rnnoiseModule = null;
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
	let module: WebAssembly.Module;
	try {
		module = await useRnnoise();
		await audioContext.audioWorklet.addModule("/rnnoise-worklet-processor.js");
	} catch (err) {
		doneWithRnnoise();
		throw err;
	}

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
			doneWithRnnoise();
		},
	};
}
