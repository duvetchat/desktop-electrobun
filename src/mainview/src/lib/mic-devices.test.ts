import { afterEach, describe, expect, test } from "bun:test";
import { listMicrophones } from "$lib/mic-devices";

// navigator.mediaDevices as each test gives it; the real one comes back after. What the list reads of a stream is its
// tracks, which the test's own stop when it is done.
type FakeDevices = {
	enumerateDevices: () => Promise<MediaDeviceInfo[]>;
	getUserMedia?: () => Promise<{ getTracks: () => { stop(): void }[] }>;
};

const realNavigator = globalThis.navigator;
function devicesOf(mediaDevices: FakeDevices) {
	Object.defineProperty(globalThis, "navigator", { value: { mediaDevices }, configurable: true });
}

afterEach(() => {
	Object.defineProperty(globalThis, "navigator", { value: realNavigator, configurable: true });
});

const device = (kind: MediaDeviceKind, deviceId: string, label: string) =>
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the list reads these three fields alone
	({ kind, deviceId, label }) as MediaDeviceInfo;

describe("the microphones to pick from", () => {
	test("are the audio inputs, with their names", async () => {
		devicesOf({
			enumerateDevices: () =>
				Promise.resolve([
					device("audioinput", "built-in", "MacBook Pro Microphone"),
					device("videoinput", "camera", "FaceTime HD Camera"),
					device("audioinput", "usb", "Studio"),
				]),
		});
		expect(await listMicrophones()).toEqual([
			{ id: "built-in", label: "MacBook Pro Microphone" },
			{ id: "usb", label: "Studio" },
		]);
	});

	test("are asked for only when a caller wants their names", async () => {
		let asked = 0;
		let stopped = 0;
		let allowed = false;
		devicesOf({
			enumerateDevices: () =>
				Promise.resolve([device("audioinput", "built-in", allowed ? "MacBook Pro Microphone" : "")]),
			getUserMedia: () => {
				asked++;
				allowed = true;
				return Promise.resolve({ getTracks: () => [{ stop: () => stopped++ }] });
			},
		});
		expect(await listMicrophones()).toEqual([{ id: "built-in", label: "" }]);
		expect(asked).toBe(0);
		expect(await listMicrophones(true)).toEqual([{ id: "built-in", label: "MacBook Pro Microphone" }]);
		expect(asked).toBe(1);
		// The microphone was opened for its names alone: it is let go at once.
		expect(stopped).toBe(1);
	});

	test("are none when the computer can't say", async () => {
		devicesOf({
			enumerateDevices: () => Promise.reject(new Error("not allowed")),
		});
		const consoleError = console.error;
		console.error = () => {};
		try {
			expect(await listMicrophones()).toEqual([]);
		} finally {
			console.error = consoleError;
		}
	});
});
