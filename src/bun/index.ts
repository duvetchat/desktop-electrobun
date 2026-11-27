import Electrobun, { ApplicationMenu, BrowserView, BrowserWindow, Screen, Updater, Utils } from "electrobun/bun";
import { internalRpcHandlers } from "../../node_modules/electrobun/dist/api/bun/proc/native";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fitActivity, MAX_ACTIVITIES, type ActivityPayload } from "./activities";
import { ActivityImages, fetchImageBytes, IpcActivities, PAGE_WAIT_MS, within } from "./activity-images";
import { COPY_FETCH_MS, MAX_COPIED_BYTES, pictureToCopy } from "./copy-image";
import { copySecret, windowsClipboard } from "./secret-clipboard";
import { appMenu, DOCS_URL, runMenuAction } from "./app-menu";
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
import { isAppPage, isOwnPage, navigatedTo, navigationRules } from "./navigation";
import { startPlayerRelay } from "./player-relay";
import { Maximizer, rectOf } from "./window-frame";
import { frameFromEvent, MainWindowKeeper, openingOf, parsePrefs } from "./main-window";
import { dragWithWindows, letWindowsArrange, pageLoaded } from "./window-snap";
import { startupSummary, writeStartupLine } from "./startup";
import { UpdateChecker, type UpdateOffer } from "./updates";
import { UPDATE_PUBLIC_KEY } from "./update-key";
import { rendererFor, shellPreload, windowChrome } from "./shell";
import { keepKeysReachingThePage, type AppKit } from "./window-keys";
import { placeWindowButtons } from "./window-buttons";
import { addWindowGlass, glassAvailable, setGlassAppearance } from "./liquid-glass";
import { WindowRelay, type WindowAnswer, type WindowCommand, type WindowStateMessage } from "./window-relay";
import { MediaWindows } from "./media-window";
import { mediaWindowOpener } from "./media-window-open";
// #357, the Windows workstream: Settings and a Space's settings in windows of their own.
import { SettingsWindows, type OpenAppWindow } from "./settings-windows";
import { createSettingsWindow } from "./settings-window-native";
import { SECOND_WINDOW_PAGES, secondWindowUrl } from "../mainview/src/lib/app-windows";
import { SETTINGS_MENU_COMMAND } from "../mainview/src/lib/app-menu";
import type { E2eMessage, E2eReply } from "../mainview/src/lib/e2e/host";
import { nativeLibraryPath } from "./native-library";
import { coreLibraryPath } from "./e2e/library";
import { startCore } from "./e2e/core";
import { e2eBoundary, fileMark } from "./e2e/rpc";
import { nativeConfirm, nativeNotice } from "./e2e/confirm";
import { noticeWindow, type NoticeWindow, type NoticeWindowOptions } from "./e2e/notice-window";

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
			// Copy image, from the page's own right-click menu (#423, #450): the picture at the URL, fetched here
			// (copy-image.ts), in base64, for the page to put on the clipboard itself; null when it can't be had.
			pictureForCopy: { params: { url: string }; response: string | null };
			// The recovery key's Copy (#569): on Windows, put on the clipboard here, out of its history and the cloud
			// clipboard, and taken off a minute later (secret-clipboard.ts): true once it's there, false when the clipboard
			// took nothing. Null elsewhere, where the page copies it itself.
			copySecret: { params: { text: string }; response: boolean | null };
			// What the title bar offers of the app's own updates (updates.ts, #456); null for nothing. A page asks as it
			// starts, as updateReady may have gone out before it loaded.
			pendingUpdate: { params: void; response: UpdateOffer | null };
			// Where the YouTube relay listens (player-relay.ts), or null when it didn't start.
			playerRelay: { params: void; response: string | null };
		};
		messages: {
			closeWindow: void;
			minimizeWindow: void;
			maximizeWindow: void;
			// A press on the title bar: Windows' move loop takes it if it turns into a drag (window-snap.ts).
			startWindowDrag: void;
			openExternal: { url: string };
			openDevTools: void;
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
			// #357, the Windows workstream: open Settings or a Space's settings in its own window, or bring it forward.
			openAppWindow: OpenAppWindow;
			// The theme the main window's page wears, at its start and on each change: on macOS the glass behind its
			// sidebar takes the same (liquid-glass.ts, #374).
			windowTheme: { theme: "light" | "dark" };
			// "Restart to update": the app quits, is replaced by the version verified and opens again (#456).
			applyUpdate: void;
			// A request of the main window's page for the end-to-end encryption core (e2e/rpc.ts), answered with
			// e2eReply. A message: Electrobun's requests share one time limit, and a command can take long.
			e2e: E2eMessage;
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
			// What the title bar offers of the app's own updates, at each change: "Restart to update" for a version
			// downloaded and verified, "Download update" where it can't be applied here, null for nothing (#456).
			updateReady: UpdateOffer | null;
			// The core's answer to an e2e request, by its id.
			e2eReply: E2eReply;
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
// page's states out to them, their commands in to it. Each of those windows has an RPC instance of its own whose
// windowCommand reaches relay.commandFromWindow, and joins with relay.add, naming the channels it mirrors.
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

// Copy image, from the page's own right-click menu (#423, #450, copy-image.ts): the picture fetched here, as an
// activity's image is, in base64, for the page to put on the clipboard itself; null when it can't be had.
const pictureForCopy = (imageUrl: string): Promise<string | null> =>
	pictureToCopy(imageUrl, (from) => fetchImageBytes(from, undefined, COPY_FETCH_MS, MAX_COPIED_BYTES))
		.then((bytes) => (bytes ? Buffer.from(bytes).toString("base64") : null))
		.catch((err: unknown) => {
			console.error("[copy-image] couldn't fetch the picture:", err);
			return null;
		});

// The recovery key's Copy (#569), on Windows: the main window owns the clipboard, as SetClipboardData needs an owner.
const secretClipboard = process.platform === "win32" ? windowsClipboard(() => win.ptr) : null;
const copySecretHere = (text: string): Promise<boolean> | null =>
	secretClipboard &&
	copySecret(text, secretClipboard).catch((err: unknown) => {
		console.error("[clipboard] A secret wasn't copied:", err);
		return false;
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

// The app's own updates, on the stable channel (#456, updates.ts): found, downloaded and verified against the manifest the
// release workflow signs, then offered on the title bar; applied only when the user asks.
const updates = new UpdateChecker(Updater, new Uint8Array(Buffer.from(UPDATE_PUBLIC_KEY, "base64")), (offer) =>
	rpc.send.updateReady(offer),
);

// ── End-to-end encryption (PLAN-E2E-CLIENTES.md, Task 7) ───────────────────────────────────────────────────────────
// The core in a worker of its own (e2e/core.ts), each user's database at <userData>/e2e/<user_id>/core.db, its key in
// the system's keyring under the channel's own name (as its notifications have it) and the user's ID. The main window's
// page reaches it through e2e/rpc.ts alone: the commands of the core's contract, and a yes in the system's box, over
// this window, before what approves a device or makes new keys, and before another account's database than the one in
// <userData>/e2e/last-user opens (#558). On Linux the core keeps the key in the Secret Service, or in a file beside the
// database when the session has none. A build without the library (macOS's, for now) answers unsupported.
const coreLibrary = coreLibraryPath(nativeLibraryPath);
// What asks nothing (a new device's fingerprints, #557): Windows' own box, and elsewhere a window of Bun's, over the main
// window, which goes with it (notice-window.ts).
const notices = nativeNotice({
	platform: process.platform,
	open: process.platform === "win32" ? undefined : noticeWindow(makeNoticeWindow, () => win.getFrame()),
});
const e2e = e2eBoundary({
	start: coreLibrary
		? () =>
				startCore({
					library: coreLibrary,
					folder: join(Utils.paths.userData, "e2e"),
					keyring: { service: notificationIdentity(channel).aumid },
				})
		: null,
	confirm: nativeConfirm({ platform: process.platform, owner: () => win.ptr, showMessageBox: Utils.showMessageBox }),
	show: notices,
	lastUser: fileMark(join(Utils.paths.userData, "e2e", "last-user")),
	reply: (reply) => rpc.send.e2eReply(reply),
});

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
			pictureForCopy: ({ url: imageUrl }) => pictureForCopy(String(imageUrl)),
			copySecret: ({ text }) => copySecretHere(String(text)),
			pendingUpdate: () => updates.offer,
			playerRelay: () => playerRelay?.origin ?? null,
		},
		messages: {
			closeWindow: () => {
				// Its place is kept first, while the window is there to ask (main-window.ts).
				mainWindowKeeper.keepNow();
				win.close();
			},
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
			openDevTools: () => win.webview.openDevTools(),
			setSpotifyActivity: ({ enabled }) => {
				markWebviewReady();
				setSpotifyActivity(enabled);
			},
			windowState: (message) => {
				relay.stateFromMain(message);
				// The media controls' pop-out opens and closes on the main page's wish, one of these states (#357).
				mediaWindows.stateFromMain(message);
				// The Settings windows of the page before this one close as this one's first state says it started.
				settingsWindows.stateFromMain(message);
			},
			openAppWindow: (request) => void settingsWindows.open(request),
			applyUpdate: () => void updates.apply(),
			// The main window's alone: the pop-out's RPC (media-window-open.ts) and the Settings windows' have no e2e.
			e2e: (message) => e2e(message),
			windowTheme: ({ theme }) => {
				if (!glass || (theme !== "light" && theme !== "dark")) return;
				if (!setGlassAppearance(win.ptr, theme))
					console.error("[liquid-glass] the glass didn't take the theme:", theme);
			},
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

const rendererType = rendererFor(currentOS);

// The main window's title bar: none, with the page drawing its own title line (the sidebar's header and the tab
// strip). On macOS it is there, transparent and empty, as a window without one can't take keys there (window-keys.ts),
// and it shows the system's traffic lights, whose corner the page keeps free (lib/platform.ts: nativeTrafficLights).
// Windows and Linux have no system buttons: the page draws theirs (WindowControls.svelte, #357).
const { titleBarStyle, nativeButtons } = windowChrome(currentOS);

// The sidebar's glass on macOS (#374, liquid-glass.ts): Liquid Glass (vibrancy before macOS 26) behind the main
// window's web view, which shows where the page paints nothing. Decided before the window is made: the window must be
// transparent for it, and its page is told in its preload whether the glass is behind it. Without the library (not
// bundled, or it didn't load) the window is opaque and the sidebar the solid tint, as before.
const glass = currentOS === "darwin" && glassAvailable();

// On macOS the editing keys (⌘C, ⌘V, ⌘Z…), ⌘Q, ⌘H and ⌘M are the menu bar's (app-menu.ts). Set right before the
// window: Electrobun 1.15.1 reads the menu later, on the main thread, from memory nothing keeps (2.0 copies it first),
// and making the window waits on that thread behind the read, so a GC has next to no time to free that memory first.
if (currentOS === "darwin") {
	ApplicationMenu.setApplicationMenu(appMenu("Duvet"));
	Electrobun.events.on("application-menu-clicked", (event: unknown) =>
		runMenuAction(event, {
			settings: openSettingsFromMenu,
			docs: () => openExternalUrl(DOCS_URL),
		}),
	);
}

// ── The main window's frame (#419, main-window.ts) ──────────────────────────────────────────────────────────────────
// The first time, sized to the display under the cursor and centred in its work area; after that where it was left, as
// it was left, which is kept in the app's data. Decided before the window is made: Electrobun makes the window at the
// frame it is given and then shows it, so it never opens at one frame and jumps to another.
const mainWindowPrefs = join(Utils.paths.userData, "main-window.json");
function cursorPoint() {
	try {
		return Screen.getCursorScreenPoint();
	} catch {
		return null;
	}
}
function keptMainWindow() {
	try {
		return readFileSync(mainWindowPrefs, "utf8");
	} catch {
		return null;
	}
}
const opening = openingOf(parsePrefs(keptMainWindow()), Screen.getAllDisplays(), cursorPoint(), currentOS);
console.log(
	`[window] opens at ${JSON.stringify(opening.frame)}` +
		(opening.maximized ? ", maximized" : "") +
		(opening.fullScreen ? ", full screen" : ""),
);

const win = new BrowserWindow({
	titleBarStyle,
	// A clear, non-opaque window, for the glass behind the page: Electrobun turns its shadow off, the glass's library
	// turns it back on.
	transparent: glass,
	renderer: rendererType,
	// What only Bun knows about this window, for the page's platform switch (shell.ts, lib/platform.ts), set before
	// any of the page's scripts run.
	preload: shellPreload("main", { titleBarStyle, nativeButtons, glass }),
	sandbox: false,
	frame: opening.frame,
	title: "Duvet",
	url,
	rpc,
});
bunMarks.window = Date.now();
// Looks for a newer version a while after the start and every few hours, on the stable channel alone (#456).
void updates.start();
// On macOS the system has the traffic lights in the corner of its own title bar, which is shorter than the page's
// title line: they go in that line, centred in it (window-buttons.ts, #406). Before anything else is done to the
// window: Electrobun shows a window as it makes it, with its lights still at that corner. Without the library they
// stay there.
if (nativeButtons) placeWindowButtons(win.ptr);
relay.setMain((command) => rpc.request.windowCommand(command));
// A window left maximized opened filling its display's work area (on Windows it is maximized below): the title bar's
// next maximize puts back the frame it had before.
if (opening.maximized && currentOS !== "win32") maximizer.resume(opening.normal, opening.area);

// Under the web view, whenever it is made: Electrobun adds web views above everything the window holds.
if (glass) {
	const result = addWindowGlass(win.ptr);
	if (result === "glass" || result === "vibrancy") console.log(`[liquid-glass] ${result} behind the main window`);
	else console.error(`[liquid-glass] no glass behind the main window (${result}): the sidebar shows the desktop bare`);
}

// Win+Left and Win+Right snap the window, and Win+Up and Win+Down maximize, restore and minimize it, once it takes what
// Windows asks of a window for that (window-snap.ts, #345).
const arrangedByWindows = currentOS === "win32" && arrangeByWindows();

function arrangeByWindows(): boolean {
	try {
		// With the smallest size the window may be made (#419), which the same procedure answers Windows.
		if (letWindowsArrange(win.ptr, undefined, opening.minimum)) return true;
		console.error("[window] Windows' keys won't snap or maximize the window: it didn't take window-snap's procedure");
	} catch (err) {
		console.error("[window] Windows' keys won't snap or maximize the window:", err);
	}
	return false;
}

// A window left maximized opens maximized on Windows too: by Windows' own maximize once the window takes it, which
// restores to the frame the window was made at; else as the title bar's maximize fills the work area.
if (opening.maximized && currentOS === "win32") {
	if (arrangedByWindows) win.maximize();
	else {
		maximizer.resume(opening.normal, opening.area);
		win.setFrame(opening.area.x, opening.area.y, opening.area.width, opening.area.height);
	}
}

// On macOS, keys reach the page once its web view is the window's first responder (window-keys.ts). AppKit's bridge is
// loaded there only; if it can't be, the app runs as it did, and a click in the page gives it the keyboard.
const appkit: (AppKit & typeof import("./appkit")) | null =
	currentOS === "darwin"
		? await import("./appkit").catch((err: unknown) => {
				console.error("[window] AppKit's bridge didn't load:", err);
				return null;
			})
		: null;
keepKeysReachingThePage(win, appkit, { nativeButtons });

// The smallest the window may be made (#419): on macOS AppKit holds a resize to it, on Windows the window's procedure
// does (arrangeByWindows above). Electrobun has no call for it, and on Linux nothing holds the window to one.
if (appkit) {
	try {
		if (!appkit.setMinSize(win.ptr, opening.minimum.width, opening.minimum.height))
			console.error("[window] the window took no minimum size");
	} catch (err) {
		console.error("[window] the window took no minimum size:", err);
	}
}

// Where the window is and how, kept as it moves, is resized and closes (main-window.ts), for the next time it opens.
const mainWindowKeeper = new MainWindowKeeper(
	{
		platform: currentOS,
		// On macOS Electrobun 1.15.1 works out a window's own frame (getFrame) from the height of the display the window
		// is on, and the displays' areas and its move and resize events from the primary display's: on a second display
		// of another height, getFrame is off by the difference. There the frame is the one the events carry.
		frame: () => (currentOS === "darwin" ? null : rectOf(win.getFrame())),
		state: () => ({
			minimized: win.isMinimized(),
			maximized: win.isMaximized(),
			// Not on Windows, where nothing in the app makes the window full screen, and Electrobun takes a window with
			// no caption, as this one is without window-snap's styles, for a full-screen one.
			fullScreen: currentOS !== "win32" && win.isFullScreen(),
		}),
		filled: (frame) => maximizer.fills(frame),
		displays: () => Screen.getAllDisplays(),
		writePrefs: (text) => {
			mkdirSync(dirname(mainWindowPrefs), { recursive: true });
			writeFileSync(mainWindowPrefs, text);
		},
		log: (line) => console.error(`[window] ${line}`),
	},
	opening,
);
const mainWindowMoved = (event: unknown) =>
	mainWindowKeeper.moved(currentOS === "darwin" ? frameFromEvent(event, mainWindowKeeper.frame) : null);
win.on("move", mainWindowMoved);
win.on("resize", mainWindowMoved);
win.on("close", () => mainWindowKeeper.closed());
// The app quitting with its window open (⌘Q): the window is still there to ask.
Electrobun.events.on("before-quit", () => mainWindowKeeper.keepNow());
// A window left full screen opens full screen, from the frame it had before, which leaving full screen gives back.
if (opening.fullScreen && currentOS !== "win32") {
	try {
		win.setFullScreen(true);
	} catch (err) {
		console.error("[window] the window didn't go full screen:", err);
	}
}

// Through the webview: BrowserWindow stores a navigationRules option of its own, and never hands it to the native side.
// As each page loads, not right after new BrowserWindow: macOS reads them later on its main queue, from an address
// nothing keeps, and right after new BrowserWindow that queue still has the webview's creation ahead of them, so a GC in
// that gap could leave no rules, with no sign. Only the app's own first page can load before they apply.
const devServer = url === DEV_SERVER_URL ? url : null;
// What frames YouTube's player with a Referer, on loopback (player-relay.ts), before the first page can ask where.
const playerRelay = startPlayerRelay();
const rules = navigationRules(currentOS, devServer, playerRelay?.origin ?? null);
win.webview.on("dom-ready", () => win.webview.setNavigationRules(rules));

// On Windows Electrobun gives the webview no keyboard: as Duvet opens, the page takes it once it has loaded (#361).
if (arrangedByWindows) win.webview.on("dom-ready", () => pageLoaded(win.ptr));

// On Linux a window manager that resizes the window as it opens does so before the browser exists, and the webview
// keeps the size it was made at: the page fills that and the rest of the window is white. A tiling one refuses a
// resize of the window to make it notice, so once the page has loaded the webview gets the window's size straight from
// the native side, by the call Electrobun's own webview tags make. Its package exports no way to do that, hence the path.
if (currentOS === "linux") {
	let sized = false;
	win.webview.on("dom-ready", () => {
		if (sized) return;
		sized = true;
		const { width, height } = win.getFrame();
		const frame = { x: 0, y: 0, width, height };
		internalRpcHandlers.message.webviewTagResize({ id: win.webview.id, frame, masks: "[]" });
	});
}

// ── The media controls' pop-out (#357, calls and media) ─────────────────────────────────────────────────────────────
// A small window of its own for the media controls, which the main page asks for (media-window.ts). The call stays in
// the main window: this one mirrors its state through the relay and sends its commands back. It closes with the main
// window, and when that window leaves the app's page (signing out). Its place and its pin are kept in the app's data.
const mediaWindowPrefs = join(Utils.paths.userData, "media-window.json");
// Brings the main window forward, out of the Dock or the taskbar if it was there: for the pop-out's commands that need
// it in front, and as a Settings window closes.
function focusMain() {
	if (win.isMinimized()) win.unminimize();
	win.focus();
}
// The menu bar's Settings… on macOS: the main window comes forward, and its page opens Settings as ⌘, does, through the
// relay's command (ProfileRow.svelte). A page with no Settings to open, signing in, answers that it has none.
function openSettingsFromMenu() {
	focusMain();
	void rpc.request
		.windowCommand(SETTINGS_MENU_COMMAND)
		.catch((err: unknown) => console.error("[menu] Settings… reached no page:", err));
}
const mediaWindows: MediaWindows = new MediaWindows({
	create: mediaWindowOpener({
		url: url === DEV_SERVER_URL ? `${DEV_SERVER_URL}/voice-controls` : (secondWindowUrl("media") ?? ""),
		renderer: rendererType,
		platform: currentOS,
		appkit,
		rules,
		command: (command) => mediaWindows.commandFromWindow(command),
	}),
	displays: () => Screen.getAllDisplays(),
	mainFrame: () => win.getFrame(),
	focusMain,
	relay,
	readPrefs: () => {
		try {
			return readFileSync(mediaWindowPrefs, "utf8");
		} catch {
			return null;
		}
	},
	writePrefs: (text) => {
		mkdirSync(dirname(mediaWindowPrefs), { recursive: true });
		writeFileSync(mediaWindowPrefs, text);
	},
	log: (line) => console.log(`[media-window] ${line}`),
});
win.on("close", () => mediaWindows.mainClosed());
// ── end of the media controls' pop-out ──────────────────────────────────────────────────────────────────────────────
// ── #357, the Windows workstream's hook: the Settings windows (settings-windows.ts) ──────────────────────────────────
const settingsWindows = new SettingsWindows({
	platform: currentOS,
	pages: SECOND_WINDOW_PAGES,
	create: (spec) =>
		createSettingsWindow(spec, {
			renderer: rendererType,
			pageUrl: (page) => (url === DEV_SERVER_URL ? `${DEV_SERVER_URL}/${page}` : `views://mainview/${page}.html`),
			rules,
			appkit,
			openExternal: openExternalUrl,
			command: (command) => relay.commandFromWindow(command),
		}),
	mainFrame: () => win.getFrame(),
	displays: () => Screen.getAllDisplays(),
	relay,
	tellMain: (command) => void rpc.request.windowCommand(command).catch(() => undefined),
	focusMain,
});
// ── end of the Windows workstream's hook ─────────────────────────────────────────────────────────────────────────────

// A notice's window, off Windows (e2e/notice-window.ts), made only once the main window is: the menu bar goes first.
function makeNoticeWindow(options: NoticeWindowOptions): NoticeWindow {
	return new BrowserWindow({ ...options, renderer: rendererType });
}

// The app's other windows show what the main window's page shares, and go with it.
win.on("close", () => {
	settingsWindows.closeAll();
	notices(null);
	// Nobody answers a command now, and nothing of the page that was is kept for a window to come.
	relay.setMain(null);
	relay.reset();
});
// Where the main window's page is: Electrobun says so as a navigation commits (did-navigate, each system's own) and
// again once the page has loaded (dom-ready, which the page itself sends on every system, with its address). Off the
// app's page, which is signing out, the pop-out and the Settings windows go, and the relay lets go of what the app's
// page published: the next account's windows are handed none of it. The app's page loading again (a reload) is told
// apart by its states' epoch instead (settingsWindows.stateFromMain, the relay's own): `load` comes after the app is
// in use, and a Settings window opened in between was closed by it.
const mainPageAt = (event: unknown) => {
	const to = navigatedTo(event);
	if (to === null || !isOwnPage(to, devServer)) return;
	mediaWindows.mainNavigated(to);
	settingsWindows.mainNavigated(to);
	if (!isAppPage(to)) relay.reset();
};
win.webview.on("did-navigate", mainPageAt);
win.webview.on("dom-ready", mainPageAt);

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
