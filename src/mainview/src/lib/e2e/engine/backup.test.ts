import { describe, expect, test } from "bun:test";
import type { DirectMessage } from "$lib/api/conversations";
import { bytesBase64 } from "$lib/staged-images";
import type { CoreHost } from "../host";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import {
	approvedDevice,
	firstDevice,
	restarted,
	sameGroup,
	shownKey,
	testDevice,
	testHost,
	turnEnded,
	until,
	useFake,
	type TestDevice,
} from "../testing/engines";
import { useXHR } from "../testing/xhr";

// The encrypted backup (PLAN-E2E-CLIENTES.md, Task 32; decisions 20, 21 and 44 to 46), on real cores through the fake
// API: a day that ended goes up with the app quiet, by the version its build answered, in the place of the copy it
// names; another device's copy is taken in before the day is built over it; a new device restores the days, newest
// conversation first; a change of keys moves the old days to the new key; a full quota pauses it all for a day. The
// fake dates the messages a day or more back (timeShift), as the API dated them then, since the core seals only days
// that ended by its own clock.
// A day's segment goes up as the app's Blob uploads do, through the XMLHttpRequest Bun lacks.
useXHR();

const SLOW = 180_000;
const MINUTE = 60_000;
const DAY = 24 * 3600 * 1000;
const SEGMENTS = "/api/users/@me/backup/segments";
const SEGMENT_PUT = { method: "PUT", path: /^\/api\/users\/@me\/backup\/segments\/[0-9a-f-]{36}\// };

const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);
const said = (request: Request) => {
	const url = new URL(request.url);
	return `${request.method} ${url.pathname}${url.search}`;
};
const putsIn = (timeline: string[]) => timeline.filter((line) => line.startsWith(`PUT ${SEGMENTS}/`));
/** The segments a device downloaded, by ID, in the order it asked for them. */
const downloadsIn = (timeline: string[]) =>
	timeline.flatMap((line) => /^GET \/api\/users\/@me\/backup\/segments\/([0-9a-f-]{36})$/.exec(line)?.slice(1) ?? []);

/** A command the core was asked, with what it answered. */
interface Asked {
	command: { cmd: string } & Record<string, any>;
	answer?: any;
}

