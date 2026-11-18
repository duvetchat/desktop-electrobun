import { getElectrobunRpc } from "$lib/electrobun-rpc";

/** Whether a press on the title bar drags the window: the primary button's, off the window's buttons. */
export function pressDrags(button: number, target: { closest(selector: string): unknown } | null): boolean {
	return button === 0 && target !== null && !target.closest(".titlebar-actions");
}

function bindControl(id: string, handler: () => void) {
	const element = document.getElementById(id);
	if (!element) return;
	element.addEventListener("click", handler);
}

function bindFallbackControls() {
	bindControl("window-close", () => window.close());
	bindControl("window-maximize", async () => {
		if (!document.fullscreenElement) {
			await document.documentElement.requestFullscreen().catch(() => undefined);
		} else {
			await document.exitFullscreen().catch(() => undefined);
		}
	});
}

export async function setupWindowControls() {
	if (typeof window === "undefined") return;

	try {
		const rpc = await getElectrobunRpc();

		if (rpc) {
			// The Bun process finds the display from the window's own frame: this page's window.screen can still be the
			// monitor the window was dragged from (#187).
			const sendMaximize = () => rpc.send.maximizeWindow();

			bindControl("window-close", () => rpc.send.closeWindow());
			bindControl("window-minimize", () => rpc.send.minimizeWindow());
			bindControl("window-maximize", sendMaximize);

			const titlebar = document.getElementById("window-titlebar");
			titlebar?.addEventListener("dblclick", (event) => {
				if (event.target instanceof Element && event.target.closest(".titlebar-actions")) return;
				sendMaximize();
			});
			// Where Bun says Windows drags the window (on Windows, once src/bun/window-snap.ts is in), Windows' move loop
			// does, from a press Bun follows until it moves past the system's drag distance: a maximized window restores as
			// it's dragged, the display's edges snap it, and a click and this double click stay the page's. Elsewhere, and
			// if Bun can't say, Electrobun drags it, by the title bar's class (Header.svelte).
			if (titlebar && (await rpc.request.nativeWindowDrag().catch(() => false))) {
				titlebar.classList.remove("electrobun-webkit-app-region-drag");
				titlebar.addEventListener("mousedown", (event) => {
					if (pressDrags(event.button, event.target instanceof Element ? event.target : null)) {
						rpc.send.startWindowDrag();
					}
				});
			}
			return;
		}
	} catch {
		// fallthrough
	}

	bindFallbackControls();
}
