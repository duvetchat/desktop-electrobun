import { expect, mock, test } from "bun:test";
import { writable } from "svelte/store";
import type { GatewaySpace, GatewayUser } from "$lib/types";

// The main window's end of the Settings windows (#357), against a fake of the windows' hub: what it shares, with
// whom and until when, and what it answers.
// The stores' .svelte.ts modules use runes, which only Svelte's compiler knows: here $state is the value itself, and
// an effect never runs.
Object.assign(globalThis, {
	$state: <T>(value: T) => value,
	$effect: Object.assign(() => {}, { root: () => () => {} }),
});

type Commands = Record<string, (args: unknown) => unknown>;
const hub = {
	published: [] as [string, unknown][],
	answering: [] as [string, Commands][],
	opened: [] as unknown[],
};
let inApp = true;
mock.module("$lib/window-hub", () => ({
	publishToWindows: (channel: string, value: unknown) => void hub.published.push([channel, value]),
	answerWindows: (channel: string, commands: Commands) => void hub.answering.push([channel, commands]),
	onWindowStates: () => Promise.resolve(false),
	askMainWindow: () => Promise.reject(new Error("not asked here")),
}));
mock.module("$lib/electrobun-rpc", () => ({
	getElectrobunRpc: () =>
		Promise.resolve(inApp ? { send: { openAppWindow: (request: unknown) => void hub.opened.push(request) } } : null),
	isElectrobunWindow: () => inApp,
}));
const { openAppWindow, startSettingsHost } = await import("./settings-host-link.svelte");
const { currentUser, gatewaySpaces } = await import("$lib/stores.svelte");

const SPACE = "01920000-0000-7000-8000-0000000005a1";
const OTHER = "01920000-0000-7000-8000-0000000005a2";
const user: GatewayUser = {
	id: "01920000-0000-7000-8000-00000000b0b0",
	username: "tamsin",
	email_verified: true,
	alias: null,
	avatar: null,
	banner: null,
	custom: "",
	flags: 0,
	badges: 0,
	is_bot: false,
	created_at: "",
	updated_at: "",
};
const space = (id: string, name: string): GatewaySpace => ({
	id,
	name,
	description: null,
	banner: null,
	owner_id: user.id,
	locale: null,
	member_roles: {},
	room_overwrites: [],
	rooms: [],
	members: [],
	roles: [],
	users: [],
	created_at: "",
	updated_at: "",
});
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const last = (channel: string) => hub.published.findLast(([said]) => said === channel)?.[1];
const count = (channel: string) => hub.published.filter(([said]) => said === channel).length;
const mobileOnly = writable(false);
const commands = () => hub.answering[0]![1];

test("it starts once, shares the user's values at once, and answers on the settings channel", () => {
	currentUser.set(user);
	gatewaySpaces.set([space(SPACE, "Harbour Lights"), space(OTHER, "Kiln & Clay")]);
	startSettingsHost(mobileOnly);
	startSettingsHost(mobileOnly);
	expect(hub.answering.map(([channel]) => channel)).toEqual(["settings"]);
	expect(last("sync:user")).toMatchObject(user);
	expect(last("sync:mobileOnly")).toBe(false);
	for (const key of [
		"teamInvites",
		"buckets",
		"voiceFaces",
		"shareSpotify",
		"shareGameActivity",
		"micId",
		"cameraId",
		"noiseSuppression",
		"theme",
		"layout",
		"audio",
		"transfers",
	])
		expect(count(`sync:${key}`), key).toBe(1);
	// No Space is shared until a window for it is there.
	expect(hub.published.some(([channel]) => channel.startsWith("sync:space:"))).toBe(false);
});

test("a change of a shared value goes out, and the same value again doesn't", () => {
	const before = count("sync:user");
	currentUser.set({ ...user, username: "tamsin-h" });
	expect(count("sync:user")).toBe(before + 1);
	expect(last("sync:user")).toMatchObject({ username: "tamsin-h" });
	currentUser.set({ ...user, username: "tamsin-h" });
	expect(count("sync:user")).toBe(before + 1);
	mobileOnly.set(true);
	expect(last("sync:mobileOnly")).toBe(true);
	// Signed out: the windows are told, and close by themselves (settings-guest-link.test.ts).
	currentUser.set(null);
	expect(last("sync:user")).toBeNull();
	currentUser.set(user);
});

