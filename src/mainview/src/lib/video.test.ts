import { describe, expect, test } from "bun:test";
import { cameraConstraints, cameraErrorMessage, readStreamId, videoRefusedMessage, vp8First } from "$lib/video";

const user = "01a15f8c-0001-7000-8000-000000000000";
const error = (name: string) => Object.assign(new Error(name), { name });

describe("readStreamId", () => {
	test("a user's stream: their voice, and their screen while they share it", () => {
		expect(readStreamId(user)).toEqual({ userId: user, camera: false });
	});

	test("a user's camera", () => {
		expect(readStreamId(`${user}.camera`)).toEqual({ userId: user, camera: true });
	});

	test("a kind of stream this client doesn't know isn't taken for the user's own", () => {
		expect(readStreamId(`${user}.screen`)).toBeNull();
		expect(readStreamId(`${user}.camera.2`)).toBeNull();
	});

	test("an ID without a user", () => {
		expect(readStreamId("")).toBeNull();
		expect(readStreamId(".camera")).toBeNull();
	});
});

describe("cameraConstraints", () => {
	test("640x360 at up to 30 fps from the default camera, without sound", () => {
		expect(cameraConstraints("")).toEqual({
			audio: false,
			video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 30, max: 30 } },
		});
	});

	test("the camera picked in the menu, and no other", () => {
		const video = cameraConstraints("cam-2").video;
		expect(video).toMatchObject({ deviceId: { exact: "cam-2" }, width: { ideal: 640 }, height: { ideal: 360 } });
	});
});

describe("vp8First", () => {
	const codec = (mimeType: string) => ({ mimeType, clockRate: 90000 });

	test("VP8 goes first, the rest keep their order", () => {
		const codecs = [codec("video/H264"), codec("video/rtx"), codec("video/VP8"), codec("video/VP9")];
		expect(vp8First(codecs).map((c) => c.mimeType)).toEqual(["video/VP8", "video/H264", "video/rtx", "video/VP9"]);
	});

	test("every VP8 entry, in any case", () => {
		const codecs = [codec("video/AV1"), codec("video/vp8"), codec("video/VP8")];
		expect(vp8First(codecs).map((c) => c.mimeType)).toEqual(["video/vp8", "video/VP8", "video/AV1"]);
	});
});

describe("cameraErrorMessage", () => {
	test("the system or the app didn't allow the camera", () => {
		expect(cameraErrorMessage(error("NotAllowedError"))).toBe(
			"Duvet isn't allowed to use your camera. Allow it in your system's privacy settings.",
		);
	});

	test("another app is using it", () => {
		expect(cameraErrorMessage(error("NotReadableError"))).toBe("Your camera is being used by another app");
	});

	test("there's no camera", () => {
		expect(cameraErrorMessage(error("NotFoundError"))).toBe("No camera found");
	});

	test("anything else", () => {
		expect(cameraErrorMessage(error("AbortError"))).toBe("Couldn't turn on your camera");
		expect(cameraErrorMessage("boom")).toBe("Couldn't turn on your camera");
	});
});

describe("videoRefusedMessage", () => {
	const refused = (reason: "limit" | "permission" | "bitrate", limit?: number) => ({
		room_id: "room",
		kind: "camera" as const,
		reason,
		limit,
	});

	test("the room already has its most cameras on", () => {
		expect(videoRefusedMessage(refused("limit", 8), "room")).toBe("This room already has 8 cameras on");
		expect(videoRefusedMessage(refused("limit", 1), "call")).toBe("This call already has 1 camera on");
		expect(videoRefusedMessage(refused("limit"), "room")).toBe("This room already has as many cameras on as it can");
	});

	test("a gateway that allows no cameras", () => {
		expect(videoRefusedMessage(refused("limit", 0), "call")).toBe("Cameras are turned off in this call");
	});

	test("no Video permission", () => {
		expect(videoRefusedMessage(refused("permission"), "room")).toBe("You can't use video in this room");
	});

	test("the camera sent too much", () => {
		expect(videoRefusedMessage(refused("bitrate"), "room")).toBe(
			"Your camera was turned off: it was sending more video than this room allows",
		);
	});
});
