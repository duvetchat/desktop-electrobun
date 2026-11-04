import { getElectrobunRpc } from "$lib/electrobun-rpc";

function bindControl(id: string, handler: () => void) {
	const element = document.getElementById(id);
	if (!element) return;
	element.addEventListener("click", handler);
}

function bindFallbackControls() {
	bindControl("window-close", () => window.close());
	bindControl("window-minimize", () => {
		document.body.classList.remove("window-maximized");
	});
	bindControl("window-maximize", async () => {
		if (!document.fullscreenElement) {
			await document.documentElement.requestFullscreen().catch(() => undefined);
		} else {
			await document.exitFullscreen().catch(() => undefined);
		}
		toggleMaximizedUi();
	});
}

function toggleMaximizedUi() {
	document.body.classList.toggle("window-maximized");
}

export async function setupWindowControls() {
	if (typeof window === "undefined") return;

	try {
		const rpc = await getElectrobunRpc();

		if (rpc) {
			const sendMaximize = () => {
				const s: Screen & { availLeft?: number; availTop?: number } = window.screen;
				rpc.send.maximizeWindow({
					availX: s.availLeft ?? 0,
					availY: s.availTop ?? 0,
					availWidth: s.availWidth,
					availHeight: s.availHeight,
				});
				toggleMaximizedUi();
			};

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
