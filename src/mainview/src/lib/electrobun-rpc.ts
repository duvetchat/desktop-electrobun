import { activityThumbnail, base64Bytes, pngImage } from "$lib/activity-thumbnail";
import { secondWindowOfPath } from "$lib/app-windows";
import type { MessageLink } from "$lib/urls";
import type { OpenAppWindow } from "$lib/settings-windows";
import type { WindowAnswer, WindowCommand, WindowStateMessage } from "$lib/window-link";

/** A message's notification on Windows, as the Bun process shows it (src/bun/index.ts): who, what and where, the
 * author's photo by URL, the message a click opens, and whether it's silent, as Duvet plays its own sound. */
export interface NotificationRequest {
	id: string;
	chatId: string;
	title: string;
	text: string;
	place: string | null;
	avatarUrl: string | null;
	link: MessageLink;
	silent: boolean;
}

export interface ActivityPayload {
	// 0 (or none) playing, 2 listening.
	type?: number;
	name: string;
	details?: string;
	state?: string;
	timestamps?: { start?: number; end?: number };
	assets?: {
		large_image?: string;
		large_text?: string;
		small_image?: string;
		small_text?: string;
	};
}

export type AppRPCSchema = {
	bun: {
		requests: {
			// A toast for a message that notifies (src/bun/toasts.ts): whether it showed.
			showNotification: { params: NotificationRequest; response: boolean };
			// The message of the toast clicked last, which Bun keeps until a page takes it; null for none.
			takeClickedMessage: { params: void; response: MessageLink | null };
			// Whether Windows' move loop drags the window (src/bun/window-snap.ts): then the title bar reports its presses.
			nativeWindowDrag: { params: void; response: boolean };
			// From a window that isn't the main one: a command for the main window's page, which Bun forwards to it
			// (webview.requests.windowCommand) and whose answer it hands back (lib/window-link.ts, src/bun/window-relay.ts).
			windowCommand: { params: WindowCommand; response: WindowAnswer };
			// Copy image, from the default right-click menu (#423): Bun puts the picture at the URL on the clipboard
			// (src/bun/copy-image.ts), and says whether it's there. The main window's only.
			copyImage: { params: { url: string }; response: boolean };
		};
		messages: {
			closeWindow: void;
			minimizeWindow: void;
			maximizeWindow: void;
			// A press on the title bar, where Windows drags the window: Bun starts the move loop if it turns into a drag.
			startWindowDrag: void;
			openExternal: { url: string };
			// F12 and the other DevTools keys, on Linux, where Chromium's own handling kills the app (lib/native-context-menu.ts).
			openDevTools: void;
			setSpotifyActivity: { enabled: boolean };
			// The page's steps of the app's start, each when it happened (Date.now()), for startup.log (#280, #288).
			startupTimings: { marks: Record<string, number> };
			// From the main window: a state its other windows mirror, which Bun sends on to each of them.
			windowState: WindowStateMessage;
			// From the main window: open Settings, or a Space's settings, in a window of its own, or bring the open one
			// forward (src/bun/settings-windows.ts, #357).
			openAppWindow: OpenAppWindow;
			// From the main window on macOS: the theme the page wears, which the glass behind its sidebar takes
			// (lib/vibrancy.ts, src/bun/liquid-glass.ts; #374).
			windowTheme: { theme: "light" | "dark" };
		};
	};
	webview: {
		requests: {
			// An IPC app's activity image, which the Bun process fetched (in base64), made a small inline image.
			activityImage: { params: { bytes: string }; response: string | null };
			// To the main window: a command another window sent, to answer.
			windowCommand: { params: WindowCommand; response: WindowAnswer };
			// A picture Copy image fetched (in base64), made a PNG (in base64), or null.
			pngImage: { params: { bytes: string }; response: string | null };
		};
		messages: {
			activityUpdate: ActivityPayload[] | null;
			// A toast was clicked: its message is Bun's to take (takeClickedMessage).
			messageClicked: void;
			// To a window that isn't the main one: a state of the main window's, to mirror.
			windowState: WindowStateMessage;
		};
	};
};

