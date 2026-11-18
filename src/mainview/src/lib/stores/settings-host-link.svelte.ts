// The main window's end of the Settings windows (#357): it owns the app's stores, so it shares with the windows what
// their screens show (lib/window-sync.ts) and does for them what only it can (lib/window-hub.ts's commands): put a
// saved profile in every store, sign out, load a code theme for its own code blocks. It opens no gateway connection of
// its own to do so, and reaches none: the Settings windows' pages import this file's neighbour, not this one.
import { get, type Readable } from "svelte/store";
import { getElectrobunRpc } from "$lib/electrobun-rpc";
import { loadCustomTheme, resetTheme } from "$lib/markdown";
import { parseSavedProfile } from "$lib/own-profile";
import { pageSettingsHost, parseMessageLayout, parseSavedSpace } from "$lib/settings-host";
import {
	bansKey,
	parseWrite,
	SETTINGS_CHANNEL,
	spaceKey,
	syncChannel,
	type OpenAppWindow,
} from "$lib/settings-windows";
import { reading, runes, sharedBans, sharedSettings } from "$lib/stores/settings-shared.svelte";
import { storageTransfers } from "$lib/stores/storage-transfers.svelte";
import { currentUser, gatewaySpaces } from "$lib/stores.svelte";
import { answerWindows, publishToWindows } from "$lib/window-hub";
import { SyncHost } from "$lib/window-sync";

let host: SyncHost | null = null;
// What stops sharing each Space whose settings window is open.
const sharedSpaces = new Map<string, () => void>();

function shareSpace(spaceId: string) {
	if (!host || sharedSpaces.has(spaceId)) return;
	// A Space's object is new with every presence update, and long: its changes go out a few times a second at most.
	const stopSpace = host.share(
		spaceKey(spaceId),
		{
			get: () => get(gatewaySpaces).find((space) => space.id === spaceId) ?? null,
			set: () => {},
			watch: (changed) => gatewaySpaces.subscribe(() => changed()),
		},
		{ throttleMs: 150 },
	);
	const stopBans = host.share(bansKey(spaceId), sharedBans(spaceId));
	sharedSpaces.set(spaceId, () => {
		stopSpace();
		stopBans();
	});
}

const fieldsOf = (args: unknown): Record<string, unknown> =>
	typeof args === "object" && args !== null ? { ...args } : {};
const textOf = (args: unknown, key: string): string | null => {
	const value = fieldsOf(args)[key];
	return typeof value === "string" ? value : null;
};

/**
 * Starts the main window's end, once: from then on it shares the user's values with any Settings window, and answers
 * their commands. `mobileOnly` is the gateway connection's word on whether the user is connected only from the mobile
 * app, which whoever imports the connection hands over.
 */
export function startSettingsHost(mobileOnly: Readable<boolean>): void {
	if (host) return;
	const sync = new SyncHost((key, value) => publishToWindows(syncChannel(key), value));
	host = sync;
	sync.share("user", reading(currentUser));
	sync.share("mobileOnly", reading(mobileOnly));
	for (const [key, shared] of Object.entries(sharedSettings())) sync.share(key, shared);
	// Whoever started a transfer gets its progress live, from the gateway: the windows get it from here.
	sync.share(
		"transfers",
		runes(
			() => Object.values(storageTransfers.byId),
			() => {},
		),
	);

	answerWindows(SETTINGS_CHANNEL, {
		set: (args) => {
			const write = parseWrite(args);
			return write ? sync.write(write.key, write.value) : false;
		},
		// A Settings window's page is there: its Space's values are shared from now on.
		hello: (args) => {
			const spaceId = textOf(args, "spaceId");
			if (spaceId) shareSpace(spaceId);
			return true;
		},
		// From Bun, as a Settings window closes.
		closed: (args) => {
			const spaceId = textOf(args, "spaceId");
			if (spaceId) {
				sharedSpaces.get(spaceId)?.();
				sharedSpaces.delete(spaceId);
			}
			return true;
		},
		profileSaved: (args) => {
			const saved = parseSavedProfile(args);
			if (saved) pageSettingsHost.profileSaved(saved);
			return saved !== null;
		},
		spaceSaved: (args) => {
			const spaceId = textOf(args, "spaceId");
			const saved = parseSavedSpace(fieldsOf(args).saved);
			if (spaceId && saved) pageSettingsHost.spaceSaved(spaceId, saved);
			return spaceId !== null && saved !== null;
		},
		spaceDeleted: (args) => {
			const spaceId = textOf(args, "spaceId");
			if (spaceId) pageSettingsHost.spaceDeleted(spaceId, textOf(args, "name") ?? "The Space");
			return spaceId !== null;
		},
		messageLayout: (args) => {
			pageSettingsHost.setMessageLayout(parseMessageLayout(textOf(args, "layout")));
			return true;
		},
		// The window loaded the theme itself before saying so; the main window's code blocks take it too.
		codeTheme: async (args) => {
			const url = textOf(args, "url");
			if (url) await loadCustomTheme(url);
			else await resetTheme();
			return true;
		},
		logout: () => {
			void pageSettingsHost.logout();
			return true;
		},
	});
}

/** Asks Bun for a Settings window: a new one, or the open one brought forward. False outside the desktop app. */
export async function openAppWindow(request: OpenAppWindow): Promise<boolean> {
	const rpc = await getElectrobunRpc();
	if (!rpc) return false;
	if (request.window === "space-settings") shareSpace(request.spaceId);
	rpc.send.openAppWindow(request);
	return true;
}
