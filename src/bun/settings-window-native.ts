// A Settings window as Electrobun makes it (#357): what settings-windows.ts asks for, turned into a BrowserWindow with
// an RPC of its own (an RPC instance has one transport). Its page speaks the app's RPC (lib/electrobun-rpc.ts), of which
// a Settings window uses the window's own buttons, links that open in the browser, and the relay: its commands go to
// the main window's page, and the main window's states come to it.
import { BrowserView, BrowserWindow, Screen } from "electrobun/bun";
import { SETTINGS_CHANNEL, type AppWindow, type AppWindowSpec } from "./settings-windows";
import { placeWindowButtons } from "./window-buttons";
import { Maximizer } from "./window-frame";
import { keepKeysReachingThePage, type AppKit } from "./window-keys";
import type { WindowAnswer, WindowCommand, WindowStateMessage } from "./window-relay";

type SettingsWindowRPC = {
	bun: {
		requests: {
			windowCommand: { params: WindowCommand; response: WindowAnswer };
			nativeWindowDrag: { params: void; response: boolean };
		};
		messages: {
			closeWindow: void;
			minimizeWindow: void;
			maximizeWindow: void;
			startWindowDrag: void;
			openExternal: { url: string };
		};
	};
	webview: {
		requests: Record<never, never>;
		messages: {
			windowState: WindowStateMessage;
		};
	};
};

export interface NativeWindowDeps {
	renderer: "native" | "cef";
	/** A page's address: the app's own views, or the dev server's. */
	pageUrl(page: string): string;
	/** The links the window's page may follow (navigation.ts). */
	rules: string[];
	/** AppKit's bridge on macOS, where the page's web view must be made the window's first responder to take keys. */
	appkit: AppKit | null;
	openExternal(url: unknown): void;
	/** A command of the window's page, for the main window's (the relay's commandFromWindow). */
	command(command: WindowCommand): Promise<WindowAnswer>;
}

export function createSettingsWindow(spec: AppWindowSpec, deps: NativeWindowDeps): AppWindow {
	const maximizer = new Maximizer();
	// The page says when it listens (its "hello"): its RPC is made after it loads, and a state sent at dom-ready would
	// reach nobody.
	const readyHandlers: (() => void)[] = [];
	const rpc = BrowserView.defineRPC<SettingsWindowRPC>({
		// A command's answer is the main window's page's, which may be loading a code theme; Electrobun's default is 1 s.
		maxRequestTime: 15_000,
		handlers: {
			requests: {
				windowCommand: (command) => {
					if (command.channel === SETTINGS_CHANNEL && command.name === "hello") {
						for (const handler of readyHandlers) handler();
					}
					return deps.command(command);
				},
				// Electrobun drags it, by its title bar's class: Windows' own move loop is the main window's (window-snap.ts).
				nativeWindowDrag: () => false,
			},
			messages: {
				closeWindow: () => window.close(),
				minimizeWindow: () => window.minimize(),
				maximizeWindow: () => {
					const frame = maximizer.press(window.getFrame(), Screen.getAllDisplays());
					if (frame) window.setFrame(frame.x, frame.y, frame.width, frame.height);
				},
				startWindowDrag: () => {},
				openExternal: ({ url }) => deps.openExternal(url),
			},
		},
	});
	const window = new BrowserWindow({
		titleBarStyle: spec.titleBarStyle,
		renderer: deps.renderer,
		preload: spec.preload,
		sandbox: false,
		frame: spec.frame,
		title: spec.title,
		url: deps.pageUrl(spec.page),
		rpc,
	});
	// On macOS the traffic lights go in the side panel's 52 px line (SettingsFrame.svelte), where the main window has
	// them (#406). First: the window is on the screen already.
	if (spec.nativeButtons) placeWindowButtons(window.ptr);
	window.webview.on("dom-ready", () => window.webview.setNavigationRules(deps.rules));
	keepKeysReachingThePage(window, deps.appkit, { nativeButtons: spec.nativeButtons });
	return {
		id: window.id,
		focus: () => {
			if (window.isMinimized()) window.unminimize();
			window.focus();
		},
		close: () => window.close(),
		setTitle: (title) => window.setTitle(title),
		send: (message) => rpc.send.windowState(message),
		onReady: (handler) => void readyHandlers.push(handler),
		onClose: (handler) => window.on("close", handler),
	};
}
