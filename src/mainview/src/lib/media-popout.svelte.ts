import { getElectrobunRpc } from "$lib/electrobun-rpc";
import { liveMedia, liveMediaActions } from "$lib/media-source";
import { MEDIA_CHANNEL, mediaCommandHandlers } from "$lib/media-state";
import { DOCKED, MEDIA_WINDOW_CHANNEL, popOutStep, type PopOutState, type PopOutStep } from "$lib/media-window";
import { currentShell } from "$lib/platform";
import { voiceKey } from "$lib/voice-keys";
import { addWindowCommands, answerWindowCommand } from "$lib/window-commands";
import { publishToWindows } from "$lib/window-hub";

// The main window's side of the media controls' pop-out (#357, BRIEF.md "Media controls"). The call stays here: the
// gateway, WebRTC and the microphone are this page's, and popping the controls out or back touches none of them. This
// only tells Bun whether the window is wanted (src/bun/media-window.ts), publishes the controls' state for the window
// to mirror while it is out, and answers the commands it sends back, each of which runs the same action the sidebar's
// controls run (lib/media-source.ts). Only the main window's page imports this.

/** Whether the controls can pop out here (the desktop app's main window, once its RPC is up), and whether they are
 * out. The sidebar's block reads it. */
export const mediaPopOut: { available: boolean; out: boolean } = $state({ available: false, out: false });

// Kept across the app page's remounts (every READY builds its UI again): the window stays out through them.
let state: PopOutState = DOCKED;
// Whether the bridge to Bun is up: nothing is published before, nor after it stops. What is published goes through
// the page's one publisher (lib/window-hub.ts), whose numbers carry on through a remount.
let bridged = false;
let stopMirroring: (() => void) | null = null;

// The controls' state goes out only while the window is: each change, numbered, and the current one at once.
function mirror(on: boolean) {
	if (on && !stopMirroring && bridged) {
		stopMirroring = liveMedia.subscribe((media) => publishToWindows(MEDIA_CHANNEL, media));
	} else if (!on && stopMirroring) {
		stopMirroring();
		stopMirroring = null;
	}
}

function step(next: PopOutStep) {
	const after = popOutStep(state, next);
	if (after === state) return;
	state = after;
	mediaPopOut.out = after.out;
	// The state first, so the window has it as it opens; then the wish Bun acts on.
	mirror(after.out);
	if (bridged) publishToWindows(MEDIA_WINDOW_CHANNEL, after.wish);
}

/** Pops the media controls out into their own window. */
export const popOutMedia = () => step("popOut");
/** Puts them back in the sidebar, and closes the window. */
export const putBackMedia = () => step("putBack");
/** Brings the window to the front. */
export const showMediaWindow = () => step("show");

/**
 * Starts the main window's side, while the app's page is up; returns what stops it. Nothing in a browser, nor in a
 * window that isn't the main one. The mute and deafen shortcuts are taken here too, in the desktop app only: browsers
 * keep them for themselves.
 */
export function startMediaBridge(): () => void {
	const shell = currentShell();
	if (typeof window === "undefined" || !shell.popOut || shell.window !== "main") return () => {};
	let stopped = false;
	const stops: (() => void)[] = [];

	void getElectrobunRpc()
		.then((rpc) => {
			if (!rpc || stopped) return;
			bridged = true;
			stops.push(
				addWindowCommands(MEDIA_CHANNEL, mediaCommandHandlers(liveMediaActions)),
				// Bun says when the window opened, and when it is gone: its own close button, or Put back inside it.
				addWindowCommands(MEDIA_WINDOW_CHANNEL, { opened: () => null, closed: () => step("closed") }),
			);
			rpc.on.windowCommand(answerWindowCommand);

			const onkeydown = (event: KeyboardEvent) => {
				const key = voiceKey(event, shell.os === "mac");
				if (!key) return;
				event.preventDefault();
				if (key === "mute") liveMediaActions.toggleMute();
				else liveMediaActions.toggleDeafen();
			};
			window.addEventListener("keydown", onkeydown);
			stops.push(() => window.removeEventListener("keydown", onkeydown));

			mediaPopOut.available = true;
			// What this page wants of the window, as it starts: nothing after a reload, the window still after a remount.
			mirror(state.out);
			publishToWindows(MEDIA_WINDOW_CHANNEL, state.wish);
		})
		.catch((err: unknown) => console.error("[media] The pop-out's bridge didn't start:", err));

	return () => {
		stopped = true;
		for (const stop of stops) stop();
		mirror(false);
		bridged = false;
		mediaPopOut.available = false;
	};
}
