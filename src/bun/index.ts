import Electrobun, { BrowserView, BrowserWindow, Screen, Updater, Utils } from "electrobun/bun";
import { dirname, join } from "node:path";
import { fitActivity, MAX_ACTIVITIES, type ActivityPayload } from "./activities";
import { ActivityImages, IpcActivities, PAGE_WAIT_MS, within } from "./activity-images";
import { avatarForToast } from "./notification-avatars";
import { forwarderScript } from "./notification-forwarder";
import { openUrl, parseOpenUrl, type NotificationLink } from "./notification-links";
import {
	listenAndSetUp,
	notificationIdentity,
	setUpNotifications,
	type NotificationIdentity,
} from "./notification-setup";
import { Toasts } from "./toasts";
import { startSpotifyReader, type SpotifyActivity } from "./spotify";
import { ipcHeld, ipcPath, LineReader } from "./ipc";
import { navigationRules } from "./navigation";
import { Maximizer } from "./window-frame";
import { dragWithWindows, letWindowsArrange } from "./window-snap";
import { startupSummary, writeStartupLine } from "./startup";
import { shellPreload } from "./shell";
import { keepKeysReachingThePage, mainWindowTitleBar, type AppKit } from "./window-keys";
import { WindowRelay, type WindowAnswer, type WindowCommand, type WindowStateMessage } from "./window-relay";

// When Bun started, and its own steps of the app's start, which the page's join in startup.log (startupTimings, #280):
// its code running (what loads before it, Electrobun's API, comes first) and the window made.
const processStart = Date.now() - process.uptime() * 1000;
const bunMarks: Record<string, number> = {};
bunMarks.code = Date.now();

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

	// app.html itself, which sends a page with no session to sign in: index.html loaded it as a second page (#285).
	return "views://mainview/app.html";
}

const url = await getMainViewUrl();

type AppRPCSchema = {
	bun: {
		requests: {
			// A message that notifies without the focus, on Windows (lib/system-notifications.ts): shown as a toast. The
			// answer says whether it showed: one that didn't shows as Duvet's notice instead.
			showNotification: { params: NotificationRequest; response: boolean };
			// The message of the toast clicked last, kept until a page takes it: a click can come before any page listens
			// (a Duvet the click started, its sign-in page, a reload). null for none.
			takeClickedMessage: { params: void; response: NotificationLink | null };
			// Whether Windows' move loop drags the window: on Windows, once window-snap.ts is in (#348). The page then
			// reports the title bar's presses (startWindowDrag) instead of leaving them to Electrobun's drag.
			nativeWindowDrag: { params: void; response: boolean };
			// From a window that isn't the main one: a command for the main window's page, forwarded to it
			// (webview.requests.windowCommand), whose answer comes back (window-relay.ts).
			windowCommand: { params: WindowCommand; response: WindowAnswer };
		};
		messages: {
			closeWindow: void;
			minimizeWindow: void;
			maximizeWindow: void;
			// A press on the title bar: Windows' move loop takes it if it turns into a drag (window-snap.ts).
			startWindowDrag: void;
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
			// The page's steps of the app's start, each when it happened (Date.now()), for startup.log (#280, #288).
			startupTimings: { marks: Record<string, number> };
			// From the main window: a state its other windows mirror, sent on to each of them.
			windowState: WindowStateMessage;
		};
	};
	webview: {
		requests: {
			// An IPC app's activity image, fetched here: the webview makes it a small inline image (it has a canvas,
			// Bun has no image decoder), or answers null. Its bytes go in base64.
			activityImage: { params: { bytes: string }; response: string | null };
			// To the main window: a command another window sent, to answer.
			windowCommand: { params: WindowCommand; response: WindowAnswer };
		};
		messages: {
			activityUpdate: ActivityPayload[] | null;
			// A toast was clicked: its message is the page's to take (takeClickedMessage).
			messageClicked: void;
			// To a window that isn't the main one: a state of the main window's, to mirror.
			windowState: WindowStateMessage;
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

// What crosses between the main window and the app's other windows (the media controls' pop-out, Settings): the main
// page's states out to them, their commands in to it. No other window exists yet: each one, as its phase builds it,
// gets an RPC instance of its own whose windowCommand is relay.commandFromWindow, and joins with relay.add.
const relay = new WindowRelay();

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
		requests: {
			showNotification: (request) => showToast(request),
			takeClickedMessage: () => {
				const link = clicked;
				clicked = null;
				return link;
			},
			nativeWindowDrag: () => arrangedByWindows,
			// The main window's page answers commands, and sends none.
			windowCommand: () => ({ ok: false, error: "The main window sends no commands" }),
		},
		messages: {
			closeWindow: () => win.close(),
			minimizeWindow: () => win.minimize(),
			maximizeWindow: () => {
				// Windows' own once it keeps the taskbar (window-snap.ts): the title bar's maximize is then Win+Up's, which
				// Win+Down restores.
				if (arrangedByWindows) {
					if (win.isMaximized()) win.unmaximize();
					else win.maximize();
					return;
				}
				const frame = maximizer.press(win.getFrame(), Screen.getAllDisplays());
				if (frame) win.setFrame(frame.x, frame.y, frame.width, frame.height);
			},
			startWindowDrag: () => {
				if (arrangedByWindows) void dragWithWindows(win.ptr);
			},
			openExternal: ({ url: externalUrl }) => openExternalUrl(externalUrl),
			setSpotifyActivity: ({ enabled }) => {
				markWebviewReady();
				setSpotifyActivity(enabled);
			},
			windowState: (message) => relay.stateFromMain(message),
			startupTimings: ({ marks }) => {
				const line = `${new Date().toISOString()} ${startupSummary(processStart, { ...bunMarks, ...marks })}`;
				console.log(line);
				// In a file of the app's data: the packaged app keeps no output of Bun's (#288).
				writeStartupLine(join(Utils.paths.userData, "startup.log"), line).catch((err: unknown) =>
					console.error("[startup] couldn't keep the start's line:", err),
				);
			},
		},
	},
});

