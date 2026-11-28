import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { get } from "svelte/store";
import { openGateway, type TestGateway } from "$lib/api/ws/test-gateway";
import type { MentionNotice } from "$lib/mention-notices";
import type { CoreHost } from "$lib/e2e/host";
import type { FakeApi, GatewayEvent } from "$lib/e2e/testing/fake-api";

// A message plays the notification sound through an <audio>, which Bun has none of.
class FakeAudio {
	volume = 1;
	currentTime = 0;
	play() {
		return Promise.resolve();
	}
}
Object.assign(globalThis, { Audio: FakeAudio });

const { FakeApi: Fake } = await import("$lib/e2e/testing/fake-api");
const { coreLibrary } = await import("$lib/e2e/testing/host-bun");
const { firstDevice, testDevice, testHost, until, useFake } = await import("$lib/e2e/testing/engines");
const { FakeHub, FakeLocks } = await import("$lib/e2e/testing/fake-tabs");
const { BrowserTabs, lockName } = await import("$lib/e2e/web/tabs");
const page = await import("$lib/e2e/engine.svelte");
const stores = await import("$lib/stores.svelte");
const { mentionNotices } = await import("$lib/mention-notices");
const { setSystemNotifier } = await import("$lib/api/ws/connection");
const { noticeText } = await import("$lib/system-notifications");
const { showChat } = await import("$lib/on-screen");
const { uuidv7 } = await import("$lib/e2e/uuid");
const { NOTICE_WAIT_MS } = await import("$lib/e2e/conversation-content.svelte");

// A conversation's message notifies with its decrypted text (PLAN-E2E-CLIENTES.md, task 20): Duvet's notice, Windows'
// toast and the browser's take it from this device's database once its engine applied the message's entry, 2 s at most;
// without it by then they say who wrote and that a message came, as a message without text does. On the web, a tab
// without the core asks the tab that has it. The app's own connection hears the gateway's events here, as in the app.
const SLOW = 180_000;
const noticeOf = (id: string) => get(mentionNotices).find((n) => n.id === id);

let gateway: TestGateway;
beforeAll(async () => {
	// The lists a new session asks for as it identifies, before any test's API is up: none.
	const early = spyOn(globalThis, "fetch").mockImplementation((async (_input: string | URL | Request) =>
		Response.json([])) as typeof fetch);
	gateway = await openGateway();
	early.mockRestore();
});
afterAll(() => gateway.close());
afterEach(async () => {
	setSystemNotifier(null);
	await page.stopEngine();
});

/** The fake answers the page's requests; the lists of READY it has no route for (friends, invites…) are empty. */
function useApi(fake: FakeApi) {
	useFake(fake);
	const answer = fake.fetch;
	spyOn(fake, "fetch").mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
		const answered = await answer(input, init);
		return answered.status === 404 && (await answered.clone().text()).includes("no such route")
			? Response.json([])
			: answered;
	});
}

/** The page signed in as the user, its gateway session's READY taken: what the app is once it's up. */
function signedIn(fake: FakeApi, user: string): string {
	const { token } = fake.signIn(user);
	localStorage.setItem("duvet_session_token", token);
	gateway.receive("READY", { user: { id: user, username: "me", status: 1 }, sessionToken: "session", guild_ids: [] });
	return token;
}

/** The user's gateway connection on the fake, as this page's: what it hears goes through the app's connection. */
const hearing = (fake: FakeApi, token: string, device: string | null) =>
	fake.connect(token, device, (event: GatewayEvent) => {
		if (event.type !== "READY") gateway.receive(event.type, event.data);
	});

