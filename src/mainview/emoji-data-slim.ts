import type { Plugin } from "vite";

/** The fields of emoji-datasource's entries that src/lib/emoji-data.ts reads. */
export const EMOJI_FIELDS = ["unified", "short_name", "short_names", "category", "sort_order", "has_img_twitter"] as const;

/**
 * Keeps only EMOJI_FIELDS of emoji-datasource's emoji.json as the build reads it (before Vite's JSON plugin): the rest
 * (images, sheet positions, per-platform flags) rode the emoji dataset's chunk, 1.3 MB against about 0.25 MB, which
 * stays in memory as the chunk's source for the session (#318). Tests read the file whole.
 */
export function slimEmojiData(): Plugin {
	return {
		name: "duvet-slim-emoji-data",
		enforce: "pre",
		transform(code, id) {
			if (!/[\\/]emoji-datasource[\\/]emoji\.json$/.test(id)) return null;
			const entries = JSON.parse(code) as Record<string, unknown>[];
			const slim = entries.map((entry) => Object.fromEntries(EMOJI_FIELDS.map((field) => [field, entry[field]])));
			return { code: JSON.stringify(slim), map: null };
		},
	};
}
