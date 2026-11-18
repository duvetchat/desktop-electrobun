/** A player's seek bar from the keyboard: the arrows move five seconds, Home and End go to the ends. The time to seek
 * to, within the recording, or null for a key that isn't one of them or a recording whose length isn't known. */
export function seekTo(key: string, current: number, duration: number): number | null {
	if (!(duration > 0)) return null;
	const STEP = 5;
	switch (key) {
		case "ArrowRight":
		case "ArrowUp":
			return Math.min(duration, current + STEP);
		case "ArrowLeft":
		case "ArrowDown":
			return Math.max(0, current - STEP);
		case "Home":
			return 0;
		case "End":
			return duration;
		default:
			return null;
	}
}
