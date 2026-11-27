import { describe, expect, test } from "bun:test";
import type { Identity } from "$lib/api/e2e";
import { certificateDevice } from "../cbor";
import type { CoreHost } from "../host";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import {
	approvedDevice,
	firstDevice,
	groupOf,
	madeHere,
	rejection,
	restarted,
	sameGroup,
	testDevice,
	testHost,
	turnEnded,
	until,
	useFake,
	watchedHost,
	type TestDevice,
} from "../testing/engines";
import { holdUploads, useXHR } from "../testing/xhr";
import type { IdentityMade } from "./identity";

// Members without a device (PLAN-E2E-CLIENTES.md, «Quien no tenía dispositivo»; Task 22): who they are, as the person
// opens the conversation, told to the core and over the message box; and the catch-up of what was sent them meanwhile,
// handed to their devices once they have one.
const SLOW = 180_000;
const DAY = 24 * 3600 * 1000;
const SHARES = /^\/api\/users\/@me\/conversations\/[0-9a-f-]{36}\/history-shares\/[0-9a-f-]{36}$/;
const PARTS = /^\/api\/users\/@me\/conversations\/[0-9a-f-]{36}\/history-shares\/[0-9a-f-]{36}\/parts\/\d+$/;
const KEY_PACKAGES = "/api/users/@me/devices/@me/key-packages";
// A catch-up's parts go up as bytes, which the app sends through the XMLHttpRequest Bun lacks.
useXHR();

function setUp() {
	const fake = new FakeApi();
	const requests: string[] = [];
	useFake(fake, (request) => requests.push(`${request.method} ${new URL(request.url).pathname}`));
	/** The packages' uploads (PUT …/history-shares/:id), by path. */
	const puts = () => requests.filter((request) => request.startsWith("PUT ") && SHARES.test(request.slice(4)));
	return { fake, requests, puts };
}

