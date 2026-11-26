import { describe, expect, spyOn, test } from "bun:test";
import type { DirectMessage } from "$lib/api/conversations";
import type { Identity } from "$lib/api/e2e";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import {
	approvedDevice,
	commitByHand,
	firstDevice,
	memoryStore,
	testHost,
	turnEnded,
	watchedHost,
	refusingStore,
	rejection,
	restarted,
	sameGroup,
	until,
	useFake,
	type TestDevice,
} from "../testing/engines";
import { useXHR } from "../testing/xhr";
import { changedIn, Contacts, waitingForYes } from "./contacts";
import { DEVICE_RECORD, KEY_CHANGES, VERIFIED_CONTACTS } from "./store";

// Contacts (PLAN-E2E-CLIENTES.md, Task 28; decision 25): the security number two people compare, the mark of one the
// person verified, and a changed key's notice in their conversations, which a verified contact's makes wait for the
// person's yes before anything more goes there. The core decides each of them; what it refuses changes nothing.
const SLOW = 180_000;
const DIGITS = /^(\d{5} ){11}\d{5}$/;
// A catch-up's parts go up as bytes, which the app sends through the XMLHttpRequest Bun lacks.
useXHR();

/** Ana and Bo, friends with a DM, each with a first device set up: no group yet. */
async function anaAndBo(seen?: (request: Request) => void) {
	const fake = new FakeApi();
	useFake(fake, seen);
	const [ana, bo] = [fake.addUser(), fake.addUser()];
	fake.befriend(ana, bo);
	const dm = fake.addConversation({ type: "dm", members: [ana, bo] });
	const a = await firstDevice(fake, ana);
	const b = await firstDevice(fake, bo);
	return { fake, ana, bo, dm, a, b };
}

/** The device's user changes their keys (Settings → Devices), the new recovery key saved: its upload tells the
 * others. */
async function newKeys(device: TestDevice) {
	await device.engine.changeKeys();
	await device.engine.keySaved();
	expect(device.engine.state).toEqual({ name: "ready" });
}

/** The ID of the change of `user`'s key the device shows, which a close or a yes names. */
const changeOf = (device: TestDevice, user: string) => device.engine.contacts().changes[user]?.change ?? "";

/** Waits for the device to note `user`'s changed key: what the gateway's IDENTITY_UPDATE has it observe. */
const changeNoted = (device: TestDevice, user: string) =>
	until(() => device.engine.contacts().changes[user] !== undefined);

/** Ana's and Bo's devices in their DM's group, Bo verified by Ana; then Bo's new keys, a strong change on Ana's. */
async function verifiedWithNewKeys(a: TestDevice, b: TestDevice, dm: string) {
	await a.engine.openConversation(dm);
	await b.engine.openConversation(dm);
	await sameGroup([a, b], dm);
	const { digits } = await a.engine.safetyNumber(b.user);
	expect(await a.engine.verifyContact(b.user, digits)).toBe(true);
	await newKeys(b);
	await changeNoted(a, b.user);
	expect(a.engine.contacts().changes[b.user]?.verified).toBe(true);
}

/** Each request's method and path, as the fake hears them. */
const requestsOf = (requests: string[]) => (request: Request) =>
	void requests.push(`${request.method} ${new URL(request.url).pathname}`);

