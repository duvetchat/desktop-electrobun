/** How far an upload is, in percent of its body's bytes sent (FetchRequestConfig.onUploadProgress), rounded down: 100
 * once every byte is up and the answer is awaited, never before. 0 while the total isn't known. */
export function uploadPercent(sent: number, total: number): number {
	if (total <= 0) return 0;
	return Math.floor((Math.min(sent, total) / total) * 100);
}

/** An upload's progress as the mobile app words it: "Uploading · 42%". It stays at 100% while the answer is awaited. */
export function uploadNote(percent: number): string {
	return `Uploading · ${percent}%`;
}
