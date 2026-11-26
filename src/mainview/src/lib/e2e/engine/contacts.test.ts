import { describe, expect, spyOn, test } from "bun:test";
import type { DirectMessage } from "$lib/api/conversations";
import type { Identity } from "$lib/api/e2e";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import {
	approvedDevice,
	firstDevice,
	memoryStore,
	rejection,
	restarted,
	sameGroup,
	until,
	useFake,
	type TestDevice,
} from "../testing/engines";
import { changedIn, Contacts, waitingForYes } from "./contacts";
import { DEVICE_RECORD, KEY_CHANGES } from "./store";

// Contacts (PLAN-E2E-CLIENTES.md, Task 28; decision 25): the security number two people compare, the mark of one the
// person verified, and a changed key's notice in their conversations, which a verified contact's makes wait for the
// person's yes before anything more goes there. The core decides each of them; what it refuses changes nothing.
const SLOW = 180_000;
const DIGITS = /^(\d{5} ){11}\d{5}$/;

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

/** Waits for the device to note `user`'s changed key: what the gateway's IDENTITY_UPDATE has it observe. */
const changeNoted = (device: TestDevice, user: string) =>
	until(() => device.engine.contacts().changes[user] !== undefined);

describe("the notices of a contact's changed key", () => {
	test("a changed key's notice shows in every conversation with that person, until it's closed", () => {
		const changes = { bo: { verified: false }, cy: { verified: true, closed: true as const } };
		// Their DM, a group with them, and a group without them.
		expect(changedIn(changes, ["ana", "bo"])).toEqual(["bo"]);
		expect(changedIn(changes, ["ana", "bo", "cy", "dee"])).toEqual(["bo"]);
		expect(changedIn(changes, ["ana", "dee"])).toEqual([]);
	});

	test("what waits for the person's yes is a verified contact's change they haven't said yes to", () => {
		const changes = {
			bo: { verified: true },
			cy: { verified: true, closed: true as const },
			dee: { verified: true, confirmed: true as const },
			eve: { verified: false },
		};
		expect(waitingForYes(changes, ["ana", "bo", "cy", "dee", "eve"])).toEqual(["bo", "cy"]);
		expect(waitingForYes(changes, ["ana", "eve"])).toEqual([]);
	});

	test("a second change before the person was done with the first keeps its strong notice, open again", () => {
		const contacts = new Contacts(memoryStore(), () => {});
		contacts.observed("bo", { state: "new", verified: false });
		contacts.observed("bo", { state: "changed", verified: false, was_verified: true });
		contacts.close("bo");
		// The core unmarked them with the first change: the second's was_verified is false.
		contacts.observed("bo", { state: "changed", verified: false, was_verified: false });
		expect(contacts.shown().changes).toEqual({ bo: { verified: true } });
		// Once said yes to, a later change of a contact no longer verified is a plain one.
		contacts.confirm(["bo"]);
		contacts.observed("bo", { state: "changed", verified: false, was_verified: false });
		expect(contacts.shown().changes).toEqual({ bo: { verified: false } });
	});

	test("an observation the core refuses is no word on anyone: the mark stays as it was, and no notice", () => {
		let told = 0;
		const contacts = new Contacts(memoryStore(), () => told++);
		contacts.observed("bo", { state: "new", verified: false });
		contacts.verifiedNow("bo", true);
		const before = told;
		contacts.observed("bo", { state: "rejected", verified: false, reason: "wrong_user" });
		expect(contacts.shown()).toEqual({ changes: {}, verified: { bo: true } });
		expect(told).toBe(before);
	});

	test("a device that starts again with nothing starts without them", () => {
		expect(DEVICE_RECORD).toContain(KEY_CHANGES);
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
			expect(a.engine.contacts().changes).toEqual({ [bo]: { verified: false } });
			const once = told;
			expect(once).toBeGreaterThan(0);
			// Seen again, the same key is no new change: no second notice.
			expect(await a.engine.contact(bo)).toBe(false);
			await a.engine.openConversation(dm);
			await a.engine.safetyNumber(bo);
			expect(a.engine.contacts().changes).toEqual({ [bo]: { verified: false } });
			expect(told).toBe(once);
			// Kept until it's closed, whatever restarts.
			const record = a.store.read(KEY_CHANGES);
			expect(record).toEqual({ [bo]: { verified: false } });
			// Closed, it's gone, and the same key never brings it back.
			await a.engine.closeKeyChange(bo);
			expect(a.engine.contacts().changes).toEqual({});
			expect(a.store.read(KEY_CHANGES)).toBeNull();
			await a.engine.contact(bo);
			expect(a.engine.contacts().changes).toEqual({});
			// Another change, its own notice.
			await newKeys(b);
			await changeNoted(a, bo);
			expect(a.engine.contacts().changes).toEqual({ [bo]: { verified: false } });
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
			expect(a.engine.contacts().changes).toEqual({ [bo]: { verified: false } });
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
			expect(a.engine.contacts().changes).toEqual({ [bo]: { verified: true } });
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
			await a.engine.closeKeyChange(bo);
			expect(a.engine.contacts().changes).toEqual({ [bo]: { verified: true, closed: true } });
			const again = await rejection(a.engine.sendMessage({ conversation_id: dm, nonce, text }));
			expect(again).toMatchObject({ code: "key_changed", users: [bo] });
			expect(sends()).toEqual([]);

			// The person's yes: what waited goes on its own, and Bo reads it; the change is done with.
			let went: DirectMessage | null = null;
			a.engine.onSent((_conversation, sentNonce, message) => {
				if (sentNonce === nonce) went = message;
			});
			await a.engine.confirmKeyChanges([bo]);
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
});

/** A signed object's base64 with one byte of its signature changed. */
function flipped(base64: string): string {
	const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
	bytes[bytes.length - 1]! ^= 0x01;
	return btoa(String.fromCharCode(...bytes));
}
