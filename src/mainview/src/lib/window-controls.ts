import { getElectrobunRpc } from "$lib/electrobun-rpc";

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
			return;
		}
	} catch {
		// fallthrough
	}

	bindFallbackControls();
}
