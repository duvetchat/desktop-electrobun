import { BrowserView, BrowserWindow, Updater } from "electrobun/bun";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === "dev") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);

			return DEV_SERVER_URL;
		} catch {
			console.log("Vite dev server not running. Run 'bun run dev:hmr' for HMR support.");
		}
	}

	return "views://mainview/index.html";
}

const url = await getMainViewUrl();

interface ActivityPayload {
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

type AppRPCSchema = {
	bun: {
		requests: {};
		messages: {
			closeWindow: void;
			minimizeWindow: void;
			maximizeWindow: { availX: number; availY: number; availWidth: number; availHeight: number };
			setWindowFrame: {
				x: number;
				y: number;
				width: number;
				height: number;
			};
			startWindowResize: { direction: string };
			stopWindowResize: void;
		};
	};
	webview: {
		requests: {};
		messages: {
			activityUpdate: ActivityPayload[] | null;
		};
	};
};

let savedFrame: { x: number; y: number; width: number; height: number } | null = null;
let isManuallyMaximized = false;

const rpc = BrowserView.defineRPC<AppRPCSchema>({
	handlers: {
		messages: {
			closeWindow: () => win.close(),
			minimizeWindow: () => win.minimize(),
			maximizeWindow: ({ availX, availY, availWidth, availHeight }) => {
				if (isManuallyMaximized && savedFrame) {
					win.setFrame(savedFrame.x, savedFrame.y, savedFrame.width, savedFrame.height);
					isManuallyMaximized = false;
					savedFrame = null;
					return;
				}

				savedFrame = win.getFrame();
				win.setFrame(availX, availY, availWidth, availHeight);
				isManuallyMaximized = true;
			},
		},
	},
});

const currentOS = process.platform;

const rendererType = currentOS === "linux" ? "cef" : "native";

const win = new BrowserWindow({
	titleBarStyle: "hidden",
	renderer: rendererType,
	sandbox: false,
	frame: {
		height: 900,
		width: 1400,
		x: 0,
		y: 0,
	},
	title: "Duvet",
	url,
	rpc,
});

// ── IPC Server for external apps (VS Code, etc.) ────────────────────────────
const IPC_PIPE =
	process.platform === "win32" ? "\\\\.\\pipe\\duvet-ipc" : "/tmp/duvet-ipc.sock";

// Clean up stale socket on Unix
if (process.platform !== "win32") {
	try {
		const { unlinkSync } = await import("fs");
		unlinkSync(IPC_PIPE);
	} catch {}
}

// Track activities per IPC client
const clientActivities = new Map<object, ActivityPayload>();

function broadcastAggregatedActivities() {
	const all = [...clientActivities.values()];
	rpc.send.activityUpdate(all.length > 0 ? all : null);
}

try {
	Bun.listen({
		unix: IPC_PIPE,
		socket: {
			open(socket) {
				console.log("[IPC] Client connected");
			},
			data(socket, raw) {
				const text = new TextDecoder().decode(raw);
				for (const line of text.split("\n")) {
					if (!line.trim()) continue;
					try {
						const msg = JSON.parse(line) as { type: string; data: unknown };
						if (msg.type === "SET_ACTIVITY") {
							clientActivities.set(socket, msg.data as ActivityPayload);
							broadcastAggregatedActivities();
						} else if (msg.type === "CLEAR_ACTIVITY") {
							clientActivities.delete(socket);
							broadcastAggregatedActivities();
						}
					} catch (err) {
						console.error("[IPC] Invalid message:", err);
					}
				}
			},
			close(socket) {
				console.log("[IPC] Client disconnected");
				clientActivities.delete(socket);
				broadcastAggregatedActivities();
			},
		},
	});
	console.log(`[IPC] Listening on ${IPC_PIPE}`);
} catch (err) {
	console.error("[IPC] Failed to start server:", err);
}
