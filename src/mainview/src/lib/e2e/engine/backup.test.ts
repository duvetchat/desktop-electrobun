import { describe, expect, spyOn, test } from "bun:test";
import { FetchError, TooLargeError } from "$lib/api/api";
import type { DirectMessage } from "$lib/api/conversations";
import type { BackupSegment, E2eApi } from "$lib/api/e2e";
import { bytesBase64 } from "$lib/staged-images";
import { CoreError } from "../errors";
import type { CoreHost } from "../host";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import {
	approvedDevice,
	firstDevice,
	memoryStore,
	restarted,
	sameGroup,
	shownKey,
	TestClock,
	testDevice,
	testHost,
	turnEnded,
	until,
	useFake,
	type TestDevice,
} from "../testing/engines";
import { useXHR } from "../testing/xhr";
import { Backups } from "./backup";
import type { EngineParts } from "./engine";
import { Failures } from "./failures";
import { BACKUP_KEY_SEEN, BACKUP_REENCRYPT, BACKUP_RESTORE, BACKUP_SET_ASIDE } from "./store";

// The encrypted backup (PLAN-E2E-CLIENTES.md, Task 32; decisions 20, 21 and 44 to 46), on real cores through the fake
// API: a day that ended goes up with the app quiet, by the version its build answered, in the place of the copy it
// names; another device's copy is taken in before the day is built over it; a new device restores the days, newest
// conversation first; a change of keys moves the old days to the new key; a full quota pauses it all for a day, and a
// day too large to keep is set aside while the rest goes on. The fake dates the messages a day or more back
// (sentAtOffset), as the API dated them then, since the core seals only days that ended by its own clock. Then the
// backup's own rules, on a stub core: what's counted against a day or a segment, the pass at the latest, nothing before
// the device is ready, the inbox first, and listings that never end.
// A day's segment goes up as the app's Blob uploads do, through the XMLHttpRequest Bun lacks.
useXHR();

const SLOW = 180_000;
const MINUTE = 60_000;
const DAY = 24 * 3600 * 1000;
const SEGMENTS = "/api/users/@me/backup/segments";
const SEGMENT_PUT = { method: "PUT", path: /^\/api\/users\/@me\/backup\/segments\/[0-9a-f-]{36}\// };
const INBOX = "/api/users/@me/devices/@me/inbox";

const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);
const said = (request: Request) => {
	const url = new URL(request.url);
	return `${request.method} ${url.pathname}${url.search}`;
};
const putsIn = (timeline: string[]) => timeline.filter((line) => line.startsWith(`PUT ${SEGMENTS}/`));
/** The segments a device downloaded, by ID, in the order it asked for them. */
const downloadsIn = (timeline: string[]) =>
	timeline.flatMap((line) => /^GET \/api\/users\/@me\/backup\/segments\/([0-9a-f-]{36})$/.exec(line)?.slice(1) ?? []);
/** Text no deflate makes smaller: what makes a day's segment as large as its messages. */
const noise = (length: number) =>
	Array.from(crypto.getRandomValues(new Uint8Array(length)), (byte) => String.fromCharCode(33 + (byte % 94))).join("");

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