/** A host that tells each command it's asked, in `asked` with its answer, and by its name in `timeline`. */
function telling(host: CoreHost, asked: Asked[], timeline: string[]): CoreHost {
	return new Proxy(host, {
		get(target, name) {
			if (name === "handle") {
				return async (command: { cmd: string } & Record<string, unknown>) => {
					const entry: Asked = { command };
					asked.push(entry);
					timeline.push(command.cmd);
					entry.answer = await target.handle(command);
					return entry.answer;
				};
			}
			const value = Reflect.get(target, name);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

/** The text a device's core shows of a message: null while it holds none. */
async function textOn(device: TestDevice, conversation: string, id: string): Promise<string | null> {
	const [shown] = await device.engine.messages(conversation, [id]);
	return shown?.status === "ok" ? (shown.text ?? null) : null;
}

/** The days the device's core holds due to go up (backup_due), as conversation/day. */
const dueOn = async (device: TestDevice) =>
	(
		await device.host.handle<{ segments: { conversation_id: string; day: string }[] }>({ cmd: "backup_due" })
	).segments.map(({ conversation_id, day }) => `${conversation_id}/${day}`);

/**
 * The device's message, as the API dates it `ago` ms back, once every device of `all` holds it as the API dated it (the
 * sender's core too, which dates its own message by its own clock until the queue brings it back).
 */
async function sent(
	fake: FakeApi,
	from: TestDevice,
	conversation: string,
	text: string,
	ago: number,
	all: TestDevice[],
): Promise<DirectMessage> {
	fake.timeShift = -ago;
	let message: DirectMessage | null;
	try {
		message = await from.engine.sendMessage({ conversation_id: conversation, nonce: crypto.randomUUID(), text });
	} finally {
		fake.timeShift = 0;
	}
	if (!message) throw new Error("the message wasn't sent");
	for (const device of all) {
		await until(async () => {
			const [shown] = await device.engine.messages(conversation, [message.id]);
			return shown?.status === "ok" && shown.sent_at === message.sent_at;
		});
	}
	return message;
}

/**
 * Ana's and Bo's first devices in a DM whose group Ana made, Ana's core telling what it's asked; every request in
 * `timeline`, which `watch` sees too.
 */
async function dm(watch: (request: Request, fake: FakeApi) => void = () => {}) {
	const fake = new FakeApi();
	const [ana, bo] = [fake.addUser(), fake.addUser()];
	const timeline: string[] = [];
	const asked: Asked[] = [];
	useFake(fake, (request) => {
		timeline.push(said(request));
		watch(request, fake);
	});
	const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
	const a = await firstDevice(fake, ana, { host: telling(testHost(), asked, timeline) });
	const b = await firstDevice(fake, bo);
	await a.engine.openConversation(conversation);
	await sameGroup([a, b], conversation);
	return { fake, ana, bo, a, b, conversation, timeline, asked };
}

/** What a segment holds, as another device of its user reads it: the texts of these messages, once it's imported. */
async function heldIn(fake: FakeApi, first: TestDevice, segment: string, conversation: string, ids: string[]) {
	const other = await approvedDevice(fake, first);
	const data = await other.api.segment(segment);
	await other.host.handle({ cmd: "backup_import", data: bytesBase64(data), deleted: [] });
	const texts = await Promise.all(ids.map((id) => textOn(other, conversation, id)));
	await other.engine.stop();
	return texts;
}

/** A first device of the user's, and the recovery key it showed before it was saved. */
async function withKey(fake: FakeApi, user: string) {
	const device = testDevice(fake, user);
	await device.engine.start();
	await device.engine.makeIdentity();
	const key = shownKey(device.engine.state)!;
	await device.engine.keySaved();
	return { device, key };
}

describe.skipIf(!coreLibrary)("the encrypted backup", () => {
	test(
		"a day goes up once it's whole, and is confirmed with the version its segment answered",
		async () => {
			const { fake, a, b, conversation, timeline, asked } = await dm();
			const day = dayOf(Date.now() - DAY);
			await sent(fake, a, conversation, "from yesterday", DAY, [a, b]);
			await sent(fake, a, conversation, "from today", 0, [a, b]);
			// Yesterday ended; today goes on.
			expect(await dueOn(a)).toEqual([`${conversation}/${day}`]);

			timeline.length = 0;
			asked.length = 0;
			a.clock.advance(MINUTE);
			await until(() => timeline.includes("backup_uploaded"));
			await turnEnded(a);
			// Once the app was quiet a minute: one upload, of yesterday alone, in the place of none.
			const put = `PUT ${SEGMENTS}/${conversation}/${day}?replaces=none`;
			expect(putsIn(timeline)).toEqual([put]);
			// Confirmed after the API took it, with what its build answered.
			const build = asked.find(({ command }) => command.cmd === "backup_segment" && command.day === day);
			const confirmed = asked.filter(({ command }) => command.cmd === "backup_uploaded");
			expect(confirmed.map(({ command }) => command)).toEqual([
				{
					...{ cmd: "backup_uploaded", conversation_id: conversation, day },
					...{ complete: build?.answer.complete, version: build?.answer.version },
				},
			]);
			expect(timeline.indexOf(put)).toBeLessThan(timeline.indexOf("backup_uploaded"));
			expect(await dueOn(a)).toEqual([]);
			expect((await a.api.segments()).map((segment) => segment.day)).toEqual([day]);

			// Nothing more goes up while nothing changes.
			timeline.length = 0;
			a.clock.advance(MINUTE);
			await turnEnded(a);
			expect(putsIn(timeline)).toEqual([]);
			await Promise.all([a.engine.stop(), b.engine.stop()]);
		},
		SLOW,
	);

	test(
		"a day another device uploaded first is imported, then built again",
		async () => {
			const { fake, a, b, conversation, timeline } = await dm();
			// Another device of Ana's, in the DM's group too.
			const phone = await approvedDevice(fake, a);
			await phone.engine.openConversation(conversation);
			await sameGroup([a, b, phone], conversation);
			const day = dayOf(Date.now() - DAY);
			const first = await sent(fake, a, conversation, "the first of the day", DAY, [a, b, phone]);
			// Her other device backs the day up first.
			phone.clock.advance(MINUTE);
			await until(async () => (await phone.api.segments()).length === 1);
			await turnEnded(phone);
			const [theirs] = await phone.api.segments();
			// Then more of that day comes, which this device holds and that copy doesn't.
			const last = await sent(fake, a, conversation, "the last of the day", DAY, [a, b, phone]);

			timeline.length = 0;
			a.clock.advance(MINUTE);
			await until(() => timeline.includes("backup_uploaded"));
			await turnEnded(a);
			// Her other device's copy holds the day: it comes down, is taken in, and only then is the day built again in its
			// place.
			const puts = putsIn(timeline);
			expect(puts).toEqual([
				`PUT ${SEGMENTS}/${conversation}/${day}?replaces=none`,
				`PUT ${SEGMENTS}/${conversation}/${day}?replaces=${theirs!.id}`,
			]);
			expect(downloadsIn(timeline)).toEqual([theirs!.id]);
			const imported = timeline.indexOf("backup_import");
			expect(imported).toBeGreaterThan(timeline.indexOf(puts[0]!));
			expect(imported).toBeLessThan(timeline.indexOf(puts[1]!));
			// One copy of the day now, Ana's, with all of it.
			const [ours] = await a.api.segments();
			expect(ours!.id).not.toBe(theirs!.id);
			expect(await heldIn(fake, a, ours!.id, conversation, [first.id, last.id])).toEqual([
				"the first of the day",
				"the last of the day",
			]);
			await Promise.all([a, b, phone].map((device) => device.engine.stop()));
		},
		SLOW,
	);

	test(
		"a deletion sends its day up again without the message",
		async () => {
			const { fake, a, b, conversation, timeline, asked } = await dm();
			const day = dayOf(Date.now() - DAY);
			const kept = await sent(fake, a, conversation, "kept", DAY, [a, b]);
			const gone = await sent(fake, a, conversation, "deleted for everyone", DAY, [a, b]);
			// Edited the same day: the API dates the edit's entry as it takes it.
			fake.timeShift = -DAY;
			await a.engine.editMessage(conversation, gone.id, "edited, then deleted");
			await until(async () => (await textOn(b, conversation, gone.id)) === "edited, then deleted");
			fake.timeShift = 0;
			a.clock.advance(MINUTE);
			await until(async () => (await a.api.segments()).length === 1);
			await turnEnded(a);
			const [before] = await a.api.segments();

			// Deleted for everyone, a day later: its day goes up again, built without it, in the copy's place.
			await a.engine.deleteMessage(conversation, gone.id);
			await until(async () => (await b.engine.messages(conversation, [gone.id])).length === 0);
			timeline.length = 0;
			asked.length = 0;
			a.clock.advance(MINUTE);
			await until(() => timeline.includes("backup_uploaded"));
			await turnEnded(a);
			expect(putsIn(timeline)).toEqual([`PUT ${SEGMENTS}/${conversation}/${day}?replaces=${before!.id}`]);
			const build = asked.find(({ command }) => command.cmd === "backup_segment" && command.day === day);
			expect(build?.command.deleted).toEqual([gone.id]);
			// The copy that held it is gone, and the new one holds neither the message nor its edit.
			const [after] = await a.api.segments();
			expect(after!.id).not.toBe(before!.id);
			expect(await heldIn(fake, a, after!.id, conversation, [kept.id, gone.id])).toEqual(["kept", null]);
			await Promise.all([a.engine.stop(), b.engine.stop()]);
		},
		SLOW,
	);

	test(
		"a new device restores its days, newest conversations first, and the rows that waited fill in",
		async () => {
			const fake = new FakeApi();
			const [ana, bo, cy] = [fake.addUser(), fake.addUser(), fake.addUser()];
			const timeline: string[] = [];
			useFake(fake, (request) => timeline.push(said(request)));
			const older = fake.addConversation({ type: "dm", members: [ana, bo] });
			const newer = fake.addConversation({ type: "dm", members: [ana, cy] });
			const { device: a, key } = await withKey(fake, ana);
			const [b, c] = [await firstDevice(fake, bo), await firstDevice(fake, cy)];
			await a.engine.openConversation(older);
			await a.engine.openConversation(newer);
			await sameGroup([a, b], older);
			await sameGroup([a, c], newer);
			// The older conversation's days are three and two days back; the newer one's, yesterday.
			const first = await sent(fake, a, older, "three days back", 3 * DAY, [a, b]);
			const second = await sent(fake, b, older, "two days back", 2 * DAY, [a, b]);
			const third = await sent(fake, c, newer, "yesterday", DAY, [a, c]);
			a.clock.advance(MINUTE);
			await until(async () => (await a.api.segments()).length === 3);
			await turnEnded(a);
			const segments = await a.api.segments();
			const idOf = (conversation: string, ago: number) =>
				segments.find((s) => s.conversation_id === conversation && s.day === dayOf(Date.now() - ago))!.id;

			// A new device of Ana's, set up with her recovery key: none of it can come from its queues.
			const n = testDevice(fake, ana);
			const changed: string[] = [];
			n.engine.onMessages((conversation) => changed.push(conversation));
			await n.engine.start();
			timeline.length = 0;
			await n.engine.recover(key);
			await until(async () => (await textOn(n, older, first.id)) === "three days back");
			await turnEnded(n);
			// Its restore: the newest conversation first, each day of it newest first, without what the API saw deleted.
			expect(downloadsIn(timeline)).toEqual([idOf(newer, DAY), idOf(older, 2 * DAY), idOf(older, 3 * DAY)]);
			for (const conversation of [newer, older]) {
				const deleted = `GET /api/users/@me/conversations/${conversation}/messages/deleted`;
				expect(timeline.some((line) => line.startsWith(deleted))).toBe(true);
			}
			// The rows that waited fill in, and the views are told.
			expect(await textOn(n, older, second.id)).toBe("two days back");
			expect(await textOn(n, newer, third.id)).toBe("yesterday");
			expect(changed).toEqual(expect.arrayContaining([newer, older]));
			// Its progress showed as it went, and nothing once it's done; nothing went up meanwhile.
			expect(n.states).toContainEqual({ name: "ready", backup: { state: "restoring", done: 0, total: 3 } });
			expect(n.engine.state).toEqual({ name: "ready" });
			expect(putsIn(timeline)).toEqual([]);
			await Promise.all([a, b, c, n].map((device) => device.engine.stop()));
		},
		SLOW,
	);

	test(
		"a segment that doesn't open is skipped",
		async () => {
			const fake = new FakeApi();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			const timeline: string[] = [];
			useFake(fake, (request) => timeline.push(said(request)));
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
			const { device: a, key } = await withKey(fake, ana);
			const b = await firstDevice(fake, bo);
			await a.engine.openConversation(conversation);
			await sameGroup([a, b], conversation);
			const altered = await sent(fake, a, conversation, "in the altered copy", DAY, [a, b]);
			const whole = await sent(fake, b, conversation, "in the whole copy", 2 * DAY, [a, b]);
			a.clock.advance(MINUTE);
			await until(async () => (await a.api.segments()).length === 2);
			await turnEnded(a);
			// The newest day's copy, the first a restore takes, is altered where the API keeps it.
			const newest = (await a.api.segments()).find((s) => s.day === dayOf(Date.now() - DAY))!;
			const bytes = fake.segmentFile(newest.id)!;
			bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;

			const n = testDevice(fake, ana);
			await n.engine.start();
			timeline.length = 0;
			await n.engine.recover(key);
			await until(async () => (await textOn(n, conversation, whole.id)) === "in the whole copy");
			await turnEnded(n);
			// The one that doesn't open stops nothing: it's skipped, the restore goes on and ends.
			expect(downloadsIn(timeline)).toHaveLength(2);
			expect(await textOn(n, conversation, altered.id)).toBeNull();
			expect(n.engine.state).toEqual({ name: "ready" });
			// And it's counted for the API, by its kind alone.
			n.clock.advance(MINUTE);
			await until(() => fake.decryptFailures.some((failure) => failure.kind === "segment"));
			await Promise.all([a, b, n].map((device) => device.engine.stop()));
		},
		SLOW,
	);

	// The core's rule (backup_import's not_found backup_key): an approved or recovered device's next key may still wait in
	// its inbox, as a change of keys' transfer.
	test(
		"a segment under a key this device doesn't hold yet takes the inbox first",
		async () => {
			const fake = new FakeApi();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			const timeline: string[] = [];
			const asked: Asked[] = [];
			useFake(fake, (request) => timeline.push(said(request)));
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
			const { device: a, key } = await withKey(fake, ana);
			const b = await firstDevice(fake, bo);
			await a.engine.openConversation(conversation);
			await sameGroup([a, b], conversation);
			const message = await sent(fake, a, conversation, "under the new key", DAY, [a, b]);
			a.clock.advance(MINUTE);
			await until(async () => (await a.api.segments()).length === 1);
			await turnEnded(a);
			const [oldKey] = (await a.api.segments()).map((segment) => segment.key_id);

			// A new device of Ana's, which hears nothing after its start: its restore's first list never reaches the API.
			const n = testDevice(fake, ana, { host: telling(testHost(), asked, timeline), hears: () => false });
			await n.engine.start();
			fake.cutRequest({ method: "GET", path: SEGMENTS });
			await n.engine.recover(key);
			await turnEnded(n);
			// Meanwhile Ana changes her keys on her first device, which moves the day to the new key and leaves the new one
			// in the new device's inbox, unread.
			await a.engine.changeKeys();
			await a.engine.keySaved();
			a.clock.advance(MINUTE);
			await until(async () => (await a.api.segments()).every((segment) => segment.key_id !== oldKey));
			await turnEnded(a);

			// The restore goes again: the day's segment is under a key the new device doesn't hold, so its inbox comes first,
			// which brings it, and the segment opens.
			asked.length = 0;
			n.clock.advance(MINUTE);
			await until(async () => (await textOn(n, conversation, message.id)) === "under the new key");
			await turnEnded(n);
			const imports = asked.filter(({ command }) => command.cmd === "backup_import");
			expect(imports.map(({ answer }) => answer !== undefined)).toEqual([false, true]);
			const inbox = asked.findIndex(({ command }) => command.cmd === "receive_direct");
			expect(inbox).toBeGreaterThan(asked.indexOf(imports[0]!));
			expect(inbox).toBeLessThan(asked.indexOf(imports[1]!));
			await Promise.all([a, b, n].map((device) => device.engine.stop()));
		},
		SLOW,
	);

	test(
		"after a rotation the old segments move to the new key, picking up where they stopped",
		async () => {
			let cutting = false;
			let moved = 0;
			// The second move's upload never reaches the API, as if the app closed on it.
			const { fake, a, b, conversation, timeline } = await dm((request, api) => {
				const url = new URL(request.url);
				if (cutting && request.method === "PUT" && SEGMENT_PUT.path.test(url.pathname) && ++moved === 2) {
					api.cutRequest(SEGMENT_PUT);
				}
			});
			const older = await sent(fake, a, conversation, "two days back", 2 * DAY, [a, b]);
			await sent(fake, a, conversation, "yesterday", DAY, [a, b]);
			a.clock.advance(MINUTE);
			await until(async () => (await a.api.segments()).length === 2);
			await turnEnded(a);
			const before = await a.api.segments();
			const oldKey = before[0]!.key_id;
			expect(before.map((segment) => segment.key_id)).toEqual([oldKey, oldKey]);

			// Ana changes her keys, and saves the new recovery key.
			await a.engine.changeKeys();
			await a.engine.keySaved();
			expect(a.engine.state).toEqual({ name: "ready" });
			cutting = true;
			timeline.length = 0;
			a.clock.advance(MINUTE);
			await until(() => moved === 2);
			await turnEnded(a);
			// The first day went over to the new key in its copy's place; the second is still under the old one: no day
			// is ever without its copy.
			const midway = await a.api.segments();
			expect(midway.map((segment) => segment.day).sort()).toEqual(before.map((segment) => segment.day).sort());
			expect(midway.filter((segment) => segment.key_id === oldKey).map((segment) => segment.id)).toEqual([
				before[1]!.id,
			]);

			// The app starts again: the move picks up after the first, which isn't downloaded again.
			const again = await restarted(fake, a);
			timeline.length = 0;
			again.clock.advance(MINUTE);
			await until(async () => (await again.api.segments()).every((segment) => segment.key_id !== oldKey));
			await turnEnded(again);
			expect(downloadsIn(timeline)).toEqual([before[1]!.id]);
			const after = await again.api.segments();
			expect(after.map((segment) => segment.day).sort()).toEqual(before.map((segment) => segment.day).sort());
			// What moved still holds its day.
			const movedFirst = after.find((segment) => segment.day === before[0]!.day)!;
			expect(await heldIn(fake, again, movedFirst.id, conversation, [older.id])).toEqual(["two days back"]);
			await Promise.all([again.engine.stop(), b.engine.stop()]);
		},
		SLOW,
	);

	test(
		"a full quota pauses the backup and says so",
		async () => {
			const { fake, a, b, conversation, timeline } = await dm();
			const day = dayOf(Date.now() - DAY);
			await sent(fake, a, conversation, "kept for later", DAY, [a, b]);
			fake.refuse(SEGMENT_PUT, 413, { error: "uploading a backup segment: not enough storage space for this file" });
			a.clock.advance(MINUTE);
			await until(() => a.engine.state.name === "ready" && a.engine.state.backup?.state === "paused");
			await turnEnded(a);
			expect(a.engine.state).toEqual({ name: "ready", backup: { state: "paused", reason: "full" } });
			// What waits stays: the day is still due, and nothing confirmed it.
			expect(timeline).not.toContain("backup_uploaded");
			expect(await dueOn(a)).toEqual([`${conversation}/${day}`]);

			// Quiet minutes don't try again: the next day does, and the backup goes on.
			timeline.length = 0;
			a.clock.advance(MINUTE);
			await turnEnded(a);
			expect(putsIn(timeline)).toEqual([]);
			a.clock.advance(DAY);
			await until(() => timeline.includes("backup_uploaded"));
			await turnEnded(a);
			expect(a.engine.state).toEqual({ name: "ready" });
			expect(await dueOn(a)).toEqual([]);

			// A copy past the storage's limit for one file pauses it too, as too large for it.
			await sent(fake, a, conversation, "too much for one file", DAY, [a, b]);
			fake.fileLimit = 16;
			a.clock.advance(MINUTE);
			await until(() => a.engine.state.name === "ready" && a.engine.state.backup?.state === "paused");
			await turnEnded(a);
			expect(a.engine.state).toEqual({ name: "ready", backup: { state: "paused", reason: "too_large" } });
			await Promise.all([a.engine.stop(), b.engine.stop()]);
		},
		SLOW,
	);
});