/** A host that notes each catch-up its core is asked to make (`share`'s catch_up), made or not. */
function countingCatchUps(host: CoreHost, made: string[]): CoreHost {
	return new Proxy(host, {
		get(target, name) {
			if (name === "share") {
				return (command: { cmd: "history_share" | "catch_up" } & Record<string, unknown>) => {
					if (command.cmd === "catch_up") made.push(String(command.user_id));
					return target.share(command);
				};
			}
			const value = Reflect.get(target, name);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

/** A host whose next open finds the database locked, as another window holds it, while `locked` says so. */
function lockable(host: CoreHost, locked: () => boolean): CoreHost {
	return new Proxy(host, {
		get(target, name) {
			if (name === "open") return async (user: string) => (locked() ? { state: "locked" } : target.open(user));
			const value = Reflect.get(target, name);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

/** Ana's DM with Cy, who has no device yet, and what Ana sent him meanwhile, noted for him. */
async function waitingForCy(given: Parameters<typeof firstDevice>[2] = {}) {
	const setup = setUp();
	const { fake } = setup;
	const [ana, cy] = [fake.addUser(), fake.addUser()];
	const conversation = fake.addConversation({ type: "dm", members: [ana, cy] });
	const a = await firstDevice(fake, ana, given);
	await a.engine.openConversation(conversation);
	const sent = await a.engine.sendMessage({
		conversation_id: conversation,
		nonce: crypto.randomUUID(),
		text: "while you were away",
	});
	return { ...setup, ana, cy, conversation, a, sent: sent! };
}

/**
 * An identity of the user's that only the server knows, as a server forges one: made by a core of its own, on a device
 * registered as the user's that's on none of their lists, which it certifies. What it made, and that device.
 */
async function forgedIdentity(fake: FakeApi, user: string): Promise<{ made: IdentityMade; device: string }> {
	const forger = testDevice(fake, user);
	await forger.engine.start();
	await forger.engine.stop();
	await forger.host.open(user);
	const made = await forger.host.handle<IdentityMade>({ cmd: "create_identity" });
	return { made, device: certificateDevice(made.certificate)! };
}

/** The message reached Cy's device by its catch-up from Ana. */
async function reached(c: TestDevice, conversation: string, message: string) {
	await caughtUp(c, conversation, message);
	const [row] = await c.engine.messages(conversation, [message]);
	expect(row).toMatchObject({ status: "ok", text: "while you were away" });
}

/**
 * The device's engine adds the catch-up waiting for its user by itself (Task 30): its key taken from the inbox, its
 * parts down and opened by its core. Until the message's row is there, opened.
 */
async function caughtUp(device: TestDevice, conversation: string, message: string) {
	await until(async () => (await device.engine.messages(conversation, [message]))[0]?.status === "ok", 120_000);
}

describe.skipIf(!coreLibrary)("members without a device", () => {
	test(
		"a member without devices is named before sending, and noted for the core",
		async () => {
			const { fake } = setUp();
			const [ana, bo, cy] = [fake.addUser(), fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({ type: "group", members: [ana, bo, cy], owner: ana });
			const told: unknown[] = [];
			const host = watchedHost(testHost(), [], (cmd, command) => {
				if (cmd === "without_devices") told.push(command.users);
				return null;
			});
			const a = await firstDevice(fake, ana, { host });
			// Bo has a device, unseen for 45 days; Cy never had one.
			const b = await firstDevice(fake, bo);
			fake.setActive(bo, false);
			await madeHere(a, conversation);
			await a.engine.openConversation(conversation);
			// Both are named over the message box, and told to the core, which notes what this device sends them.
			expect(a.engine.conversationState(conversation)).toEqual({ name: "no_device", users: [bo, cy] });
			expect(told.at(-1)).toEqual([bo, cy]);
			// Bo's device is seen again: as the conversation opens next, only Cy is named.
			fake.setActive(bo, true);
			await a.engine.openConversation(conversation);
			expect(a.engine.conversationState(conversation)).toEqual({ name: "no_device", users: [cy] });
			expect(told.at(-1)).toEqual([cy]);
			await sameGroup([a, b], conversation);
		},
		SLOW,
	);

	test(
		"what was sent to a member without devices goes to them when their first device joins",
		async () => {
			const { fake } = setUp();
			const [ana, cy] = [fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({ type: "dm", members: [ana, cy] });
			const a = await firstDevice(fake, ana);
			await a.engine.openConversation(conversation);
			expect(a.engine.conversationState(conversation)).toEqual({ name: "no_device", users: [cy] });
			const sent = await a.engine.sendMessage({
				conversation_id: conversation,
				nonce: crypto.randomUUID(),
				text: "while you were away",
			});
			// Cy's first device: once its identity is up, he's no longer named, and his device joins the group.
			const c = await firstDevice(fake, cy);
			await until(() => a.engine.conversationState(conversation) === null);
			await sameGroup([a, c], conversation);
			// Ana's device hands him what it noted: a catch-up up for him, its key in his device's inbox, which opens it.
			await caughtUp(c, conversation, sent!.id);
			const [row] = await c.engine.messages(conversation, [sent!.id]);
			expect(row).toMatchObject({ status: "ok", text: "while you were away" });
			// Delivered, its notes are gone: there's nothing more to catch Cy up on.
			await turnEnded(a);
			const again = a.host.share({ cmd: "catch_up", conversation_id: conversation, user_id: cy, devices: [] });
			expect(await rejection(again)).toMatchObject({ code: "not_found", what: "catch_up" });
		},
		SLOW,
	);

	// Task 22's review, I2: the core's members changed, here or by another device's commit, and who has no device is
	// asked again: a member added without one is named at once, and what's sent from then on is noted for them.
	test(
		"a member added without a device gets what's sent from then on, once their first device joins",
		async () => {
			const { fake } = setUp();
			const [ana, bo, dee] = [fake.addUser(), fake.addUser(), fake.addUser()];
			fake.befriend(ana, dee);
			const conversation = fake.addConversation({ type: "group", members: [ana, bo], owner: ana });
			const [a, b] = [await firstDevice(fake, ana), await firstDevice(fake, bo)];
			await madeHere(a, conversation);
			await a.engine.openConversation(conversation);
			await sameGroup([a, b], conversation);
			expect(a.engine.conversationState(conversation)).toBeNull();
			// Dee has no device yet: her addition names her over the message box, with no open of the conversation.
			await a.engine.addMember(conversation, dee);
			expect(a.engine.conversationState(conversation)).toEqual({ name: "no_device", users: [dee] });
			const sent = await a.engine.sendMessage({
				conversation_id: conversation,
				nonce: crypto.randomUUID(),
				text: "welcome, Dee",
			});
			const d = await firstDevice(fake, dee);
			await sameGroup([a, b, d], conversation);
			await caughtUp(d, conversation, sent!.id);
			const [row] = await d.engine.messages(conversation, [sent!.id]);
			expect(row).toMatchObject({ status: "ok", text: "welcome, Dee" });
		},
		SLOW,
	);

	// #537: a member whose listed devices had no key package to give as the group was made, or as they were added, got no
	// leaf in it, yet has an identity, seen lately: they count as without a device there until a device of theirs has a
	// leaf, so what's sent meanwhile is noted for them, and their catch-up brings it.
	test(
		"a DM made before the other's only device has key packages: its catch-up brings the first messages",
		async () => {
			const { fake } = setUp();
			const [ana, cy] = [fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({ type: "dm", members: [ana, cy] });
			const a = await firstDevice(fake, ana);
			// Cy's only device is set up, its identity and its list up, and its key packages not yet: their upload fails.
			fake.refuse({ method: "PUT", path: KEY_PACKAGES }, 500, { error: "internal server error" });
			const c = await firstDevice(fake, cy);
			await c.engine.stop();
			await a.engine.openConversation(conversation);
			expect((await groupOf(a, conversation))?.devices.map((device) => device.user_id)).toEqual([ana]);
			expect(a.engine.conversationState(conversation)).toEqual({ name: "no_device", users: [cy] });
			const sent = await a.engine.sendMessage({
				conversation_id: conversation,
				nonce: crypto.randomUUID(),
				text: "while you were away",
			});
			// His device's app starts again: it joins, and Ana's device hands it what came before.
			const again = await restarted(fake, c);
			await sameGroup([a, again], conversation);
			await reached(again, conversation, sent!.id);
			await until(() => a.engine.conversationState(conversation) === null);
		},
		SLOW,
	);

	test(
		"a member added before their only device has key packages: their catch-up brings what came since",
		async () => {
			const { fake } = setUp();
			const [ana, bo, dee] = [fake.addUser(), fake.addUser(), fake.addUser()];
			fake.befriend(ana, dee);
			const conversation = fake.addConversation({ type: "group", members: [ana, bo], owner: ana });
			const [a, b] = [await firstDevice(fake, ana), await firstDevice(fake, bo)];
			await madeHere(a, conversation);
			await a.engine.openConversation(conversation);
			await sameGroup([a, b], conversation);
			fake.refuse({ method: "PUT", path: KEY_PACKAGES }, 500, { error: "internal server error" });
			const d = await firstDevice(fake, dee);
			await d.engine.stop();
			// Added by add_members with none of her devices in: she's named over the message box, and noted for.
			await a.engine.addMember(conversation, dee);
			expect(a.engine.conversationState(conversation)).toEqual({ name: "no_device", users: [dee] });
			const sent = await a.engine.sendMessage({
				conversation_id: conversation,
				nonce: crypto.randomUUID(),
				text: "while you were away",
			});
			const again = await restarted(fake, d);
			await sameGroup([a, b, again], conversation);
			await reached(again, conversation, sent!.id);
		},
		SLOW,
	);

	// Task 23's review, item 12 (against the desktop): one catch-up at a time for each member of each conversation,
	// however many applies name them while it goes.
	test(
		"a member that several applies name meanwhile is caught up once",
		async () => {
			const made: string[] = [];
			const { fake, cy, conversation, a, sent } = await waitingForCy({ host: countingCatchUps(testHost(), made) });
			// Ana's device hears what comes next at once: Cy's first device joining, and two messages of his.
			fake.holdEvents();
			const c = await firstDevice(fake, cy);
			await until(async () => (await groupOf(c, conversation)) !== null);
			for (const text of ["hi", "Ana?"]) {
				await c.engine.sendMessage({ conversation_id: conversation, nonce: crypto.randomUUID(), text });
			}
			fake.releaseEvents();
			await reached(c, conversation, sent.id);
			await turnEnded(a);
			expect(made).toEqual([cy]);
		},
		SLOW,
	);

	// Task 22's review, M6 (a): only the core's calls take the engine's turn. A catch-up's parts go up outside it, so the
	// engine's other work goes on meanwhile.
	test(
		"a catch-up's parts go up outside the engine's turn, which other work takes meanwhile",
		async () => {
			const { fake, ana, cy, conversation, a, sent } = await waitingForCy();
			const other = fake.addConversation({ type: "dm", members: [ana, fake.addUser()] });
			let held = false;
			let release = () => {};
			holdUploads(() => new Promise<void>((go) => ((held = true), (release = go))));
			let c: TestDevice;
			try {
				c = await firstDevice(fake, cy);
				await until(() => held);
				let opened = false;
				void a.engine.openConversation(other).then(() => (opened = true));
				await until(() => opened, 10_000);
			} finally {
				holdUploads(null);
				release();
			}
			await reached(c, conversation, sent.id);
		},
		SLOW,
	);

	// M6 (b): the package stays with the host until it's delivered. Cut after the API took it, and its day's one with
	// it, it goes again as it was, which the API takes again, not a new one it would refuse for the day.
	test(
		"a catch-up cut after its package went up resumes it, which the API takes again",
		async () => {
			const { fake, puts, cy, conversation, a, sent } = await waitingForCy();
			fake.cutRequest({ method: "PUT", path: PARTS });
			const c = await firstDevice(fake, cy);
			await until(() => puts().length === 1);
			// An apply that names Cy meanwhile makes nothing new.
			await c.engine.sendMessage({ conversation_id: conversation, nonce: crypto.randomUUID(), text: "hi Ana" });
			await turnEnded(a);
			a.clock.advance(60_000);
			await reached(c, conversation, sent.id);
			expect(new Set(puts()).size).toBe(1);
		},
		SLOW,
	);

	// M6 (c): one that fails otherwise isn't tried at each apply that names the member, but after a wait, a minute, then
	// twice as long each time.
	test(
		"a catch-up that fails otherwise goes again after a wait, longer each time",
		async () => {
			const { fake, puts, cy, conversation, a, sent } = await waitingForCy();
			fake.refuse({ method: "PUT", path: SHARES }, 500, { error: "internal server error" });
			fake.refuse({ method: "PUT", path: SHARES }, 500, { error: "internal server error" });
			const c = await firstDevice(fake, cy);
			await until(() => puts().length === 1);
			await c.engine.sendMessage({ conversation_id: conversation, nonce: crypto.randomUUID(), text: "hi Ana" });
			await turnEnded(a);
			expect(puts()).toHaveLength(1);
			a.clock.advance(60_000);
			await until(() => puts().length === 2);
			await turnEnded(a);
			a.clock.advance(60_000);
			await turnEnded(a);
			expect(puts()).toHaveLength(2);
			a.clock.advance(60_000);
			await reached(c, conversation, sent.id);
			expect(puts()).toHaveLength(3);
		},
		SLOW,
	);

	// M6 (d): a 429 waits as long as its Retry-After says, the per-user hour's included, not always a day.
	test(
		"a catch-up the API refuses for a while waits as long as it says",
		async () => {
			const { fake, puts, cy, conversation, a, sent } = await waitingForCy();
			fake.refuse({ method: "PUT", path: SHARES }, 429, { error: "too many requests" }, { "Retry-After": "120" });
			const c = await firstDevice(fake, cy);
			await until(() => puts().length === 1);
			await turnEnded(a);
			a.clock.advance(119_000);
			await turnEnded(a);
			expect(puts()).toHaveLength(1);
			a.clock.advance(1_000);
			await reached(c, conversation, sent.id);
		},
		SLOW,
	);

	// Task 23's review, M3: a catch-up whose turn came while the engine wasn't ready (its database locked a moment by
	// another window, as it started again) is asked for again once it's ready, not left for the app's next start.
	test(
		"a catch-up whose turn came while the engine wasn't ready goes once it is",
		async () => {
			let locked = false;
			const { fake, cy, conversation, a, sent } = await waitingForCy({
				host: lockable(testHost(), () => locked),
			});
			fake.holdEvents();
			const c = await firstDevice(fake, cy);
			await until(async () => (await groupOf(c, conversation)) !== null);
			// Cy's joining reaches Ana's device as its engine starts again and finds its database locked: the catch-up's
			// turn comes while it isn't ready.
			fake.releaseEvents();
			locked = true;
			await a.engine.start();
			expect(a.engine.state.name).toBe("locked");
			locked = false;
			a.clock.advance(2_000);
			await reached(c, conversation, sent.id);
		},
		SLOW,
	);

	// #550 (step 5's engines review, Minor 2): a catch-up goes as a share does, its keys before its completion. A device
	// the API no longer has (404), or no longer lets this user's reach (403), takes none, and the member's others still
	// get theirs: the package isn't dropped, and its next try doesn't meet the API's one catch-up a day.
	test(
		"a catch-up whose member lost a device meanwhile still reaches their other devices",
		async () => {
			const { fake, requests, cy, conversation, sent } = await waitingForCy();
			// Cy's two devices join while Ana's device hears none of it: her catch-up for him is sealed to both.
			fake.holdEvents();
			const c = await firstDevice(fake, cy);
			const d = await approvedDevice(fake, c);
			const [first, second] = [c.registered.at(-1)!, d.registered.at(-1)!];
			const inbox = new RegExp(`^/api/devices/(${first}|${second})/inbox$`);
			// The first key to go is to a device the API no longer has.
			fake.refuse({ method: "POST", path: inbox }, 404, { error: "device not found" });
			fake.releaseEvents();
			const keys = () => requests.filter((request) => request.startsWith("POST ") && inbox.test(request.slice(5)));
			await until(() => keys().length > 0);
			const other = keys()[0]!.includes(first) ? d : c;
			await reached(other, conversation, sent.id);
			// Its keys went before its completion.
			const complete = requests.findIndex((request) => request.endsWith("/complete"));
			expect(complete).toBeGreaterThan(requests.lastIndexOf(keys().at(-1)!));
		},
		SLOW,
	);

	test(
		"a catch-up refused for a day keeps its notes",
		async () => {
			const { fake, requests } = setUp();
			const [ana, cy] = [fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({ type: "dm", members: [ana, cy] });
			const a = await firstDevice(fake, ana);
			await a.engine.openConversation(conversation);
			const sent = await a.engine.sendMessage({
				conversation_id: conversation,
				nonce: crypto.randomUUID(),
				text: "kept a day",
			});
			// The API takes no more catch-ups to Cy today: the first one is refused.
			fake.refuse({ method: "PUT", path: SHARES }, 429);
			const c = await firstDevice(fake, cy);
			await sameGroup([a, c], conversation);
			const ups = () => requests.filter((request) => request.startsWith("PUT ") && SHARES.test(request.slice(4)));
			await until(() => ups().length === 1);
			// Within the day, nothing more goes, however often Ana's device applies.
			await c.engine.sendMessage({ conversation_id: conversation, nonce: crypto.randomUUID(), text: "hi Ana" });
			await turnEnded(a);
			a.clock.advance(DAY / 2);
			await turnEnded(a);
			expect(ups()).toHaveLength(1);
			expect(await c.api.shares()).toEqual([]);
			// A day on, it goes, with what was noted before the refusal.
			a.clock.advance(DAY / 2);
			await caughtUp(c, conversation, sent!.id);
			const [row] = await c.engine.messages(conversation, [sent!.id]);
			expect(row).toMatchObject({ status: "ok", text: "kept a day" });
		},
		SLOW,
	);

	// #530: a verified contact's changed key can come in the catch-up's own identity round, after the check before its
	// make. What Ana sent while Cy had no identity was noted under none, which any identity of his takes; she verified
	// him once he had one, while the API held his catch-up off. Then the server forges him an identity, with a device of
	// its own, and serves Ana its certificates as his identity, his real identity to the make's observation, and the
	// forged one to the round the core asks for, which seals the package to the forged device: no part, completion or key
	// of it goes until Ana's yes, and then that same package goes.
	test(
		"a catch-up whose own identity round brings a verified contact's changed key waits for the yes",
		async () => {
			const made: string[] = [];
			const { fake, requests, puts, ana, cy, a } = await waitingForCy({ host: countingCatchUps(testHost(), made) });
			fake.refuse({ method: "PUT", path: SHARES }, 429, { error: "too many requests" }, { "Retry-After": "120" });
			await firstDevice(fake, cy);
			await until(() => puts().length === 1);
			await turnEnded(a);
			const { digits } = await a.engine.safetyNumber(cy);
			expect(await a.engine.verifyContact(cy, digits)).toBe(true);
			const forged = await forgedIdentity(fake, cy);
			const { identity_key, device_list, certificate } = forged.made;
			const lie = (view: Identity): Identity => ({ ...view, identity_key, device_list, certificates: [certificate] });
			// After Ana's device asks for Cy's identity, its next GET …/identities gets his own, and the later ones the lie.
			let next: "his" | "forged" | null = null;
			fake.servedAs = (view, route, viewer) => {
				if (viewer !== ana || view.user_id !== cy) return view;
				if (route === "identity") {
					next ??= "his";
					return lie(view);
				}
				if (next !== "his") return next === "forged" ? lie(view) : view;
				next = "forged";
				return view;
			};
			const onward = () =>
				requests.filter(
					(request) =>
						/\/history-shares\/[0-9a-f-]{36}\/(parts\/\d+|complete)$/.test(request) ||
						request === `POST /api/devices/${forged.device}/inbox`,
				);
			a.clock.advance(120_000);
			await until(() => a.engine.contacts().changes[cy] !== undefined);
			await turnEnded(a);
			expect(a.engine.contacts().changes[cy]?.verified).toBe(true);
			expect(onward()).toEqual([]);
			// Her yes: the package made for the forged device goes on, its key to that device, and no other is made.
			const makes = made.length;
			await a.engine.confirmKeyChanges([{ user: cy, change: a.engine.contacts().changes[cy]!.change }]);
			await until(() => requests.includes(`POST /api/devices/${forged.device}/inbox`));
			await turnEnded(a);
			expect(made).toHaveLength(makes);
		},
		SLOW,
	);
});
