import { afterEach, expect, mock, spyOn, test } from "bun:test";

// #330: RNNoise's WebAssembly came as a 4.8 MB base64 string in its chunk, and its compiled module stayed for the session
// from the first call on. It's fetched from its own file as voice needs it, and let go of once no denoised stream does.
const WASM_URL = "https://app.test/_app/immutable/assets/rnnoise.test.wasm";
void mock.module("virtual:rnnoise-wasm", () => ({ default: WASM_URL }));
const { doneWithRnnoise, useRnnoise } = await import("$lib/audio/noise-suppression");

// The smallest WebAssembly module: its magic number and version.
const EMPTY_MODULE = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
let fetched: { mockRestore(): void } | undefined;
const fetchesOf = (answer: () => Response) => {
	const spy = spyOn(globalThis, "fetch").mockImplementation((async (_input: string | URL | Request) =>
		answer()) as typeof fetch);
	fetched = spy;
	return spy;
};
afterEach(() => fetched?.mockRestore());

test("compiles the file once while streams use it, and fetches it again once none does", async () => {
	const calls = fetchesOf(() => new Response(EMPTY_MODULE));
	const first = await useRnnoise();
	const second = await useRnnoise();
	expect(second).toBe(first);
	expect(calls).toHaveBeenCalledTimes(1);
	expect(String(calls.mock.calls[0]![0])).toBe(WASM_URL);
	doneWithRnnoise();
	await useRnnoise();
	expect(calls).toHaveBeenCalledTimes(1);
	doneWithRnnoise();
	doneWithRnnoise();
	await useRnnoise();
	expect(calls).toHaveBeenCalledTimes(2);
	doneWithRnnoise();
});

test("a file it couldn't fetch is fetched again by the next stream", async () => {
	let status = 404;
	const calls = fetchesOf(() => (status === 404 ? new Response("not found", { status }) : new Response(EMPTY_MODULE)));
	await expect(useRnnoise()).rejects.toThrow("404");
	doneWithRnnoise();
	status = 200;
	expect(await useRnnoise()).toBeInstanceOf(WebAssembly.Module);
	expect(calls).toHaveBeenCalledTimes(2);
	doneWithRnnoise();
});
