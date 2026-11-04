import { activityThumbnail, base64Bytes } from "$lib/activity-thumbnail";

export interface MaximizeParams {
	availX: number;
	availY: number;
	availWidth: number;
	availHeight: number;
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
		requests: {};
		messages: {
			closeWindow: void;
			minimizeWindow: void;
			maximizeWindow: MaximizeParams;
			openExternal: { url: string };
			setSpotifyActivity: { enabled: boolean };
		};
	};
	webview: {
		requests: {
			// An IPC app's activity image, which the Bun process fetched (in base64), made a small inline image.
			activityImage: { params: { bytes: string }; response: string | null };
		};
		messages: {
			activityUpdate: ActivityPayload[] | null;
		};
	};
};

export type AppRPCClient = {
	send: {
		closeWindow: () => void;
		minimizeWindow: () => void;
		maximizeWindow: (params: MaximizeParams) => void;
		openExternal: (params: { url: string }) => void;
		setSpotifyActivity: (params: { enabled: boolean }) => void;
	};
	on: {
		activityUpdate: (handler: (data: ActivityPayload[] | null) => void) => void;
	};
};

let rpcPromise: Promise<AppRPCClient | null> | null = null;

export function isElectrobunWindow() {
	return typeof window !== "undefined" && "__electrobunWindowId" in window;
}

const activityListeners: ((data: ActivityPayload[] | null) => void)[] = [];

async function createRpcClient(): Promise<AppRPCClient | null> {
	// Only the top frame. Electrobun injects its preload into subframes on some platforms (macOS WKUserScript
	// forMainFrameOnly:false), so isElectrobunWindow() can read true inside an embedded player page; wiring the
	// RPC there would run the app's bun↔webview channel from a third-party frame. The app's RPC only ever
	// belongs to its own top-level document.
	if (!isElectrobunWindow() || window.top !== window) return null;

	const { Electroview } = await import("electrobun/view");
	const rpc = Electroview.defineRPC<AppRPCSchema>({
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
			},
		},
	});

	// The view wires rpc to the Bun process; nothing else needs it.
	void new Electroview({ rpc });

	const client: AppRPCClient = {
		send: rpc.send,
		on: {
			activityUpdate: (handler) => {
				activityListeners.push(handler);
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
