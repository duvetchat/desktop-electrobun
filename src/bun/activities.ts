// The user's activities as the gateway keeps them (validActivities in duvet-gateway). It ignores a whole list when
// one activity breaks a limit, so what an IPC app sends is fitted to the limits here: one app can't hide the others'.
export const MAX_ACTIVITIES = 5;
const MAX_TEXT = 128;
/** The most bytes an activity's image takes: the gateway keeps only data URIs this long at most. */
export const MAX_IMAGE_BYTES = 8 << 10;

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

/** How often the user's activities go out at most: the gateway drops a connection's messages past 10 a second, voice's
 * and calls' with them, and a game may set its activity many times a second (#600). */
export const ACTIVITY_UPDATE_MS = 1000;

/** send, at most once every ms: a call within ms of the last send is put off to the end of that time, and those that
 * come meanwhile join it, so what's current then is what goes, and the last change is never lost. */
export function atMostEvery(ms: number, send: () => void): () => void {
	let last = -Infinity;
	let waiting: ReturnType<typeof setTimeout> | undefined;
	const now = () => {
		waiting = undefined;
		last = performance.now();
		send();
	};
	return () => {
		if (waiting) return;
		const wait = last + ms - performance.now();
		if (wait > 0) waiting = setTimeout(now, wait);
		else now();
	};
}

/** A text cut to the gateway's 128 characters (code points, as it counts them), ending in an ellipsis when cut. */
export function clip(value: string): string {
	const chars = [...value];
	return chars.length <= MAX_TEXT ? value : `${chars.slice(0, MAX_TEXT - 1).join("")}…`;
}

/** An IPC app's activity as the gateway takes it, or null when it has no name. Texts are clipped, an image too big
 * is left out, a type other than listening shows as playing, and a field of the wrong type is dropped. An image by
 * URL is still a URL here: withInlineImages (activity-images.ts) makes it inline, or leaves it out. */
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