/** The ID of the key the device's core seals the backup with now (the backup's own way to read it: sealsWith). */
const sealsWith = async (device: TestDevice) =>
	(
		await device.host.handle<{ key_id: string }>({
			...{ cmd: "backup_segment", conversation_id: "00000000-0000-0000-0000-000000000000" },
			day: "2026-01-01",
		})
	).key_id;

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
	fake.sentAtOffset = -ago;
	let message: DirectMessage | null;
	try {
		message = await from.engine.sendMessage({ conversation_id: conversation, nonce: crypto.randomUUID(), text });
	} finally {
		fake.sentAtOffset = 0;
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
 * Ana's and Bo's first devices in a DM whose group Ana made, Ana's core telling what it's asked and hearing what
 * `hears` says; every request in `timeline`, which `watch` sees too.
 */
async function dm(given: { watch?: (request: Request, fake: FakeApi) => void; hears?: () => boolean } = {}) {
	const fake = new FakeApi();
	const [ana, bo] = [fake.addUser(), fake.addUser()];
	const timeline: string[] = [];
	const asked: Asked[] = [];
	useFake(fake, (request) => {
		timeline.push(said(request));
		given.watch?.(request, fake);
	});
	const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
	const host = telling(testHost(), asked, timeline);
	const a = await firstDevice(fake, ana, { host, ...(given.hears ? { hears: given.hears } : {}) });
	const b = await firstDevice(fake, bo);
	await a.engine.openConversation(conversation);
	await sameGroup([a, b], conversation);
	return { fake, ana, bo, a, b, conversation, timeline, asked };
}

/** Another device of the first one's user, approved by it and in the conversation's group with `others`. */
async function phoneOf(
	fake: FakeApi,
	first: TestDevice,
	conversation: string,
	others: TestDevice[],
	hears?: () => boolean,
) {
	const phone = await approvedDevice(fake, first, hears ? { hears } : {});
	await phone.engine.openConversation(conversation);
	await sameGroup([first, ...others, phone], conversation);
	return phone;
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

	// The review's M9 and M5: a row only that copy held survives the day built over it, and shows.
	test(
		"a day another device uploaded first is imported, with what only it held, then built again",
		async () => {
			let listening = true;
			const { fake, a, b, conversation, timeline } = await dm({ hears: () => listening });
			const day = dayOf(Date.now() - DAY);
			// Bo writes before Ana's phone is set up: the phone never holds it, as it joins the group after.
			const early = await sent(fake, b, conversation, "before her phone", DAY, [a, b]);
			const phone = await phoneOf(fake, a, conversation, [b]);
			const late = await sent(fake, b, conversation, "with her phone", DAY, [a, b, phone]);
			// Her first device backs the day up, then hears nothing more: what Bo writes next reaches her phone alone.
			a.clock.advance(MINUTE);
			await until(async () => (await a.api.segments()).length === 1);
			await turnEnded(a);
			const [theirs] = await a.api.segments();
			listening = false;
			const later = await sent(fake, b, conversation, "after her first device's copy", DAY, [b, phone]);
			expect(await textOn(phone, conversation, early.id)).toBeNull();

			const changed: string[] = [];
			phone.engine.onMessages((id) => changed.push(id));
			timeline.length = 0;
			phone.clock.advance(MINUTE);
			await until(async () => (await phone.api.segments())[0]?.id !== theirs!.id);
			await turnEnded(phone);
			// The phone's day holds what that copy lacks, and the copy holds a row the phone lacks: the copy comes down and
			// is taken in, then the day is built again in its place.
			expect(putsIn(timeline)).toEqual([
				`PUT ${SEGMENTS}/${conversation}/${day}?replaces=none`,
				`PUT ${SEGMENTS}/${conversation}/${day}?replaces=${theirs!.id}`,
			]);
			expect(downloadsIn(timeline)).toEqual([theirs!.id]);
			const download = timeline.indexOf(`GET ${SEGMENTS}/${theirs!.id}`);
			expect(download).toBeGreaterThan(timeline.indexOf(putsIn(timeline)[0]!));
			expect(download).toBeLessThan(timeline.indexOf(putsIn(timeline)[1]!));
			// What only that copy held is on the phone now, and its views were told.
			expect(await textOn(phone, conversation, early.id)).toBe("before her phone");
			expect(changed).toContain(conversation);
			// One copy of the day now, the phone's, with all of it.
			const [ours] = await a.api.segments();
			expect(await heldIn(fake, a, ours!.id, conversation, [early.id, late.id, later.id])).toEqual([
				"before her phone",
				"with her phone",
				"after her first device's copy",
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
			fake.sentAtOffset = -DAY;
			await a.engine.editMessage(conversation, gone.id, "edited, then deleted");
			await until(async () => (await textOn(b, conversation, gone.id)) === "edited, then deleted");
			fake.sentAtOffset = 0;
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

			// A new device of Ana's, set up with her recovery key: none of it can come from its queues. Its download of
			// the older conversation's first day never reaches the API, as if the network dropped there.
			const n = testDevice(fake, ana);
			const changed: string[] = [];
			n.engine.onMessages((conversation) => changed.push(conversation));
			await n.engine.start();
			timeline.length = 0;
			fake.cutRequest({ method: "GET", path: `${SEGMENTS}/${idOf(older, 2 * DAY)}` });
			await n.engine.recover(key);
			await until(async () => (await textOn(n, newer, third.id)) === "yesterday");
			await turnEnded(n);
			// The newer conversation is in; the restore stopped at the older one, and shows no progress while it waits.
			expect(n.backups).toContainEqual({ state: "restoring", done: 0, total: 3 });
			expect(n.engine.backup().state).not.toBe("restoring");
			expect(await textOn(n, older, second.id)).toBeNull();

			// A minute later it picks up at the older conversation: the newer one isn't downloaded again.
			n.clock.advance(MINUTE);
			await until(async () => (await textOn(n, older, first.id)) === "three days back");
			await turnEnded(n);
			// Its restore: the newest conversation first, each day of it newest first, without what the API saw deleted.
			expect(downloadsIn(timeline)).toEqual([
				idOf(newer, DAY),
				idOf(older, 2 * DAY),
				idOf(older, 2 * DAY),
				idOf(older, 3 * DAY),
			]);
			for (const conversation of [newer, older]) {
				const deleted = `GET /api/users/@me/conversations/${conversation}/messages/deleted`;
				expect(timeline.some((line) => line.startsWith(deleted))).toBe(true);
			}
			// The rows that waited fill in, and the views are told.
			expect(await textOn(n, older, second.id)).toBe("two days back");
			expect(changed).toEqual(expect.arrayContaining([newer, older]));
			// Nothing of the restore shows once it's done, and nothing went up meanwhile.
			expect(n.engine.backup().state).not.toBe("restoring");
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

			// The restore goes again, its pass's first look at the inbox cut: the day's segment is under a key the new
			// device doesn't hold, so its inbox comes first, which brings it, and the segment opens.
			asked.length = 0;
			fake.cutRequest({ method: "GET", path: INBOX });
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
			const { fake, a, b, conversation, timeline } = await dm({
				watch: (request, api) => {
					const url = new URL(request.url);
					if (cutting && request.method === "PUT" && SEGMENT_PUT.path.test(url.pathname) && ++moved === 2) {
						api.cutRequest(SEGMENT_PUT);
					}
				},
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
			await until(() => a.engine.backup().state === "paused");
			await turnEnded(a);
			expect(a.engine.backup()).toEqual({ state: "paused", reason: "full" });
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
			expect(a.engine.backup()).toEqual({ state: "up_to_date" });
			expect(await dueOn(a)).toEqual([]);
			await Promise.all([a.engine.stop(), b.engine.stop()]);
		},
		SLOW,
	);

	// The review's I1, and M9's segment past 32 MiB and body over 32 MiB: only a full storage pauses the pass.
	test(
		"a day too large to keep is set aside, and the other days go on",
		async () => {
			const { fake, a, b, conversation, timeline } = await dm();
			const [older, newer] = [dayOf(Date.now() - 2 * DAY), dayOf(Date.now() - DAY)];
			// The older day holds a long text, the newer one a short one: only the older passes the storage's limit for one
			// file, which the API answers in its words.
			await sent(fake, a, conversation, noise(16_000), 2 * DAY, [a, b]);
			await sent(fake, a, conversation, "a short day", DAY, [a, b]);
			fake.fileLimit = 4_000;
			timeline.length = 0;
			a.clock.advance(MINUTE);
			await until(() => timeline.includes("backup_uploaded"));
			await turnEnded(a);
			// The older day came first and didn't fit: it's set aside, and the newer one went up all the same.
			expect(putsIn(timeline)).toEqual([
				`PUT ${SEGMENTS}/${conversation}/${older}?replaces=none`,
				`PUT ${SEGMENTS}/${conversation}/${newer}?replaces=none`,
			]);
			expect((await a.api.segments()).map((segment) => segment.day)).toEqual([newer]);
			expect(await dueOn(a)).toEqual([`${conversation}/${older}`]);
			expect(a.engine.backup()).toEqual({ state: "paused", reason: "too_large" });

			// Quiet minutes leave it alone.
			timeline.length = 0;
			a.clock.advance(MINUTE);
			await turnEnded(a);
			expect(putsIn(timeline)).toEqual([]);

			// A day later it's tried again: with room for it now, it goes up, and the backup is up to date.
			fake.fileLimit = 20 << 20;
			timeline.length = 0;
			a.clock.advance(DAY);
			await until(() => timeline.includes("backup_uploaded"));
			await turnEnded(a);
			expect(putsIn(timeline)).toEqual([`PUT ${SEGMENTS}/${conversation}/${older}?replaces=none`]);
			expect(await dueOn(a)).toEqual([]);
			expect(a.engine.backup()).toEqual({ state: "up_to_date" });

			// A segment past the request's 32 MiB never goes, and the API's «over 32 MiB» is the same: each day is set
			// aside, and nothing is confirmed.
			await sent(fake, a, conversation, "more for the older day", 2 * DAY, [a, b]);
			await sent(fake, a, conversation, "more for the newer day", DAY, [a, b]);
			const put = spyOn(a.api, "putSegment").mockImplementationOnce(() =>
				Promise.reject(new TooLargeError(33 << 20, "A day")),
			);
			fake.refuse(SEGMENT_PUT, 413, { error: "the request body is over 32 MiB" });
			timeline.length = 0;
			a.clock.advance(MINUTE);
			await until(async () => (await dueOn(a)).length === 2 && a.engine.backup().state === "paused");
			await turnEnded(a);
			put.mockRestore();
			expect(putsIn(timeline)).toEqual([
				`PUT ${SEGMENTS}/${conversation}/${newer}?replaces=${await shownCopyOf(a, newer)}`,
			]);
			expect(timeline).not.toContain("backup_uploaded");
			expect(await dueOn(a)).toEqual([`${conversation}/${older}`, `${conversation}/${newer}`]);
			expect(a.engine.backup()).toEqual({ state: "paused", reason: "too_large" });
			await Promise.all([a.engine.stop(), b.engine.stop()]);
		},
		SLOW,
	);

	// The review's I3, and M9's 409 without `current`.
	test(
		"the backup says it's up to date only once a pass found nothing due, and nothing failed since",
		async () => {
			const { fake, a, b, conversation, timeline } = await dm();
			// No pass yet: nothing says it's up to date.
			expect(a.engine.backup()).toEqual({ state: "uploading" });
			a.clock.advance(MINUTE);
			await until(() => a.engine.backup().state === "up_to_date");
			await turnEnded(a);

			// A day that ended goes up; the API's 409 that names no copy (its bucket moved under the upload) is a failure
			// that passes: nothing came down, nothing is confirmed, and it isn't up to date.
			await sent(fake, a, conversation, "from yesterday", DAY, [a, b]);
			fake.refuse(SEGMENT_PUT, 409, { error: "the storage bucket moved: try again" });
			timeline.length = 0;
			a.clock.advance(MINUTE);
			await until(() => putsIn(timeline).length === 1);
			await turnEnded(a);
			expect(downloadsIn(timeline)).toEqual([]);
			expect(timeline).not.toContain("backup_uploaded");
			expect(a.engine.backup()).toEqual({ state: "uploading" });
			// Tried again a minute later, it goes up, and nothing waits.
			a.clock.advance(MINUTE);
			await until(() => timeline.includes("backup_uploaded"));
			await turnEnded(a);
			expect(a.engine.backup()).toEqual({ state: "up_to_date" });
			expect(a.backups).toContainEqual({ state: "uploading" });

			// A change of keys that waits for its key to be saved backs nothing up: no longer up to date.
			await a.engine.changeKeys();
			a.clock.advance(MINUTE);
			await until(() => a.engine.backup().state === "uploading");
			await Promise.all([a.engine.stop(), b.engine.stop()]);
		},
		SLOW,
	);

	// The review's I4: the rule that stands between a device behind on its keys and another device's newer copy.
	test(
		"another device's copy under a key this device doesn't hold stays where it is",
		async () => {
			let phoneToken: string | null = null;
			let listening = true;
			// Her phone's inbox reads nothing once it's told to: the change of keys' transfer never reaches it.
			const { fake, a, b, conversation, timeline } = await dm({
				watch: (request, api) => {
					const own = phoneToken && request.headers.get("Authorization") === `Bearer ${phoneToken}`;
					if (own && !listening && request.method === "GET" && new URL(request.url).pathname === INBOX) {
						api.refuse({ method: "GET", path: INBOX }, 200, []);
					}
				},
			});
			// Ana's phone, which hears nothing once she changes her keys: it never learns of the change.
			const phone = await phoneOf(fake, a, conversation, [b], () => listening);
			phoneToken = phone.token;
			const day = dayOf(Date.now() - DAY);
			await sent(fake, a, conversation, "one day of it", DAY, [a, b, phone]);
			// Her first device backs the day up, then moves it to the key it changes to.
			a.clock.advance(MINUTE);
			await until(async () => (await a.api.segments()).length === 1);
			await turnEnded(a);
			listening = false;
			await a.engine.changeKeys();
			await a.engine.keySaved();
			const newKey = await sealsWith(a);
			a.clock.advance(MINUTE);
			await until(async () => (await a.api.segments())[0]?.key_id === newKey);
			await turnEnded(a);
			const [moved] = await a.api.segments();
			expect(await sealsWith(phone)).not.toBe(newKey);

			// The phone, still on the older key, has the day due: its copy goes up, and the API keeps it out (409).
			timeline.length = 0;
			phone.clock.advance(MINUTE);
			await until(() => putsIn(timeline).length > 0);
			await turnEnded(phone);
			// The copy that holds the day came down and doesn't open here: it stays, nothing goes up in its place, and the
			// day waits for the key.
			expect(putsIn(timeline)).toEqual([`PUT ${SEGMENTS}/${conversation}/${day}?replaces=none`]);
			expect(downloadsIn(timeline)).toContain(moved!.id);
			expect(await a.api.segments()).toEqual([moved!]);
			expect(await dueOn(phone)).toEqual([`${conversation}/${day}`]);
			expect(phone.engine.backup()).toEqual({ state: "uploading" });
			await Promise.all([a, b, phone].map((device) => device.engine.stop()));
		},
		SLOW,
	);

	// The review's M9: a copy no core opens holds nothing anyone reads.
	test(
		"another device's copy that doesn't open is built over",
		async () => {
			const { fake, a, b, conversation, timeline } = await dm();
			const phone = await phoneOf(fake, a, conversation, [b]);
			const day = dayOf(Date.now() - DAY);
			const message = await sent(fake, a, conversation, "kept by this device", DAY, [a, b, phone]);
			phone.clock.advance(MINUTE);
			await until(async () => (await phone.api.segments()).length === 1);
			await turnEnded(phone);
			const [theirs] = await phone.api.segments();
			// Altered where the API keeps it.
			const bytes = fake.segmentFile(theirs!.id)!;
			bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;

			timeline.length = 0;
			a.clock.advance(MINUTE);
			await until(() => timeline.includes("backup_uploaded"));
			await turnEnded(a);
			// It came down, didn't open, and the day was built in its place.
			expect(putsIn(timeline)).toEqual([
				`PUT ${SEGMENTS}/${conversation}/${day}?replaces=none`,
				`PUT ${SEGMENTS}/${conversation}/${day}?replaces=${theirs!.id}`,
			]);
			expect(downloadsIn(timeline)).toEqual([theirs!.id]);
			const [ours] = await a.api.segments();
			expect(ours!.id).not.toBe(theirs!.id);
			expect(await heldIn(fake, a, ours!.id, conversation, [message.id])).toEqual(["kept by this device"]);
			// Counted for the API, by its kind alone.
			a.clock.advance(MINUTE);
			await until(() => fake.decryptFailures.some((failure) => failure.kind === "segment"));
			await Promise.all([a, b, phone].map((device) => device.engine.stop()));
		},
		SLOW,
	);

	// The review's M9: two devices of the user's with the new key move the same segments at once.
	test(
		"two devices moving at once leave each day one copy, under the new key",
		async () => {
			const { fake, a, b, conversation, timeline } = await dm();
			const phone = await phoneOf(fake, a, conversation, [b]);
			const older = await sent(fake, a, conversation, "two days back", 2 * DAY, [a, b, phone]);
			const newer = await sent(fake, a, conversation, "yesterday", DAY, [a, b, phone]);
			// Her first device backs both days up; her phone takes them in, as it holds the same.
			a.clock.advance(MINUTE);
			await until(async () => (await a.api.segments()).length === 2);
			await turnEnded(a);
			phone.clock.advance(MINUTE);
			await turnEnded(phone);
			expect(await dueOn(phone)).toEqual([]);
			const before = await a.api.segments();

			// Ana changes her keys on her first device, whose transfer her phone takes.
			await a.engine.changeKeys();
			await a.engine.keySaved();
			const newKey = await sealsWith(a);
			await until(async () => (await sealsWith(phone)) === newKey);
			// Both move: their first uploads wait for each other, then go in the order they came.
			fake.gather(SEGMENT_PUT, 2);
			timeline.length = 0;
			a.clock.advance(MINUTE);
			phone.clock.advance(MINUTE);
			await until(async () => (await a.api.segments()).every((segment) => segment.key_id === newKey));
			await Promise.all([turnEnded(a), turnEnded(phone)]);
			// Each tried each segment, and the second to come for one was kept out: one copy a day, which holds the day.
			expect(putsIn(timeline)).toHaveLength(4);
			const after = await a.api.segments();
			expect(after.map((segment) => segment.day).sort()).toEqual(before.map((segment) => segment.day).sort());
			const copyOf = (day: string) => after.find((segment) => segment.day === day)!.id;
			expect(await heldIn(fake, a, copyOf(before[0]!.day), conversation, [older.id])).toEqual(["two days back"]);
			expect(await heldIn(fake, a, copyOf(before[1]!.day), conversation, [newer.id])).toEqual(["yesterday"]);
			// Neither took it for a failure: both moves ended, and both are up to date.
			for (const device of [a, phone]) {
				expect(device.store.read(BACKUP_REENCRYPT)).toBeNull();
				expect(device.engine.backup()).toEqual({ state: "up_to_date" });
			}
			await Promise.all([a, b, phone].map((device) => device.engine.stop()));
		},
		SLOW,
	);

	// The review's M10: the move a lost device left halfway is finished by a new installation.
	test(
		"a new installation moves what a lost device's move left under the old key",
		async () => {
			let cutting = false;
			let moved = 0;
			const { fake, a, b, conversation } = await dm({
				watch: (request, api) => {
					const url = new URL(request.url);
					if (cutting && request.method === "PUT" && SEGMENT_PUT.path.test(url.pathname) && ++moved === 2) {
						api.cutRequest(SEGMENT_PUT);
					}
				},
			});
			const older = await sent(fake, a, conversation, "two days back", 2 * DAY, [a, b]);
			const newer = await sent(fake, a, conversation, "yesterday", DAY, [a, b]);
			a.clock.advance(MINUTE);
			await until(async () => (await a.api.segments()).length === 2);
			await turnEnded(a);
			const before = await a.api.segments();
			const oldKey = before[0]!.key_id;
			// Ana changes her keys: her device moves the first day, then is lost on the second.
			await a.engine.changeKeys();
			const changed = a.engine.state;
			const key = changed.name === "ready" ? changed.rotation?.recoveryKey : null;
			if (!key) throw new Error("the change of keys showed no recovery key");
			await a.engine.keySaved();
			cutting = true;
			a.clock.advance(MINUTE);
			await until(() => moved === 2);
			await turnEnded(a);
			await a.engine.stop();
			expect((await a.api.segments()).filter((segment) => segment.key_id === oldKey)).toHaveLength(1);

			// A new installation of Ana's, set up with her new recovery key, which brings the older backup key too.
			const n = testDevice(fake, a.user);
			await n.engine.start();
			await n.engine.recover(key);
			await until(async () => (await textOn(n, conversation, older.id)) === "two days back");
			await turnEnded(n);
			// Its first pass moves what isn't under its key; each day keeps its copy, which holds it.
			n.clock.advance(MINUTE);
			await turnEnded(n);
			const after = await n.api.segments();
			expect(after.filter((segment) => segment.key_id === oldKey)).toEqual([]);
			expect(after.map((segment) => segment.day).sort()).toEqual(before.map((segment) => segment.day).sort());
			const copyOf = (day: string) => after.find((segment) => segment.day === day)!.id;
			expect(await heldIn(fake, n, copyOf(before[0]!.day), conversation, [older.id])).toEqual(["two days back"]);
			expect(await heldIn(fake, n, copyOf(before[1]!.day), conversation, [newer.id])).toEqual(["yesterday"]);
			await Promise.all([b, n].map((device) => device.engine.stop()));
		},
		SLOW,
	);

	// The review's M15.
	test(
		"a moved day's next upload replaces the copy it moved to",
		async () => {
			const { fake, a, b, conversation, timeline } = await dm();
			const day = dayOf(Date.now() - DAY);
			const gone = await sent(fake, a, conversation, "deleted after the move", DAY, [a, b]);
			await sent(fake, a, conversation, "kept", DAY, [a, b]);
			a.clock.advance(MINUTE);
			await until(async () => (await a.api.segments()).length === 1);
			await turnEnded(a);
			const [first] = await a.api.segments();
			await a.engine.changeKeys();
			await a.engine.keySaved();
			a.clock.advance(MINUTE);
			await until(async () => (await a.api.segments())[0]?.key_id !== first!.key_id);
			await turnEnded(a);
			const [moved] = await a.api.segments();

			// A deletion sends the day up again: in the place of the copy it moved to, with nothing to take in first.
			await a.engine.deleteMessage(conversation, gone.id);
			await until(async () => (await b.engine.messages(conversation, [gone.id])).length === 0);
			timeline.length = 0;
			a.clock.advance(MINUTE);
			await until(() => timeline.includes("backup_uploaded"));
			await turnEnded(a);
			expect(putsIn(timeline)).toEqual([`PUT ${SEGMENTS}/${conversation}/${day}?replaces=${moved!.id}`]);
			expect(downloadsIn(timeline)).toEqual([]);
			await Promise.all([a.engine.stop(), b.engine.stop()]);
		},
		SLOW,
	);
});

/** The ID of the copy the API shows of the device's user's day. */
async function shownCopyOf(device: TestDevice, day: string): Promise<string> {
	const held = (await device.api.segments()).find((segment) => segment.day === day);
	if (!held) throw new Error(`no copy of ${day}`);
	return held.id;
}

// The backup's own rules, on a stub core and API: no cryptography, only what the backup decides from their answers.

const C = "0193a4b2-0000-7000-8000-0000000c0001";
const BUILT = { data: "AAAA", key_id: "current", complete: true, version: 1 };

type StubCore = Record<string, (command: Record<string, any>) => unknown>;
type StubApi = Pick<E2eApi, "segments" | "deletedMessages" | "segment" | "putSegment">;

/** The API's answer of `status`, in its words, as the client gives it. */
const refusal = (status: number, error: string) =>
	new FetchError(
		`Request failed with status ${status}`,
		{},
		{
			...{ data: { error }, status },
			...{ statusText: "", headers: new Headers() },
		},
	);

const segmentOf = (id: string, day: string, key_id = "current", conversation_id = C): BackupSegment => ({
	...{ id, conversation_id, day, complete: true, key_id },
	...{ size: 3, created_at: "2026-11-01T00:00:00Z" },
});
const [S1, S2] = ["0193a4b2-0000-7000-8000-000000050001", "0193a4b2-0000-7000-8000-000000050002"];

/**
 * The backup on a stub core and API, on a clock of the test's. `log` tells, in order, each core command, request and
 * look at the inbox it made; `ready` says whether the device backs up.
 */
function onAStub(given: { api?: Partial<StubApi>; core?: StubCore; ready?: () => boolean } = {}) {
	const clock = new TestClock();
	const store = memoryStore();
	const log: string[] = [];
	const core: StubCore = {
		backup_due: () => ({ segments: [] }),
		backup_segment: () => BUILT,
		backup_uploaded: () => ({}),
		backup_import: () => ({ imported: 1 }),
		backup_reencrypt: () => ({ data: "AAAA", key_id: "current" }),
		...given.core,
	};
	const host = {
		handle: async (command: { cmd: string } & Record<string, unknown>) => {
			log.push(command.cmd);
			const answer = core[command.cmd];
			if (!answer) throw new Error(`the stub core has no ${command.cmd}`);
			return answer(command);
		},
	};
	const calls: StubApi = {
		segments: async () => [],
		deletedMessages: async () => ({ ids: [] }),
		segment: async () => new Uint8Array(3),
		putSegment: async () => ({ id: crypto.randomUUID() }),
		...given.api,
	};
	const api: StubApi = {
		segments: (...args) => {
			log.push("segments");
			return calls.segments(...args);
		},
		deletedMessages: (...args) => {
			log.push("deletedMessages");
			return calls.deletedMessages(...args);
		},
		segment: (...args) => {
			log.push("segment");
			return calls.segment(...args);
		},
		putSegment: (...args) => {
			log.push("putSegment");
			return calls.putSegment(...args);
		},
	};
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the backup reaches no other part, nor route
	const parts = { host, api, store, clock } as unknown as EngineParts;
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- nothing here reports a failure to the API
	const failures = new Failures(api as unknown as E2eApi, clock);
	const ready = given.ready ?? (() => true);
	const backups: Backups = new Backups(parts, failures, {
		turn: (work) => (ready() ? work() : Promise.reject(new CoreError("not_ready", "not ready"))),
		inbox: async () => void log.push("inbox"),
		changed: () => {},
		shown: () => {},
		update: () => {},
	});
	return { backups, clock, store, log };
}

/** Runs what's due as the clock moves on, then what that started, settled. */
async function moveOn(stub: { backups: Backups; clock: TestClock }, ms: number) {
	stub.clock.advance(ms);
	await stub.backups.settled();
}

describe("the backup's rules", () => {
	// The review's M7: a day the API refuses for good (here a day past tomorrow, from a clock a day ahead).
	test("a day that fails three passes in a row is set aside, and the days after it go up", async () => {
		const due = ["2026-11-20", "2026-11-21"];
		const confirmed = new Set<string>();
		const puts: string[] = [];
		const stub = onAStub({
			core: {
				backup_due: () => ({
					segments: due.filter((day) => !confirmed.has(day)).map((day) => ({ conversation_id: C, day })),
				}),
				backup_uploaded: ({ day }) => void confirmed.add(day),
			},
			api: {
				putSegment: async (_conversation, day) => {
					puts.push(day);
					if (day === "2026-11-20")
						throw refusal(400, "invalid day: a day is YYYY-MM-DD, in UTC, from 2026-01-01 to tomorrow");
					return { id: crypto.randomUUID() };
				},
			},
		});
		stub.backups.quiet();
		await stub.backups.settled();
		// Each pass stops at it, waiting a minute, then two, then four.
		await moveOn(stub, MINUTE);
		await moveOn(stub, 2 * MINUTE);
		expect(puts).toEqual(["2026-11-20", "2026-11-20", "2026-11-20"]);
		expect(confirmed.size).toBe(0);
		await moveOn(stub, 4 * MINUTE);
		// Set aside after the third: the next day goes up, and the one set aside isn't tried again before a day passed.
		expect(puts).toEqual(["2026-11-20", "2026-11-20", "2026-11-20", "2026-11-21"]);
		expect([...confirmed]).toEqual(["2026-11-21"]);
		expect(stub.backups.shown()).toEqual({ state: "uploading" });
		await moveOn(stub, 60 * MINUTE);
		expect(puts).toHaveLength(4);
		await moveOn(stub, DAY);
		expect(puts.at(-1)).toBe("2026-11-20");
		expect(stub.store.read<Record<string, { fails: number }>>(BACKUP_SET_ASIDE)?.[`day:${C}/2026-11-20`]?.fails).toBe(
			4,
		);
	});

	// Round 3: a passing outage loses a restore no day. A download that never came whole is tried again a day later.
	test("a restore's segment that failed three passes in a row is tried again a day later, while the rest comes in", async () => {
		const [newer, older] = [segmentOf(S1, "2026-11-21"), segmentOf(S2, "2026-11-20")];
		let broken = true;
		const imported: string[] = [];
		const stub = onAStub({
			core: {
				backup_import: ({ data }) => {
					imported.push(data);
					return { imported: 1 };
				},
			},
			api: {
				segments: async () => [newer, older],
				segment: async (id) => {
					if (id !== newer.id) return new Uint8Array([2, 2, 2]);
					if (broken) throw new TypeError("the stream ended before the file did");
					return new Uint8Array([1, 1, 1]);
				},
			},
		});
		stub.store.write(BACKUP_RESTORE, { done: [] });
		stub.backups.wake();
		await stub.backups.settled();
		// Each pass stops at it, waiting a minute, then two.
		await moveOn(stub, MINUTE);
		await moveOn(stub, 2 * MINUTE);
		expect(imported).toEqual([]);
		// Set aside after the third: the restore takes the rest, and stays due for the day it set aside.
		await moveOn(stub, 4 * MINUTE);
		expect(imported).toEqual(["AgIC"]);
		expect(stub.store.read<unknown>(BACKUP_RESTORE)).toEqual({ done: [C], waiting: true });
		// Until its day comes, a pass neither tries it again nor lists the backup for it.
		const listings = () => stub.log.filter((line) => line === "segments").length;
		const listed = listings();
		await moveOn(stub, 60 * MINUTE);
		expect(listings()).toBe(listed);
		expect(imported).toEqual(["AgIC"]);
		// A day later the storage answers again: the day comes in, and the restore is over.
		broken = false;
		await moveOn(stub, DAY);
		expect(imported).toEqual(["AgIC", "AQEB"]);
		expect(stub.store.read(BACKUP_RESTORE)).toBeNull();
		expect(stub.store.read(BACKUP_SET_ASIDE)).toBeNull();
	});

	// Round 3: never imported without its deleted messages, nor left out of the restore for a passing outage.
	test("a conversation whose deleted messages didn't come three passes in a row is restored a day later, the others meanwhile", async () => {
		const [first, second] = ["0193a4b2-0000-7000-8000-0000000c0011", "0193a4b2-0000-7000-8000-0000000c0012"];
		// The first conversation's day is the newer one: the restore comes to it first.
		const segments = [segmentOf(S1, "2026-11-21", "current", first), segmentOf(S2, "2026-11-20", "current", second)];
		let down = true;
		const imported: string[] = [];
		const stub = onAStub({
			core: {
				backup_import: ({ data }) => {
					imported.push(data);
					return { imported: 1 };
				},
			},
			api: {
				segments: async () => segments,
				segment: async (id) => (id === S1 ? new Uint8Array([1, 1, 1]) : new Uint8Array([2, 2, 2])),
				deletedMessages: async (conversation) => {
					if (conversation === first && down) throw new TypeError("fetch failed");
					return { ids: [] };
				},
			},
		});
		stub.store.write(BACKUP_RESTORE, { done: [] });
		stub.backups.wake();
		await stub.backups.settled();
		await moveOn(stub, MINUTE);
		await moveOn(stub, 2 * MINUTE);
		expect(imported).toEqual([]);
		// Set aside after the third: the other conversation comes in, and nothing of the first without its list.
		await moveOn(stub, 4 * MINUTE);
		expect(imported).toEqual(["AgIC"]);
		expect(stub.log.filter((line) => line === "segment")).toHaveLength(1);
		expect(stub.store.read<unknown>(BACKUP_RESTORE)).toEqual({ done: [second], waiting: true });
		// A day later its list comes: its day comes in, and the restore is over.
		down = false;
		await moveOn(stub, DAY);
		expect(imported).toEqual(["AgIC", "AQEB"]);
		expect(stub.store.read(BACKUP_RESTORE)).toBeNull();
		expect(stub.store.read(BACKUP_SET_ASIDE)).toBeNull();
	});

	// Round 3: a key this device doesn't hold yet may still come, with a change of keys' transfer.
	test("a restore's segment under a key this device doesn't hold is tried again a day later", async () => {
		let held = false;
		const imported: string[] = [];
		const stub = onAStub({
			core: {
				backup_import: ({ data }) => {
					if (!held) throw new CoreError("not_found", "no such backup key", { what: "backup_key" });
					imported.push(data);
					return { imported: 1 };
				},
			},
			api: { segments: async () => [segmentOf(S1, "2026-11-21")] },
		});
		stub.store.write(BACKUP_RESTORE, { done: [] });
		stub.backups.wake();
		await stub.backups.settled();
		// Its inbox first, then once more: still no key, so the day is set aside, and the restore stays due for it.
		expect(stub.log.filter((line) => line === "inbox")).toHaveLength(2);
		expect(imported).toEqual([]);
		expect(stub.store.read<unknown>(BACKUP_RESTORE)).toEqual({ done: [C], waiting: true });
		// A day later the key is here: the day comes in, and the restore is over.
		held = true;
		await moveOn(stub, DAY);
		expect(imported).toEqual(["AAAA"]);
		expect(stub.store.read(BACKUP_RESTORE)).toBeNull();
	});

	// The review's M7: a move's segment that never comes down whole stops the move no more; it stays under its key,
	// which the older keys a device holds still open.
	test("a move's segment that failed three passes in a row is passed over", async () => {
		const segments = [segmentOf(S1, "2026-11-21", "older"), segmentOf(S2, "2026-11-20", "older")];
		const put: string[] = [];
		const stub = onAStub({
			api: {
				segments: async () => segments,
				segment: async (id) => {
					if (id === S1) throw new TypeError("the stream ended before the file did");
					return new Uint8Array([1, 2, 3]);
				},
				putSegment: async (_conversation, day, _segment, replaces) => {
					put.push(`${day} ${replaces}`);
					return { id: crypto.randomUUID() };
				},
			},
		});
		stub.store.write(BACKUP_KEY_SEEN, "older");
		stub.backups.quiet();
		await stub.backups.settled();
		await moveOn(stub, MINUTE);
		await moveOn(stub, 2 * MINUTE);
		expect(put).toEqual([]);
		await moveOn(stub, 4 * MINUTE);
		expect(put).toEqual([`2026-11-20 ${S2}`]);
		expect(stub.store.read(BACKUP_REENCRYPT)).toBeNull();
		expect(stub.store.read(BACKUP_SET_ASIDE)).toBeNull();
	});

	test("a network that doesn't answer counts against no day", async () => {
		let down = true;
		const puts: string[] = [];
		const offline = async () => {
			if (down) throw new TypeError("fetch failed");
			return { ids: [] };
		};
		const stub = onAStub({
			core: {
				backup_due: () => ({ segments: puts.length && !down ? [] : [{ conversation_id: C, day: "2026-11-20" }] }),
			},
			api: {
				deletedMessages: offline,
				putSegment: async (_conversation, day) => {
					puts.push(day);
					return { id: crypto.randomUUID() };
				},
			},
		});
		stub.backups.quiet();
		await stub.backups.settled();
		for (const ms of [1, 2, 4, 8, 16].map((m) => m * MINUTE)) await moveOn(stub, ms);
		expect(stub.store.read(BACKUP_SET_ASIDE)).toBeNull();
		// Back up, the day goes at the next pass.
		down = false;
		await moveOn(stub, 32 * MINUTE);
		expect(puts).toEqual(["2026-11-20"]);
	});

	// The review's M8: however busy the app, a pass at the latest 30 minutes after the last one ended, and as a day ends.
	test("a pass runs 30 minutes after the last one ended at the latest, and as the UTC day ends", async () => {
		const stub = onAStub();
		// A minute into a UTC day.
		stub.clock.advance(DAY - (stub.clock.now() % DAY) + MINUTE);
		const passes = () => stub.log.filter((line) => line === "backup_due").length;
		stub.backups.wake();
		await moveOn(stub, 29 * MINUTE);
		expect(passes()).toBe(0);
		await moveOn(stub, MINUTE);
		expect(passes()).toBe(1);
		await moveOn(stub, 30 * MINUTE);
		expect(passes()).toBe(2);
		// Ten minutes before the day ends, the next pass is as it ends.
		stub.clock.advance(DAY - (stub.clock.now() % DAY) - 10 * MINUTE);
		await stub.backups.settled();
		const before = passes();
		stub.backups.quiet();
		await stub.backups.settled();
		await moveOn(stub, 10 * MINUTE + 2000);
		expect(passes()).toBe(before + 2);
	});

	// The review's M12: a new device waiting at Finish makes no request for its restore.
	test("before the device is ready, a pass makes no request and asks nothing of the core", async () => {
		const stub = onAStub({ ready: () => false });
		stub.store.write(BACKUP_RESTORE, { done: [] });
		stub.backups.quiet();
		await stub.backups.settled();
		stub.backups.wake();
		await stub.backups.settled();
		expect(stub.log).toEqual([]);
		expect(stub.backups.shown()).toEqual({ state: "uploading" });
	});

	// The review's M6, the core's rule: before the copy work, the transfers waiting.
	test("a pass takes the inbox before anything else", async () => {
		const stub = onAStub({ core: { backup_due: () => ({ segments: [{ conversation_id: C, day: "2026-11-20" }] }) } });
		stub.store.write(BACKUP_RESTORE, { done: [] });
		stub.backups.quiet();
		await stub.backups.settled();
		expect(stub.log[0]).toBe("inbox");
		expect(stub.log).toContain("putSegment");
	});

	// The review's M13: full pages forever list no backup.
	test("a listing whose pages never end stops at a thousand of them", async () => {
		const full = Array.from({ length: 1000 }, (_, i) =>
			segmentOf(`0193a4b2-0000-7000-8000-${String(i).padStart(12, "0")}`, "2026-11-20"),
		);
		const ids = full.map((segment) => segment.id);
		const listed = (stub: ReturnType<typeof onAStub>, name: string) => stub.log.filter((line) => line === name).length;
		// The restore's list of the segments (of a conversation it's done with: a list that ends restores none of them).
		let pages = 0;
		const restore = onAStub({ api: { segments: async () => (++pages > 1001 ? [] : full) } });
		restore.store.write(BACKUP_RESTORE, { done: [C] });
		restore.backups.wake();
		await restore.backups.settled();
		expect(listed(restore, "segments")).toBe(1000);
		// A conversation's deleted messages.
		let deletedPages = 0;
		const deleted = onAStub({
			api: {
				segments: async () => [full[0]!],
				deletedMessages: async () => ({ ids: ++deletedPages > 1001 ? [] : ids }),
			},
		});
		deleted.store.write(BACKUP_RESTORE, { done: [] });
		deleted.backups.wake();
		await deleted.backups.settled();
		expect(listed(deleted, "deletedMessages")).toBe(1000);
		// The move's.
		let movePages = 0;
		const move = onAStub({ api: { segments: async () => (++movePages > 1001 ? [] : full) } });
		move.store.write(BACKUP_KEY_SEEN, "older");
		move.backups.quiet();
		await move.backups.settled();
		expect(listed(move, "segments")).toBe(1000);
	});
});
