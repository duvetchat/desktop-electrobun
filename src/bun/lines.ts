/** Hands on each line a helper process writes (trimmed, empty ones left out), as its bytes arrive. */
export async function readLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
	const decoder = new TextDecoder();
	let buffered = "";
	for await (const chunk of stream) {
		buffered += decoder.decode(chunk, { stream: true });
		let newline = buffered.indexOf("\n");
		while (newline >= 0) {
			const line = buffered.slice(0, newline).trim();
			buffered = buffered.slice(newline + 1);
			if (line) onLine(line);
			newline = buffered.indexOf("\n");
		}
	}
	// The last line may have no newline: PowerShell's error, say, which says why the helper ended.
	const last = (buffered + decoder.decode()).trim();
	if (last) onLine(last);
}