describe("the notices of a contact's changed key", () => {
	test("a changed key's notice shows in every conversation with that person, until it's closed", () => {
		const changes = {
			bo: { verified: false, change: "c1" },
			cy: { verified: true, closed: true as const, change: "c2" },
		};
		// Their DM, a group with them, and a group without them.
		expect(changedIn(changes, ["ana", "bo"])).toEqual(["bo"]);
		expect(changedIn(changes, ["ana", "bo", "cy", "dee"])).toEqual(["bo"]);
		expect(changedIn(changes, ["ana", "dee"])).toEqual([]);
	});

	test("what waits for the person's yes is a verified contact's change they haven't said yes to", () => {
		const changes = {
			bo: { verified: true, change: "c1" },
			cy: { verified: true, closed: true as const, change: "c2" },
			dee: { verified: true, confirmed: true as const, change: "c3" },
			eve: { verified: false, change: "c4" },
		};
		expect(waitingForYes(changes, ["ana", "bo", "cy", "dee", "eve"])).toEqual(["bo", "cy"]);
		expect(waitingForYes(changes, ["ana", "eve"])).toEqual([]);
	});

	test("a second change before the person was done with the first keeps its strong notice, open again", () => {
		const contacts = new Contacts(memoryStore(), "ana", () => {});
		contacts.observed("bo", { state: "new", verified: false });
		contacts.observed("bo", { state: "changed", verified: false, was_verified: true });
		contacts.close("bo", contacts.shown().changes.bo!.change);
		// The core unmarked them with the first change: the second's was_verified is false.
		contacts.observed("bo", { state: "changed", verified: false, was_verified: false });
		expect(contacts.shown().changes).toEqual({ bo: { verified: true, change: expect.any(String) } });
		// Once said yes to, a later change of a contact no longer verified is a plain one.
		contacts.confirm([{ user: "bo", change: contacts.shown().changes.bo!.change }]);
		contacts.observed("bo", { state: "changed", verified: false, was_verified: false });
		expect(contacts.shown().changes).toEqual({ bo: { verified: false, change: expect.any(String) } });
	});

	// Review, Minor 6: a yes or a close the person gave a change is that change's, not one that came while they looked.
	test("a yes, and a close, are for the change the person was shown, not one that came since", () => {
		const contacts = new Contacts(memoryStore(), "ana", () => {});
		contacts.observed("bo", { state: "changed", verified: false, was_verified: true });
		const shown = contacts.shown().changes.bo!;
		contacts.observed("bo", { state: "changed", verified: false, was_verified: false });
		const now = contacts.shown().changes.bo!;
		expect(now.change).not.toBe(shown.change);
		contacts.confirm([{ user: "bo", change: shown.change }]);
		contacts.close("bo", shown.change);
		expect(contacts.shown().changes.bo).toEqual(now);
		expect(contacts.holding(["bo"])).toEqual(["bo"]);
		contacts.confirm([{ user: "bo", change: now.change }]);
		contacts.close("bo", now.change);
		expect(contacts.shown().changes).toEqual({});
	});

	// Review, Minor 4: a refused list is no change, but the core's refusal still says whether the identity it holds is
	// verified, so a contact's mark shows after a start before any observation the core takes.
	test("a refused observation says no change, and keeps the mark of the identity the core holds", () => {
		let told = 0;
		const contacts = new Contacts(memoryStore(), "ana", () => told++);
		contacts.observed("bo", { state: "rejected", verified: true, reason: "wrong_user" });
		expect(contacts.shown()).toEqual({ changes: {}, verified: { bo: true } });
		expect(told).toBe(1);
		// The user's own observations are no contact's.
		contacts.observed("ana", { state: "same", verified: true });
		expect(contacts.shown().verified).toEqual({ bo: true });
	});

	// Review, Minor 5: the core says `changed` once. Whom the person verified is kept at the tap, so a change the record
	// never took is one the next start finds: the core holds that contact unverified, and nothing was noted.
	test("a verified contact the core holds unverified, with no change kept, is a strong change", () => {
		const store = memoryStore();
		const contacts = new Contacts(store, "ana", () => {});
		contacts.verifiedNow("bo", true);
		expect(store.read<string[]>(VERIFIED_CONTACTS)).toEqual(["bo"]);
		const again = new Contacts(store, "ana", () => {});
		again.observed("bo", { state: "same", verified: false });
		expect(again.shown().changes).toEqual({ bo: { verified: true, change: expect.any(String) } });
		expect(again.holding(["bo"])).toEqual(["bo"]);
		// Kept as verified until the person is done with the change: a record that refuses it finds it at each start.
		expect(store.read<string[]>(VERIFIED_CONTACTS)).toEqual(["bo"]);
		again.confirm([{ user: "bo", change: again.shown().changes.bo!.change }]);
		again.close("bo", again.shown().changes.bo!.change);
		expect(store.read(VERIFIED_CONTACTS)).toBeNull();
		again.observed("bo", { state: "same", verified: false });
		expect(again.shown().changes).toEqual({});
	});

	// Review, Minor 5: what the record kept is read back at a start, each change with its ID, closed or said yes to as it
	// was: one the person was never asked about (not verified) has no list to be found again by.
	test("the changes the record kept are there again at a start, each as it was", () => {
		const store = memoryStore();
		const contacts = new Contacts(store, "ana", () => {});
		contacts.observed("bo", { state: "changed", verified: false, was_verified: false });
		contacts.observed("cy", { state: "changed", verified: false, was_verified: true });
		contacts.confirm([{ user: "cy", change: contacts.shown().changes.cy!.change }]);
		const again = new Contacts(store, "ana", () => {});
		expect(again.shown().changes).toEqual(contacts.shown().changes);
		expect(again.shown().changes.cy).toEqual({ verified: true, confirmed: true, change: expect.any(String) });
		expect(again.holding(["bo", "cy"])).toEqual([]);
	});

	test("a device that starts again with nothing starts without them", () => {
		expect(DEVICE_RECORD).toEqual(expect.arrayContaining([KEY_CHANGES, VERIFIED_CONTACTS]));
	});
});