export type AppRPCClient = {
	send: {
		closeWindow: () => void;
		minimizeWindow: () => void;
		maximizeWindow: () => void;
		startWindowDrag: () => void;
		openExternal: (params: { url: string }) => void;
		openDevTools: () => void;
		setSpotifyActivity: (params: { enabled: boolean }) => void;
		startupTimings: (params: { marks: Record<string, number> }) => void;
		windowState: (message: WindowStateMessage) => void;
		openAppWindow: (request: OpenAppWindow) => void;
		windowTheme: (params: { theme: "light" | "dark" }) => void;
	};
	request: {
		showNotification: (params: NotificationRequest) => Promise<boolean>;
		takeClickedMessage: () => Promise<MessageLink | null>;
		nativeWindowDrag: () => Promise<boolean>;
		windowCommand: (command: WindowCommand) => Promise<WindowAnswer>;
		copyImage: (params: { url: string }) => Promise<boolean>;
	};
	on: {
		activityUpdate: (handler: (data: ActivityPayload[] | null) => void) => void;
		messageClicked: (handler: () => void) => void;
		/** In a window that isn't the main one: each state the main window publishes. */
		windowState: (handler: (message: WindowStateMessage) => void) => void;
		/** In the main window: what answers the other windows' commands. One answerer: a later one replaces it. */
		windowCommand: (handler: (command: WindowCommand) => WindowAnswer | Promise<WindowAnswer>) => void;
	};
};

let rpcPromise: Promise<AppRPCClient | null> | null = null;

export function isElectrobunWindow() {
	return typeof window !== "undefined" && "__electrobunWindowId" in window;
}

const activityListeners: ((data: ActivityPayload[] | null) => void)[] = [];
const clickListeners: (() => void)[] = [];
const stateListeners: ((message: WindowStateMessage) => void)[] = [];
let commandAnswerer: ((command: WindowCommand) => WindowAnswer | Promise<WindowAnswer>) | null = null;

async function createRpcClient(): Promise<AppRPCClient | null> {
	// Only the top frame. Electrobun injects its preload into subframes on some platforms (macOS WKUserScript
	// forMainFrameOnly:false), so isElectrobunWindow() can read true inside an embedded player page; wiring the
	// RPC there would run the app's bun↔webview channel from a third-party frame. The app's RPC only ever
	// belongs to its own top-level document.
	if (!isElectrobunWindow() || window.top !== window) return null;

	const { Electroview } = await import("electrobun/view");
	const rpc = Electroview.defineRPC<AppRPCSchema>({
		// A toast's answer waits for its photo (2 s at most) and its helper's (10 s at most), and Copy image's for its
		// picture (13 s at most, src/bun/copy-image.ts); Electrobun's default is 1 s.
		maxRequestTime: 15_000,
		handlers: {
			requests: {
				// Bun has no image decoder; this page has a canvas (lib/activity-thumbnail.ts).
				activityImage: ({ bytes }) => activityThumbnail(base64Bytes(bytes)),
				pngImage: ({ bytes }) => pngImage(base64Bytes(bytes)),
				// Only the main window's page sets an answerer: any other says so, rather than leave Bun waiting.
				windowCommand: (command) =>
					commandAnswerer ? commandAnswerer(command) : { ok: false, error: "This window answers no commands" },
			},
			messages: {
				activityUpdate: (data: ActivityPayload[] | null) => {
					for (const listener of activityListeners) {
						listener(data);
					}
				},
				messageClicked: () => {
					for (const listener of clickListeners) listener();
				},
				windowState: (message: WindowStateMessage) => {
					for (const listener of stateListeners) listener(message);
				},
			},
		},
	});

	// The view wires rpc to the Bun process; nothing else needs it.
	void new Electroview({ rpc });

	const client: AppRPCClient = {
		send: rpc.send,
		request: {
			showNotification: (params) => rpc.request.showNotification(params),
			takeClickedMessage: () => rpc.request.takeClickedMessage(),
			nativeWindowDrag: () => rpc.request.nativeWindowDrag(),
			windowCommand: (command) => rpc.request.windowCommand(command),
			copyImage: (params) => rpc.request.copyImage(params),
		},
		on: {
			activityUpdate: (handler) => {
				activityListeners.push(handler);
			},
			messageClicked: (handler) => {
				clickListeners.push(handler);
			},
			windowState: (handler) => {
				stateListeners.push(handler);
			},
			windowCommand: (handler) => {
				// Never in a page of another window, whatever asks: only the main window's page answers (Bun asks
				// no other, either: src/bun/window-relay.ts).
				if (secondWindowOfPath(location.pathname) === null) commandAnswerer = handler;
			},
		},
	};
	return client;
}

export async function getElectrobunRpc() {
	if (!rpcPromise) {
		rpcPromise = createRpcClient().catch((error) => {
			rpcPromise = null;
			throw error;
		});
	}

	return rpcPromise;
}