/** A host whose `apply` waits for `held()`'s promise, when it gives one: the engine can't read a message meanwhile. */
const heldApply = (host: CoreHost, held: () => Promise<void> | null): CoreHost =>
	new Proxy(host, {
		get(target, name) {
			if (name === "handle") {
				return async (command: { cmd: string } & Record<string, unknown>) => {
					if (command.cmd === "apply") await held();
					return target.handle(command);
				};
			}
			const value = Reflect.get(target, name);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});

/** A system notifier that keeps what it shows, as the toast or the browser would have it. */
function keptNotifier() {
	const shown: { authorName: string; text: string }[] = [];
	setSystemNotifier({
		available: () => true,
		show: async (notice: MentionNotice) => {
			shown.push({ authorName: notice.authorName, text: noticeText(notice, {}) });
			return true;
		},
	});
	return shown;
}

describe.skipIf(!coreLibrary)("a conversation's notice", () => {
	// The review's I1: a server could write what Duvet's notice, the toast and the browser's notification say, under a
	// member's name, with a message that has no number but a content, or one whose components are all its text.
	test(
		"a notice shows nothing of the API's message but who wrote it, whatever its fields",
		async () => {
			const fake = new Fake();
			useApi(fake);
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
			signedIn(fake, ana);
			stores.pageVisible.set(true);
			const at = new Date().toISOString();
			const forged = (fields: Record<string, unknown>) => {
				const id = uuidv7();
				gateway.receive("DM_MESSAGE_CREATE", {
					...{ id, conversation_id: conversation, author_id: bo, type: 0, created_at: at, updated_at: at },
					...{ user: { id: bo, username: "bo", alias: "Bo", avatar: null, banner: null }, content: null },
					...fields,
				});
				return id;
			};
			const display = [{ type: 10, content: "written by the server, in a component" }];
			const ids = [
				forged({ content: "written by the server" }),
				forged({ flags: 1 << 15, components: display }),
				forged({ seq: 7, ciphertext: "AAAA", flags: 1 << 15, components: display, content: "and in its content" }),
			];
			await until(() => ids.every((id) => noticeOf(id) !== undefined), 10_000);
			for (const id of ids) {
				const notice = noticeOf(id)!;
				expect([notice.authorName, notice.text, noticeText(notice, {})]).toEqual(["Bo", "", "Click to see message"]);
			}
		},
		SLOW,
	);

	test(
		"a notice shows the decrypted text, or says a message came when it can't be read in time",
		async () => {
			const fake = new Fake();
			useApi(fake);
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
			const token = signedIn(fake, ana);
			let held: Promise<void> | null = null;
			const host = heldApply(testHost(), () => held);
			await page.startEngine(ana, {
				...{ desktop: true, desktopHost: async () => host, webHost: () => Promise.reject(new Error("no web")) },
				...{ missing: () => [], persist: () => undefined },
			});
			await page.makeIdentity();
			await page.keySaved();
			const { device_id } = await host.handle<{ device_id: string }>({ cmd: "status" });
			const hear = hearing(fake, token, device_id);
			const b = await firstDevice(fake, bo);
			await page.openConversation(conversation);
			await until(
				async () => !!(await b.host.handle({ cmd: "group", conversation_id: conversation }).catch(() => null)),
			);
			const send = (text: string) =>
				b.engine.sendMessage({ conversation_id: conversation, nonce: crypto.randomUUID(), text });

			// The window has the focus, on another chat: Duvet's notice, with what Bo wrote, which the API never had.
			stores.pageVisible.set(true);
			const first = (await send(`hello <@${ana}>, the plan`))!;
			expect(first.content).toBeNull();
			await until(() => noticeOf(first.id) !== undefined, 10_000);
			expect(noticeOf(first.id)).toMatchObject({
				link: { conversationId: conversation, messageId: first.id },
				place: "dm",
				placeName: "",
				text: `hello <@${ana}>, the plan`,
				mentionMap: { [ana]: "me" },
			});

			// Without the focus, the system's notification: the toast's or the browser's text is the device's too.
			stores.pageVisible.set(false);
			const shown = keptNotifier();
			const second = (await send("the second, in the toast"))!;
			await until(() => shown.length === 1, 10_000);
			expect(shown).toEqual([{ authorName: bo.slice(0, 8), text: "the second, in the toast" }]);
			expect(noticeOf(second.id)).toBeUndefined();

			// The engine can't apply the next one within 2 s: the notification says who wrote, and that a message came, 2 s
			// after it came, not later (the review's M8: a wait of 5 s fails this).
			let release = () => {};
			held = new Promise<void>((resolve) => (release = resolve));
			const sentAt = Date.now();
			const late = (await send("too late to be read"))!;
			await until(() => shown.length === 2, 10_000);
			const waited = Date.now() - sentAt;
			expect(waited).toBeGreaterThanOrEqual(1_990);
			expect(waited).toBeLessThan(4_000);
			expect(shown[1]).toEqual({ authorName: bo.slice(0, 8), text: "Click to see message" });

			// One whose chat comes on screen while it waits shows nothing once its wait is over (the review's M6).
			const seen = (await send("read in its chat"))!;
			const hide = showChat(conversation);
			stores.pageVisible.set(true);
			await Bun.sleep(NOTICE_WAIT_MS + 1_000);
			hide();
			stores.pageVisible.set(false);

			// The apply goes on, and the texts come late: they notify nothing more (the review's M8). A message after them
			// notifies once, on its own.
			held = null;
			release();
			await until(async () => {
				const { messages } = await host.handle<{ messages: { status: string }[] }>({
					...{ cmd: "messages", conversation_id: conversation, ids: [late.id, seen.id] },
				});
				return messages.length === 2 && messages.every((m) => m.status === "ok");
			});
			await send("after them");
			await until(() => shown.length >= 3, 10_000);
			expect(shown.slice(2)).toEqual([{ authorName: bo.slice(0, 8), text: "after them" }]);
			expect([noticeOf(late.id), noticeOf(seen.id)]).toEqual([undefined, undefined]);

			hear();
			await b.engine.stop();
		},
		SLOW,
	);

	test(
		"a tab that doesn't hold the core gets its notice's text from the one that does",
		async () => {
			const fake = new Fake();
			useApi(fake);
			const [cy, bo] = [fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({ type: "dm", members: [cy, bo] });
			const token = signedIn(fake, cy);
			const [locks, hub] = [new FakeLocks(), new FakeHub()];
			// Cy's tab that leads: its engine and its core, which tell the other tabs what changed. Its apply of Bo's message
			// waits until this page has asked for it once and found nothing: its text then comes by what changed alone.
			let held: Promise<void> | null = null;
			let asked = () => {};
			const leader = testDevice(fake, cy, { token, host: heldApply(testHost(), () => held) });
			const { engine } = leader;
			const leading = new BrowserTabs({
				...{ userId: cy, locks, channel: hub.channel(lockName(cy)) },
				methods: {
					state: () => engine.state,
					cutoverAt: () => engine.cutoverAt,
					read: async ({ conversationId, ids }: { conversationId: string; ids: string[] }) => {
						const read = await engine.read(conversationId, ids);
						asked();
						return read;
					},
				},
				lead: () => engine.start(),
			});
			engine.onMessages((id) => leading.changed(id));
			await leading.leading;
			await engine.makeIdentity();
			await engine.keySaved();
			// This page is another tab of Cy's: it opens no core of its own.
			let hosts = 0;
			await page.startEngine(cy, {
				...{ desktop: false, desktopHost: () => Promise.reject(new Error("no desktop")), missing: () => [] },
				tabs: { locks, channel: hub.channel(lockName(cy)) },
				webHost: async () => (hosts++, testHost()),
				persist: () => undefined,
			});
			const b = await firstDevice(fake, bo);
			await engine.openConversation(conversation);
			await until(
				async () => !!(await b.host.handle({ cmd: "group", conversation_id: conversation }).catch(() => null)),
			);
			// Each tab has a gateway connection of its own: this page's hears Bo's message too.
			const hear = hearing(fake, token, leader.registered.at(-1) ?? null);

			stores.pageVisible.set(true);
			let readOnce = false;
			held = new Promise<void>((resolve) => {
				asked = () => {
					readOnce = true;
					resolve();
				};
			});
			const sent = (await b.engine.sendMessage({
				...{ conversation_id: conversation, nonce: crypto.randomUUID() },
				text: "read by the tab that leads",
			}))!;
			await until(() => noticeOf(sent.id) !== undefined, 10_000);
			expect(readOnce).toBe(true);
			expect(noticeOf(sent.id)).toMatchObject({ text: "read by the tab that leads", place: "dm", placeName: "" });
			expect(hosts).toBe(0);
			held = null;

			hear();
			await b.engine.stop();
			await engine.stop();
			leading.close();
		},
		SLOW,
	);
});
