// The media controls' pop-out as Electrobun makes it (#357, docs/redesign/PLATFORM.md §3): a BrowserWindow of its own,
// with its own RPC (an RPC object has one transport), whose page is views://mainview/voice-controls.html. What decides
// when it opens and closes, where, and what its commands do is media-window.ts, which this hands the window to.
import { BrowserView, BrowserWindow } from "electrobun/bun";
import type { MediaWindowHandle } from "./media-window";
import { shellPreload, type TitleBarStyle } from "./shell";
import type { Rect } from "./window-frame";
import { keepKeysReachingThePage, type AppKit } from "./window-keys";
import type { WindowAnswer, WindowCommand, WindowStateMessage } from "./window-relay";

/** The window's title, which the system shows in Mission Control, the taskbar and Alt-Tab (COPY.md §4.2). */
export const MEDIA_WINDOW_TITLE = "Voice controls";

/** The window's title bar: on macOS the system's own lights over a transparent bar, which also lets the window take
 * the keyboard (window-keys.ts); elsewhere none, the page drawing its close button. */
export function mediaWindowTitleBar(platform: string): { titleBarStyle: TitleBarStyle; nativeButtons: boolean } {
	return platform === "darwin"
		? { titleBarStyle: "hiddenInset", nativeButtons: true }
		: { titleBarStyle: "hidden", nativeButtons: false };
}

// What the pop-out's page and Bun say to each other: the part of the app's RPC (lib/electrobun-rpc.ts) its page uses.
type MediaWindowRPC = {
	bun: {
		requests: {
			windowCommand: { params: WindowCommand; response: WindowAnswer };
			// What the shared layout asks of any window (lib/window-controls.ts): this one has none of it.
			nativeWindowDrag: { params: void; response: boolean };
		};
		messages: {
			closeWindow: void;
			minimizeWindow: void;
			maximizeWindow: void;
			startWindowDrag: void;
		};
	};
	webview: {
		requests: Record<never, never>;
		messages: { windowState: WindowStateMessage };
	};
};

export interface MediaWindowOpenOptions {
	/** The page's address: views://mainview/voice-controls.html, or the dev server's. */
	url: string;
	renderer: "native" | "cef";
	platform: string;
	appkit: AppKit | null;
	/** The links the window's page may follow (navigation.ts). */
	rules: string[];
	/** The pop-out's commands, which media-window.ts answers or relays. */
	command(command: WindowCommand): Promise<WindowAnswer>;
}

/** What makes the window: media-window.ts's `create`. */
export function mediaWindowOpener(
	options: MediaWindowOpenOptions,
): (frame: Rect, pinned: boolean) => MediaWindowHandle {
	return (frame, pinned) => {
		const { titleBarStyle, nativeButtons } = mediaWindowTitleBar(options.platform);
		// Assigned right below: the handlers only run once the window's page talks.
		let window: BrowserWindow | null = null;
		const rpc = BrowserView.defineRPC<MediaWindowRPC>({
			maxRequestTime: 10_000,
			handlers: {
				requests: {
					windowCommand: (command) => options.command(command),
					nativeWindowDrag: () => false,
				},
				messages: {
					closeWindow: () => window?.close(),
					minimizeWindow: () => window?.minimize(),
					maximizeWindow: () => {},
					startWindowDrag: () => {},
				},
			},
		});
		const made = new BrowserWindow({
			title: MEDIA_WINDOW_TITLE,
			titleBarStyle,
			renderer: options.renderer,
			// Which window this is, for its page's platform switch (shell.ts), before any of its scripts run.
			preload: shellPreload("media", { titleBarStyle, nativeButtons }),
			sandbox: false,
			frame,
			url: options.url,
			rpc,
		});
		window = made;
		// A window that can't be kept on top still opens: the pin is a preference, not the window.
		if (pinned) {
			try {
				made.setAlwaysOnTop(true);
			} catch (err) {
				console.error("[media-window] the window couldn't be kept on top:", err);
			}
		}
		try {
			// The mute and deafen shortcuts are the page's own key handler: on macOS its web view must have the keyboard.
			keepKeysReachingThePage(made, options.appkit, { nativeButtons });
			made.webview.on("dom-ready", () => made.webview.setNavigationRules(options.rules));
		} catch (err) {
			// Whoever asked is told no window opened (media-window.ts): none is left behind that nobody drives.
			try {
				made.close();
			} catch {
				// It never got as far as a window to close.
			}
			throw err;
		}
		return {
			id: made.id,
			focus: () => {
				if (made.isMinimized()) made.unminimize();
				made.focus();
			},
			close: () => made.close(),
			getFrame: () => made.getFrame(),
			setAlwaysOnTop: (on) => made.setAlwaysOnTop(on),
			send: (message) => rpc.send.windowState(message),
			on: (event, handler) => {
				if (event === "ready") made.webview.on("dom-ready", handler);
				else made.on(event, handler);
			},
		};
	};
}
