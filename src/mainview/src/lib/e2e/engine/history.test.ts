import { describe, expect, spyOn, test } from "bun:test";
import type { HistoryShare } from "$lib/types";
import { CoreError } from "../errors";
import type { CoreHost, ShareMade } from "../host";
import { FakeApi, type GatewayEvent } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import {
	approvedDevice,
	firstDevice,
	groupOf,
	madeHere,
	rejection,
	restarted,
	sameGroup,
	testHost,
	turnEnded,
	until,
	watchedHost,
	type TestDevice,
} from "../testing/engines";
import { useXHR } from "../testing/xhr";
import { KEPT_LATER, SHARE_KEYS } from "./store";

// A conversation's history shared with a member (PLAN-E2E-CLIENTES.md, Task 30; decision 26), and what a device does
// with the packages it's handed: a member's share, offered and added on the person's word (Ruling 22), and a catch-up
// (task 22's), added by itself, one at a time, with the engine's turn free for everything else.
const SLOW = 240_000;
const DAY = 24 * 3600 * 1000;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CONV = `/api/users/@me/conversations/${UUID}`;
const PACKAGE = new RegExp(`^${CONV}/history-shares/(${UUID})$`);
const PART_UP = new RegExp(`^${CONV}/history-shares/${UUID}/parts/\\d+$`);
const COMPLETE = new RegExp(`^${CONV}/history-shares/${UUID}/complete$`);
const INBOX = new RegExp(`^/api/devices/(${UUID})/inbox$`);
const PART_DOWN = new RegExp(`^/api/history-shares/${UUID}/parts/\\d+$`);
const ACK = new RegExp(`^/api/history-shares/${UUID}/ack$`);
/** A device's list of its packages, and its own inbox. */
const LIST = /^\/api\/users\/@me\/history-shares$/;
const OWN_INBOX = /^\/api\/users\/@me\/devices\/@me\/inbox$/;
/** The API's page of a device's packages: the oldest 100 it hasn't acknowledged. */
const PAGE = 100;
// A package's parts go up as bytes, which the app sends through the XMLHttpRequest Bun lacks.
useXHR();

interface Seen {
	method: string;
	path: string;
	/** The session it went with: none for a signed file's download. */
	token: string | null;
	request: Request;
}

/**
 * The fake, answering every request the test's engines make, each seen first; `hold` may keep one waiting until what it
 * gives settles, as a slow network would, and `answer` answer one in the fake's place, as a server that lies would
 * (`fake` answers it as the API would, for a lie made of the truth).
 */
function setUp(
	hold?: (seen: Seen) => Promise<void> | void,
	answer?: (seen: Seen, fake: FakeApi) => Response | undefined | Promise<Response | undefined>,
) {
	const fake = new FakeApi();
	const requests: Seen[] = [];
	spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init);
		const token = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "")?.[1] ?? null;
		const seen = { method: request.method, path: new URL(request.url).pathname, token, request: request.clone() };
		requests.push(seen);
		await hold?.(seen);
		return (await answer?.(seen, fake)) ?? fake.fetch(request);
	}) as typeof fetch);
	const by = (device: TestDevice, method: string, path: RegExp) =>
		requests.filter((seen) => seen.token === device.token && seen.method === method && path.test(seen.path));
	return { fake, requests, by };
}

const send = async (device: TestDevice, conversation: string, text: string) =>
	(await device.engine.sendMessage({ conversation_id: conversation, nonce: crypto.randomUUID(), text }))!;
const deviceOf = (device: TestDevice) => device.registered.at(-1)!;
/** A share's notice (type 4) for `to`, as a member's connection heard it. */
const noticeFor =
	(to: string, range: string) =>
	({ type, data }: GatewayEvent): boolean => {
		const message: unknown = data;
		return (
			type === "DM_MESSAGE_CREATE" &&
			typeof message === "object" &&
			message !== null &&
			"type" in message &&
			message.type === 4 &&
			"history_share" in message &&
			JSON.stringify(message.history_share) === JSON.stringify({ to_user_id: to, range })
		);
	};
const byText = (x: string, y: string) => x.localeCompare(y);
/** What the device's core holds of these messages: their texts, in order. */
const texts = async (device: TestDevice, conversation: string, ids: string[]) =>
	(await device.engine.messages(conversation, ids)).map((row) => row.text ?? "").sort(byText);

/**
 * Ana's and Bo's group, where Bo wrote ten days ago and both wrote this week; then Dee, with two devices (the first as
 * `dee` gives), joins it, and Ana's device holds all three messages.
 */
async function deeJoins(
	given: { setup?: ReturnType<typeof setUp>; anaHost?: CoreHost; dee?: Parameters<typeof firstDevice>[2] } = {},
) {
	const { anaHost } = given;
	const setup = given.setup ?? setUp();
	const { fake } = setup;
	const [ana, bo, dee] = [fake.addUser(), fake.addUser(), fake.addUser()];
	fake.befriend(ana, dee);
	const conversation = fake.addConversation({ type: "group", members: [ana, bo], owner: ana });
	const a = await firstDevice(fake, ana, anaHost ? { host: anaHost } : {});
	const b = await firstDevice(fake, bo);
	await madeHere(a, conversation);
	await a.engine.openConversation(conversation);
	await sameGroup([a, b], conversation);
	// Ten days ago, as the API stamped it: Ana's device holds it as sent then.
	fake.sentAtOffset = -10 * DAY;
	const old = await send(b, conversation, "ten days ago, from Bo");
	fake.sentAtOffset = 0;
	const recent = [
		await send(a, conversation, "this week, from Ana"),
		await send(b, conversation, "this week, from Bo"),
	];
	await until(async () => (await texts(a, conversation, [old.id, ...recent.map((m) => m.id)])).length === 3);
	const d1 = await firstDevice(fake, dee, given.dee);
	const d2 = await approvedDevice(fake, d1);
	await a.engine.addMember(conversation, dee);
	await sameGroup([a, b, d1, d2], conversation);
	return { ...setup, ana, bo, dee, conversation, a, b, d1, d2, old, recent };
}

/** Ana's DM with Cy, who has no device yet, and what Ana sent him meanwhile, noted for him by her core. */
async function cyHasNoDevice(setup = setUp()) {
	const { fake } = setup;
	const [ana, cy] = [fake.addUser(), fake.addUser()];
	const conversation = fake.addConversation({ type: "dm", members: [ana, cy] });
	const a = await firstDevice(fake, ana);
	await a.engine.openConversation(conversation);
	expect(a.engine.conversationState(conversation)).toEqual({ name: "no_device", users: [cy] });
	const sent = await send(a, conversation, "while you were away");
	return { ...setup, ana, cy, conversation, a, sent };
}

