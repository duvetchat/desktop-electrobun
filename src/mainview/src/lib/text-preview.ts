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
	const body = await readFile(url);
	return { text: body.slice(0, limit), truncated: body.length > limit };
}

async function readFile(url: string): Promise<string> {
	// Ask the API to stream the file itself (?stream=1, as the audio players do) instead of following its redirect to
	// the storage host, whose answer a fetch may not read without CORS.
	const streamed = url.includes("?") ? `${url}&stream=1` : `${url}?stream=1`;
	try {
		const res = await fetch(streamed, { cache: "no-store", credentials: "include" });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return await res.text();
	} catch (err) {
		// A file the stream doesn't take is read as its own route gives it.
		const res = await fetch(url, { cache: "no-store", credentials: "include" });
		if (!res.ok) throw err;
		return await res.text();
	}
}
