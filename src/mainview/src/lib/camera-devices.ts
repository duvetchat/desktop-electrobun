import type { CameraChoice } from "$lib/media-state";

/** The cameras this computer has, with their names. Before the camera was ever allowed their labels are empty, and
 * they're named by place; `ask` opens the camera first, which fills them in (the preview asks on its own). */
export async function listCameras(ask = false): Promise<CameraChoice[]> {
	try {
		const cameras = async () =>
			(await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput");
		let found = await cameras();
		if (ask && found.length > 0 && !found[0]?.label) {
			const stream = await navigator.mediaDevices.getUserMedia({ video: true });
			stream.getTracks().forEach((track) => track.stop());
			found = await cameras();
		}
		return found.map((camera) => ({ id: camera.deviceId, label: camera.label }));
	} catch (err) {
		console.error("Failed to fetch media devices:", err);
		return [];
	}
}
