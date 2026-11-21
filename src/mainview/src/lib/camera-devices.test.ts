import { afterEach, describe, expect, test } from "bun:test";
import { listCameras } from "$lib/camera-devices";

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

describe("the cameras to pick from", () => {
	test("are the video inputs, with their names", async () => {
		devicesOf({
			enumerateDevices: () =>
				Promise.resolve([
					device("videoinput", "built-in", "FaceTime HD Camera"),
					device("audioinput", "mic", "MacBook Pro Microphone"),
					device("videoinput", "usb", "Studio"),
				]),
		});
		expect(await listCameras()).toEqual([
			{ id: "built-in", label: "FaceTime HD Camera" },
			{ id: "usb", label: "Studio" },
		]);
	});

	test("are asked for only when a caller wants their names", async () => {
		let asked = 0;
		let stopped = 0;
		let allowed = false;
		devicesOf({
			enumerateDevices: () => Promise.resolve([device("videoinput", "built-in", allowed ? "FaceTime HD Camera" : "")]),
			getUserMedia: () => {
				asked++;
				allowed = true;
				return Promise.resolve({ getTracks: () => [{ stop: () => stopped++ }] });
			},
		});
		expect(await listCameras()).toEqual([{ id: "built-in", label: "" }]);
		expect(asked).toBe(0);
		expect(await listCameras(true)).toEqual([{ id: "built-in", label: "FaceTime HD Camera" }]);
		expect(asked).toBe(1);
		// The camera was opened for its names alone: it is let go at once.
		expect(stopped).toBe(1);
	});

	test("are none when the computer can't say", async () => {
		devicesOf({
			enumerateDevices: () => Promise.reject(new Error("not allowed")),
		});
		const consoleError = console.error;
		console.error = () => {};
		try {
			expect(await listCameras()).toEqual([]);
		} finally {
			console.error = consoleError;
		}
	});
});
