/**
 * AudioWorkletProcessor that buffers 480-sample frames and sends them
 * to the main thread for RNNoise processing, then outputs the result.
 *
 * Communication protocol via MessagePort:
 * - Main → Worklet: { type: "processed", samples: Float32Array }
 * - Worklet → Main: { type: "process", samples: Float32Array }
 */
class RnnoiseWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.FRAME_SIZE = 480;
    this.inputRing = new Float32Array(0);
    this.outputRing = new Float32Array(0);
    this.port.onmessage = (e) => {
      if (e.data.type === "processed") {
        // Append processed samples to output ring
        const prev = this.outputRing;
        const next = new Float32Array(prev.length + e.data.samples.length);
        next.set(prev);
        next.set(e.data.samples, prev.length);
        this.outputRing = next;
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) return true;

    // Accumulate input samples
    const prev = this.inputRing;
    const combined = new Float32Array(prev.length + input.length);
    combined.set(prev);
    combined.set(input, prev.length);
    this.inputRing = combined;

    // Send complete frames to main thread for processing
    while (this.inputRing.length >= this.FRAME_SIZE) {
      const frame = this.inputRing.slice(0, this.FRAME_SIZE);
      this.inputRing = this.inputRing.slice(this.FRAME_SIZE);
      this.port.postMessage({ type: "process", samples: frame }, [frame.buffer]);
    }

    // Output processed samples
    if (this.outputRing.length >= output.length) {
      output.set(this.outputRing.subarray(0, output.length));
      this.outputRing = this.outputRing.slice(output.length);
    } else if (this.outputRing.length > 0) {
      output.set(this.outputRing);
      this.outputRing = new Float32Array(0);
    }
    // else: output stays zeroed (silence until first frame is processed)

    return true;
  }
}

registerProcessor("rnnoise-worklet-processor", RnnoiseWorkletProcessor);
