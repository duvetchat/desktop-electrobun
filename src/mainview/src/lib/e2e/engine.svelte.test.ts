import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { get } from "svelte/store";
import { base64Bytes } from "$lib/activity-thumbnail";
import { sessionApi } from "$lib/api/api";
import { e2eApi } from "$lib/api/e2e";
import type { EnginePlatform } from "./engine.svelte";
import { toEngine, type EngineEvent } from "./events";
import type { CoreHost } from "./host";
import type { ShownChange } from "./engine/contacts";
import { notice } from "./notices";
import { firstDevice, groupOf, rejection, shownKey, testDevice, testHost, until, useFake } from "./testing/engines";
import { FakeApi } from "./testing/fake-api";
import { FakeHub, FakeLocks } from "./testing/fake-tabs";
import { BunCoreHost, coreLibrary } from "./testing/host-bun";
import { useXHR } from "./testing/xhr";
import { BrowserTabs, lockName } from "./web/tabs";

// The engine's module and the stores it reaches are .svelte.ts modules whose $state only Svelte's compiler knows: here
// it's the value itself, set before they load.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const page = await import("./engine.svelte");
const { logout } = await import("$lib/api/auth");
const { toastStore } = await import("$lib/stores/toast.svelte");
const { conversations: drawnConversations, friendsReady } = await import("$lib/stores.svelte");

// The page's engine (lib/e2e/engine.svelte.ts): one for the page on the desktop's one host, and on the web the engine of
// the tab that leads, which the user's other tabs show and ask (Ruling 16), on task 8's tabs with a test's locks and
// channel; its core closed as the user signs out.
const SLOW = 180_000;
const RECOVERY_KEY = /^[1-9A-HJ-NP-Za-km-z]{48}$/;

/** A platform with nothing of its own but what a test gives it. */
const platform = (given: Partial<EnginePlatform>): EnginePlatform => ({
	desktop: false,
	desktopHost: () => Promise.reject(new Error("no desktop host here")),
	webHost: () => Promise.reject(new Error("no web host here")),
	missing: () => [],
	persist: () => undefined,
	...given,
});

