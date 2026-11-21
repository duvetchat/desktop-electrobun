/** How much of a text file its preview shows: a megabyte is enough for a log or a source file, and small enough that
 * a huge one doesn't hold up the dialog. */
export const TEXT_PREVIEW_LIMIT = 1_000_000;

export interface TextPreview {
	text: string;
	/** Whether the file is longer than the preview: its first TEXT_PREVIEW_LIMIT characters are all that's shown. */
	truncated: boolean;
}

/** Reads a file's text for its preview, cut to its first `limit` characters. Throws when it can't be read. */
export async function readTextPreview(url: string, limit = TEXT_PREVIEW_LIMIT): Promise<TextPreview> {
	const res = await fetch(url, { cache: "no-store" });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const body = await res.text();
	return { text: body.slice(0, limit), truncated: body.length > limit };
}
