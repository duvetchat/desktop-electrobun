import { describe, expect, test } from "bun:test";
import { CoreError } from "../errors";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import {
	firstDevice,
	rejection,
	sameGroup,
	testHost,
	turnEnded,
	until,
	useFake,
	watchedHost,
	type TestDevice,
} from "../testing/engines";
import { useXHR } from "../testing/xhr";

// Members without a device (PLAN-E2E-CLIENTES.md, «Quien no tenía dispositivo»; Task 22): who they are, as the person
// opens the conversation, told to the core and over the message box; and the catch-up of what was sent them meanwhile,
// handed to their devices once they have one.
const SLOW = 180_000;
const DAY = 24 * 3600 * 1000;
const SHARES = /^\/api\/users\/@me\/conversations\/[0-9a-f-]{36}\/history-shares\/[0-9a-f-]{36}$/;
// A catch-up's parts go up as bytes, which the app sends through the XMLHttpRequest Bun lacks.
useXHR();

function setUp() {
	const fake = new FakeApi();
	const requests: string[] = [];
	useFake(fake, (request) => requests.push(`${request.method} ${new URL(request.url).pathname}`));
	return { fake, requests };
}

/**
 * The catch-up waiting for the device's user from `from` in the conversation, as Task 30 will import it: its key taken
 * from the device's inbox, its parts down and opened by its core. What it imported.
 */
async function importCatchUp(device: TestDevice, conversation: string, from: string) {
	let share: { id: string; parts: number } | undefined;
	await until(async () => {
		share = (await device.api.shares()).find(
			(one) => one.kind === "catch_up" && one.conversation_id === conversation && one.from_user_id === from,
		);
		return !!share;
	});
	const parts: Uint8Array[] = [];
	for (let n = 0; n < share!.parts; n++) parts.push(await device.api.sharePart(share!.id, n));
	// Its key came by the inbox, which the device's engine takes as its DEVICE_MESSAGE comes.
	let imported = 0;
	await until(async () => {
		imported = await device.host
			.importShare(share!.id, parts)
			.then((done) => done.imported)
			.catch((error: unknown) => {
				if (error instanceof CoreError && error.code === "not_found") return 0;
				throw error;
			});
		return imported > 0;
	});
	return imported;
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
			expect(await importCatchUp(c, conversation, ana)).toBeGreaterThan(0);
			const [row] = await c.engine.messages(conversation, [sent!.id]);
			expect(row).toMatchObject({ status: "ok", text: "while you were away" });
			// Delivered, its notes are gone: there's nothing more to catch Cy up on.
			await turnEnded(a);
			const again = a.host.share({ cmd: "catch_up", conversation_id: conversation, user_id: cy, devices: [] });
			expect(await rejection(again)).toMatchObject({ code: "not_found", what: "catch_up" });
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
			expect(await importCatchUp(c, conversation, ana)).toBeGreaterThan(0);
			const [row] = await c.engine.messages(conversation, [sent!.id]);
			expect(row).toMatchObject({ status: "ok", text: "kept a day" });
		},
		SLOW,
	);
});
