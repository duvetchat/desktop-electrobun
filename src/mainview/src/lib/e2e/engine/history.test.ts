import { describe, expect, spyOn, test } from "bun:test";
import { CoreError } from "../errors";
import type { CoreHost, ShareMade } from "../host";
import { FakeApi, type GatewayEvent } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import {
	approvedDevice,
	firstDevice,
	groupOf,
	rejection,
	sameGroup,
	testHost,
	turnEnded,
	until,
	watchedHost,
	type TestDevice,
} from "../testing/engines";
import { useXHR } from "../testing/xhr";
import { KEPT_LATER } from "./store";

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
 * gives settles, as a slow network would, and `answer` answer one in the fake's place, as a server that lies would.
 */
function setUp(hold?: (seen: Seen) => Promise<void> | void, answer?: (seen: Seen) => Response | undefined) {
	const fake = new FakeApi();
	const requests: Seen[] = [];
	spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init);
		const token = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "")?.[1] ?? null;
		const seen = { method: request.method, path: new URL(request.url).pathname, token, request: request.clone() };
		requests.push(seen);
		await hold?.(seen);
		return answer?.(seen) ?? fake.fetch(request);
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
 * Ana's and Bo's group, where Bo wrote ten days ago and both wrote this week; then Dee, with two devices, joins it, and
 * Ana's device holds all three messages.
 */
async function deeJoins(given: { setup?: ReturnType<typeof setUp>; anaHost?: CoreHost } = {}) {
	const { anaHost } = given;
	const setup = given.setup ?? setUp();
	const { fake } = setup;
	const [ana, bo, dee] = [fake.addUser(), fake.addUser(), fake.addUser()];
	fake.befriend(ana, dee);
	const conversation = fake.addConversation({ type: "group", members: [ana, bo], owner: ana });
	const a = await firstDevice(fake, ana, anaHost ? { host: anaHost } : {});
	const b = await firstDevice(fake, bo);
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
	const d1 = await firstDevice(fake, dee);
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

/** A host that counts the packages it imports at once, and the most it ever did. */
function countingImports(host: CoreHost, counts: { now: number; most: number; done: number }): CoreHost {
	return new Proxy(host, {
		get(target, name) {
			if (name === "importShare") {
				return async (shareId: string, parts: Uint8Array[]) => {
					counts.now++;
					counts.most = Math.max(counts.most, counts.now);
					try {
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
			// Its parts, then its completion, then its key, to each of Dee's devices and to no other.
			const parts = by(a, "PUT", PART_UP).map((seen) => seen.path);
			expect(parts).toEqual(Array.from({ length: about.parts }, (_, n) => `${put!.path}/parts/${n}`));
			expect(by(a, "POST", COMPLETE)).toHaveLength(1);
			const keyed = by(a, "POST", INBOX).map((seen) => INBOX.exec(seen.path)![1]!);
			expect(keyed.sort(byText)).toEqual([deviceOf(d1), deviceOf(d2)].sort(byText));
			const order = requests.map((seen) => seen.path);
			expect(order.lastIndexOf(`${put!.path}/parts/${about.parts - 1}`)).toBeLessThan(
				order.indexOf(`${put!.path}/complete`),
			);
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
			await d1.engine.importShared(d1.engine.offers(conversation)[0]!.share_id);
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
			// Ana's device can't hand the key on at first: the package is up and complete, its key not.
			const away = await cyHasNoDevice();
			away.fake.refuse({ method: "POST", path: INBOX }, 500, { error: "internal server error" });
			const c = await firstDevice(away.fake, away.cy);
			await until(() => away.by(away.a, "POST", COMPLETE).length === 1, 120_000);
			await until(() => c.heard.some((event) => event.type === "HISTORY_SHARE_CREATE"));
			await turnEnded(away.a);
			await turnEnded(c);
			// Cy's device lists it, and waits: it fetches none of it and adds nothing.
			expect((await c.api.shares()).map((share) => share.kind)).toEqual(["catch_up"]);
			expect(away.by(c, "GET", PART_DOWN)).toEqual([]);
			expect(await texts(c, away.conversation, [away.sent.id])).toEqual([]);
			// The key goes a minute on, and the catch-up comes in by itself.
			away.a.clock.advance(60_000);
			await until(async () => (await texts(c, away.conversation, [away.sent.id])).length === 1, 120_000);

			// A share's offer waits for its key the same way.
			const setup = { fake: away.fake, requests: away.requests, by: away.by };
			const { fake, dee, conversation, a, d1 } = await deeJoins({ setup });
			fake.refuse({ method: "POST", path: INBOX }, 500, { error: "internal server error" });
			await a.engine.shareHistory(conversation, dee, "week");
			await turnEnded(a);
			await until(() => d1.heard.some((event) => event.type === "HISTORY_SHARE_CREATE"));
			await turnEnded(d1);
			expect(d1.engine.offers(conversation)).toEqual([]);
			a.clock.advance(60_000);
			await until(() => d1.engine.offers(conversation).length === 1);
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
