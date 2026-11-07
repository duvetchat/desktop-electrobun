import Electrobun, { BrowserView, BrowserWindow, Screen, Updater, Utils } from "electrobun/bun";
import { fitActivity, MAX_ACTIVITIES, type ActivityPayload } from "./activities";
import { ActivityImages, IpcActivities, PAGE_WAIT_MS, within } from "./activity-images";
import { startSpotifyReader, type SpotifyActivity } from "./spotify";
import { ipcHeld, ipcPath, LineReader } from "./ipc";
import { navigationRules } from "./navigation";
import { Maximizer } from "./window-frame";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

// Opens a URL in the system browser, never in a webview. Only http(s) and mailto: are allowed through — a
// link the app routes here comes from message content or an embed, so a custom scheme (file:, a protocol
// handler, …) must not be launched. The webview asks for this over RPC (see AppRPCSchema.openExternal) for
// every external anchor, and new-window attempts are funnelled here too.
function openExternalUrl(url: unknown): void {
	if (typeof url !== "string") return;
	if (!/^(https?:|mailto:)/i.test(url)) return;
	Utils.openExternal(url);
}

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

type AppRPCSchema = {
	bun: {
		requests: {};
		messages: {
			closeWindow: void;
			minimizeWindow: void;
			maximizeWindow: void;
			openExternal: { url: string };
			setWindowFrame: {
				x: number;
				y: number;
				width: number;
				height: number;
			};
			startWindowResize: { direction: string };
			stopWindowResize: void;
			// The webview's "Share what I listen to on Spotify" setting, sent at start and on each change.
			setSpotifyActivity: { enabled: boolean };
		};
	};
	webview: {
		requests: {
			// An IPC app's activity image, fetched here: the webview makes it a small inline image (it has a canvas,
			// Bun has no image decoder), or answers null. Its bytes go in base64.
			activityImage: { params: { bytes: string }; response: string | null };
		};
		messages: {
			activityUpdate: ActivityPayload[] | null;
		};
	};
};

const maximizer = new Maximizer();

// The webview makes the IPC apps' images by URL inline once its page has loaded, which its first setSpotifyActivity
// says: a request sent before then would find no page to answer it. An image waits for it PAGE_WAIT_MS at most, then
// gives its place to the next one: a signed-out app's page never sends it.
let markWebviewReady!: () => void;
const webviewReady = new Promise<void>((resolve) => (markWebviewReady = resolve));
const activityImages = new ActivityImages(async (bytes) => {
	await within(webviewReady, PAGE_WAIT_MS);
	return rpc.request.activityImage({ bytes: Buffer.from(bytes).toString("base64") });
});

// Track activities per IPC client, each with its images inline: a URL would reach nobody (gateway#134). Declared
// before the RPC, whose setSpotifyActivity sends them too: on macOS and Linux an await comes before the IPC server,
// and the webview could ask meanwhile.
const clientActivities = new IpcActivities(activityImages, () => broadcastAggregatedActivities());

// What Spotify plays here, while the webview's setting lets the reader run; it goes out with the IPC apps'.
let spotifyActivity: SpotifyActivity | null = null;
let stopSpotify: (() => void) | null = null;

function setSpotifyActivity(enabled: boolean) {
	if (enabled && !stopSpotify) {
		stopSpotify = startSpotifyReader((activity) => {
			spotifyActivity = activity;
			broadcastAggregatedActivities();
		});
	} else if (!enabled && stopSpotify) {
		stopSpotify();
		stopSpotify = null;
		spotifyActivity = null;
	}
	// A page that just loaded sends this first, so it gets what's current: the reader only reports changes.
	broadcastAggregatedActivities();
}