describe.skipIf(!coreLibrary)("contacts", () => {
	test(
		"both sides see the same 60 digits",
		async () => {
			const { ana, bo, a, b } = await anaAndBo();
			const ours = await a.engine.safetyNumber(bo);
			expect(ours.digits).toMatch(DIGITS);
			expect(ours.qr).toEqual(expect.any(String));
			// The same number, and the same code, whichever of the two looks.
			expect(await b.engine.safetyNumber(ana)).toEqual(ours);
			// Looking marks no one.
			expect(a.engine.contacts().verified[bo]).toBe(false);
			// New keys make a new number, the same again on both sides.
			await newKeys(b);
			const now = await a.engine.safetyNumber(bo);
			expect(now.digits).toMatch(DIGITS);
			expect(now.digits).not.toBe(ours.digits);
			expect(await b.engine.safetyNumber(ana)).toEqual(now);
		},
		SLOW,
	);

	test(
		"a verified contact wears its mark",
		async () => {
			const { fake, ana, bo, a, b } = await anaAndBo();
			expect(await a.engine.contact(bo)).toBe(false);
			const { digits } = await a.engine.safetyNumber(bo);
			expect(await a.engine.verifyContact(bo, digits)).toBe(true);
			expect(a.engine.contacts().verified[bo]).toBe(true);
			expect(await a.engine.contact(bo)).toBe(true);
			// Only on the person's own act: Bo's device doesn't mark Ana, however often it looks at her.
			expect(await b.engine.safetyNumber(ana)).toMatchObject({ digits });
			expect(await b.engine.contact(ana)).toBe(false);
			expect(b.engine.contacts().verified[ana]).toBe(false);
			// The mark is the core's: the app started again shows it once it looks at Bo.
			const again = await restarted(fake, a);
			expect(await again.engine.contact(bo)).toBe(true);
			expect(again.engine.contacts().verified[bo]).toBe(true);
		},
		SLOW,
	);

	test(
		"Mark as verified marks the number the person compared, never one that changed meanwhile",
		async () => {
			const { bo, a, b } = await anaAndBo();
			const { digits } = await a.engine.safetyNumber(bo);
			await newKeys(b);
			await changeNoted(a, bo);
			expect(await a.engine.verifyContact(bo, digits)).toBe(false);
			expect(await a.engine.contact(bo)).toBe(false);
			// The new number, compared, verifies them: their change is done with.
			const now = await a.engine.safetyNumber(bo);
			expect(now.digits).not.toBe(digits);
			expect(await a.engine.verifyContact(bo, now.digits)).toBe(true);
			expect(a.engine.contacts()).toEqual({ changes: {}, verified: { [bo]: true } });
		},
		SLOW,
	);

	test(
		"a changed key shows its notice once for each change",
		async () => {
			const { bo, dm, a, b } = await anaAndBo();
			expect(await a.engine.contact(bo)).toBe(false);
			let told = 0;
			a.engine.onContacts(() => told++);
			// Bo's new keys: the gateway's IDENTITY_UPDATE has Ana's device look at him again.
			await newKeys(b);
			await changeNoted(a, bo);
			expect(a.engine.contacts().changes).toEqual({ [bo]: { verified: false, change: expect.any(String) } });
			const once = told;
			expect(once).toBeGreaterThan(0);
			// Seen again, the same key is no new change: no second notice.
			expect(await a.engine.contact(bo)).toBe(false);
			await a.engine.openConversation(dm);
			await a.engine.safetyNumber(bo);
			expect(a.engine.contacts().changes).toEqual({ [bo]: { verified: false, change: expect.any(String) } });
			expect(told).toBe(once);
			// Kept until it's closed, whatever restarts.
			const record = a.store.read(KEY_CHANGES);
			expect(record).toEqual({ [bo]: { verified: false, change: expect.any(String) } });
			// Closed, it's gone, and the same key never brings it back.
			await a.engine.closeKeyChange(bo, changeOf(a, bo));
			expect(a.engine.contacts().changes).toEqual({});
			expect(a.store.read(KEY_CHANGES)).toBeNull();
			await a.engine.contact(bo);
			expect(a.engine.contacts().changes).toEqual({});
			// Another change, its own notice.
			await newKeys(b);
			await changeNoted(a, bo);
			expect(a.engine.contacts().changes).toEqual({ [bo]: { verified: false, change: expect.any(String) } });
			// The record names users alone, never a key.
			const { identity_key } = await a.api.identity(bo);
			expect(JSON.stringify(a.store.read(KEY_CHANGES))).not.toContain(identity_key);
		},
		SLOW,
	);

	test(
		"a conversation opened shows its members' changed keys, an event missed or not",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			fake.befriend(ana, bo);
			const dm = fake.addConversation({ type: "dm", members: [ana, bo] });
			// Ana's device hears no IDENTITY_UPDATE: as one away while Bo's keys changed, past what the gateway keeps.
			const a = await firstDevice(fake, ana, { hears: (event) => event.type !== "IDENTITY_UPDATE" });
			const b = await firstDevice(fake, bo);
			expect(await a.engine.contact(bo)).toBe(false);
			await newKeys(b);
			expect(a.engine.contacts().changes).toEqual({});
			await a.engine.openConversation(dm);
			expect(a.engine.contacts().changes).toEqual({ [bo]: { verified: false, change: expect.any(String) } });
		},
		SLOW,
	);

	test(
		"a verified contact's changed key asks before the next message goes",
		async () => {
			const requests: string[] = [];
			const { ana, bo, dm, a, b } = await anaAndBo((request) =>
				requests.push(`${request.method} ${new URL(request.url).pathname}`),
			);
			await a.engine.openConversation(dm);
			await b.engine.openConversation(dm);
			await sameGroup([a, b], dm);
			const { digits } = await a.engine.safetyNumber(bo);
			expect(await a.engine.verifyContact(bo, digits)).toBe(true);
			await newKeys(b);
			await changeNoted(a, bo);
			expect(a.engine.contacts().changes).toEqual({ [bo]: { verified: true, change: expect.any(String) } });
			expect(waitingForYes(a.engine.contacts().changes, [ana, bo])).toEqual([bo]);
			expect(a.engine.contacts().verified[bo]).toBe(false);

			// The next message waits for the person's yes: nothing goes to the API, and it waits on this device.
			const sends = () => requests.filter((request) => request === `POST /api/users/@me/conversations/${dm}/messages`);
			const nonce = crypto.randomUUID();
			const text = "are you still you?";
			const held = await rejection(a.engine.sendMessage({ conversation_id: dm, nonce, text }));
			expect(held).toMatchObject({ code: "key_changed", users: [bo] });
			expect(sends()).toEqual([]);
			expect((await a.engine.pendingMessages(dm)).map((pending) => pending.nonce)).toEqual([nonce]);
			// Closing the notice isn't the yes: a Retry waits still.
			await a.engine.closeKeyChange(bo, changeOf(a, bo));
			expect(a.engine.contacts().changes).toEqual({
				[bo]: { verified: true, closed: true, change: expect.any(String) },
			});
			const again = await rejection(a.engine.sendMessage({ conversation_id: dm, nonce, text }));
			expect(again).toMatchObject({ code: "key_changed", users: [bo] });
			expect(sends()).toEqual([]);

			// The person's yes: what waited goes on its own, and Bo reads it; the change is done with.
			let went: DirectMessage | null = null;
			a.engine.onSent((_conversation, sentNonce, message) => {
				if (sentNonce === nonce) went = message;
			});
			await a.engine.confirmKeyChanges([{ user: bo, change: changeOf(a, bo) }]);
			expect(a.engine.contacts().changes).toEqual({});
			await until(() => went !== null);
			expect(sends()).toHaveLength(1);
			const id = (went as DirectMessage | null)?.id ?? "";
			await until(async () => (await b.engine.messages(dm, [id]))[0]?.text === text);
			// What the person sends after their yes goes as ever.
			const next = await a.engine.sendMessage({ conversation_id: dm, nonce: crypto.randomUUID(), text: "ok" });
			expect(next).toMatchObject({ conversation_id: dm });
		},
		SLOW,
	);

	test(
		"a rejected list changes nothing and says nothing",
		async () => {
			const fake = new FakeApi();
			const [ana, bo, cy] = [fake.addUser(), fake.addUser(), fake.addUser()];
			fake.befriend(ana, bo);
			fake.befriend(ana, cy);
			// What the API serves of Bo, as the test forges it: as it is, until a test says otherwise.
			let forge = (identity: Identity) => identity;
			spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
				const request = new Request(input, init);
				const answer = await fake.fetch(request);
				if (new URL(request.url).pathname !== "/api/users/identities" || !answer.ok) return answer;
				const served: Identity[] = await answer.json();
				return Response.json(served.map((identity) => (identity.user_id === bo ? forge(identity) : identity)));
			}) as typeof fetch);
			const a = await firstDevice(fake, ana);
			await firstDevice(fake, bo);
			await firstDevice(fake, cy);
			const { digits } = await a.engine.safetyNumber(bo);
			expect(await a.engine.verifyContact(bo, digits)).toBe(true);
			const cys = await a.api.identity(cy);
			let told = 0;
			a.engine.onContacts(() => told++);

			// Another user's list served under Bo's name: the core refuses it.
			forge = (identity) => ({ ...cys, user_id: identity.user_id });
			expect(await a.engine.contact(bo)).toBe(true);
			// A list its identity didn't sign: the core refuses that too.
			forge = (identity) => ({ ...identity, device_list: flipped(identity.device_list) });
			expect(await a.engine.contact(bo)).toBe(true);
			// The number is still the one of the identity this device holds of Bo: the one the person compared.
			expect((await a.engine.safetyNumber(bo)).digits).toBe(digits);
			// Nothing changed and nothing was said: the mark stays, and no notice.
			expect(a.engine.contacts()).toEqual({ changes: {}, verified: { [bo]: true } });
			expect(a.store.read(KEY_CHANGES)).toBeNull();
			expect(told).toBe(0);
			// Review, Minor 4: started again, before any list the core takes, a refused one keeps Bo's mark on show.
			forge = (identity) => ({ ...cys, user_id: identity.user_id });
			const again = await restarted(fake, a);
			expect(await again.engine.contact(bo)).toBe(true);
			expect(again.engine.contacts()).toEqual({ changes: {}, verified: { [bo]: true } });
		},
		SLOW,
	);

	test(
		"nothing the server says alone marks or unmarks anyone",
		async () => {
			const { fake, ana, bo, dm, a, b } = await anaAndBo();
			const { digits } = await a.engine.safetyNumber(bo);
			expect(await a.engine.verifyContact(bo, digits)).toBe(true);
			// A new device of Bo's, on his list: IDENTITY_UPDATE again, the same identity, still verified, no notice.
			const heard = () => a.heard.filter((event) => event.type === "IDENTITY_UPDATE").length;
			const before = heard();
			await approvedDevice(fake, b);
			await until(() => heard() > before);
			await a.engine.openConversation(dm);
			expect(await a.engine.contact(bo)).toBe(true);
			expect(a.engine.contacts()).toEqual({ changes: {}, verified: { [bo]: true } });
			// However often it's seen, the server's answer marks no one the person didn't verify.
			for (let n = 0; n < 3; n++) expect(await b.engine.contact(ana)).toBe(false);
		},
		SLOW,
	);
	// Review, Important 1: what goes to a conversation reaches whom its group holds, whatever the API lists. A server
	// that lists the group without Bo while his new key's leaf is in it takes away neither the hold nor his notice.
	test(
		"a verified contact's changed key holds what goes to their group, though the API lists it without them",
		async () => {
			const requests: string[] = [];
			const { fake, bo, dm, a, b } = await anaAndBo(requestsOf(requests));
			await verifiedWithNewKeys(a, b, dm);
			fake.dropMembers(dm, [bo]);
			const again = await restarted(fake, a);
			expect(await again.engine.keyChangesIn(dm)).toEqual({ [bo]: { verified: true, change: expect.any(String) } });
			const sent = again.engine.sendMessage({ conversation_id: dm, nonce: crypto.randomUUID(), text: "still you?" });
			expect(await rejection(sent)).toMatchObject({ code: "key_changed", users: [bo] });
			expect(requests.filter((request) => request === `POST /api/users/@me/conversations/${dm}/messages`)).toEqual([]);
		},
		SLOW,
	);

	// Review, Important 2: an edit is the message's new text: it waits for the yes as a message does.
	test(
		"an edit after a verified contact's changed key sends nothing until the yes",
		async () => {
			const requests: string[] = [];
			const { bo, dm, a, b } = await anaAndBo(requestsOf(requests));
			await a.engine.openConversation(dm);
			await b.engine.openConversation(dm);
			await sameGroup([a, b], dm);
			const sent = (await a.engine.sendMessage({ conversation_id: dm, nonce: crypto.randomUUID(), text: "first" }))!;
			const { digits } = await a.engine.safetyNumber(bo);
			await a.engine.verifyContact(bo, digits);
			await newKeys(b);
			await changeNoted(a, bo);
			const path = `/api/users/@me/conversations/${dm}/messages/${sent.id}`;
			const edits = () => requests.filter((request) => request === `PATCH ${path}`);
			await a.engine.editMessage(dm, sent.id, "edited");
			await turnEnded(a);
			expect(edits()).toEqual([]);
			await a.engine.confirmKeyChanges([{ user: bo, change: changeOf(a, bo) }]);
			await until(() => edits().length === 1);
			await until(async () => (await b.engine.messages(dm, [sent.id]))[0]?.text === "edited");
		},
		SLOW,
	);

	test(
		"an edit made again on a 409, whose queue brought a verified contact's changed key, waits for the yes",
		async () => {
			const requests: string[] = [];
			const fake = new FakeApi();
			useFake(fake, requestsOf(requests));
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			fake.befriend(ana, bo);
			const dm = fake.addConversation({ type: "dm", members: [ana, bo] });
			// Ana's device hears neither Bo's IDENTITY_UPDATE nor his commit: only the 409's read of the queue brings them.
			let deaf = false;
			const a = await firstDevice(fake, ana, {
				hears: (event) => !(deaf && (event.type === "IDENTITY_UPDATE" || event.type === "MLS_COMMIT")),
			});
			const b = await firstDevice(fake, bo);
			await a.engine.openConversation(dm);
			await b.engine.openConversation(dm);
			await sameGroup([a, b], dm);
			const sent = (await a.engine.sendMessage({ conversation_id: dm, nonce: crypto.randomUUID(), text: "first" }))!;
			const { digits } = await a.engine.safetyNumber(bo);
			await a.engine.verifyContact(bo, digits);
			deaf = true;
			await newKeys(b);
			// His device renews its leaf under his new keys: a commit in the queue Ana's device hasn't read.
			await b.engine.stop();
			await b.host.open(bo);
			await commitByHand(b, dm);
			expect(a.engine.contacts().changes).toEqual({});
			const path = `/api/users/@me/conversations/${dm}/messages/${sent.id}`;
			fake.refuse({ method: "PATCH", path }, 409, { error: "stale message" });
			const edits = () => requests.filter((request) => request === `PATCH ${path}`);
			await a.engine.editMessage(dm, sent.id, "edited");
			await turnEnded(a);
			// The 409's queue brought the change: the edit made again waits for the yes.
			expect(edits()).toHaveLength(1);
			expect(a.engine.contacts().changes[bo]?.verified).toBe(true);
			deaf = false;
			await a.engine.confirmKeyChanges([{ user: bo, change: changeOf(a, bo) }]);
			await until(() => edits().length === 2);
		},
		SLOW,
	);

	// Review, Important 3: a catch-up hands a member what was sent while they had no device; for a verified contact whose
	// key changed, it waits for the yes too, and goes once it's given.
	test(
		"a catch-up for a verified contact whose key changed waits for the yes",
		async () => {
			const requests: string[] = [];
			const { fake, bo, dm, a, b } = await anaAndBo(requestsOf(requests));
			const shares = () => requests.filter((request) => /^PUT \/api\/.*\/history-shares\/[0-9a-f-]{36}$/.test(request));
			await a.engine.openConversation(dm);
			await b.engine.openConversation(dm);
			await sameGroup([a, b], dm);
			const sent = (await a.engine.sendMessage({ conversation_id: dm, nonce: crypto.randomUUID(), text: "first" }))!;
			const { digits } = await a.engine.safetyNumber(bo);
			await a.engine.verifyContact(bo, digits);
			// Bo's device isn't seen for 45 days: what Ana's sends now is noted for him.
			fake.setActive(bo, false);
			await a.engine.openConversation(dm);
			expect(a.engine.conversationState(dm)).toEqual({ name: "no_device", users: [bo] });
			await newKeys(b);
			await changeNoted(a, bo);
			// Her edit of a message he read is noted for his new keys, which a catch-up would carry it to.
			await a.engine.editMessage(dm, sent.id, "edited");
			// He's seen again, and his device writes: the apply of it names him due a catch-up, which waits.
			fake.setActive(bo, true);
			await a.engine.openConversation(dm);
			const back = (await b.engine.sendMessage({ conversation_id: dm, nonce: crypto.randomUUID(), text: "back" }))!;
			await until(async () => (await a.engine.messages(dm, [back.id]))[0]?.text === "back");
			await turnEnded(a);
			expect(shares()).toEqual([]);
			await a.engine.confirmKeyChanges([{ user: bo, change: changeOf(a, bo) }]);
			await until(() => shares().length > 0);
		},
		SLOW,
	);

	// Review, Minor 5: a change and its hold outlast a restart; one the record never took is found again at the next
	// start, as the person had verified the contact.
	test(
		"a verified contact's changed key and its hold outlast a restart, even one the record didn't take",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			fake.befriend(ana, bo);
			const dm = fake.addConversation({ type: "dm", members: [ana, bo] });
			const store = memoryStore();
			// Ana's storage refuses the changes' record, as a full one does: the change is noted for this session alone.
			const a = await firstDevice(fake, ana, { store: refusingStore(store, KEY_CHANGES) });
			const b = await firstDevice(fake, bo);
			await verifiedWithNewKeys(a, b, dm);
			expect(store.read(KEY_CHANGES)).toBeNull();
			const again = await restarted(fake, a, { store });
			expect(again.engine.contacts().changes).toEqual({ [bo]: { verified: true, change: expect.any(String) } });
			const message = () => ({ conversation_id: dm, nonce: crypto.randomUUID(), text: "hi" });
			expect(await rejection(again.engine.sendMessage(message()))).toMatchObject({ code: "key_changed", users: [bo] });
			// Kept now, the change is there after another restart, and still holds.
			const third = await restarted(fake, again);
			expect(third.engine.contacts().changes[bo]?.verified).toBe(true);
			expect(await rejection(third.engine.sendMessage(message()))).toMatchObject({ code: "key_changed" });
		},
		SLOW,
	);

	// Review, Minor 7: verifying the new number is a yes too: what waited goes.
	test(
		"verifying a contact's new number sends what waited for the yes",
		async () => {
			const { bo, dm, a, b } = await anaAndBo();
			await verifiedWithNewKeys(a, b, dm);
			const nonce = crypto.randomUUID();
			await rejection(a.engine.sendMessage({ conversation_id: dm, nonce, text: "waiting" }));
			let went: DirectMessage | null = null;
			a.engine.onSent((_conversation, sentNonce, message) => {
				if (sentNonce === nonce) went = message;
			});
			const now = await a.engine.safetyNumber(bo);
			expect(await a.engine.verifyContact(bo, now.digits)).toBe(true);
			await until(() => went !== null);
		},
		SLOW,
	);

	// Ruling 6's sixth confirmation: on the desktop Bun's box names the digits the person compared, which it checks
	// against its own; the engine hands them along.
	test(
		"Mark as verified hands the core the digits the person compared",
		async () => {
			const fake = new FakeApi();
			useFake(fake);
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			fake.befriend(ana, bo);
			const commands: Record<string, unknown>[] = [];
			const host = watchedHost(testHost(), [], (cmd, command) => {
				if (cmd === "verify_user") commands.push(command);
				return null;
			});
			const a = await firstDevice(fake, ana, { host });
			await firstDevice(fake, bo);
			const { digits } = await a.engine.safetyNumber(bo);
			expect(await a.engine.verifyContact(bo, digits)).toBe(true);
			expect(commands).toEqual([{ cmd: "verify_user", user_id: bo, digits }]);
		},
		SLOW,
	);
});

/** A signed object's base64 with one byte of its signature changed. */
function flipped(base64: string): string {
	const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
	bytes[bytes.length - 1]! ^= 0x01;
	return btoa(String.fromCharCode(...bytes));
}
