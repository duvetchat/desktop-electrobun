import type { MicChoice } from "$lib/media-state";

/** The microphones this computer has, with their names. Before the microphone was ever allowed their labels are
 * empty, and they're named by place; `ask` opens the microphone first, which fills them in (the picker asks on its
 * press). */
export async function listMicrophones(ask = false): Promise<MicChoice[]> {
	try {
		const mics = async () =>
			(await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
		let found = await mics();
		if (ask && found.length > 0 && !found[0]?.label) {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			stream.getTracks().forEach((track) => track.stop());
			found = await mics();
		}
		return found.map((mic) => ({ id: mic.deviceId, label: mic.label }));
	} catch (err) {
		console.error("Failed to fetch media devices:", err);
		return [];
	}
}
