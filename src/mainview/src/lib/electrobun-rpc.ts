import { activityThumbnail, base64Bytes } from "$lib/activity-thumbnail";
import type { MessageLink } from "$lib/urls";

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
		};
		messages: {
			closeWindow: void;
			minimizeWindow: void;
			maximizeWindow: void;
			openExternal: { url: string };
			setSpotifyActivity: { enabled: boolean };
			// The page's steps of the app's start, each when it happened (Date.now()), for startup.log (#280, #288).
			startupTimings: { marks: Record<string, number> };
		};
	};
	webview: {
		requests: {
			// An IPC app's activity image, which the Bun process fetched (in base64), made a small inline image.
			activityImage: { params: { bytes: string }; response: string | null };
		};
		messages: {
			activityUpdate: ActivityPayload[] | null;
			// A toast was clicked: its message is Bun's to take (takeClickedMessage).
			messageClicked: void;
		};
	};
};

export type AppRPCClient = {
	send: {
		closeWindow: () => void;
		minimizeWindow: () => void;
		maximizeWindow: () => void;
		openExternal: (params: { url: string }) => void;
		setSpotifyActivity: (params: { enabled: boolean }) => void;
		startupTimings: (params: { marks: Record<string, number> }) => void;
	};
	request: {
		showNotification: (params: NotificationRequest) => Promise<boolean>;
		takeClickedMessage: () => Promise<MessageLink | null>;
	};
	on: {
		activityUpdate: (handler: (data: ActivityPayload[] | null) => void) => void;
		messageClicked: (handler: () => void) => void;
	};
};

let rpcPromise: Promise<AppRPCClient | null> | null = null;

export function isElectrobunWindow() {
	return typeof window !== "undefined" && "__electrobunWindowId" in window;
}

const activityListeners: ((data: ActivityPayload[] | null) => void)[] = [];
const clickListeners: (() => void)[] = [];

async function createRpcClient(): Promise<AppRPCClient | null> {
	// Only the top frame. Electrobun injects its preload into subframes on some platforms (macOS WKUserScript
	// forMainFrameOnly:false), so isElectrobunWindow() can read true inside an embedded player page; wiring the
	// RPC there would run the app's bun↔webview channel from a third-party frame. The app's RPC only ever
	// belongs to its own top-level document.
	if (!isElectrobunWindow() || window.top !== window) return null;

	const { Electroview } = await import("electrobun/view");
	const rpc = Electroview.defineRPC<AppRPCSchema>({
		// A toast's answer waits for its photo (2 s at most) and its helper's (10 s at most); Electrobun's default is 1 s.
		maxRequestTime: 15_000,
		handlers: {
			requests: {
				// Bun has no image decoder; this page has a canvas (lib/activity-thumbnail.ts).
				activityImage: ({ bytes }) => activityThumbnail(base64Bytes(bytes)),
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
		},
		on: {
			activityUpdate: (handler) => {
				activityListeners.push(handler);
			},
			messageClicked: (handler) => {
				clickListeners.push(handler);
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