const currentOS = process.platform;

const rendererType = currentOS === "linux" ? "cef" : "native";

// The main window's title bar: none, with the page drawing its own title line (the sidebar's header and the tab
// strip). On macOS it is there, transparent and empty, as a window without one can't take keys there (window-keys.ts),
// and it shows the system's traffic lights, whose corner the page keeps free (lib/platform.ts: nativeTrafficLights).
// Windows and Linux have no system buttons: the page draws theirs (WindowControls.svelte, #357).
const titleBarStyle = mainWindowTitleBar(currentOS);
const nativeButtons = currentOS === "darwin";

const win = new BrowserWindow({
	titleBarStyle,
	renderer: rendererType,
	// What only Bun knows about this window, for the page's platform switch (shell.ts, lib/platform.ts), set before
	// any of the page's scripts run.
	preload: shellPreload("main", { titleBarStyle, nativeButtons }),
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
bunMarks.window = Date.now();
relay.setMain((command) => rpc.request.windowCommand(command));

// Win+Left and Win+Right snap the window, and Win+Up and Win+Down maximize, restore and minimize it, once it takes what
// Windows asks of a window for that (window-snap.ts, #345).
const arrangedByWindows = currentOS === "win32" && arrangeByWindows();

function arrangeByWindows(): boolean {
	try {
		if (letWindowsArrange(win.ptr)) return true;
		console.error("[window] Windows' keys won't snap or maximize the window: it didn't take window-snap's procedure");
	} catch (err) {
		console.error("[window] Windows' keys won't snap or maximize the window:", err);
	}
	return false;
}

// On macOS, keys reach the page once its web view is the window's first responder (window-keys.ts). AppKit's bridge is
// loaded there only; if it can't be, the app runs as it did, and a click in the page gives it the keyboard.
const appkit: AppKit | null =
	currentOS === "darwin"
		? await import("./appkit").catch((err: unknown) => {
				console.error("[window] AppKit's bridge didn't load:", err);
				return null;
			})
		: null;
keepKeysReachingThePage(win, appkit, { nativeButtons });

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

let notifications: { toasts: Toasts; scheme: string } | null = null;
// The message of the toast clicked last, until a page takes it (takeClickedMessage).
let clicked: NotificationLink | null = null;

if (currentOS === "win32") void startNotifications();

async function startNotifications() {
	const identity = notificationIdentity(channel);
	// The installed app's launcher, which the forwarder starts detached, so it outlives it (notification-forwarder.ts).
	const launcher = [join(dirname(process.execPath), "launcher.exe")];
	const ready = await listenAndSetUp(
		() => listenForClicks(identity),
		() => setUpNotifications(channel, Utils.paths.userData, forwarderScript(identity.pipe, launcher)),
	);
	if (ready) notifications = { toasts: new Toasts(identity.aumid), scheme: identity.scheme };
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
					for (const line of lines) openClicked(line, scheme);
				},
			},
		});
	} catch (err) {
		console.error("[Notifications] Can't listen for clicks:", err);
	}
}

// A click's link, from anything on this computer that can reach the pipe: only the channel's own open link with its
// IDs (parseOpenUrl) brings the window to the front, and its message is kept for the page, which is told.
function openClicked(line: string, scheme: string) {
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
	clicked = link;
	if (win.isMinimized()) win.unminimize();
	win.focus();
	rpc.send.messageClicked();
}

// A toast for the webview's request, with the author's photo when it's had within a moment (notification-avatars.ts),
// and whether it showed, as the helper answers (toasts.ts).
async function showToast(request: NotificationRequest): Promise<boolean> {
	// No toasts until they're set up, nor when that failed: the webview shows Duvet's notice instead.
	if (!notifications) return false;
	const avatarPath = request.avatarUrl
		? await avatarForToast(request.avatarUrl, {
				inline: (avatarUrl) => avatarImages.inline(avatarUrl),
				dir: join(Utils.paths.userCache, "notification-avatars"),
			})
		: null;
	return notifications.toasts.show({
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
