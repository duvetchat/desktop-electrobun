// A Settings window's end of the main window (#357): its page has the app's stores but nothing that fills them (no
// gateway connection: lib/app-windows.ts's guard), so they mirror the main window's (lib/window-sync.ts), and what the
// screen changes in them is written back. What only the main window can do, it is asked to (lib/window-hub.ts).
import { get } from "svelte/store";
import { getElectrobunRpc } from "$lib/electrobun-rpc";
import { applyOwnProfile } from "$lib/own-profile";
import { pageSettingsHost, type SettingsHost } from "$lib/settings-host";
import {
	bansKey,
	GOTO_CHANNEL,
	gotoFor,
	parseSettingsArgs,
	SETTINGS_CHANNEL,
	spaceKey,
	syncKey,
	type SettingsWindowArgs,
} from "$lib/settings-windows";
import { stagedLink } from "$lib/staged-images";
import { tellsTransferEnd } from "$lib/storage-transfers";
import { sharedBans, sharedSettings } from "$lib/stores/settings-shared.svelte";
import { storageTransfers } from "$lib/stores/storage-transfers.svelte";
import { currentUser, gatewaySpaces } from "$lib/stores.svelte";
import type { GatewaySpace, StorageTransfer } from "$lib/types";
import { askMainWindow, onWindowStates } from "$lib/window-hub";
import { SyncGuest } from "$lib/window-sync";

export interface SettingsGuest {
	/** What Bun told this window: its Space, and the section asked for. */
	readonly args: SettingsWindowArgs;
	/** Whether the main window's values are here: the screen shows from then on. */
	readonly ready: boolean;
	/** Whether the gateway says the user is connected only from the mobile app. */
	readonly mobileOnly: boolean;
	/** The section the window was last asked to show, with a number that changes each time it is. */
	readonly asked: { section: string; at: number } | null;
	readonly host: SettingsHost;
	/** Closes this window. */
	close(): void;
}

/** Starts a Settings window's end. Its page calls it once, as it loads. */
export function startSettingsGuest(): SettingsGuest {
	const args = parseSettingsArgs("__duvetSettings" in globalThis ? globalThis.__duvetSettings : null);
	const spaceId = args.spaceId;
	let ready = $state(false);
	let mobileOnly = $state(false);
	let asked = $state<{ section: string; at: number } | null>(null);
	let closing = false;

	const ask = (name: string, commandArgs?: unknown) => askMainWindow(SETTINGS_CHANNEL, name, commandArgs);
	// A command the main window didn't take (it closed, or is reloading) changes nothing here: the window goes with it.
	const tell = (name: string, commandArgs?: unknown) =>
		void ask(name, commandArgs).catch((err: unknown) =>
			console.warn(`[settings] the main window took no ${name}:`, err),
		);

	function close() {
		if (closing) return;
		closing = true;
		void getElectrobunRpc().then((rpc) => rpc?.send.closeWindow());
	}

	const staged = stagedLink(ask);
	const guest = new SyncGuest((key, value) => ask("set", { key, value }));
	// currentUser is the screen's to read: the main window's word sets it, here alone.
	guest.mirror(
		"user",
		{ get: () => get(currentUser), set: (user) => currentUser.set(user), watch: () => () => {} },
		{ readOnly: true },
	);
	guest.mirror(
		"mobileOnly",
		{ get: () => mobileOnly, set: (value) => (mobileOnly = value), watch: () => () => {} },
		{ readOnly: true },
	);
	// Each state is taken unless the one known is later (storageTransfers.set): an end first seen here is told, if
	// it is of a transfer this window shows. Any other is the main window's to tell.
	storageTransfers.tellsEnd = (transfer) => tellsTransferEnd({ window: "settings", spaceId }, transfer);
	guest.mirror<StorageTransfer[]>(
		"transfers",
		{
			get: () => Object.values(storageTransfers.byId),
			set: (transfers) => {
				if (Array.isArray(transfers)) for (const transfer of transfers) storageTransfers.set(transfer);
			},
			watch: () => () => {},
		},
		{ readOnly: true },
	);
	for (const [key, shared] of Object.entries(sharedSettings())) guest.mirror(key, shared);
	if (spaceId) {
		guest.mirror<GatewaySpace | null>(
			spaceKey(spaceId),
			{
				get: () => get(gatewaySpaces).find((space) => space.id === spaceId) ?? null,
				set: (space) => gatewaySpaces.set(space ? [space] : []),
				watch: () => () => {},
			},
			{ readOnly: true },
		);
		guest.mirror(bansKey(spaceId), sharedBans(spaceId));
	}

	function settle() {
		const here = guest.has("user") && (!spaceId || guest.has(spaceKey(spaceId)));
		if (!here) return;
		// Signed out, or a Space deleted or left: its settings close by themselves.
		if (get(currentUser) === null || (spaceId && get(gatewaySpaces).length === 0)) close();
		else ready = true;
	}

	void onWindowStates((channel, value) => {
		if (channel === GOTO_CHANNEL) {
			const section = gotoFor(value, spaceId);
			if (section) asked = { section, at: Date.now() };
			return;
		}
		const key = syncKey(channel);
		if (key === null) return;
		guest.accept(key, value);
		settle();
	}).then((listening) => {
		// The page is there: the main window shares this window's Space from now on.
		if (listening) tell("hello", { spaceId });
	});

	const host: SettingsHost = {
		logout: async () => {
			await ask("logout").catch(() => undefined);
			close();
		},
		profileSaved: (saved) => {
			// Here at once, for the screen; everywhere else in the main window.
			applyOwnProfile(saved);
			tell("profileSaved", saved);
		},
		spaceSaved: (id, saved) => {
			pageSettingsHost.spaceSaved(id, saved);
			tell("spaceSaved", { spaceId: id, saved });
		},
		spaceDeleted: (id, name) => {
			tell("spaceDeleted", { spaceId: id, name });
			close();
		},
		messageLayout: () => pageSettingsHost.messageLayout(),
		setMessageLayout: (layout) => {
			pageSettingsHost.setMessageLayout(layout);
			tell("messageLayout", { layout });
		},
		codeThemeChanged: (url) => tell("codeTheme", { url }),
		// This window's page ends with the window: the main window keeps what is picked and not saved.
		stagedImages: (scope) => staged.kept(scope),
		stageImage: (scope, slot, picked) => staged.stage(scope, slot, picked),
	};

	return {
		args,
		get ready() {
			return ready;
		},
		get mobileOnly() {
			return mobileOnly;
		},
		get asked() {
			return asked;
		},
		host,
		close,
	};
}
