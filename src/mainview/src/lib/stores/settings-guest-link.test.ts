import { expect, mock, test } from "bun:test";
import { get } from "svelte/store";

// A Settings window's end of the main window (#357), against a fake of the main window: when its screen may show,
// and when it closes by itself.
// The stores' .svelte.ts modules use runes, which only Svelte's compiler knows: here $state is the value itself, and
// an effect (one saves the layout's choices as they change) never runs.
Object.assign(globalThis, {
	$state: <T>(value: T) => value,
	$effect: Object.assign(() => {}, { root: () => () => {} }),
});

type Listener = (channel: string, value: unknown) => void;
const main = {
	listeners: [] as Listener[],
	asked: [] as [string, string, unknown][],
	closed: 0,
};
mock.module("$lib/window-hub", () => ({
	onWindowStates: (listener: Listener) => {
		main.listeners.push(listener);
		return Promise.resolve(true);
	},
	askMainWindow: (channel: string, name: string, args?: unknown) => {
		main.asked.push([channel, name, args]);
		return Promise.resolve(null);
	},
	answerWindows: () => {},
	publishToWindows: () => {},
}));
mock.module("$lib/electrobun-rpc", () => ({
	getElectrobunRpc: () => Promise.resolve({ send: { closeWindow: () => void main.closed++ } }),
	isElectrobunWindow: () => true,
}));
const { startSettingsGuest } = await import("./settings-guest-link.svelte");
const { currentUser, gatewaySpaces } = await import("$lib/stores.svelte");

const SPACE = "01920000-0000-7000-8000-0000000005a1";
const user = { id: "01920000-0000-7000-8000-00000000b0b0", username: "tamsin" };
const space = { id: SPACE, name: "Harbour Lights", rooms: [], roles: [] };
const settled = async () => {
	for (let i = 0; i < 5; i++) await Promise.resolve();
};
/** A window's page, started as Bun starts it, and the main window's way to speak to it. */
async function open(args: { spaceId?: string; section?: string } | null) {
	Object.assign(globalThis, { __duvetSettings: args });
	main.asked.length = 0;
	main.closed = 0;
	const guest = startSettingsGuest();
	await settled();
	const say = main.listeners.at(-1)!;
	return { guest, say };
}
const told = (name: string) => main.asked.filter(([channel, said]) => channel === "settings" && said === name);

test("Settings' own window says hello, and is ready once the user has arrived", async () => {
	const { guest, say } = await open(null);
	expect(guest.args).toEqual({ spaceId: null, section: null });
	expect(told("hello")).toEqual([["settings", "hello", { spaceId: null }]]);
	expect(guest.ready).toBe(false);
	// Another channel's state, and a shared value that isn't the user, don't make it ready.
	say("media", { muted: true });
	say("sync:mobileOnly", false);
	expect(guest.ready).toBe(false);
	say("sync:user", user);
	expect(guest.ready).toBe(true);
	expect(get(currentUser)).toMatchObject(user);
	expect(guest.mobileOnly).toBe(false);
	expect(main.closed).toBe(0);
});

test("a Space's window is ready only once both the user and the Space have arrived, in either order", async () => {
	const first = await open({ spaceId: SPACE, section: "roles" });
	expect(first.guest.args).toEqual({ spaceId: SPACE, section: "roles" });
	expect(told("hello")).toEqual([["settings", "hello", { spaceId: SPACE }]]);
	first.say("sync:user", user);
	expect(first.guest.ready).toBe(false);
	first.say(`sync:space:${SPACE}`, space);
	expect(first.guest.ready).toBe(true);
	expect(get(gatewaySpaces).map((s) => s.id)).toEqual([SPACE]);

	const second = await open({ spaceId: SPACE });
	second.say(`sync:space:${SPACE}`, space);
	expect(second.guest.ready).toBe(false);
	second.say("sync:user", user);
	expect(second.guest.ready).toBe(true);
	expect(main.closed).toBe(0);
});

test("signed out in the main window, the window closes by itself, once", async () => {
	const { guest, say } = await open(null);
	say("sync:user", user);
	expect(guest.ready).toBe(true);
	say("sync:user", null);
	say("sync:user", null);
	await settled();
	expect(main.closed).toBe(1);
});

test("a window that opens signed out never shows its screen", async () => {
	const { guest, say } = await open(null);
	say("sync:user", null);
	await settled();
	expect(guest.ready).toBe(false);
	expect(main.closed).toBe(1);
});

test("a Space deleted or left closes its settings, and leaves Settings' own window open", async () => {
	const own = await open(null);
	const ofSpace = await open({ spaceId: SPACE });
	ofSpace.say("sync:user", user);
	ofSpace.say(`sync:space:${SPACE}`, space);
	expect(ofSpace.guest.ready).toBe(true);
	ofSpace.say(`sync:space:${SPACE}`, null);
	await settled();
	expect(main.closed).toBe(1);
	expect(own.guest.ready).toBe(false);
});

test("it shows the section it is asked to, when the asking is for this window", async () => {
	const { guest, say } = await open({ spaceId: SPACE });
	expect(guest.asked).toBeNull();
	say("settings:goto", { spaceId: null, section: "appearance" });
	say("settings:goto", { spaceId: "another", section: "roles" });
	expect(guest.asked).toBeNull();
	say("settings:goto", { spaceId: SPACE, section: "bans" });
	expect(guest.asked?.section).toBe("bans");
});

test("deleting the Space tells the main window and closes; signing out asks it first, then closes", async () => {
	const { guest } = await open({ spaceId: SPACE });
	guest.host.spaceDeleted(SPACE, "Harbour Lights");
	await settled();
	expect(told("spaceDeleted")).toEqual([["settings", "spaceDeleted", { spaceId: SPACE, name: "Harbour Lights" }]]);
	expect(main.closed).toBe(1);

	const own = await open(null);
	await own.guest.host.logout();
	await settled();
	expect(told("logout")).toHaveLength(1);
	expect(main.closed).toBe(1);
	// Closing is asked of Bun once, whatever asks again.
	own.guest.close();
	await settled();
	expect(main.closed).toBe(1);
});
