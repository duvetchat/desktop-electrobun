import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "svelte/server";
import { tags } from "../server-render";

// The Settings section (#357, DESIGN-MAP.md S-54): the microphone voice uses, a test of it, noise suppression, and the
// camera with a preview. The test and the preview open devices, which a server render can't: what they draw and what
// they are called are here.
const { default: VoiceVideoSettings } = await import("./VoiceVideoSettings.svelte");

const props = (overrides: Record<string, unknown> = {}) => ({
	micId: "",
	cameraId: "",
	noiseSuppression: true,
	mics: [
		{ id: "built-in", label: "MacBook Pro Microphone" },
		{ id: "usb", label: "" },
	],
	micsLoaded: true,
	cameras: [
		{ id: "face", label: "FaceTime HD Camera" },
		{ id: "usb-cam", label: "" },
	],
	camerasLoaded: true,
	onSelectMic() {},
	onSelectCamera() {},
	onToggleNoiseSuppression() {},
	onRefreshMics() {},
	onRefreshCameras() {},
	...overrides,
});

const words = (overrides: Record<string, unknown> = {}) =>
	render(VoiceVideoSettings, { props: props(overrides) }).body.replace(/<[^>]*>/g, " ");

describe("Voice and video", () => {
	test("names the microphone, the input level and noise suppression", async () => {
		const all = await tags(VoiceVideoSettings, props());
		const text = words().replace(/\s+/g, " ");
		expect(text).toContain("Microphone");
		expect(text).toContain("Input level");
		expect(text).toContain("Noise suppression");
		expect(all.some((tag) => tag.name === "select" && tag.attributes.id === "voice-microphone")).toBe(true);
	});

	test("offers the system's default and every microphone, naming the unnamed by place", async () => {
		const all = await tags(VoiceVideoSettings, props());
		expect(all.filter((tag) => tag.name === "option").map((tag) => tag.attributes.value)).toEqual([
			"",
			"built-in",
			"usb",
			"",
			"face",
			"usb-cam",
		]);
		expect(words().replace(/\s+/g, " ")).toContain("Microphone 2");
	});

	test("says so when there are no microphones, and not before they are looked for", () => {
		expect(words({ mics: [], micsLoaded: true })).toContain("No microphones found.");
		expect(words({ mics: [], micsLoaded: false })).not.toContain("No microphones found.");
	});

	test("tests the microphone with a button, against a meter that starts still", async () => {
		const all = await tags(VoiceVideoSettings, props());
		const meter = all.find((tag) => tag.attributes.role === "meter");
		expect(meter?.attributes["aria-valuenow"]).toBe("0");
		expect(words().replace(/\s+/g, " ")).toContain("Test microphone");
	});

	test("noise suppression is a switch, on as the setting says", async () => {
		const all = await tags(VoiceVideoSettings, props());
		const off = await tags(VoiceVideoSettings, props({ noiseSuppression: false }));
		const switchOf = (found: typeof all) => found.find((tag) => tag.attributes.role === "switch");
		expect(switchOf(all)?.attributes["aria-checked"]).toBe("true");
		expect(switchOf(all)?.attributes["aria-label"]).toBe("Noise suppression");
		expect(switchOf(off)?.attributes["aria-checked"]).toBe("false");
	});

	test("names the video, its camera and names the unnamed camera by place", async () => {
		const all = await tags(VoiceVideoSettings, props());
		const text = words().replace(/\s+/g, " ");
		expect(text).toContain("Video");
		expect(text).toContain("Camera");
		expect(text).toContain("Camera 2");
		expect(all.some((tag) => tag.name === "select" && tag.attributes.id === "video-camera")).toBe(true);
	});

	test("says so when there are no cameras, and not before they are looked for", () => {
		expect(words({ cameras: [], camerasLoaded: true })).toContain("No cameras found.");
		expect(words({ cameras: [], camerasLoaded: false })).not.toContain("No cameras found.");
	});

	// The preview opens the camera, which a server render leaves out: its box, mirror and label are read from source.
	test("draws a 16:9 preview, mirrored, until the camera opens", () => {
		const source = readFileSync(join(import.meta.dir, "VoiceVideoSettings.svelte"), "utf8");
		expect(source).toContain("aspect-video");
		expect(source).toContain("use:srcObject={preview}");
		expect(source).toContain("-scale-x-100");
		expect(source).toMatch(/>\s*Preview\s*</);
		expect(source).toContain("Opening your camera…");
		expect(source).toContain("Try again");
	});

	// The test opens a microphone and the preview a camera: the section that goes must let both go.
	test("releases the microphone and the camera when the section goes", () => {
		const source = readFileSync(join(import.meta.dir, "VoiceVideoSettings.svelte"), "utf8");
		expect(source).toMatch(/stopTest\(\);\s*stopPreview\(\);/);
		expect(source).toMatch(/stream\?\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\);/);
		expect(source).toMatch(/cameraStream\?\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\);/);
		expect(source).toMatch(/cancelAnimationFrame\(frame\);/);
	});
});