test("a window's hello shares its Space and its bans, its changes gathered; closed stops and wipes them", async () => {
	expect(commands().hello!({ spaceId: SPACE })).toBe(true);
	expect(last(`sync:space:${SPACE}`)).toMatchObject({ id: SPACE, name: "Harbour Lights" });
	expect(count(`sync:bans:${SPACE}`)).toBe(1);
	expect(count(`sync:space:${OTHER}`)).toBe(0);
	// Said twice (a reload of the window's page), it is shared once.
	commands().hello!({ spaceId: SPACE });
	expect(count(`sync:space:${SPACE}`)).toBe(1);

	// A Space changes several times a second (presence): what goes out is the last of each short while.
	gatewaySpaces.set([space(SPACE, "Harbour"), space(OTHER, "Kiln & Clay")]);
	gatewaySpaces.set([space(SPACE, "Harbour Lights at night"), space(OTHER, "Kiln & Clay")]);
	expect(count(`sync:space:${SPACE}`)).toBe(1);
	await wait(220);
	expect(count(`sync:space:${SPACE}`)).toBe(2);
	expect(last(`sync:space:${SPACE}`)).toMatchObject({ name: "Harbour Lights at night" });

	expect(commands().closed!({ spaceId: SPACE })).toBe(true);
	expect(last(`sync:space:${SPACE}`)).toBeNull();
	expect(last(`sync:bans:${SPACE}`)).toBeNull();
	const after = count(`sync:space:${SPACE}`);
	gatewaySpaces.set([space(SPACE, "Changed after its window closed")]);
	await wait(220);
	expect(count(`sync:space:${SPACE}`)).toBe(after);
});

test("a window's write of a shared value is set here; one of a key nothing shares is refused", () => {
	expect(commands().set!({ key: "voiceFaces", value: false })).toBe(true);
	expect(last("sync:voiceFaces")).toBe(false);
	expect(commands().set!({ key: "voiceFaces", value: true })).toBe(true);
	expect(last("sync:voiceFaces")).toBe(true);
	// Voice and video: the microphone, the camera and its noise suppression are the main window's voice's.
	expect(commands().set!({ key: "micId", value: "studio" })).toBe(true);
	expect(last("sync:micId")).toBe("studio");
	expect(commands().set!({ key: "cameraId", value: "face" })).toBe(true);
	expect(last("sync:cameraId")).toBe("face");
	expect(commands().set!({ key: "noiseSuppression", value: false })).toBe(true);
	expect(last("sync:noiseSuppression")).toBe(false);
	expect(commands().set!({ key: "micId", value: 3 })).toBe(true);
	expect(last("sync:micId")).toBe("studio");
	expect(commands().set!({ key: "cameraId", value: 3 })).toBe(true);
	expect(last("sync:cameraId")).toBe("face");
	expect(commands().set!({ key: "nothing-shares-this", value: 1 })).toBe(false);
	expect(commands().set!("not a write")).toBe(false);
	// The user is the main window's alone: a window's write doesn't change it.
	commands().set!({ key: "user", value: { id: "someone-else" } });
	expect(last("sync:user")).toMatchObject(user);
});

test("a command without what it needs is refused, and changes nothing", () => {
	expect(commands().spaceDeleted!({})).toBe(false);
	expect(commands().spaceSaved!({ spaceId: SPACE })).toBe(false);
	expect(commands().profileSaved!("nothing")).toBe(false);
	expect(commands().stage!({})).toBe(false);
});

test("opening a Space's settings shares the Space before Bun is asked for the window", async () => {
	gatewaySpaces.set([space(SPACE, "Harbour Lights"), space(OTHER, "Kiln & Clay")]);
	expect(await openAppWindow({ window: "space-settings", spaceId: OTHER, name: "Kiln & Clay", section: "roles" })).toBe(
		true,
	);
	expect(hub.opened).toEqual([{ window: "space-settings", spaceId: OTHER, name: "Kiln & Clay", section: "roles" }]);
	expect(last(`sync:space:${OTHER}`)).toMatchObject({ id: OTHER });
	expect(await openAppWindow({ window: "settings" })).toBe(true);
	expect(hub.opened).toHaveLength(2);
});

test("outside the desktop app no window is asked for", async () => {
	inApp = false;
	expect(await openAppWindow({ window: "settings" })).toBe(false);
	expect(hub.opened).toHaveLength(2);
	inApp = true;
});
