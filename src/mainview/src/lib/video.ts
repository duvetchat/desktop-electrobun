import { t } from "$lib/i18n";
import type { VoiceVideoRefusedEvent } from "$lib/types";

// What the camera sends. The gateway forwards a single encoding to everyone (no simulcast), so this is what
// every viewer gets.
export const CAMERA_MAX_BITRATE = 500_000;
export const CAMERA_MAX_FRAMERATE = 30;

const CAMERA_STREAM_SUFFIX = ".camera";

/** Whose a stream the gateway forwards is, and whether it's their camera. A user's voice and screen come as
 * `<user_id>`, their camera as `<user_id>.camera`; null for anything else, which this client leaves alone. */
export function readStreamId(id: string): { userId: string; camera: boolean } | null {
	const dot = id.indexOf(".");
	if (dot === -1) return id ? { userId: id, camera: false } : null;
	if (dot === 0 || id.slice(dot) !== CAMERA_STREAM_SUFFIX) return null;
	return { userId: id.slice(0, dot), camera: true };
}

/** The camera at 640x360 and up to 30 fps; the one picked in the menu when there is one. */
export function cameraConstraints(deviceId: string): MediaStreamConstraints {
	return {
		audio: false,
		video: {
			...(deviceId ? { deviceId: { exact: deviceId } } : {}),
			width: { ideal: 640 },
			height: { ideal: 360 },
			frameRate: { ideal: CAMERA_MAX_FRAMERATE, max: CAMERA_MAX_FRAMERATE },
		},
	};
}

/** The codecs with VP8 first, for the camera's transceiver: the gateway forwards what it gets without
 * transcoding, and every viewer (WebView2, WebKit, CEF) decodes VP8. */
export function vp8First<T extends { mimeType: string }>(codecs: T[]): T[] {
	const isVP8 = (c: T) => c.mimeType.toLowerCase() === "video/vp8";
	return [...codecs.filter(isVP8), ...codecs.filter((c) => !isVP8(c))];
}

/** Why the camera didn't open, from getUserMedia's error. */
export function cameraErrorMessage(err: unknown): string {
	const name = typeof err === "object" && err !== null && "name" in err ? err.name : undefined;
	switch (name) {
		case "NotAllowedError":
		case "SecurityError":
			return t("call_camera_not_allowed");
		case "NotReadableError":
			return t("call_camera_in_use");
		case "NotFoundError":
		case "OverconstrainedError":
			return t("call_camera_not_found");
		default:
			return t("call_camera_failed");
	}
}

/** Why the gateway turned the camera off (VOICE_VIDEO_REFUSED), in a voice room or a conversation's call. */
export function videoRefusedMessage(event: VoiceVideoRefusedEvent, place: "room" | "call"): string {
	switch (event.reason) {
		case "limit":
			// The gateway can be set to allow no cameras at all (VOICE_MAX_CAMERAS=0).
			if (event.limit === 0) return t("call_video_cameras_off", { place });
			return event.limit === undefined
				? t("call_video_camera_limit_reached", { place })
				: t("call_video_camera_limit", { place, limit: event.limit });
		case "permission":
			return t("call_video_not_allowed", { place });
		case "bitrate":
			return t("call_video_bitrate", { place });
		default:
			return t("call_camera_turned_off");
	}
}