/** A host that counts its closes. */
const counted = (host: CoreHost, closed: () => void): CoreHost =>
	new Proxy(host, {
		get(target, name) {
			if (name === "close") return () => (closed(), target.close());
			const value = Reflect.get(target, name);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});

/** The page's session: the user's, signed in on the fake. */
function signedIn(fake: FakeApi): string {
	const user = fake.addUser();
	localStorage.setItem("duvet_session_token", fake.signIn(user).token);
	return user;
}

/** Runs `go` with the page's window, there's none outside a browser: where the page went. */
async function withWindow(go: () => Promise<unknown>): Promise<string> {
	const location = { href: "" };
	Object.defineProperty(globalThis, "window", { value: { location }, configurable: true });
	try {
		await go();
	} finally {
		Reflect.deleteProperty(globalThis, "window");
	}
	return location.href;
}

/** The page draws the user's conversations, as READY's list leaves them in its store (#574: what founds a group). */
async function drawnOnPage(): Promise<void> {
	const api = e2eApi(sessionApi({ token: localStorage.getItem("duvet_session_token")!, sessionToken: null }));
	drawnConversations.set(await api.conversations());
}

/** The page's engine on the desktop, on `host`, through the first device's flow: ready. */
async function readyOnDesktop(user: string, host: BunCoreHost) {
	await page.startEngine(user, platform({ desktop: true, desktopHost: async () => host }));
	await page.makeIdentity();
	await page.keySaved();
	expect(page.encryption.state).toEqual({ name: "ready" });
	return host.handle<{ device_id: string; identity_key: string }>({ cmd: "status" });
}

/** The core's database in the host's folder, opened again with its key: what's left there. */
async function reopened(host: BunCoreHost, user: string) {
	const again = testHost({ folder: host.folder, key: base64Bytes(host.key) });
	await again.open(user);
	return { host: again, status: await again.handle<Record<string, unknown>>({ cmd: "status" }) };
}

afterEach(() => page.stopEngine());
// A shared history's parts go up as bytes, which the app sends through the XMLHttpRequest Bun lacks.
useXHR();

// N-C1: the conversation as the page draws it, which the engine holds a group to. Before READY's lists, the page's own
// first listing; a fresh one writes into its store, one it didn't draw added; one that leaves it out leaves its copy.
test("the page's drawing: its first listing, a fresh one into its store, and its copy where a listing has none", async () => {
	const fake = new FakeApi();
	useFake(fake);
	const ana = signedIn(fake);
	const bo = fake.addUser();
	const dm = fake.addConversation({ type: "dm", members: [ana, bo] });
	drawnConversations.set([]);
	expect((await page.shownConversation(dm, false))?.id).toBe(dm);
	expect(get(drawnConversations).map((conv) => conv.id)).toEqual([dm]);
	const group = fake.addConversation({ type: "group", members: [ana, bo], owner: ana });
	expect(await page.shownConversation(group, false)).toBeNull();
	expect((await page.shownConversation(group, true))?.id).toBe(group);
	expect(get(drawnConversations).map((conv) => conv.id)).toEqual([group, dm]);
	// Left out of a listing, the conversation stays as the page drew it.
	fake.conversationsAs = (view) => (view.id === dm ? null : view);
	expect(await page.shownConversation(dm, true)).toEqual(get(drawnConversations).find((conv) => conv.id === dm)!);
	expect(get(drawnConversations).map((conv) => conv.id)).toEqual([group, dm]);
});

// The review's untested cases. The page's first listing failing fails the look that asked for it, so what waits stays
// for the next start, READY or Retry, and the next look lists again. READY's lists in with its conversations' failed
// (friendsReady set, the store empty): the page draws nothing, and a fresh look's listing adds what it asks for.
test("the page's drawing when its first listing fails, and when READY's list of conversations failed", async () => {
	const fake = new FakeApi();
	const conversations = "/api/users/@me/conversations";
	let listings = 0;
	useFake(fake, (request) => {
		if (request.method === "GET" && new URL(request.url).pathname === conversations) listings++;
	});
	const ana = signedIn(fake);
	const bo = fake.addUser();
	const dm = fake.addConversation({ type: "dm", members: [ana, bo] });
	drawnConversations.set([]);
	fake.refuse({ method: "GET", path: conversations }, 500);
	await rejection(page.shownConversation(dm, false));
	expect(get(drawnConversations)).toEqual([]);
	expect((await page.shownConversation(dm, false))?.id).toBe(dm);
	expect(listings).toBe(2);
	// A new session's READY: its lists came, its conversations' didn't.
	await page.stopEngine();
	drawnConversations.set([]);
	friendsReady.set(true);
	try {
		expect(await page.shownConversation(dm, false)).toBeNull();
		expect(listings).toBe(2);
		expect((await page.shownConversation(dm, true))?.id).toBe(dm);
		expect(get(drawnConversations).map((conv) => conv.id)).toEqual([dm]);
		expect((await page.shownConversation(dm, false))?.id).toBe(dm);
		expect(listings).toBe(3);
	} finally {
		friendsReady.set(false);
	}
});

// N-I2: what a tab that doesn't lead sends, edits or deletes carries the people that tab draws, which the leader holds
// the delivery to beside its own drawing; none where it draws no such conversation.
test("on the web, a tab that doesn't lead carries the people it draws with what it sends, edits or deletes", async () => {
	const fake = new FakeApi();
	useFake(fake);
	const ana = signedIn(fake);
	const bo = fake.addUser();
	const dm = fake.addConversation({ type: "dm", members: [ana, bo] });
	const [locks, hub] = [new FakeLocks(), new FakeHub()];
	const carried: unknown[] = [];
	const leading = new BrowserTabs({
		...{ userId: ana, locks, channel: hub.channel(lockName(ana)) },
		methods: {
			state: () => ({ name: "ready" }),
			sendMessage: async ({ drawn }: { drawn?: unknown }) => (carried.push(drawn), null),
			editMessage: async ({ drawn }: { drawn?: unknown }) => void carried.push(drawn),
			deleteMessage: async ({ drawn }: { drawn?: unknown }) => void carried.push(drawn),
		},
		lead: async () => {},
	});
	await leading.leading;
	await page.startEngine(ana, platform({ tabs: { locks, channel: hub.channel(lockName(ana)) } }));
	await until(() => page.encryption.state.name === "ready");
	await drawnOnPage();
	const listed = get(drawnConversations).find((conv) => conv.id === dm)!;
	const people = { type: 1, owner_id: listed.owner_id, members: [{ user_id: ana }, { user_id: bo }] };
	await page.sendEncrypted({ conversation_id: dm, nonce: crypto.randomUUID(), text: "hi" });
	await page.editEncrypted(dm, crypto.randomUUID(), "edited");
	await page.deleteEncrypted(dm, crypto.randomUUID());
	await page.sendEncrypted({ conversation_id: crypto.randomUUID(), nonce: crypto.randomUUID(), text: "hi" });
	expect(carried).toEqual([people, people, people, null]);
	await page.stopEngine();
	leading.close();
});

describe.skipIf(!coreLibrary)("the page's engine", () => {
	// #575 (M6): what the page's engine last showed goes with it as it stops: the state its sheets draw (a first device's
	// recovery key among them), what each conversation said, the cutover's instant and the server key's notice. Every
	// sign-out loads another page today; the day one doesn't, the next user's page shows none of it.
	test(
		"what the engine last showed goes as it stops",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			fake.cutoverAt = "2026-11-20T00:00:00Z";
			const ana = signedIn(fake);
			const bo = fake.addUser();
			const conversation = fake.addConversation({ type: "group", members: [bo, ana], owner: bo });
			await readyOnDesktop(ana, testHost());
			await page.openConversation(conversation);
			await until(() => page.encryption.conversations[conversation]?.name === "wait_owner");
			expect(page.encryption.cutoverAt).toBe(fake.cutoverAt);
			await page.stopEngine();
			expect(page.encryption.state).toEqual({ name: "starting" });
			expect(page.encryption.conversations).toEqual({});
			expect(page.encryption.cutoverAt).toBeNull();
			expect(page.encryption.serverKeyChanged).toBe(false);
		},
		SLOW,
	);

	test(
		"on the desktop, one engine on one host for the page, its core closed as the user signs out",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			const ana = signedIn(fake);
			let [hosts, closes] = [0, 0];
			const host = counted(testHost(), () => closes++);
			const desktop = platform({ desktop: true, desktopHost: async () => (hosts++, host) });
			await page.startEngine(ana, desktop);
			// The app page mounts again with every READY: the engine it started goes on.
			await page.startEngine(ana, desktop);
			expect(hosts).toBe(1);
			expect(page.encryption.state).toEqual({ name: "first_device", recoveryKey: null, finishing: false });
			await page.makeIdentity();
			expect(shownKey(page.encryption.state)).toMatch(RECOVERY_KEY);
			await page.keySaved();
			expect(page.encryption.state).toEqual({ name: "ready" });

			Object.defineProperty(globalThis, "window", { value: { location: { href: "" } }, configurable: true });
			try {
				await logout();
			} finally {
				Reflect.deleteProperty(globalThis, "window");
			}
			expect(closes).toBe(1);
		},
		SLOW,
	);

	test(
		"on the web, the tab that leads runs the engine, and makes the storage last once its device is set up",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			const ana = signedIn(fake);
			let [hosts, persisted] = [0, 0];
			const web = platform({
				tabs: { locks: new FakeLocks(), channel: new FakeHub().channel(lockName(ana)) },
				webHost: async () => (hosts++, testHost()),
				persist: async () => persisted++,
			});
			await page.startEngine(ana, web);
			await until(() => page.encryption.state.name === "first_device");
			// The person's taps go through the tabs, here to this tab's own engine.
			await page.makeIdentity();
			expect(shownKey(page.encryption.state)).toMatch(RECOVERY_KEY);
			await page.keySaved();
			expect(page.encryption.state).toEqual({ name: "ready" });
			expect(persisted).toBe(1);
			// Ready again, after the user's identity changed: the storage was made to last already.
			toEngine({ type: "IDENTITY_UPDATE", data: { user_id: ana, identity_key: "", device_list_version: 1 } });
			await page.makeIdentity();
			expect(page.encryption.state).toEqual({ name: "ready" });
			expect([hosts, persisted]).toEqual([1, 1]);
		},
		SLOW,
	);

	test(
		"on the web, a tab that doesn't lead shows the leader's state, its taps run there, and it opens no core",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			const ana = signedIn(fake);
			const [locks, hub] = [new FakeLocks(), new FakeHub()];
			// The user's tab that leads: its engine, its session, its core.
			const leader = testDevice(fake, ana);
			const { engine } = leader;
			const leading = new BrowserTabs({
				...{ userId: ana, locks, channel: hub.channel(lockName(ana)) },
				methods: {
					state: () => engine.state,
					makeIdentity: () => engine.makeIdentity(),
					keySaved: () => engine.keySaved(),
					uploadLater: () => engine.uploadLater(),
					startOver: () => engine.startOver(),
				},
				lead: () => engine.start(),
			});
			await leading.leading;
			let hosts = 0;
			const web = platform({
				tabs: { locks, channel: hub.channel(lockName(ana)) },
				webHost: async () => (hosts++, testHost()),
			});
			await page.startEngine(ana, web);
			await until(() => page.encryption.state.name === "first_device");
			await page.makeIdentity();
			expect(shownKey(page.encryption.state)).toMatch(RECOVERY_KEY);
			expect(page.encryption.state).toEqual(engine.state);
			await page.keySaved();
			expect(page.encryption.state).toEqual({ name: "ready" });
			expect(engine.state).toEqual({ name: "ready" });
			expect(hosts).toBe(0);
			await page.stopEngine();
			await engine.stop();
			leading.close();
		},
		SLOW,
	);

	// Task 22's review, M7: on the web, the tab that leads has no engine (its host didn't load). A new conversation is
	// made by the API alone, as on a page without an engine, not refused as not ready; its group waits for a device that
	// can make it.
	test(
		"on the web, a conversation made while the leading tab has no engine is made by the API alone",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			const ana = signedIn(fake);
			const bo = fake.addUser();
			fake.befriend(ana, bo);
			const [locks, hub] = [new FakeLocks(), new FakeHub()];
			const broken = () => Promise.reject(new Error("the worker didn't load"));
			await page.startEngine(ana, platform({ tabs: { locks, channel: hub.channel(lockName(ana)) }, webHost: broken }));
			const made = await page.createDM(bo);
			expect(made.members.map((member) => member.user_id).sort()).toEqual([ana, bo].sort());
			const api = e2eApi(sessionApi({ token: localStorage.getItem("duvet_session_token")!, sessionToken: null }));
			const listed = (await api.conversations()).find((conv) => conv.id === made.id);
			expect(listed?.mls ?? null).toBeNull();
		},
		SLOW,
	);

	// M6: a conversation's view opens it once. One that opened before the page had its engine (the desktop's host
	// still loading) is opened by the engine once it's ready.
	test(
		"a conversation opened before the page has its engine gets its group once the engine is ready",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			const ana = signedIn(fake);
			const bo = fake.addUser();
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
			const b = await firstDevice(fake, bo);
			let loaded = () => {};
			const loading = new Promise<void>((resolve) => (loaded = resolve));
			const host = testHost();
			const starting = page.startEngine(
				ana,
				platform({ desktop: true, desktopHost: async () => (await loading, host) }),
			);
			await drawnOnPage();
			await page.openConversation(conversation);
			loaded();
			await starting;
			await page.makeIdentity();
			await page.keySaved();
			expect(page.encryption.state).toEqual({ name: "ready" });
			// Ready, the engine opens it: Ana's device makes the DM's group, and Bo's comes in.
			const listed = (await b.api.conversations()).find((conv) => conv.id === conversation);
			expect(listed?.mls).toMatchObject({ generation: 0 });
			await until(async () => (await groupOf(b, conversation)) !== null);
		},
		SLOW,
	);

	// Decision 13: deleting a device's data is an act of its own, beside signing out.
	test(
		"removing this device deletes its data and signs out",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			const ana = signedIn(fake);
			const token = localStorage.getItem("duvet_session_token")!;
			const host = testHost();
			const { device_id } = await readyOnDesktop(ana, host);
			// The device every identify names (lib/e2e/client.ts): it goes with the data (M4).
			expect(localStorage.getItem(`duvet.e2e.${ana}.device`)).toBe(device_id);

			const went = await withWindow(() => page.removeThisDevice());
			// Signed out: the page went to sign in, and the API ended its session.
			expect(went).toContain("sign-in");
			expect(localStorage.getItem("duvet_session_token")).toBeNull();
			expect(localStorage.getItem(`duvet.e2e.${ana}.device`)).toBeNull();
			const ended = e2eApi(sessionApi({ token, sessionToken: null })).devices();
			expect(await rejection(ended)).toMatchObject({ response: { status: 401 } });
			// Its data is gone: its folder holds a new database, of no device.
			const left = await reopened(host, ana);
			expect(left.status).not.toHaveProperty("device_id");
			await left.host.close();
		},
		SLOW,
	);

	// M9: the tab that leads deleted the data for another tab; its engine and its lock mustn't outlive the session.
	test(
		"on the web, the tab that leads signs out once it deleted its data for another tab, and lets the lock go",
		async () => {
			const fake = new FakeApi();
			// The leader's sign-out takes its request's round trip before it lets the lock go, as over a network: its
			// answer reaches the other tab first.
			spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
				const request = new Request(input, init);
				if (new URL(request.url).pathname === "/api/auth/logout") await Bun.sleep(50);
				return fake.fetch(request);
			}) as typeof fetch);
			const ana = signedIn(fake);
			const [locks, hub] = [new FakeLocks(), new FakeHub()];
			const host = testHost();
			await page.startEngine(
				ana,
				platform({ tabs: { locks, channel: hub.channel(lockName(ana)) }, webHost: async () => host }),
			);
			await until(() => page.encryption.state.name === "first_device");
			await page.makeIdentity();
			await page.keySaved();
			expect(page.encryption.state).toEqual({ name: "ready" });
			// Another tab of the user's, waiting for the lock this page holds, asks it to delete the device's data.
			const other = new BrowserTabs({
				...{ userId: ana, locks, channel: hub.channel(lockName(ana)) },
				methods: {},
				lead: async () => {},
			});
			const location = { href: "" };
			Object.defineProperty(globalThis, "window", { value: { location }, configurable: true });
			try {
				await other.call("removeThisDevice");
				await until(() => location.href !== "", 15_000);
				// Its tabs closed with its engine: the other tab takes the lock.
				await other.leading;
			} finally {
				Reflect.deleteProperty(globalThis, "window");
				other.close();
			}
			expect(location.href).toContain("sign-in");
			const left = await reopened(host, ana);
			expect(left.status).not.toHaveProperty("device_id");
			await left.host.close();
		},
		SLOW,
	);

	test(
		"signing out leaves the device and its database",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			const ana = signedIn(fake);
			const host = testHost();
			const { device_id, identity_key } = await readyOnDesktop(ana, host);

			await withWindow(logout);
			// The session ended, nothing else: the database opens with its device and its identity…
			const left = await reopened(host, ana);
			expect(left.status).toMatchObject({ device_id, identity_key, has_identity: true });
			// …and the API keeps the device on the list: the next sign-in on this core binds it again, and it's ready.
			const next = testDevice(fake, ana, { host: left.host });
			await next.engine.start();
			expect(next.engine.state).toEqual({ name: "ready" });
			expect(next.registered).toEqual([device_id]);
			expect(await next.api.devices()).toMatchObject([{ id: device_id, listed: true, current: true }]);
			await next.engine.stop();
		},
		SLOW,
	);

	test(
		"what the engine tells of the user's devices shows in the notices' words",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			const ana = signedIn(fake);
			// The page's gateway connection, which hands the engine what it hears (connection.ts does it in the app).
			const token = localStorage.getItem("duvet_session_token")!;
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fake's events are the API's, as the gateway hands them on
			fake.connect(token, null, (event) => toEngine(event as EngineEvent));
			const host = testHost();
			await readyOnDesktop(ana, host);
			const shown = (text: string) => toastStore.items.some(({ message }) => message === text);

			// Another device of the user's registers.
			const other = testDevice(fake, ana);
			await other.engine.start();
			await other.engine.stop();
			const name = "Duvet for Windows";
			await until(() => shown(notice("device_added", { name })));

			// Not seen in 45 days: the page's next engine warns of it.
			fake.lastSeen(other.registered[0]!, new Date(Date.now() - 46 * 24 * 3600 * 1000).toISOString());
			await page.stopEngine();
			await page.startEngine(ana, platform({ desktop: true, desktopHost: async () => host }));
			await until(() => shown(notice("inactive_warning", { device: name })));
		},
		SLOW,
	);

	// Task 30's review, M1: the person hears their share went once the API took it; one that ends for good after that
	// is told to them, wherever they are.
	test(
		"a share of the history the person heard went, which ended for good, is said in a toast",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			const ana = signedIn(fake);
			const bo = fake.addUser();
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
			const b = await firstDevice(fake, bo);
			await readyOnDesktop(ana, testHost());
			await drawnOnPage();
			await page.openConversation(conversation);
			await until(async () => (await groupOf(b, conversation)) !== null);
			fake.refuse({ method: "PUT", path: /\/history-shares\/[0-9a-f-]{36}\/parts\/\d+$/ }, 413, {
				error: "a part is 1 MiB and its tag at most",
			});
			expect(await page.shareHistory(conversation, bo, "week")).toMatchObject({ sent: true });
			await until(() => toastStore.items.some(({ message }) => message === notice("share_history_failed")));
			await b.engine.stop();
		},
		SLOW,
	);

	// Task 30's review, M5: another tab's request that doesn't name its member or its range shares nothing: none the
	// page makes lacks either, and a range the person didn't pick isn't made up for it.
	// desktop-electrobun#559: a group the leading tab had the API make, unanswered as its tab went, would be made again by
	// the tab that leads next.
	test(
		"on the web, a new group asked of a tab that went before it answered fails, and isn't made again",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			const ana = signedIn(fake);
			const bo = fake.addUser();
			fake.befriend(ana, bo);
			const [locks, hub] = [new FakeLocks(), new FakeHub()];
			let asked = 0;
			// The leading tab, as the page makes one: it takes the request, and never answers.
			const leader = new BrowserTabs({
				...{ userId: ana, locks, channel: hub.channel(lockName(ana)) },
				once: page.MADE_ONCE,
				methods: { createConversation: () => (asked++, new Promise(() => {})) },
				lead: async () => {},
			});
			await leader.leading;
			const web = platform({ tabs: { locks, channel: hub.channel(lockName(ana)) }, webHost: async () => testHost() });
			await page.startEngine(ana, web);
			const making = rejection(page.createGroup("friends", [bo]));
			await until(() => asked === 1);
			// The leader said it took it before it ran it: that reaches this tab before the leader goes (#568).
			await hub.delivered();
			leader.close();
			// This tab leads now, and doesn't make it again: the tab that went may have.
			expect(await making).toMatchObject({ code: "internal" });
			expect(fake.conversationIds()).toEqual([]);
		},
		SLOW,
	);

	test(
		"on the web, the tab that leads refuses another tab's share without its member or its range",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			const ana = signedIn(fake);
			const [locks, hub] = [new FakeLocks(), new FakeHub()];
			const web = platform({ tabs: { locks, channel: hub.channel(lockName(ana)) }, webHost: async () => testHost() });
			await page.startEngine(ana, web);
			await until(() => page.encryption.state.name === "first_device");
			await page.makeIdentity();
			await page.keySaved();
			const other = new BrowserTabs({
				...{ userId: ana, locks, channel: hub.channel(lockName(ana)) },
				methods: {},
				lead: async () => {},
			});
			try {
				const [conversationId, userId] = [crypto.randomUUID(), crypto.randomUUID()];
				for (const params of [
					{ conversationId, userId },
					{ conversationId, range: "week" },
					{ conversationId, userId, range: "year" },
				]) {
					expect(await rejection(other.call("shareHistory", params))).toMatchObject({ code: "bad_command" });
				}
			} finally {
				other.close();
			}
		},
		SLOW,
	);

	// Task 28: what the page shows of the person's contacts is the engine's, as it changes: whom they verified, and the
	// changed keys still shown.
	test(
		"on the desktop, the page shows the contacts the engine holds as they change",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			const ana = signedIn(fake);
			const bo = fake.addUser();
			fake.befriend(ana, bo);
			await firstDevice(fake, bo);
			await readyOnDesktop(ana, testHost());
			expect(page.encryption.contacts).toEqual({ changes: {}, verified: {} });
			const { digits } = await page.safetyNumberOf(bo);
			expect(digits).toMatch(/^(\d{5} ){11}\d{5}$/);
			expect(page.encryption.contacts.verified[bo]).toBe(false);
			expect(await page.verifyContact(bo, digits)).toBe(true);
			expect(page.encryption.contacts.verified[bo]).toBe(true);
			expect(await page.contactOf(bo)).toBe(true);
		},
		SLOW,
	);

	test(
		"on the web, a tab that doesn't lead shows the leader's contacts, and verifies through it",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			const ana = signedIn(fake);
			const bo = fake.addUser();
			fake.befriend(ana, bo);
			await firstDevice(fake, bo);
			const [locks, hub] = [new FakeLocks(), new FakeHub()];
			// The user's tab that leads, its engine set up, serving the contacts' methods as the page's own tabs do.
			const leader = testDevice(fake, ana);
			const { engine } = leader;
			const leading = new BrowserTabs({
				...{ userId: ana, locks, channel: hub.channel(lockName(ana)) },
				methods: {
					state: () => engine.state,
					contacts: () => engine.contacts(),
					contact: (userId: string) => engine.contact(userId),
					safetyNumber: (userId: string) => engine.safetyNumber(userId),
					verifyContact: ({ userId, digits }: { userId: string; digits: string }) =>
						engine.verifyContact(userId, digits),
				},
				lead: async () => {
					await engine.start();
					await engine.makeIdentity();
					await engine.keySaved();
				},
			});
			engine.onContacts(() => leading.stateChanged());
			await leading.leading;
			await page.startEngine(ana, platform({ tabs: { locks, channel: hub.channel(lockName(ana)) } }));
			await until(() => page.encryption.state.name === "ready");
			const { digits } = await page.safetyNumberOf(bo);
			expect(await engine.safetyNumber(bo)).toMatchObject({ digits });
			expect(await page.verifyContact(bo, digits)).toBe(true);
			await until(() => page.encryption.contacts.verified[bo] === true);
			expect(engine.contacts().verified[bo]).toBe(true);
			await page.stopEngine();
			await engine.stop();
			leading.close();
		},
		SLOW,
	);

	// Task 32's review, I3: what the backup shows is the engine's own, apart from its state, and a tab that doesn't lead
	// shows the leader's as it changes: up to date only once the leader's pass found nothing due.
	test(
		"on the web, a tab that doesn't lead shows the leader's encrypted backup as it changes",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			const ana = signedIn(fake);
			const [locks, hub] = [new FakeLocks(), new FakeHub()];
			const leader = testDevice(fake, ana);
			const { engine } = leader;
			const leading = new BrowserTabs({
				...{ userId: ana, locks, channel: hub.channel(lockName(ana)) },
				methods: { state: () => engine.state, backup: () => engine.backup() },
				lead: async () => {
					await engine.start();
					await engine.makeIdentity();
					await engine.keySaved();
				},
			});
			engine.onBackup(() => leading.stateChanged());
			await leading.leading;
			await page.startEngine(ana, platform({ tabs: { locks, channel: hub.channel(lockName(ana)) } }));
			await until(() => page.encryption.state.name === "ready");
			expect(page.encryption.backup).toEqual({ state: "uploading" });
			// The leader's app is quiet a minute: its pass finds nothing due, and this tab shows it.
			leader.clock.advance(60_000);
			await until(() => page.encryption.backup.state === "up_to_date");
			expect(engine.backup()).toEqual({ state: "up_to_date" });
			await page.stopEngine();
			expect(page.encryption.backup).toEqual({ state: "uploading" });
			await engine.stop();
			leading.close();
		},
		SLOW,
	);

	// Round 3: a tab that doesn't lead asks the leader for a conversation's changed keys, and its close and its yes name
	// the change it showed: one for another change takes nothing.
	test(
		"on the web, a tab that doesn't lead shows a conversation's changed keys, and closes and says yes to the change shown",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			const ana = signedIn(fake);
			const bo = fake.addUser();
			fake.befriend(ana, bo);
			const dm = fake.addConversation({ type: "dm", members: [ana, bo] });
			const b = await firstDevice(fake, bo);
			const [locks, hub] = [new FakeLocks(), new FakeHub()];
			// The leader serves the changes' methods as the page's own tabs do.
			const { engine } = testDevice(fake, ana);
			const leading = new BrowserTabs({
				...{ userId: ana, locks, channel: hub.channel(lockName(ana)) },
				methods: {
					state: () => engine.state,
					contacts: () => engine.contacts(),
					keyChangesIn: (id: string) => engine.keyChangesIn(id),
					closeKeyChange: ({ user, change }: ShownChange) => engine.closeKeyChange(user, change),
					confirmKeyChanges: (changes: ShownChange[]) => engine.confirmKeyChanges(changes),
				},
				lead: async () => {
					await engine.start();
					await engine.makeIdentity();
					await engine.keySaved();
				},
			});
			engine.onContacts(() => leading.stateChanged());
			await leading.leading;
			// Ana verified Bo, whose new keys are a strong change on her leader's engine.
			const { digits } = await engine.safetyNumber(bo);
			expect(await engine.verifyContact(bo, digits)).toBe(true);
			await b.engine.changeKeys();
			await b.engine.keySaved();
			expect(await engine.contact(bo)).toBe(false);
			const change = engine.contacts().changes[bo]?.change ?? "";
			expect(engine.contacts().changes[bo]).toEqual({ verified: true, change: expect.any(String) });

			await page.startEngine(ana, platform({ tabs: { locks, channel: hub.channel(lockName(ana)) } }));
			await until(() => page.encryption.state.name === "ready");
			expect(await page.keyChangesIn(dm)).toEqual({ [bo]: { verified: true, change } });
			await page.closeKeyChange(bo, "another change");
			await page.confirmKeyChanges([{ user: bo, change: "another change" }]);
			expect(engine.contacts().changes[bo]).toEqual({ verified: true, change });
			await page.closeKeyChange(bo, change);
			expect(engine.contacts().changes[bo]).toEqual({ verified: true, closed: true, change });
			await page.confirmKeyChanges([{ user: bo, change }]);
			expect(engine.contacts().changes).toEqual({});
			await page.stopEngine();
			await engine.stop();
			leading.close();
		},
		SLOW,
	);
});
