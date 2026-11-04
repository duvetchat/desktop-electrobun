const FALLBACK_SVG = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#555"/><text x="12" y="17" text-anchor="middle" font-size="14" fill="#999" font-family="sans-serif">?</text></svg>`)}`;

// The image types the gateway keeps an activity's image in (activityImageTypes in duvet-gateway).
const ACTIVITY_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"]);

/**
 * value when it's an image an activity may show: a data URI of one of the types the gateway keeps (its scheme in
 * lowercase, as the gateway takes it), which an <img> draws without loading anything; nothing otherwise. Since
 * gateway#134 the gateway sends no other value, so an http(s) one can only come from an older gateway or a fault,
 * and drawing it would have its host learn the viewer's IP (desktop#149). Never put an activity's SVG into the page
 * itself: drawn as an image, it loads nothing.
 */
export function inlineActivityImage(value: string | undefined): string | undefined {
	const mediaType = value?.startsWith("data:") ? /^data:([^;,]*)[;,]/.exec(value)?.[1] : undefined;
	return mediaType !== undefined && ACTIVITY_IMAGE_TYPES.has(mediaType.toLowerCase()) ? value : undefined;
}

/** The image to draw for an activity's large image: its own when it's inline (inlineActivityImage), a "?" otherwise. */
export function resolveActivityIcon(value: string | undefined): string {
	return inlineActivityImage(value) ?? FALLBACK_SVG;
}