/** A host whose `share` answers what `change` makes of the core's answer: the package the core made, said otherwise. */
function sharing(host: CoreHost, change: (made: ShareMade) => ShareMade): CoreHost {
	return new Proxy(host, {
		get(target, name) {
			if (name === "share") return async (command: never) => change(await target.share(command));
			const value = Reflect.get(target, name);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

/**
 * A host that counts the packages it imports at once, the most it ever did and the imports that ended; each refused
 * with what `refuse` gives, as a core whose call is cut would, while it gives one.
 */
function countingImports(
	host: CoreHost,
	counts: { now: number; most: number; done: number },
	refuse: () => Error | null = () => null,
): CoreHost {
	return new Proxy(host, {
		get(target, name) {
			if (name === "importShare") {
				return async (shareId: string, parts: Uint8Array[]) => {
					counts.now++;
					counts.most = Math.max(counts.most, counts.now);
					try {
						const refused = refuse();
						if (refused) throw refused;
						return await target.importShare(shareId, parts);
					} finally {
						counts.now--;
						counts.done++;
					}
				};
			}
			const value = Reflect.get(target, name);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

/**
 * Ana's DM with Bo, both in its group, where Ana verified Bo; then Bo changes his keys (Settings → Devices): a strong
 * change on Ana's device, which holds what goes to him until her yes (Task 28).
 */
async function boChangesKeys(setup = setUp()) {
	const { fake } = setup;
	const [ana, bo] = [fake.addUser(), fake.addUser()];
	fake.befriend(ana, bo);
	const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
	const a = await firstDevice(fake, ana);
	const b = await firstDevice(fake, bo);
	await a.engine.openConversation(conversation);
	await b.engine.openConversation(conversation);
	await sameGroup([a, b], conversation);
	await send(a, conversation, "before your new keys");
	const { digits } = await a.engine.safetyNumber(bo);
	expect(await a.engine.verifyContact(bo, digits)).toBe(true);
	await b.engine.changeKeys();
	await b.engine.keySaved();
	await until(() => a.engine.contacts().changes[bo]?.verified === true);
	return { ...setup, ana, bo, conversation, a, b };
}

/** A host whose `share` the core refuses, as one would whose served devices aren't on the member's list. */
const unlisted = (host: CoreHost): CoreHost =>
	new Proxy(host, {
		get(target, name) {
			if (name === "share") {
				return () =>
					Promise.reject(
						new CoreError("rule_violation", "a device isn't on its user's list", { rule: "device_not_listed" }),
					);
			}
			const value = Reflect.get(target, name);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});

/** The packages whose keys the device's record holds, by ID: not those done with, which it holds by their IDs alone. */
const keysHeld = (device: TestDevice): string[] =>
	(device.store.read<unknown[]>(SHARE_KEYS) ?? []).flatMap((entry) =>
		typeof entry === "object" && entry !== null && "type" in entry && "share_id" in entry
			? [String(entry.share_id)]
			: [],
	);
const isPackage = (data: unknown): data is HistoryShare =>
	typeof data === "object" && data !== null && "id" in data && typeof data.id === "string";
/** The package a HISTORY_SHARE_CREATE told of. */
const packageOf = (event: GatewayEvent | undefined): HistoryShare | null => {
	const data: unknown = event?.type === "HISTORY_SHARE_CREATE" ? event.data : null;
	return isPackage(data) ? data : null;
};
/** Whether the device heard of the package, and holds its key. */
const keyAndPackage = (device: TestDevice, share: string) =>
	keysHeld(device).includes(share) && device.heard.some((event) => packageOf(event)?.id === share);
/** Packages a server made up for the conversation, from `from`: no key of theirs is anywhere. */
const madeUp = (count: number, conversation: string, from: string): HistoryShare[] =>
	Array.from({ length: count }, () => ({
		...{ id: crypto.randomUUID(), conversation_id: conversation, from_user_id: from, kind: "share" as const },
		...{ range: "week", starts_at: new Date().toISOString(), size: 64, parts: 1 },
	}));
/** The ID of the share a device put up last. */
const lastShare = (by: ReturnType<typeof setUp>["by"], device: TestDevice) =>
	PACKAGE.exec(by(device, "PUT", PACKAGE).at(-1)!.path)![1]!;

describe.skipIf(!coreLibrary)("a conversation's history, shared", () => {
	test(
		"a week is shared: its parts go up, its keys go to each of the member's devices, and the group sees the notice",
		async () => {
			const { requests, by, dee, conversation, a, b, d1, d2 } = await deeJoins();
			expect(await a.engine.shareHistory(conversation, dee, "week")).toMatchObject({ sent: true, truncated: false });
			await turnEnded(a);
			// One package, for Dee, a week back.
			const packages = by(a, "PUT", PACKAGE);
			expect(packages).toHaveLength(1);
			const [put] = packages;
			const about = await put!.request.json();
			expect(about).toMatchObject({ to_user_id: dee, kind: "share", range: "week" });
			const share = PACKAGE.exec(put!.path)![1]!;
			// Its parts, then its key, to each of Dee's devices and to no other, then its completion, which posts its notice
			// and lists it for Dee: nobody sees a share whose keys didn't go (M1).
			const parts = by(a, "PUT", PART_UP);
			expect(parts.map((seen) => seen.path)).toEqual(
				Array.from({ length: about.parts }, (_, n) => `${put!.path}/parts/${n}`),
			);
			const completed = by(a, "POST", COMPLETE);
			expect(completed).toHaveLength(1);
			const keys = by(a, "POST", INBOX);
			const keyed = keys.map((seen) => INBOX.exec(seen.path)![1]!);
			expect(keyed.sort(byText)).toEqual([deviceOf(d1), deviceOf(d2)].sort(byText));
			const at = (seen: Seen) => requests.indexOf(seen);
			expect(at(parts.at(-1)!)).toBeLessThan(Math.min(...keys.map(at)));
			expect(Math.max(...keys.map(at))).toBeLessThan(at(completed[0]!));
			// The group sees the notice: whom it went to, and how far back.
			for (const device of [a, b, d1, d2]) await until(() => device.heard.some(noticeFor(dee, "week")));
			// Up, the package goes from Ana's host.
			expect(await rejection(a.host.sharePart(share, 0))).toMatchObject({ code: "not_found" });
		},
		SLOW,
	);

	test(
		"a share that didn't fit says it was cut to the newest",
		async () => {
			let start = 0;
			const anaHost = sharing(testHost(), (made) => {
				start = Date.now() - DAY;
				return { ...made, truncated: true, start };
			});
			const { dee, conversation, a } = await deeJoins({ anaHost });
			// The core cut it, keeping the newest that fit: the person is told from when the member gets everything.
			const outcome = await a.engine.shareHistory(conversation, dee, "all");
			expect(outcome).toEqual({ sent: true, truncated: true, start });
			await turnEnded(a);
		},
		SLOW,
	);

	test(
		"a share is imported only when the person says so; a catch-up, by itself",
		async () => {
			const { fake, requests, by, ana, dee, conversation, a, d1, d2, old, recent } = await deeJoins();
			await a.engine.shareHistory(conversation, dee, "week");
			await turnEnded(a);
			// Dee's devices offer it once its key is in, and add nothing of it until she says so.
			for (const device of [d1, d2]) await until(() => device.engine.offers(conversation).length === 1);
			const [offer] = d1.engine.offers(conversation);
			expect(offer).toMatchObject({ from_user_id: ana, range: "week" });
			await turnEnded(d1);
			const ids = [old.id, ...recent.map((message) => message.id)];
			expect(await texts(d1, conversation, ids)).toEqual([]);
			expect(by(d1, "GET", PART_DOWN)).toEqual([]);
			expect(by(d1, "POST", ACK)).toEqual([]);
			// She says so on one device: the week comes to it, never the older message, and that offer goes.
			expect(await d1.engine.importShared(offer!.share_id)).toBeGreaterThan(0);
			expect(await texts(d1, conversation, ids)).toEqual(["this week, from Ana", "this week, from Bo"]);
			expect(d1.engine.offers(conversation)).toEqual([]);
			expect(by(d1, "POST", ACK)).toHaveLength(1);
			// Her other device still waits for her word.
			await turnEnded(d2);
			expect(d2.engine.offers(conversation)).toHaveLength(1);
			expect(await texts(d2, conversation, ids)).toEqual([]);

			// A catch-up: Cy's first device adds what Ana noted for him, with nothing asked of him, and offers nothing.
			const away = await cyHasNoDevice({ fake, requests, by });
			const c = await firstDevice(away.fake, away.cy);
			await until(async () => (await texts(c, away.conversation, [away.sent.id])).length === 1, 120_000);
			expect(await texts(c, away.conversation, [away.sent.id])).toEqual(["while you were away"]);
			expect(c.engine.offers(away.conversation)).toEqual([]);
			await until(() => away.by(c, "POST", ACK).length === 1);
		},
		SLOW,
	);

	test(
		"imported messages say who shared them, and fill the rows that waited",
		async () => {
			// A row that waited: Ana's device writes to Cy at the epoch before his first device came in, as it heard
			// nothing meanwhile, so his device can't open it. Its key reaches him only once that row is there.
			const away = await cyHasNoDevice();
			let keysIn = false;
			away.fake.holdEvents();
			const c = await firstDevice(away.fake, away.cy, {
				hears: (event) => event.type !== "DEVICE_MESSAGE" || keysIn,
			});
			await until(async () => (await groupOf(c, away.conversation)) !== null);
			const late = await send(away.a, away.conversation, "written before Ana heard of you");
			away.fake.releaseEvents();
			await until(async () => (await c.engine.messages(away.conversation, [late.id]))[0]?.status === "waiting");
			// The catch-up comes, its key with it: the row fills, shared by Ana, as does the one from before he had a device.
			keysIn = true;
			c.connect(deviceOf(c));
			await until(async () => (await c.engine.messages(away.conversation, [late.id]))[0]?.status === "ok", 120_000);
			for (const id of [late.id, away.sent.id]) {
				const [row] = await c.engine.messages(away.conversation, [id]);
				expect(row).toMatchObject({ status: "ok", user_id: away.ana, shared_by: away.ana });
			}

			// A row a device opened itself stays as it was: a share brings it again, and it isn't the sharer's.
			const setup = { fake: away.fake, requests: away.requests, by: away.by };
			const { ana, bo, dee, conversation, a, b, d1, old, recent } = await deeJoins({ setup });
			const after = await send(b, conversation, "after Dee came");
			await until(async () => (await d1.engine.messages(conversation, [after.id]))[0]?.status === "ok");
			await a.engine.shareHistory(conversation, dee, "all");
			await turnEnded(a);
			await until(() => d1.engine.offers(conversation).length === 1);
			// The views are told any of the conversation's rows may have changed: an open chat reads its rows again.
			const told: (readonly string[] | undefined)[] = [];
			d1.engine.onMessages((id, ids) => id === conversation && told.push(ids));
			await d1.engine.importShared(d1.engine.offers(conversation)[0]!.share_id);
			expect(told).toContainEqual(undefined);
			const rows = await d1.engine.messages(conversation, [old.id, ...recent.map((m) => m.id), after.id]);
			const of = (id: string) => rows.find((row) => row.message_id === id);
			expect(of(after.id)).toMatchObject({ user_id: bo, shared_by: null, text: "after Dee came" });
			expect(of(old.id)).toMatchObject({ user_id: bo, shared_by: ana, text: "ten days ago, from Bo" });
			expect(of(recent[0]!.id)).toMatchObject({ user_id: ana, shared_by: ana });
		},
		SLOW,
	);

	test(
		"a package whose key hasn't come waits for it",
		async () => {
			// Cy's first device doesn't read its inbox until its next READY: Ana's catch-up, its key there already, is
			// listed for it before the key is in.
			let deaf = true;
			let cy = "";
			const setup = setUp(undefined, (seen) =>
				deaf && seen.token === cy && seen.method === "GET" && OWN_INBOX.test(seen.path) ? Response.json([]) : undefined,
			);
			const away = await cyHasNoDevice(setup);
			cy = away.fake.signIn(away.cy).token;
			const c = await firstDevice(away.fake, away.cy, { token: cy });
			await until(() => c.heard.some((event) => event.type === "HISTORY_SHARE_CREATE"), 120_000);
			await turnEnded(away.a);
			await turnEnded(c);
			// Cy's device lists it, and waits: it fetches none of it and adds nothing.
			expect((await c.api.shares()).map((share) => share.kind)).toEqual(["catch_up"]);
			expect(away.by(c, "GET", PART_DOWN)).toEqual([]);
			expect(await texts(c, away.conversation, [away.sent.id])).toEqual([]);
			// The next READY reads the inbox: the key is in, and the catch-up comes in by itself.
			deaf = false;
			c.connect(deviceOf(c));
			await until(async () => (await texts(c, away.conversation, [away.sent.id])).length === 1, 120_000);

			// A share's offer waits for its key the same way.
			const { dee, conversation, a, d1 } = await deeJoins({ setup });
			deaf = true;
			cy = d1.token;
			await a.engine.shareHistory(conversation, dee, "week");
			await turnEnded(a);
			await until(() => d1.heard.some((event) => event.type === "HISTORY_SHARE_CREATE"));
			await turnEnded(d1);
			expect(d1.engine.offers(conversation)).toEqual([]);
			deaf = false;
			d1.connect(deviceOf(d1));
			await until(() => d1.engine.offers(conversation).length === 1);
		},
		SLOW,
	);

	// Its key went first, as a share's keys go before its completion: the package, unknown here, comes after it.
	test(
		"a key that comes before its package waits for it",
		async () => {
			let deaf = false;
			const { by, dee, conversation, a, d1 } = await deeJoins({
				dee: { hears: (event) => !(deaf && event.type === "HISTORY_SHARE_CREATE") },
			});
			deaf = true;
			await a.engine.shareHistory(conversation, dee, "week");
			await turnEnded(a);
			const share = lastShare(by, a);
			await until(() => keysHeld(d1).includes(share));
			await turnEnded(d1);
			// Its key is kept, its package not known here yet: nothing is offered or fetched.
			expect(d1.engine.offers(conversation)).toEqual([]);
			expect(by(d1, "GET", PART_DOWN)).toEqual([]);
			// A READY lists it: it's offered, by the key that came first.
			deaf = false;
			d1.connect(deviceOf(d1));
			await until(() => d1.engine.offers(conversation).length === 1);
			expect(d1.engine.offers(conversation)[0]).toMatchObject({ share_id: share });
		},
		SLOW,
	);

	test(
		"the eleventh share of the hour says why it didn't go",
		async () => {
			const { by, dee, conversation, a } = await deeJoins();
			for (let n = 0; n < 10; n++) {
				expect(await a.engine.shareHistory(conversation, dee, "day")).toMatchObject({ sent: true });
			}
			await turnEnded(a);
			const eleventh = await a.engine.shareHistory(conversation, dee, "day");
			expect(eleventh).toMatchObject({ sent: false, why: "limit" });
			const wait = eleventh.sent ? 0 : "retryAfterMs" in eleventh ? eleventh.retryAfterMs : 0;
			expect(wait).toBeGreaterThan(0);
			expect(wait).toBeLessThanOrEqual(3600_000);
			// Refused, it made no notice and left nothing behind: no part of it went up, and the host let it go.
			await turnEnded(a);
			const refused = PACKAGE.exec(by(a, "PUT", PACKAGE).at(-1)!.path)![1]!;
			expect(by(a, "PUT", PART_UP).filter((seen) => seen.path.includes(refused))).toEqual([]);
			expect(await rejection(a.host.sharePart(refused, 0))).toMatchObject({ code: "not_found" });
		},
		SLOW,
	);

	test(
		"a member with no device is told there's no one to share with",
		async () => {
			const away = await cyHasNoDevice();
			expect(await away.a.engine.shareHistory(away.conversation, away.cy, "week")).toEqual({
				sent: false,
				why: "no_device",
			});
			expect(away.by(away.a, "PUT", PACKAGE)).toEqual([]);
		},
		SLOW,
	);

	// The person waits for the API's word on the package, and for nothing more: one it didn't take (its server failing,
	// or no answer) is said at once, in the app's words, and goes; Share again makes another.
	test(
		"a share the API didn't take says so at once, and nothing of it goes on",
		async () => {
			const { fake, by, dee, conversation, a } = await deeJoins();
			fake.refuse({ method: "PUT", path: PACKAGE }, 500, { error: "internal server error" });
			expect(await a.engine.shareHistory(conversation, dee, "week")).toEqual({
				sent: false,
				why: "refused",
				error: null,
			});
			const [put] = by(a, "PUT", PACKAGE);
			const refused = PACKAGE.exec(put!.path)![1]!;
			await turnEnded(a);
			a.clock.advance(3600_000);
			await turnEnded(a);
			expect(by(a, "PUT", PACKAGE)).toHaveLength(1);
			expect(await rejection(a.host.sharePart(refused, 0))).toMatchObject({ code: "not_found" });
			// A refusal of the API's own says its words.
			fake.refuse({ method: "PUT", path: PACKAGE }, 413, { error: "the history share doesn't fit in your storage" });
			expect(await a.engine.shareHistory(conversation, dee, "week")).toEqual({
				sent: false,
				why: "refused",
				error: "the history share doesn't fit in your storage",
			});
		},
		SLOW,
	);

	// M1: the person was told it went once the API took it; one that ends for good after that is told to them, and
	// nothing of it reached the group, as its keys and its completion come last.
	test(
		"a share that ends for good after the person heard it went is said",
		async () => {
			const { fake, by, dee, conversation, a } = await deeJoins();
			const ended: unknown[] = [];
			a.engine.onChangeRefused((...told) => ended.push(told));
			fake.refuse({ method: "PUT", path: PART_UP }, 413, { error: "a part is 1 MiB and its tag at most" });
			expect(await a.engine.shareHistory(conversation, dee, "week")).toMatchObject({ sent: true });
			await turnEnded(a);
			expect(ended).toEqual([[conversation, lastShare(by, a), "share"]]);
			expect(by(a, "POST", INBOX)).toEqual([]);
			expect(by(a, "POST", COMPLETE)).toEqual([]);
		},
		SLOW,
	);

	// M6: a member with devices is served only theirs; a served device the core takes off their list is the server's
	// doing, not a member with none.
	test(
		"a share whose served devices aren't the member's list says it didn't go, not that they have none",
		async () => {
			const { by, dee, conversation, a } = await deeJoins({ anaHost: unlisted(testHost()) });
			expect(await a.engine.shareHistory(conversation, dee, "week")).toEqual({
				sent: false,
				why: "refused",
				error: null,
			});
			expect(by(a, "PUT", PACKAGE)).toEqual([]);
		},
		SLOW,
	);

	// Task 28: a verified contact's changed key holds what goes to them until the person's yes. A share's package is
	// taken (the person hears it went), and its parts, its keys and its completion, which lists it for them and posts its
	// notice, wait for the yes.
	test(
		"a share to a verified contact whose key changed sends no part, key or completion until the yes",
		async () => {
			const { requests, by, bo, conversation, a, b } = await boChangesKeys();
			const mark = requests.length;
			expect(await a.engine.shareHistory(conversation, bo, "week")).toMatchObject({ sent: true });
			await turnEnded(a);
			const since = () => requests.slice(mark).filter((seen) => seen.token === a.token);
			expect(by(a, "PUT", PACKAGE)).toHaveLength(1);
			expect(since().filter((seen) => [PART_UP, INBOX, COMPLETE].some((path) => path.test(seen.path)))).toEqual([]);
			// Her yes names the change she was shown: the share goes on, and Bo's device offers it.
			await a.engine.confirmKeyChanges([{ user: bo, change: a.engine.contacts().changes[bo]!.change }]);
			await until(() => by(a, "POST", COMPLETE).length === 1);
			await until(() => b.engine.offers(conversation).length === 1);
		},
		SLOW,
	);

	test(
		"verifying the contact's new number sends the share that waited for it",
		async () => {
			const { by, bo, conversation, a, b } = await boChangesKeys();
			expect(await a.engine.shareHistory(conversation, bo, "week")).toMatchObject({ sent: true });
			await turnEnded(a);
			expect(by(a, "PUT", PART_UP)).toEqual([]);
			expect(by(a, "POST", COMPLETE)).toEqual([]);
			const { digits } = await a.engine.safetyNumber(bo);
			expect(await a.engine.verifyContact(bo, digits)).toBe(true);
			await until(() => by(a, "POST", COMPLETE).length === 1);
			await until(() => b.engine.offers(conversation).length === 1);
		},
		SLOW,
	);
});

// Task 22's review, for what a device receives (its M6): one catch-up at a time, its parts down outside the engine's
// turn, the package kept until it's added, and a wait after a failure, as long as a 429 says.
describe.skipIf(!coreLibrary)("the packages a device receives", () => {
	test(
		"catch-ups are added one at a time",
		async () => {
			const setup = setUp();
			const { fake } = setup;
			const [ana, bo, cy] = [fake.addUser(), fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({ type: "group", members: [ana, bo, cy], owner: ana });
			const [a, b] = [await firstDevice(fake, ana), await firstDevice(fake, bo)];
			await madeHere(a, conversation);
			await a.engine.openConversation(conversation);
			await sameGroup([a, b], conversation);
			await b.engine.openConversation(conversation);
			const sent = [await send(a, conversation, "from Ana"), await send(b, conversation, "from Bo")];
			// Cy's first device gets a catch-up from each.
			const counts = { now: 0, most: 0, done: 0 };
			const c = await firstDevice(fake, cy, { host: countingImports(testHost(), counts) });
			const ids = sent.map((message) => message.id);
			await until(async () => (await texts(c, conversation, ids)).length === 2, 120_000);
			expect(await texts(c, conversation, ids)).toEqual(["from Ana", "from Bo"]);
			expect(counts.most).toBe(1);
			expect(counts.done).toBeGreaterThanOrEqual(2);
		},
		SLOW,
	);

	test(
		"a catch-up's parts come down outside the engine's turn, which other work takes meanwhile",
		async () => {
			let held = false;
			let release = () => {};
			let holding = true;
			const away = await (async () => {
				const setup = setUp((seen) => {
					if (!holding || !PART_DOWN.test(seen.path)) return;
					held = true;
					return new Promise<void>((go) => (release = go));
				});
				const { fake } = setup;
				const [ana, cy, dan] = [fake.addUser(), fake.addUser(), fake.addUser()];
				const conversation = fake.addConversation({ type: "dm", members: [ana, cy] });
				const other = fake.addConversation({ type: "dm", members: [cy, dan] });
				const a = await firstDevice(fake, ana);
				await a.engine.openConversation(conversation);
				const sent = await send(a, conversation, "while you were away");
				return { ...setup, cy, conversation, other, a, sent };
			})();
			let c: TestDevice;
			try {
				c = await firstDevice(away.fake, away.cy);
				await until(() => held, 120_000);
				// The parts' download waits; the engine's turn doesn't.
				let opened = false;
				void c.engine.openConversation(away.other).then(() => (opened = true));
				await until(() => opened, 10_000);
			} finally {
				holding = false;
				release();
			}
			await until(async () => (await texts(c, away.conversation, [away.sent.id])).length === 1, 120_000);
		},
		SLOW,
	);

	test(
		"a package that failed to come in goes again after a wait, as long as a 429 says",
		async () => {
			const away = await cyHasNoDevice();
			// Its parts' route fails once, then refuses for two minutes.
			away.fake.refuse({ method: "GET", path: PART_DOWN }, 500, { error: "internal server error" });
			away.fake.refuse(
				{ method: "GET", path: PART_DOWN },
				429,
				{ error: "too many requests, try again later" },
				{ "Retry-After": "120" },
			);
			const c = await firstDevice(away.fake, away.cy);
			await until(() => away.by(c, "GET", PART_DOWN).length === 1, 120_000);
			await turnEnded(c);
			// A failure waits a minute.
			expect(away.by(c, "GET", PART_DOWN)).toHaveLength(1);
			c.clock.advance(60_000);
			await until(() => away.by(c, "GET", PART_DOWN).length === 2);
			await turnEnded(c);
			// The 429 waits what it says, not a minute.
			c.clock.advance(119_000);
			await turnEnded(c);
			expect(away.by(c, "GET", PART_DOWN)).toHaveLength(2);
			c.clock.advance(1_000);
			await until(async () => (await texts(c, away.conversation, [away.sent.id])).length === 1, 120_000);
		},
		SLOW,
	);

	test(
		"a package added on one try is only acknowledged on the next, never added twice",
		async () => {
			const away = await cyHasNoDevice();
			away.fake.refuse({ method: "POST", path: ACK }, 500, { error: "internal server error" });
			const counts = { now: 0, most: 0, done: 0 };
			const c = await firstDevice(away.fake, away.cy, { host: countingImports(testHost(), counts) });
			await until(() => away.by(c, "POST", ACK).length === 1, 120_000);
			await turnEnded(c);
			expect(await texts(c, away.conversation, [away.sent.id])).toEqual(["while you were away"]);
			c.clock.advance(60_000);
			await until(() => away.by(c, "POST", ACK).length === 2);
			await turnEnded(c);
			expect(counts.done).toBe(1);
			expect(await c.api.shares()).toEqual([]);
		},
		SLOW,
	);

	// A part is a megabyte and its tag at most: one longer isn't the part its sender sealed, and no try changes that.
	test(
		"a package whose part is longer than a part can be ends here, unopened",
		async () => {
			let lying = true;
			const setup = setUp(undefined, (seen) =>
				lying && seen.token === null && seen.path.startsWith("/attachments/")
					? new Response(new Uint8Array((1 << 20) + 17))
					: undefined,
			);
			const away = await cyHasNoDevice(setup);
			const counts = { now: 0, most: 0, done: 0 };
			const c = await firstDevice(away.fake, away.cy, { host: countingImports(testHost(), counts) });
			await until(() => away.by(c, "POST", ACK).length === 1, 120_000);
			await turnEnded(c);
			lying = false;
			c.clock.advance(3600_000);
			await turnEnded(c);
			// Acknowledged unopened, and never asked for again.
			expect(counts.done).toBe(0);
			expect(away.by(c, "GET", PART_DOWN)).toHaveLength(1);
			expect(await texts(c, away.conversation, [away.sent.id])).toEqual([]);
		},
		SLOW,
	);

	test(
		"a key the core couldn't take yet is taken at the inbox's next round",
		async () => {
			const away = await cyHasNoDevice();
			let refused = false;
			const host = watchedHost(testHost(), [], (cmd) =>
				cmd === "receive_direct" && !refused
					? ((refused = true),
						new CoreError("bad_command", "the command's fields don't match", { field: "from_certificate" }))
					: null,
			);
			const c = await firstDevice(away.fake, away.cy, { host });
			await until(() => refused, 120_000);
			await turnEnded(c);
			// Kept for later, as its sender won't send it again; the inbox is cleared through it.
			expect(c.store.read<unknown[]>(KEPT_LATER)).toHaveLength(1);
			expect(await texts(c, away.conversation, [away.sent.id])).toEqual([]);
			// The next round takes it, and the catch-up comes in.
			c.connect(deviceOf(c));
			await until(async () => (await texts(c, away.conversation, [away.sent.id])).length === 1, 120_000);
			expect(c.store.read<unknown[]>(KEPT_LATER) ?? []).toEqual([]);
		},
		SLOW,
	);

	// I1: the API lists a device's packages a page at a time, the oldest 100, and only acknowledgements move it.
	test(
		"a list lets a package go only when it's shorter than the API's page, and its key stays for when it's listed again",
		async () => {
			let lie: ((listed: HistoryShare[]) => HistoryShare[]) | null = null;
			let dee = "";
			const setup = setUp(undefined, async (seen, fake) => {
				if (!lie || seen.token !== dee || seen.method !== "GET" || !LIST.test(seen.path)) return undefined;
				const listed: HistoryShare[] = await (await fake.fetch(seen.request)).json();
				return Response.json(lie(listed));
			});
			const { ana, conversation, a, d1, ...them } = await deeJoins({ setup });
			dee = d1.token;
			await a.engine.shareHistory(conversation, them.dee, "week");
			await turnEnded(a);
			await until(() => d1.engine.offers(conversation).length === 1);
			const offered = d1.engine.offers(conversation);
			const listed = async (made: typeof lie) => {
				lie = made;
				d1.connect(deviceOf(d1));
				await turnEnded(d1);
			};
			// A whole page of others leaves it out: what's past the page isn't gone.
			await listed(() => madeUp(PAGE, conversation, ana));
			expect(d1.engine.offers(conversation)).toEqual(offered);
			// A short list without it lets it go, its key kept: listed again, it's offered again.
			await listed(() => madeUp(3, conversation, ana));
			expect(d1.engine.offers(conversation)).toEqual([]);
			expect(keysHeld(d1)).toContain(offered[0]!.share_id);
			await listed(null);
			expect(d1.engine.offers(conversation)).toEqual(offered);
			// Past its 30 days its key goes from the record, as from the core: it's offered no more.
			d1.clock.advance(31 * DAY);
			expect(d1.engine.offers(conversation)).toEqual([]);
		},
		SLOW,
	);

	// I1: HISTORY_SHARE_CREATE comes outside the engine's turn, while a list asked before it may be on its way.
	test(
		"a package heard while a list asked before it is on its way stays",
		async () => {
			let holding = false;
			let asked = false;
			let release = () => {};
			let dee = "";
			const setup = setUp(undefined, async (seen, fake) => {
				if (!holding || seen.token !== dee || seen.method !== "GET" || !LIST.test(seen.path)) return undefined;
				// The API's answer, made now, before the share: it comes late.
				const answer = await fake.fetch(seen.request);
				asked = true;
				await new Promise<void>((go) => (release = go));
				return answer;
			});
			const { conversation, a, d1, ...them } = await deeJoins({ setup });
			[dee, holding] = [d1.token, true];
			d1.connect(deviceOf(d1));
			await until(() => asked);
			await a.engine.shareHistory(conversation, them.dee, "week");
			await turnEnded(a);
			await until(() => d1.heard.some((event) => event.type === "HISTORY_SHARE_CREATE"));
			holding = false;
			release();
			// The list's answer, without it, doesn't let it go: its key, which the turn takes after that list, offers it.
			await until(() => d1.engine.offers(conversation).length === 1, 20_000);
		},
		SLOW,
	);

	test(
		"while the API's page is whole, each acknowledgement lists it again",
		async () => {
			let padded = false;
			let dee = "";
			const setup = setUp(undefined, async (seen, fake) => {
				if (!padded || seen.token !== dee || seen.method !== "GET" || !LIST.test(seen.path)) return undefined;
				const listed: HistoryShare[] = await (await fake.fetch(seen.request)).json();
				return Response.json([...listed, ...madeUp(PAGE - listed.length, listed[0]?.conversation_id ?? "", "")]);
			});
			const { requests, by, conversation, a, d1, ...them } = await deeJoins({ setup });
			dee = d1.token;
			await a.engine.shareHistory(conversation, them.dee, "week");
			await turnEnded(a);
			await until(() => d1.engine.offers(conversation).length === 1);
			// The page is whole, its share among the hundred.
			padded = true;
			d1.connect(deviceOf(d1));
			await turnEnded(d1);
			const lists = by(d1, "GET", LIST).length;
			await d1.engine.importShared(d1.engine.offers(conversation)[0]!.share_id);
			await turnEnded(d1);
			// Its acknowledgement made room on the page: the ones past it are asked for.
			const [ack] = by(d1, "POST", ACK);
			expect(by(d1, "GET", LIST)).toHaveLength(lists + 1);
			expect(requests.indexOf(ack!)).toBeLessThan(requests.indexOf(by(d1, "GET", LIST).at(-1)!));
		},
		SLOW,
	);

	test(
		"a conversation offers its newest three; Dismiss lets one go for good, and the next shows",
		async () => {
			const { fake, by, dee, conversation, a, d1 } = await deeJoins();
			for (let n = 0; n < 4; n++) await a.engine.shareHistory(conversation, dee, "day");
			await turnEnded(a);
			const newest = by(a, "PUT", PACKAGE)
				.map((seen) => PACKAGE.exec(seen.path)![1]!)
				.sort((x, y) => y.localeCompare(x));
			await until(() => newest.every((share) => keyAndPackage(d1, share)));
			await turnEnded(d1);
			const offered = (device: TestDevice) => device.engine.offers(conversation).map((offer) => offer.share_id);
			expect(offered(d1)).toEqual(newest.slice(0, 3));
			// Dismissed, the newest shows no more and is acknowledged, unopened: the fourth shows.
			d1.engine.dismissShared(newest[0]!);
			expect(offered(d1)).toEqual(newest.slice(1));
			await turnEnded(d1);
			expect(by(d1, "POST", ACK).map((seen) => seen.path)).toEqual([`/api/history-shares/${newest[0]}/ack`]);
			expect(by(d1, "GET", PART_DOWN)).toEqual([]);
			// After a restart, it's still let go.
			const again = await restarted(fake, d1);
			await turnEnded(again);
			expect(offered(again)).toEqual(newest.slice(1));
			await again.engine.stop();
		},
		SLOW,
	);

	// I2: the core deletes a key once it imported its package: what's done is noted before the API is told.
	test(
		"a share's acknowledgement that failed goes again alone, and after a restart with no offer or download",
		async () => {
			const counts = { now: 0, most: 0, done: 0 };
			const { fake, by, dee, conversation, a, d1 } = await deeJoins({
				dee: { host: countingImports(testHost(), counts) },
			});
			await a.engine.shareHistory(conversation, dee, "week");
			await turnEnded(a);
			await until(() => d1.engine.offers(conversation).length === 1);
			// The API doesn't take its acknowledgement: it's in all the same, and the person hears so.
			fake.refuse({ method: "POST", path: ACK }, 500, { error: "internal server error" });
			expect(await d1.engine.importShared(d1.engine.offers(conversation)[0]!.share_id)).toBeGreaterThan(0);
			expect(d1.engine.offers(conversation)).toEqual([]);
			await turnEnded(d1);
			expect(by(d1, "POST", ACK)).toHaveLength(1);
			// A minute on it goes again by itself, alone, and fails again.
			fake.refuse({ method: "POST", path: ACK }, 500, { error: "internal server error" });
			d1.clock.advance(60_000);
			await until(() => by(d1, "POST", ACK).length === 2);
			await turnEnded(d1);
			const parts = by(d1, "GET", PART_DOWN).length;
			// After a restart, the record says it's in: it's acknowledged, never offered or fetched again.
			const again = await restarted(fake, d1);
			await until(() => by(again, "POST", ACK).length === 3);
			await turnEnded(again);
			expect(again.engine.offers(conversation)).toEqual([]);
			expect(by(again, "GET", PART_DOWN)).toHaveLength(parts);
			expect(counts.done).toBe(1);
			expect(await again.api.shares()).toEqual([]);
			await again.engine.stop();
		},
		SLOW,
	);

	test(
		"a package whose key the core used up is done with, and acknowledged",
		async () => {
			let usedUp = false;
			const counts = { now: 0, most: 0, done: 0 };
			const host = countingImports(testHost(), counts, () =>
				usedUp ? new CoreError("not_found", "no such share", { what: "share" }) : null,
			);
			const { fake, by, dee, conversation, a, d1 } = await deeJoins({ dee: { host } });
			await a.engine.shareHistory(conversation, dee, "week");
			await turnEnded(a);
			await until(() => d1.engine.offers(conversation).length === 1);
			// Its import ended before, unnoted: the core deleted the key then.
			usedUp = true;
			expect(await d1.engine.importShared(d1.engine.offers(conversation)[0]!.share_id)).toBe(0);
			await turnEnded(d1);
			expect(by(d1, "POST", ACK)).toHaveLength(1);
			expect(d1.engine.offers(conversation)).toEqual([]);
			const again = await restarted(fake, d1);
			await turnEnded(again);
			expect(again.engine.offers(conversation)).toEqual([]);
			await again.engine.stop();
		},
		SLOW,
	);

	// I3: the key's kind, conversation and sharer are the core's, as the sender's device signed them; the API's list
	// and HISTORY_SHARE_CREATE are a server's word, and history_import takes no kind: this is Ruling 22's whole guard.
	test(
		"a package the API lists as another kind, conversation or sharer than its key says brings nothing in",
		async () => {
			const { fake, by, bo, dee, conversation, a, d1, old, recent } = await deeJoins();
			const other = crypto.randomUUID();
			const lies: FakeApi["listedAs"][] = [
				(view) => ({ ...view, kind: "catch_up" }),
				(view) => ({ ...view, conversation_id: other }),
				(view) => ({ ...view, from_user_id: bo }),
			];
			const ids = [old.id, ...recent.map((message) => message.id)];
			for (const lie of lies) {
				fake.listedAs = lie;
				await a.engine.shareHistory(conversation, dee, "week");
				await turnEnded(a);
				const share = lastShare(by, a);
				await until(() => keyAndPackage(d1, share));
				await turnEnded(d1);
			}
			// Listed again, as the server lies: still nothing.
			d1.connect(deviceOf(d1));
			await turnEnded(d1);
			for (const conv of [conversation, other]) expect(d1.engine.offers(conv)).toEqual([]);
			expect(by(d1, "GET", PART_DOWN)).toEqual([]);
			expect(by(d1, "POST", ACK)).toEqual([]);
			expect(await texts(d1, conversation, ids)).toEqual([]);
		},
		SLOW,
	);

	test(
		"a package listed with more parts than a package has is never fetched",
		async () => {
			const { fake, by, dee, conversation, a, d1 } = await deeJoins();
			fake.listedAs = (view) => ({ ...view, parts: 65 });
			await a.engine.shareHistory(conversation, dee, "week");
			await turnEnded(a);
			await until(() => keyAndPackage(d1, lastShare(by, a)));
			await turnEnded(d1);
			expect(d1.engine.offers(conversation)).toEqual([]);
			expect(by(d1, "GET", PART_DOWN)).toEqual([]);
		},
		SLOW,
	);

	// M2: a failed import's parts aren't held through its wait; a catch-up that keeps failing waits for the person.
	test(
		"an import that failed lets its parts go, and a catch-up whose import failed three times waits as an offer",
		async () => {
			const away = await cyHasNoDevice();
			let failing = true;
			const counts = { now: 0, most: 0, done: 0 };
			const host = countingImports(testHost(), counts, () =>
				failing ? new CoreError("internal", "the call was cut") : null,
			);
			const c = await firstDevice(away.fake, away.cy, { host });
			await until(() => counts.done === 1, 120_000);
			await turnEnded(c);
			expect(away.by(c, "GET", PART_DOWN)).toHaveLength(1);
			// Its next try, a minute on, fetches its parts again; then two minutes on.
			c.clock.advance(60_000);
			await until(() => counts.done === 2);
			await turnEnded(c);
			expect(away.by(c, "GET", PART_DOWN)).toHaveLength(2);
			c.clock.advance(120_000);
			await until(() => counts.done === 3);
			await turnEnded(c);
			// Failed three times: it goes no more by itself, unacknowledged, and waits as an offer, with no range.
			c.clock.advance(3600_000);
			await turnEnded(c);
			expect(counts.done).toBe(3);
			expect(away.by(c, "POST", ACK)).toEqual([]);
			expect(c.engine.offers(away.conversation)).toMatchObject([{ from_user_id: away.ana, range: null }]);
			// The person tries it: it comes in.
			failing = false;
			expect(await c.engine.importShared(c.engine.offers(away.conversation)[0]!.share_id)).toBeGreaterThan(0);
			expect(await texts(c, away.conversation, [away.sent.id])).toEqual(["while you were away"]);
			expect(c.engine.offers(away.conversation)).toEqual([]);
		},
		SLOW,
	);

	// M3: a 429 whose Retry-After is 0, or a date past, would ask again as often as the server answers so.
	test(
		"a 429 that asks for no wait waits a minute all the same",
		async () => {
			const away = await cyHasNoDevice();
			const busy = { error: "too many requests, try again later" };
			away.fake.refuse({ method: "GET", path: PART_DOWN }, 429, busy, { "Retry-After": "0" });
			const c = await firstDevice(away.fake, away.cy);
			await until(() => away.by(c, "GET", PART_DOWN).length === 1, 120_000);
			await turnEnded(c);
			c.clock.advance(1_000);
			await turnEnded(c);
			expect(away.by(c, "GET", PART_DOWN)).toHaveLength(1);
			c.clock.advance(59_000);
			await until(async () => (await texts(c, away.conversation, [away.sent.id])).length === 1, 120_000);
		},
		SLOW,
	);

	// M4: the core keeps nothing of a key it used: a key and a listing handed again bring the package in again unless
	// the device keeps what it's done with.
	test(
		"a package's key and listing handed again once it's done with bring nothing in",
		async () => {
			let replay: HistoryShare | null = null;
			let cy = "";
			const setup = setUp(undefined, (seen) =>
				replay && seen.token === cy && seen.method === "GET" && LIST.test(seen.path)
					? Response.json([replay])
					: undefined,
			);
			const away = await cyHasNoDevice(setup);
			const counts = { now: 0, most: 0, done: 0 };
			const c = await firstDevice(away.fake, away.cy, { host: countingImports(testHost(), counts) });
			cy = c.token;
			await until(() => away.by(c, "POST", ACK).length === 1, 120_000);
			await turnEnded(c);
			expect(counts.done).toBe(1);
			// A server hands both again: the key in the inbox, the package on the list.
			const [heard] = c.heard.filter((event) => event.type === "HISTORY_SHARE_CREATE");
			replay = packageOf(heard);
			expect(replay).not.toBeNull();
			const { message } = await away.by(away.a, "POST", INBOX).at(-1)!.request.clone().json();
			await away.a.api.sendToDevice(deviceOf(c), message);
			await until(async () => (await c.api.inbox()).length === 0);
			c.connect(deviceOf(c));
			await turnEnded(c);
			expect(counts.done).toBe(1);
			expect(away.by(c, "GET", PART_DOWN)).toHaveLength(1);
			expect(c.engine.offers(away.conversation)).toEqual([]);
			expect(keysHeld(c)).toEqual([]);
		},
		SLOW,
	);

	test(
		"a shared history's text goes nowhere but the cores",
		async () => {
			const witness = `witness${crypto.randomUUID().replaceAll("-", "")}`;
			const written: string[] = [];
			const spies = (["log", "info", "warn", "error", "debug", "trace"] as const).map((method) =>
				spyOn(console, method).mockImplementation((...args: unknown[]) => {
					written.push(
						args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : String(arg))).join(" "),
					);
				}),
			);
			try {
				const { fake, requests } = setUp();
				const [ana, bo, dee] = [fake.addUser(), fake.addUser(), fake.addUser()];
				fake.befriend(ana, dee);
				const conversation = fake.addConversation({ type: "group", members: [ana, bo], owner: ana });
				const [a, b] = [await firstDevice(fake, ana), await firstDevice(fake, bo)];
				await madeHere(a, conversation);
				await a.engine.openConversation(conversation);
				await sameGroup([a, b], conversation);
				await send(b, conversation, witness);
				const d1 = await firstDevice(fake, dee);
				await a.engine.addMember(conversation, dee);
				await sameGroup([a, b, d1], conversation);
				await a.engine.shareHistory(conversation, dee, "week");
				await turnEnded(a);
				await until(() => d1.engine.offers(conversation).length === 1);
				expect(await d1.engine.importShared(d1.engine.offers(conversation)[0]!.share_id)).toBeGreaterThan(0);
				// The witness is in Dee's core now, and nowhere else: no request, record or console line holds it.
				const bodies = await Promise.all(
					requests.map(
						async (seen) => `${seen.request.url} ${new TextDecoder().decode(await seen.request.arrayBuffer())}`,
					),
				);
				expect(bodies.filter((body) => body.includes(witness))).toEqual([]);
				for (const device of [a, b, d1]) {
					const record = ["approvals", "transfers", "later", "pending_sends", "pending_changes", "share_keys"].map(
						(key) => JSON.stringify(device.store.read(key)),
					);
					expect(record.filter((kept) => kept.includes(witness))).toEqual([]);
				}
				expect(written.filter((line) => line.includes(witness))).toEqual([]);
			} finally {
				for (const spy of spies) spy.mockRestore();
			}
		},
		SLOW,
	);
});