const rpc = BrowserView.defineRPC<AppRPCSchema>({
	// The webview's answer to activityImage, which decodes an image of up to 4 MiB; Electrobun's default is 1 s.
	maxRequestTime: 10_000,
	handlers: {
		messages: {
			closeWindow: () => win.close(),
			minimizeWindow: () => win.minimize(),
			maximizeWindow: () => {
				const frame = maximizer.press(win.getFrame(), Screen.getAllDisplays());
				if (frame) win.setFrame(frame.x, frame.y, frame.width, frame.height);
			},
			openExternal: ({ url: externalUrl }) => openExternalUrl(externalUrl),
			setSpotifyActivity: ({ enabled }) => {
				markWebviewReady();
				setSpotifyActivity(enabled);
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

// Through the webview: BrowserWindow stores a navigationRules option of its own, and never hands it to the native side.
// As each page loads, not right after new BrowserWindow: macOS reads them later on its main queue, from an address
// nothing keeps, and right after new BrowserWindow that queue still has the webview's creation ahead of them, so a GC in
// that gap could leave no rules, with no sign. Only the app's own first page can load before they apply.
const rules = navigationRules(currentOS, url === DEV_SERVER_URL ? url : null);
win.webview.on("dom-ready", () => win.webview.setNavigationRules(rules));

// Backstop for any attempt to open a new window — window.open, target="_blank" or a modifier-click the
// webview doesn't handle itself. The window never spawns a second webview or popup; the URL goes to the
// system browser instead. The webview also routes ordinary external-link clicks over RPC (openExternal), so
// this mainly covers scripted opens and modifier-clicks. Embedded players can't reach here: their iframe
// sandbox drops allow-popups (lib/urls.ts frameSandbox). The event fires globally through Electrobun's
// emitter (webviewEvents.ts → proc/native.ts webviewEventHandler) with the URL in event.data.detail.
Electrobun.events.on("new-window-open", (event: { data?: { detail?: { url?: string } | string } }) => {
	const detail = event?.data?.detail;
	const target = typeof detail === "string" ? detail : detail?.url;
	openExternalUrl(target);
});

// ── IPC Server for external apps (VS Code, etc.) ────────────────────────────
const IPC_PIPE = ipcPath(process.platform, process.env);
// Another Duvet that runs keeps its apps, and this one doesn't listen (#188).
const ipcHeldElsewhere = await ipcHeld(IPC_PIPE);

// Clean up stale socket on Unix
if (process.platform !== "win32" && !ipcHeldElsewhere) {
	try {
		const { unlinkSync } = await import("fs");
		unlinkSync(IPC_PIPE);
	} catch {}
}

function broadcastAggregatedActivities() {
	// The gateway keeps MAX_ACTIVITIES: Spotify's has its place, and the IPC apps' fill the rest.
	const spotify = spotifyActivity ? [spotifyActivity] : [];
	const all = [...clientActivities.activities().slice(0, MAX_ACTIVITIES - spotify.length), ...spotify];
	rpc.send.activityUpdate(all.length > 0 ? all : null);
}

if (ipcHeldElsewhere) {
	console.log(`[IPC] Another Duvet listens on ${IPC_PIPE}; this one doesn't`);
} else {
	try {
		Bun.listen<LineReader>({
			unix: IPC_PIPE,
			socket: {
				open(socket) {
					socket.data = new LineReader();
					console.log("[IPC] Client connected");
				},
				data(socket, raw) {
					const lines = socket.data.push(raw);
					if (!lines) {
						console.error("[IPC] Line too long, closing client");
						socket.terminate();
						return;
					}
					for (const line of lines) {
						if (!line.trim()) continue;
						try {
							// An app can send anything: a message without a type is dropped, and an activity is fitted to
							// the gateway's limits, or dropped.
							const msg: unknown = JSON.parse(line);
							if (typeof msg !== "object" || msg === null || !("type" in msg)) continue;
							if (msg.type === "SET_ACTIVITY") {
								clientActivities.set(socket, fitActivity("data" in msg ? msg.data : undefined));
							} else if (msg.type === "CLEAR_ACTIVITY") {
								clientActivities.clear(socket);
							}
						} catch (err) {
							console.error("[IPC] Invalid message:", err);
						}
					}
				},
				close(socket) {
					console.log("[IPC] Client disconnected");
					clientActivities.clear(socket);
				},
			},
		});
		console.log(`[IPC] Listening on ${IPC_PIPE}`);
	} catch (err) {
		console.error("[IPC] Failed to start server:", err);
	}
}
