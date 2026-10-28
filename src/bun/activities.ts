// The user's activities as the gateway keeps them (validActivities in duvet-gateway). It ignores a whole list when
// one activity breaks a limit, so what an IPC app sends is fitted to the limits here: one app can't hide the others'.
export const MAX_ACTIVITIES = 5;
const MAX_TEXT = 128;
const MAX_IMAGE_BYTES = 8 << 10;

export interface ActivityPayload {
	// 0 (or none) playing, 2 listening.
	type?: number;
	name: string;
	details?: string;
	state?: string;
	timestamps?: { start?: number; end?: number };
	assets?: {
		large_image?: string;
		large_text?: string;
		small_image?: string;
		small_text?: string;
	};
}

/** A text cut to the gateway's 128 characters (code points, as it counts them), ending in an ellipsis when cut. */
export function clip(value: string): string {
	const chars = [...value];
	return chars.length <= MAX_TEXT ? value : `${chars.slice(0, MAX_TEXT - 1).join("")}…`;
}

/** An IPC app's activity as the gateway takes it, or null when it has no name. Texts are clipped, an image too big
 * is left out, a type other than listening shows as playing, and a field of the wrong type is dropped. */
export function fitActivity(data: unknown): ActivityPayload | null {
	if (!isObject(data) || typeof data.name !== "string" || !data.name) return null;
	const activity: ActivityPayload = {
		type: data.type === 2 ? 2 : undefined,
		name: clip(data.name),
		details: text(data.details),
		state: text(data.state),
	};
	if (isObject(data.timestamps)) {
		activity.timestamps = { start: time(data.timestamps.start), end: time(data.timestamps.end) };
	}
	if (isObject(data.assets)) {
		activity.assets = {
			large_image: image(data.assets.large_image),
			large_text: text(data.assets.large_text),
			small_image: image(data.assets.small_image),
			small_text: text(data.assets.small_text),
		};
	}
	return activity;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function text(value: unknown): string | undefined {
	return typeof value === "string" ? clip(value) : undefined;
}

// The gateway counts an image's bytes as UTF-8, as it receives them.
function image(value: unknown): string | undefined {
	return typeof value === "string" && new TextEncoder().encode(value).length <= MAX_IMAGE_BYTES ? value : undefined;
}

// Unix milliseconds the gateway reads as an integer.
function time(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(Math.round(value)) ? Math.round(value) : undefined;
}
