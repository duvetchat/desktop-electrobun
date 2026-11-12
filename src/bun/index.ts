import Electrobun, { BrowserView, BrowserWindow, Screen, Updater, Utils } from "electrobun/bun";
import { dirname, join } from "node:path";
import { fitActivity, MAX_ACTIVITIES, type ActivityPayload } from "./activities";
import { ActivityImages, IpcActivities, PAGE_WAIT_MS, within } from "./activity-images";
import { avatarForToast } from "./notification-avatars";
import { forwarderScript } from "./notification-forwarder";
import { openUrl, parseOpenUrl, type NotificationLink } from "./notification-links";
import { notificationIdentity, setUpNotifications, type NotificationIdentity } from "./notification-setup";
import { Toasts } from "./toasts";
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

// dev, canary or stable: each channel's notifications have their own sender, link and pipe (notification-setup.ts).
const channel = await Updater.localInfo.channel();

async function getMainViewUrl(): Promise<string> {
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
			// A message that notifies without the focus, on Windows (lib/system-notifications.ts): shown as a toast.
			showNotification: NotificationRequest;
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
			// A click on a notification: the message it opens.
			openMessage: NotificationLink;
		};
	};
};

/** A message's notification, as the webview asks for it: who, what and where, the author's photo by URL, the message
 * it opens, and whether it's silent, as the webview plays its own sound. */
type NotificationRequest = {
	id: string;
	chatId: string;
	title: string;
	text: string;
	place: string | null;
	avatarUrl: string | null;
	link: NotificationLink;
	silent: boolean;
};

const maximizer = new Maximizer();

// The webview makes the IPC apps' images by URL inline once its page has loaded, which its first setSpotifyActivity
// says: a request sent before then would find no page to answer it. An image waits for it PAGE_WAIT_MS at most, then
// gives its place to the next one: a signed-out app's page never sends it.
let markWebviewReady!: () => void;
const webviewReady = new Promise<void>((resolve) => (markWebviewReady = resolve));
// An image made small by the webview's canvas: an IPC app's activity image, or a notification's photo.
const thumbnail = async (bytes: Uint8Array) => {
	await within(webviewReady, PAGE_WAIT_MS);
	return rpc.request.activityImage({ bytes: Buffer.from(bytes).toString("base64") });
};
const activityImages = new ActivityImages(thumbnail);
// The authors' photos for toasts, made small the same way, apart: a burst of messages from many people doesn't push
// the activities' images out.
const avatarImages = new ActivityImages(thumbnail);

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
			showNotification: (request) => void showToast(request),
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

// What Electrobun reports as a new window goes to the system browser: a Ctrl or Cmd click. The webview sends every
// other click on a link over RPC (openExternal, lib/external-links.ts). On Windows and Linux Electrobun has no hook for
// a scripted window.open, which opens a second window: nothing in the app calls it, and embedded players can't, as their
// iframe sandbox drops allow-popups (lib/urls.ts frameSandbox). The event fires globally through Electrobun's emitter
// (webviewEvents.ts → proc/native.ts webviewEventHandler) with the URL in event.data.detail.
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

// ── Notifications (Windows) ──────────────────────────────────────────────────
// The webview decides what notifies (lib/notifications.ts) and asks for a toast (showNotification); a click on one
// comes back over this channel's own pipe through the forwarder (notification-forwarder.ts), and opens its message.
// DISENO-NOTIFICACIONES.md, section 8.

// How long a click's message waits for the page, which a Duvet the click started is still loading.
const OPEN_WAIT_MS = 60_000;

let notifications: { toasts: Toasts; scheme: string } | null = null;

if (currentOS === "win32") void startNotifications();

async function startNotifications() {
	const identity = notificationIdentity(channel);
	// The installed app's launcher, through cmd /c start: Bun ends what it starts with it, and the Duvet a click starts
	// must outlive the forwarder.
	const launcher = ["cmd.exe", "/d", "/c", "start", "", join(dirname(process.execPath), "launcher.exe")];
	try {
		await setUpNotifications(channel, Utils.paths.userData, forwarderScript(identity.pipe, launcher));
	} catch (err) {
		console.error("[Notifications] Can't set them up:", err);
		return;
	}
	notifications = { toasts: new Toasts(identity.aumid), scheme: identity.scheme };
	await listenForClicks(identity);
}

// The channel's pipe, where the forwarder hands a click's link. Another Duvet of this channel that runs keeps it, as
// the IPC pipe (#188).
async function listenForClicks({ pipe, scheme }: NotificationIdentity) {
	if (await ipcHeld(pipe)) return;
	try {
		Bun.listen<LineReader>({
			unix: pipe,
			socket: {
				open(socket) {
					socket.data = new LineReader();
				},
				data(socket, raw) {
					const lines = socket.data.push(raw);
					if (!lines) {
						socket.terminate();
						return;
					}
					for (const line of lines) void openClicked(line, scheme);
				},
			},
		});
	} catch (err) {
		console.error("[Notifications] Can't listen for clicks:", err);
	}
}

// A click's link, from anything on this computer that can reach the pipe: only the channel's own open link with its
// IDs (parseOpenUrl) brings the window to the front and opens the message.
async function openClicked(line: string, scheme: string) {
	let sent: unknown;
	try {
		const msg: unknown = JSON.parse(line);
		if (typeof msg === "object" && msg !== null && "type" in msg && msg.type === "OPEN_URL" && "url" in msg)
			sent = msg.url;
	} catch {
		return;
	}
	const link = typeof sent === "string" ? parseOpenUrl(sent, scheme) : null;
	if (!link) return;
	if (win.isMinimized()) win.unminimize();
	win.focus();
	try {
		await within(webviewReady, OPEN_WAIT_MS);
	} catch {
		return;
	}
	rpc.send.openMessage(link);
}

// A toast for the webview's request, with the author's photo when it's had within a moment (notification-avatars.ts).
async function showToast(request: NotificationRequest) {
	if (!notifications) return;
	const avatarPath = request.avatarUrl
		? await avatarForToast(request.avatarUrl, {
				inline: (avatarUrl) => avatarImages.inline(avatarUrl),
				dir: join(Utils.paths.userCache, "notification-avatars"),
			})
		: null;
	notifications.toasts.show({
		tag: request.id,
		group: request.chatId,
		title: request.title,
		text: request.text,
		place: request.place,
		avatarPath,
		launch: openUrl(notifications.scheme, request.link),
		silent: request.silent,
	});
}
