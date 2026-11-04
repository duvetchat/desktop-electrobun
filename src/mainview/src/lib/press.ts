/**
 * Calls `done` once the press of a pointer under way ends, after the click its release makes: the browser dispatches
 * that click to the element under the pointer in the task of the release, so `done` runs in a task of its own, after
 * it. A cancelled press (pointercancel) ends it too. Listens in the capture phase, so an element that stops the release
 * doesn't keep the press going. Returns a function that stops waiting, without calling `done`.
 */
export function afterPress(
	target: Pick<EventTarget, "addEventListener" | "removeEventListener">,
	done: () => void,
): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const stop = () => {
		target.removeEventListener("pointerup", end, true);
		target.removeEventListener("pointercancel", end, true);
		clearTimeout(timer);
	};
	function end() {
		stop();
		timer = setTimeout(done);
	}
	target.addEventListener("pointerup", end, true);
	target.addEventListener("pointercancel", end, true);
	return stop;
}
