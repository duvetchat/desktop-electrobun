import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { base64Bytes } from "$lib/activity-thumbnail";
import { bytesBase64 } from "$lib/staged-images";
import { drawnAs, messageEnvelope } from "../conventions";
import { uuidv7 } from "../uuid";
import { FAKE_API_URL, FakeApi, type GatewayEvent } from "./fake-api";
import { BunCoreHost, coreLibrary } from "./host-bun";

// Real cores (host-bun.ts: the core's own library) talking through the fake API by hand, with the commands and routes
// the engine will use: what each device sends is what its core made, and what it applies is what the fake handed out.
// Without the core for this platform (macOS), there's nothing to run them with.
const CONVERSATIONS = "/api/users/@me/conversations";
/** What the app says it is, as each of its requests does (X-Duvet-Client). */
const CLIENT = "desktop-windows/1.2.0";
const hosts: BunCoreHost[] = [];
afterAll(async () => {
	for (const host of hosts) {
		await host.close();
		rmSync(host.folder, { recursive: true, force: true });
	}
});

interface Answer {
	status: number;
	body: any;
	headers: Headers;
}

/** A request as the app sends one: its session's token, and a JSON body or bytes. */
async function call(fake: FakeApi, token: string, method: string, path: string, body?: unknown): Promise<Answer> {
	const bytes = body instanceof Uint8Array;
	const response = await fake.fetch(`${FAKE_API_URL}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			"X-Duvet-Client": CLIENT,
			"Content-Type": bytes ? "application/octet-stream" : "application/json",
		},
		body: body instanceof Uint8Array ? body.slice() : body === undefined ? undefined : JSON.stringify(body),
	});
	const json = response.headers.get("Content-Type")?.includes("json");
	return {
		status: response.status,
		body: json ? await response.json() : new Uint8Array(await response.arrayBuffer()),
		headers: response.headers,
	};
}

/** A file's bytes: its route answers its signed URL (PLAN-E2E-API.md, I and J), which takes no session. */
async function download(fake: FakeApi, token: string, path: string): Promise<Uint8Array> {
	const { status, body } = await call(fake, token, "GET", path);
	expect({ status, url: typeof body.url }).toEqual({ status: 200, url: "string" });
	return new Uint8Array(await (await fake.fetch(body.url)).arrayBuffer());
}

interface Device {
	host: BunCoreHost;
	user: string;
	id: string;
	token: string;
	/** What its connection to the gateway heard. */
	heard: GatewayEvent[];
}

/** A device of user's: its core and its device made, the device registered and bound to a session, and connected. */
async function device(fake: FakeApi, user: string): Promise<Device> {
	const host = new BunCoreHost();
	hosts.push(host);
	expect(await host.open(user)).toEqual({ state: "ready", keyStorage: "provided" });
	const { token, device_challenge } = fake.signIn(user);
	const id = uuidv7();
	const keys = await host.handle<object>({ cmd: "create_device", user_id: user, device_id: id });
	const { proof } = await host.handle<{ proof: string }>({ cmd: "bind_proof", challenge: device_challenge });
	const registered = await call(fake, token, "POST", "/api/users/@me/devices", {
		device_id: id,
		name: "Duvet for Windows",
		...keys,
		proof,
	});
	expect(registered.status).toBe(201);
	const heard: GatewayEvent[] = [];
	fake.connect(token, id, (event) => heard.push(event));
	return { host, user, id, token, heard };
}

/** The device makes its user's identity and publishes it, as a first device does. */
async function publishIdentity(fake: FakeApi, d: Device) {
	const made = await d.host.handle<Record<string, string>>({ cmd: "create_identity" });
	const { identity_key, device_list, certificate, encrypted_identity, wrapped_backup_key } = made;
	const put = await call(fake, d.token, "PUT", "/api/users/@me/identity", {
		...{ identity_key, device_list, certificate, encrypted_identity, wrapped_backup_key, replaces: null },
	});
	expect(put.status).toBe(200);
	await d.host.handle({ cmd: "identity_uploaded" });
	await d.host.handle({ cmd: "device_list_uploaded", version: put.body.device_list_version });
	return { made, put };
}

/** The device observes user's identity as the API serves it. */
async function observe(fake: FakeApi, d: Device, user: string) {
	const { status, body } = await call(fake, d.token, "GET", `/api/users/${user}/identity`);
	expect(status).toBe(200);
	const { identity_key, device_list, certificates } = body;
	return d.host.handle<{ state: string }>({
		cmd: "observe_user",
		user_id: user,
		identity_key,
		device_list,
		certificates,
	});
}

interface KeyPackage {
	id: string;
	data: string;
	expires_at: number;
	last_resort: boolean;
}

/** The device's core makes its key packages (spending those the API handed out), and the device uploads them. */
async function uploadKeyPackages(fake: FakeApi, d: Device, spent?: string[]) {
	const { key_packages } = await d.host.handle<{ key_packages: KeyPackage[] }>({
		cmd: "key_packages",
		...(spent ? { spent } : {}),
	});
	const put = await call(fake, d.token, "PUT", "/api/users/@me/devices/@me/key-packages", { key_packages });
	expect(put.status).toBe(200);
	const handedOut: string[] = put.body.handed_out;
	return { key_packages, handed_out: handedOut };
}

/** A conversation as the API's list gives it to the device: its group as that device has it. */
async function conversationOf(fake: FakeApi, d: Device, id: string) {
	const { body } = await call(fake, d.token, "GET", CONVERSATIONS);
	return body.find((conversation: { id: string }) => conversation.id === id);
}

/** The device's core applies entries of the conversation's queue. */
const apply = (fake: FakeApi, d: Device, conversation: string, entries: unknown[]) =>
	d.host.handle<{ applied_through: number }>({
		cmd: "apply",
		conversation_id: conversation,
		entries,
		external_sender: fake.externalSender,
	});

/** A DM between Ana and Bo, a device each, and its group: made by Ana's device, joined by Bo's through its welcome. */
async function dmWithGroup() {
	const fake = new FakeApi();
	const [ana, bo] = [fake.addUser(), fake.addUser()];
	const a = await device(fake, ana);
	const b = await device(fake, bo);
	await publishIdentity(fake, a);
	await publishIdentity(fake, b);
	expect((await uploadKeyPackages(fake, b)).handed_out).toEqual([]);
	const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });

	// Ana's device makes the group: the members observed, and a key package claimed for each of their devices.
	await observe(fake, a, ana);
	expect((await observe(fake, a, bo)).state).toBe("new");
	const claimed = await call(fake, a.token, "POST", `/api/users/${bo}/key-packages/claim`);
	expect(claimed.body.key_packages.map((kp: { device_id: string }) => kp.device_id)).toEqual([b.id]);
	// The device that asks needs none of its own.
	expect((await call(fake, a.token, "POST", `/api/users/${ana}/key-packages/claim`)).body).toEqual({
		key_packages: [],
	});
	const shown = await conversationOf(fake, a, conversation);
	expect(shown).toMatchObject({ id: conversation, type: 1, legacy: false, mls: null });
	const made = await a.host.handle<Record<string, any>>({
		cmd: "create_group",
		conversation_id: conversation,
		kind: "dm",
		members: shown.members.map((member: { user_id: string }) => member.user_id),
		key_packages: { [bo]: claimed.body.key_packages.map((kp: { data: string }) => kp.data) },
		external_sender: fake.externalSender,
		legacy: false,
	});
	const { generation, commit, group_info, initial_group_info, welcome } = made;
	const committed = await call(fake, a.token, "POST", `${CONVERSATIONS}/${conversation}/mls/commits`, {
		...{ generation, epoch: 0, commit, group_info, initial_group_info, welcome },
	});
	expect(committed).toMatchObject({ status: 201, body: { seq: 1, generation: 0, epoch: 1, welcome_seq: 2 } });
	await a.host.handle({ cmd: "commit_result", conversation_id: conversation, accepted: true, seq: 1 });

	// Bo's device joins by the welcome, read from the number the API says it's been in the group since.
	const heard = b.heard.find((event) => event.type === "MLS_WELCOME");
	expect(heard?.data).toMatchObject({ conversation_id: conversation, generation: 0, epoch: 1, devices: [b.id] });
	const mine = await conversationOf(fake, b, conversation);
	expect(mine.mls).toEqual({ generation: 0, epoch: 1, last_seq: 2, floor_seq: 1, joined_seq: 2 });
	const queue = await call(fake, b.token, "GET", `${CONVERSATIONS}/${conversation}/mls/queue?after=1`);
	expect(queue.body.entries.map((entry: { seq: number; kind: string }) => [entry.seq, entry.kind])).toEqual([
		[2, "welcome"],
	]);
	await observe(fake, b, ana);
	await observe(fake, b, bo);
	expect((await apply(fake, b, conversation, queue.body.entries)).applied_through).toBe(2);
	return { fake, ana, bo, a, b, conversation };
}

/** The device sends a message: its core encrypts it, the API takes it, and the core binds it to its ID. */
async function send(fake: FakeApi, d: Device, conversation: string, text: string, extra: object = {}) {
	const nonce = crypto.randomUUID();
	const envelope = messageEnvelope(text, []);
	const { ciphertext } = await d.host.handle<{ ciphertext: string }>({
		...{ cmd: "encrypt", conversation_id: conversation, nonce, envelope },
	});
	const posted = await call(fake, d.token, "POST", `${CONVERSATIONS}/${conversation}/messages`, {
		...{ ciphertext, nonce, ...extra },
	});
	expect(posted.status).toBe(201);
	const { id, seq } = posted.body;
	await d.host.handle({ cmd: "sent", conversation_id: conversation, nonce, message_id: id, seq });
	return { nonce, ciphertext, message: posted.body };
}

/** A message as the queue's entry its event's object is (PLAN-E2E-CLIENTES.md, its engine's section on a conversation's queue). */
const messageEntry = (m: any) => ({
	...{ seq: m.seq, kind: "message", data: m.ciphertext, message_id: m.id },
	...{ sender_user: m.author_id, sender_device: m.sender_device_id, sent_at: m.sent_at },
});

describe.skipIf(!coreLibrary)("the fake API, with real cores", () => {
	test("two cores converse through the fake", async () => {
		const { fake, ana, bo, a, b, conversation } = await dmWithGroup();
		const group = await b.host.handle<{ members: { user_id: string }[] }>({
			cmd: "group",
			conversation_id: conversation,
		});
		expect(group.members.map((member) => member.user_id)).toEqual([ana, bo]);

		// Ana writes: Bo's device applies the message its event brings, and reads it.
		const { nonce, message } = await send(fake, a, conversation, "hello Bo");
		expect(message).toMatchObject({ seq: 3, author_id: ana, sender_device_id: a.id, nonce, content: null });
		const created = b.heard.find((event) => event.type === "DM_MESSAGE_CREATE")!.data;
		expect(created).toEqual(message);
		expect((await apply(fake, b, conversation, [messageEntry(created)])).applied_through).toBe(3);
		const read = await b.host.handle<{ messages: any[] }>({
			cmd: "messages",
			conversation_id: conversation,
			ids: [created.id],
		});
		expect(read.messages).toEqual([
			expect.objectContaining({
				message_id: created.id,
				seq: 3,
				text: "hello Bo",
				status: "ok",
				user_id: ana,
				device_id: a.id,
			}),
		]);

		// Bo sends a sticker: the empty envelope, the sticker in the clear. Ana's device reads it from the queue alone.
		const sticker = uuidv7();
		const { message: stuck } = await send(fake, b, conversation, "", { sticker_attachment_id: sticker });
		expect(stuck).toMatchObject({ seq: 4, sticker_attachment_id: sticker });
		const queue = await call(fake, a.token, "GET", `${CONVERSATIONS}/${conversation}/mls/queue?after=0`);
		expect(queue.body).toMatchObject({ last_seq: 4, floor_seq: 1, generation: 0, epoch: 1 });
		expect(queue.body.entries.map((entry: { seq: number; kind: string }) => [entry.seq, entry.kind])).toEqual([
			[1, "commit"],
			[2, "welcome"],
			[3, "message"],
			[4, "message"],
		]);
		expect((await apply(fake, a, conversation, queue.body.entries)).applied_through).toBe(4);
		const [shown] = (
			await a.host.handle<{ messages: any[] }>({ cmd: "messages", conversation_id: conversation, ids: [stuck.id] })
		).messages;
		expect(shown).toMatchObject({ text: null, attachments: [], status: "ok", user_id: bo });
		expect(drawnAs(shown, true)).toBe("sticker");
		// A page of the queue stops at its limit.
		const page = await call(fake, a.token, "GET", `${CONVERSATIONS}/${conversation}/mls/queue?after=1&limit=2`);
		expect(page.body.entries.map((entry: { seq: number }) => entry.seq)).toEqual([2, 3]);
	});

	test("one commit takes an epoch, and the same commit again gets the answer it got", async () => {
		const { fake, a, b, conversation } = await dmWithGroup();
		const path = `${CONVERSATIONS}/${conversation}/mls/commits`;
		const first = await a.host.handle<object>({ cmd: "refresh", conversation_id: conversation });
		const second = await b.host.handle<object>({ cmd: "refresh", conversation_id: conversation });
		const won = await call(fake, a.token, "POST", path, { generation: 0, epoch: 1, ...first });
		expect(won).toMatchObject({ status: 201, body: { seq: 3, generation: 0, epoch: 2 } });
		expect(won.body).not.toHaveProperty("welcome_seq");
		expect(await call(fake, b.token, "POST", path, { generation: 0, epoch: 1, ...second })).toMatchObject({
			status: 409,
			body: { error: "another commit took this epoch", generation: 0, epoch: 2 },
		});
		expect((await call(fake, a.token, "POST", path, { generation: 0, epoch: 1, ...first })).body).toEqual(won.body);
		// A commit whose framing isn't what the request says is refused before anything.
		expect((await call(fake, b.token, "POST", path, { generation: 0, epoch: 2, ...second })).status).toBe(400);
		expect(b.heard.filter((event) => event.type === "MLS_COMMIT").map((event) => event.data.epoch)).toEqual([1, 2]);

		await a.host.handle({ cmd: "commit_result", conversation_id: conversation, accepted: true, seq: 3 });
		await b.host.handle({ cmd: "commit_result", conversation_id: conversation, accepted: false });
		const queue = await call(fake, b.token, "GET", `${CONVERSATIONS}/${conversation}/mls/queue?after=2`);
		expect(queue.body).toMatchObject({ last_seq: 3, generation: 0, epoch: 2 });
		expect((await apply(fake, b, conversation, queue.body.entries)).applied_through).toBe(3);
		for (const d of [a, b]) {
			expect((await d.host.handle<{ epoch: number }>({ cmd: "group", conversation_id: conversation })).epoch).toBe(2);
		}
		const { message } = await send(fake, a, conversation, "after the commit");
		expect((await apply(fake, b, conversation, [messageEntry(message)])).applied_through).toBe(4);
	});

	test("a message's nonce answers with the message it sent, and its edit and deletion go in the queue", async () => {
		const { fake, a, b, conversation } = await dmWithGroup();
		const { nonce, ciphertext, message } = await send(fake, a, conversation, "once");
		const path = `${CONVERSATIONS}/${conversation}/messages`;
		expect(await call(fake, a.token, "POST", path, { ciphertext, nonce })).toMatchObject({
			status: 201,
			body: message,
		});
		const other = await a.host.handle<{ ciphertext: string }>({
			...{ cmd: "encrypt", conversation_id: conversation, nonce: crypto.randomUUID(), envelope: { text: "twice" } },
		});
		expect((await call(fake, a.token, "POST", path, { ciphertext: other.ciphertext, nonce })).status).toBe(409);
		// The conversation's text never goes in the clear.
		expect(
			(await call(fake, a.token, "POST", path, { content: "hi", ciphertext, nonce: crypto.randomUUID() })).body,
		).toEqual({
			error: "conversations are end-to-end encrypted",
		});
		expect(b.heard.filter((event) => event.type === "DM_MESSAGE_CREATE")).toHaveLength(1);

		const edit = await a.host.handle<{ ciphertext: string }>({
			...{ cmd: "edit", conversation_id: conversation, message_id: message.id, text: "once more" },
		});
		const edited = await call(fake, a.token, "PATCH", `${path}/${message.id}`, { ciphertext: edit.ciphertext });
		expect(edited).toMatchObject({
			status: 200,
			body: { id: message.id, entry: { seq: 4, kind: "edit", message_id: message.id } },
		});
		expect((await call(fake, a.token, "PATCH", `${path}/${message.id}`, { ciphertext: edit.ciphertext })).body).toEqual(
			edited.body,
		);
		expect((await call(fake, b.token, "PATCH", `${path}/${message.id}`, { ciphertext: edit.ciphertext })).status).toBe(
			403,
		);
		const tombstone = await a.host.handle<{ ciphertext: string }>({
			...{ cmd: "delete", conversation_id: conversation, message_id: message.id },
		});
		const deleted = await call(fake, a.token, "DELETE", `${path}/${message.id}`, { ciphertext: tombstone.ciphertext });
		expect(deleted).toMatchObject({ status: 200, body: { id: message.id, entry: { seq: 5, kind: "delete" } } });
		expect(b.heard.find((event) => event.type === "DM_MESSAGE_DELETE")?.data).toEqual({
			...{ id: message.id, conversation_id: conversation, entry: deleted.body.entry },
		});

		// The queue has the message and its edit emptied, and the deletion whole; Bo's core applies them all.
		const queue = (await call(fake, b.token, "GET", `${CONVERSATIONS}/${conversation}/mls/queue?after=2`)).body;
		expect(
			queue.entries.map((entry: any) => [entry.seq, entry.kind, entry.deleted ?? false, entry.data === ""]),
		).toEqual([
			[3, "message", true, true],
			[4, "edit", true, true],
			[5, "delete", false, false],
		]);
		expect((await apply(fake, b, conversation, queue.entries)).applied_through).toBe(5);
		expect((await call(fake, b.token, "GET", `${path}/deleted?after=0`)).body).toEqual({ ids: [message.id] });
	});

	test("a device list goes in only on top of the current one", async () => {
		const fake = new FakeApi();
		const ana = fake.addUser();
		const a = await device(fake, ana);
		await publishIdentity(fake, a);
		const path = "/api/users/@me/device-list";
		const second = await a.host.handle<{ device_list: string }>({ cmd: "sign_device_list", remove: [] });
		expect(await call(fake, a.token, "PUT", path, { device_list: second.device_list, base_version: 1 })).toMatchObject({
			status: 200,
			body: { version: 2 },
		});
		await a.host.handle({ cmd: "device_list_uploaded", version: 2 });
		// The current list again, byte for byte, is taken as it is.
		expect((await call(fake, a.token, "PUT", path, { device_list: second.device_list, base_version: 1 })).body).toEqual(
			{
				version: 2,
			},
		);
		await observe(fake, a, ana);
		const third = await a.host.handle<{ device_list: string }>({ cmd: "sign_device_list", remove: [] });
		expect(await call(fake, a.token, "PUT", path, { device_list: third.device_list, base_version: 1 })).toMatchObject({
			status: 409,
			body: { error: "device list changed", device_list: second.device_list, version: 2 },
		});
		expect((await call(fake, a.token, "PUT", path, { device_list: third.device_list, base_version: 2 })).body).toEqual({
			version: 3,
		});
		expect((await call(fake, a.token, "GET", `/api/users/${ana}/identity`)).body).toMatchObject({
			...{ user_id: ana, device_list: third.device_list, device_list_version: 3, active: true },
		});
		const updates = a.heard.filter((event) => event.type === "IDENTITY_UPDATE");
		expect(updates.map((event) => event.data.device_list_version)).toEqual([1, 2, 3]);
		// A list the identity didn't sign is refused whatever its versions say.
		const forged = {
			device_list: bytesBase64(base64Bytes(third.device_list).map((byte, i) => (i === 10 ? byte ^ 1 : byte))),
		};
		expect((await call(fake, a.token, "PUT", path, { ...forged, base_version: 3 })).status).toBe(400);
	});

	test("an identity goes up once, and another first device is told the one there is", async () => {
		const fake = new FakeApi();
		const ana = fake.addUser();
		const a = await device(fake, ana);
		const { made, put } = await publishIdentity(fake, a);
		const { identity_key, device_list, certificate, encrypted_identity, wrapped_backup_key } = made;
		const again = { identity_key, device_list, certificate, encrypted_identity, wrapped_backup_key, replaces: null };
		expect((await call(fake, a.token, "PUT", "/api/users/@me/identity", again)).body).toEqual(put.body);

		const a2 = await device(fake, ana);
		const other = await a2.host.handle<Record<string, string>>({ cmd: "create_identity" });
		const raced = await call(fake, a2.token, "PUT", "/api/users/@me/identity", {
			...{ identity_key: other.identity_key, device_list: other.device_list, certificate: other.certificate },
			...{ encrypted_identity: other.encrypted_identity, wrapped_backup_key: other.wrapped_backup_key, replaces: null },
		});
		expect(raced).toMatchObject({ status: 409, body: { error: "identity changed", identity_key } });
		expect((await call(fake, a2.token, "GET", "/api/users/@me/identity/backup")).body).toEqual({
			...{ identity_key, device_list, encrypted_identity, wrapped_backup_key, wrapped_previous_backup_keys: null },
		});
	});

	test("a key package is handed out once, and an upload names those handed out", async () => {
		const fake = new FakeApi();
		const [ana, bo, cy] = [fake.addUser(), fake.addUser(), fake.addUser()];
		const [a, b, c] = [await device(fake, ana), await device(fake, bo), await device(fake, cy)];
		for (const d of [a, b, c]) await publishIdentity(fake, d);
		fake.addConversation({ type: "dm", members: [ana, bo] });
		const { key_packages: set } = await uploadKeyPackages(fake, b);
		expect(set.filter((kp) => kp.last_resort)).toHaveLength(1);
		const claim = (d: Device) => call(fake, d.token, "POST", `/api/users/${bo}/key-packages/claim`);
		expect((await claim(c)).status).toBe(403); // Cy shares no conversation with Bo

		const claimed = [(await claim(a)).body.key_packages[0].data, (await claim(a)).body.key_packages[0].data];
		expect(claimed[0]).not.toBe(claimed[1]);
		const handedOut = set.filter((kp) => claimed.includes(kp.data)).map((kp) => kp.id);
		expect(handedOut).toHaveLength(2);
		// The same set again: the API names the two it handed out, which the core then spends, making two in their place.
		const put = await call(fake, b.token, "PUT", "/api/users/@me/devices/@me/key-packages", { key_packages: set });
		expect(put.body.handed_out.sort()).toEqual(handedOut.sort());
		const renewed = await uploadKeyPackages(fake, b, put.body.handed_out);
		expect(renewed.handed_out).toEqual([]);
		expect(renewed.key_packages.map((kp) => kp.id)).not.toContain(handedOut[0]);

		// The single-use ones run out, then the last resort goes again and again; under 20 left, the device hears it.
		const lastResort = renewed.key_packages.find((kp) => kp.last_resort)!.data;
		const given: string[] = [];
		for (let i = 0; i < 102; i++) given.push((await claim(a)).body.key_packages[0].data);
		expect(new Set(given.slice(0, 100)).size).toBe(100);
		expect(given.slice(0, 100)).not.toContain(lastResort);
		expect(given.slice(100)).toEqual([lastResort, lastResort]);
		const low = b.heard.filter((event) => event.type === "KEY_PACKAGES_LOW").map((event) => event.data);
		expect(low[0]).toEqual({ device_id: b.id, remaining: 19 });
		expect(a.heard.some((event) => event.type === "KEY_PACKAGES_LOW")).toBe(false);
	});

	test("the inbox hands out what came after, and deletes through what was handled", async () => {
		const fake = new FakeApi();
		const [ana, bo, cy] = [fake.addUser(), fake.addUser(), fake.addUser()];
		const [a, b, c] = [await device(fake, ana), await device(fake, bo), await device(fake, cy)];
		fake.addConversation({ type: "dm", members: [ana, bo] });
		// Another connection of Bo's, of no device: it hears its user's events, never a device's.
		const elsewhere: GatewayEvent[] = [];
		fake.connect(b.token, null, (event) => elsewhere.push(event));
		const to = `/api/devices/${b.id}/inbox`;
		const one = await call(fake, a.token, "POST", to, { message: btoa("one") });
		const two = await call(fake, a.token, "POST", to, { message: btoa("two") });
		expect([one.status, two.status]).toEqual([201, 201]);
		expect((await call(fake, c.token, "POST", to, { message: btoa("cy") })).status).toBe(403);
		expect(
			(await call(fake, a.token, "POST", to, { message: bytesBase64(new Uint8Array(64 * 1024 + 1)) })).status,
		).toBe(400);
		expect(b.heard.filter((event) => event.type === "DEVICE_MESSAGE").map((event) => event.data)).toEqual([
			{ device_id: b.id, id: one.body.id },
			{ device_id: b.id, id: two.body.id },
		]);

		const inbox = "/api/users/@me/devices/@me/inbox";
		const all = (await call(fake, b.token, "GET", inbox)).body;
		expect(all.map((m: any) => [m.id, m.from_user_id, m.from_device_id, atob(m.message)])).toEqual([
			[one.body.id, ana, a.id, "one"],
			[two.body.id, ana, a.id, "two"],
		]);
		expect((await call(fake, b.token, "GET", `${inbox}?after=${one.body.id}`)).body.map((m: any) => m.id)).toEqual([
			two.body.id,
		]);
		expect((await call(fake, b.token, "DELETE", `${inbox}?through=${one.body.id}`)).status).toBe(204);
		expect(elsewhere.map((event) => event.type)).toEqual(["READY"]);
		expect((await call(fake, b.token, "GET", inbox)).body.map((m: any) => m.id)).toEqual([two.body.id]);
	});

	test("a day's backup replaces only the copy it names", async () => {
		const { fake, a, conversation } = await dmWithGroup();
		const { message } = await send(fake, a, conversation, "kept in the backup");
		// The message's UTC day: backup_due lists a day once it ended, but any day seals.
		const day = new Date(message.sent_at).toISOString().slice(0, 10);
		const segment = await a.host.handle<{ data: string; key_id: string; complete: boolean; version: number }>({
			...{ cmd: "backup_segment", conversation_id: conversation, day },
		});
		const bytes = base64Bytes(segment.data);
		const path = `/api/users/@me/backup/segments/${conversation}/${day}`;
		const first = await call(fake, a.token, "PUT", `${path}?replaces=none`, bytes);
		expect(first.status).toBe(201);
		expect(await call(fake, a.token, "PUT", `${path}?replaces=none`, bytes)).toMatchObject({
			status: 409,
			body: { current: first.body.id },
		});
		const second = await call(fake, a.token, "PUT", `${path}?replaces=${first.body.id}`, bytes);
		expect(second.status).toBe(201);
		await a.host.handle({
			cmd: "backup_uploaded",
			conversation_id: conversation,
			day,
			complete: segment.complete,
			version: segment.version,
		});

		expect(
			(await call(fake, a.token, "GET", `/api/users/@me/backup/segments?conversation_id=${conversation}`)).body,
		).toEqual([
			{
				...{
					id: second.body.id,
					conversation_id: conversation,
					day,
					complete: segment.complete,
					key_id: segment.key_id,
				},
				...{ size: bytes.length, created_at: expect.any(String) },
			},
		]);
		expect(bytesBase64(await download(fake, a.token, `/api/users/@me/backup/segments/${second.body.id}`))).toBe(
			segment.data,
		);
		// The header names its conversation and its day: another route's isn't taken.
		expect(
			(
				await call(
					fake,
					a.token,
					"PUT",
					`/api/users/@me/backup/segments/${conversation}/2001-01-01?replaces=none`,
					bytes,
				)
			).status,
		).toBe(400);
	});

	test("a shared history goes up in parts, for its recipient's devices", async () => {
		const { fake, ana, bo, a, b, conversation } = await dmWithGroup();
		await send(fake, a, conversation, "shared with Bo");
		const certificates = (await call(fake, a.token, "GET", `/api/users/${bo}/identity`)).body.certificates;
		const made = await a.host.share({
			cmd: "history_share",
			conversation_id: conversation,
			to_user: bo,
			range: "all",
			devices: certificates,
		});
		expect(made.keys.map((key) => key.device_id)).toEqual([b.id]);
		const share = `${CONVERSATIONS}/${conversation}/history-shares/${made.share_id}`;
		const about = {
			to_user_id: bo,
			kind: "share",
			range: "all",
			starts_at: made.start,
			size: made.size,
			parts: made.parts,
		};
		expect((await call(fake, a.token, "PUT", share, about)).status).toBe(201);
		expect((await call(fake, a.token, "POST", `${share}/complete`)).status).toBe(409); // its parts aren't up yet
		for (let n = 0; n < made.parts; n++) {
			expect(
				(await call(fake, a.token, "PUT", `${share}/parts/${n}`, await a.host.sharePart(made.share_id, n))).status,
			).toBe(204);
		}
		expect((await call(fake, a.token, "POST", `${share}/complete`)).status).toBe(204);
		for (const key of made.keys) {
			expect(
				(await call(fake, a.token, "POST", `/api/devices/${key.device_id}/inbox`, { message: key.message })).status,
			).toBe(201);
		}
		await a.host.dropShare(made.share_id);

		// Bo's device hears of it, takes its key from the inbox and its parts from the API, imports it, and says so.
		expect(b.heard.find((event) => event.type === "HISTORY_SHARE_CREATE")?.data).toMatchObject({
			...{
				id: made.share_id,
				conversation_id: conversation,
				from_user_id: ana,
				kind: "share",
				range: "all",
				parts: made.parts,
			},
		});
		const notice = b.heard.find((event) => event.type === "DM_MESSAGE_CREATE" && event.data.type === 4)?.data;
		expect(notice).toMatchObject({ author_id: ana, history_share: { to_user_id: bo, range: "all" } });
		expect(notice).not.toHaveProperty("seq");
		expect((await call(fake, b.token, "GET", "/api/users/@me/history-shares")).body.map((s: any) => s.id)).toEqual([
			made.share_id,
		]);
		const from = (await call(fake, b.token, "GET", `/api/users/${ana}/identity`)).body.certificates[0];
		for (const message of (await call(fake, b.token, "GET", "/api/users/@me/devices/@me/inbox")).body) {
			expect(
				await b.host.handle<{ type: string }>({
					cmd: "receive_direct",
					message: message.message,
					from_certificate: from,
				}),
			).toMatchObject({
				type: "history.key",
			});
		}
		const parts: Uint8Array[] = [];
		for (let n = 0; n < made.parts; n++) {
			parts.push(await download(fake, b.token, `/api/history-shares/${made.share_id}/parts/${n}`));
		}
		expect(await b.host.importShare(made.share_id, parts)).toEqual({ imported: expect.any(Number) });
		expect((await call(fake, b.token, "POST", `/api/history-shares/${made.share_id}/ack`)).status).toBe(204);
		expect((await call(fake, b.token, "GET", "/api/users/@me/history-shares")).body).toEqual([]);
	});

	test("a device registers once, then binds each new session", async () => {
		const fake = new FakeApi();
		const [ana, bo] = [fake.addUser(), fake.addUser()];
		const a = await device(fake, ana);
		expect(await a.host.handle<object>({ cmd: "status" })).toMatchObject({ user_id: ana, device_id: a.id });

		const again = fake.signIn(ana);
		expect((await call(fake, again.token, "GET", "/api/users/@me/devices")).body).toEqual([
			expect.objectContaining({ id: a.id, name: "Duvet for Windows", listed: false, current: false }),
		]);
		// A proof over another session's challenge doesn't bind this one.
		const stale = await a.host.handle<{ proof: string }>({
			cmd: "bind_proof",
			challenge: fake.signIn(ana).device_challenge,
		});
		expect(await call(fake, again.token, "POST", `/api/users/@me/devices/${a.id}/bind`, stale)).toMatchObject({
			status: 403,
			body: { error: "the proof doesn't verify" },
		});
		const proof = await a.host.handle<{ proof: string }>({ cmd: "bind_proof", challenge: again.device_challenge });
		expect((await call(fake, again.token, "POST", `/api/users/@me/devices/${a.id}/bind`, proof)).status).toBe(204);
		expect((await call(fake, again.token, "GET", "/api/users/@me/devices")).body).toEqual([
			expect.objectContaining({ id: a.id, current: true }),
		]);
		// Its ID is its own: another user's registration of it is refused.
		const b = new BunCoreHost();
		hosts.push(b);
		await b.open(bo);
		const theirs = fake.signIn(bo);
		const made = await b.handle<object>({ cmd: "create_device", user_id: bo, device_id: a.id });
		const { proof: bos } = await b.handle<{ proof: string }>({ cmd: "bind_proof", challenge: theirs.device_challenge });
		expect(
			await call(fake, theirs.token, "POST", "/api/users/@me/devices", {
				device_id: a.id,
				name: "Duvet",
				...made,
				proof: bos,
			}),
		).toMatchObject({
			status: 409,
			body: { error: "device id in use" },
		});
		// A device on its user's list goes only by a list without it.
		await publishIdentity(fake, a);
		expect(await call(fake, a.token, "DELETE", `/api/users/@me/devices/${a.id}`)).toMatchObject({
			status: 409,
			body: { error: "sign a device list without it" },
		});
	});
});

describe.skipIf(!coreLibrary)("the fake's switches", () => {
	test("a lost answer leaves its work done", async () => {
		const fake = new FakeApi();
		const ana = fake.addUser();
		const a = await device(fake, ana);
		const made = await a.host.handle<Record<string, string>>({ cmd: "create_identity" });
		const { identity_key, device_list, certificate, encrypted_identity, wrapped_backup_key } = made;
		const body = { identity_key, device_list, certificate, encrypted_identity, wrapped_backup_key, replaces: null };
		fake.loseAnswer({ method: "PUT", path: "/api/users/@me/identity" });
		await expect(call(fake, a.token, "PUT", "/api/users/@me/identity", body)).rejects.toThrow(TypeError);
		expect((await call(fake, a.token, "GET", `/api/users/${ana}/identity`)).body).toMatchObject({ identity_key });
		// The same upload again is the identity there is: 200, as it would have been.
		expect(await call(fake, a.token, "PUT", "/api/users/@me/identity", body)).toMatchObject({
			status: 200,
			body: { device_list_version: 1 },
		});
	});

	test("426, 503 and 409 answer as the API does, and change nothing", async () => {
		const { fake, a, b, conversation } = await dmWithGroup();
		const path = `${CONVERSATIONS}/${conversation}/messages`;
		const { ciphertext } = await a.host.handle<{ ciphertext: string }>({
			...{ cmd: "encrypt", conversation_id: conversation, nonce: crypto.randomUUID(), envelope: { text: "later" } },
		});
		const message = { ciphertext, nonce: crypto.randomUUID() };
		fake.refuse({ method: "POST", path }, 503);
		const paused = await call(fake, a.token, "POST", path, message);
		expect(paused).toMatchObject({ status: 503, body: { error: "encrypted conversations are paused" } });
		expect(paused.headers.get("Retry-After")).toBe("60");
		fake.refuse({ path }, 426);
		expect(await call(fake, a.token, "POST", path, message)).toMatchObject({
			status: 426,
			body: { error: "update Duvet", client: null, minimum: null },
		});
		fake.refuse({ path: /\/messages$/ }, 409, { error: "stale message", generation: 0, epoch: 1 });
		expect(await call(fake, a.token, "POST", path, message)).toMatchObject({
			status: 409,
			body: { error: "stale message" },
		});
		expect(b.heard.filter((event) => event.type === "DM_MESSAGE_CREATE")).toEqual([]);
		// Each switch answered once: the message goes now, the next number of the queue.
		expect(await call(fake, a.token, "POST", path, message)).toMatchObject({ status: 201, body: { seq: 3 } });
	});

	test("events can wait, then come backwards or twice, and an entry can come without its data", async () => {
		const { fake, a, b, conversation } = await dmWithGroup();
		fake.holdEvents();
		const first = await send(fake, a, conversation, "first");
		const second = await send(fake, a, conversation, "second");
		const before = b.heard.length;
		fake.releaseEvents({ order: "reverse", repeat: true });
		expect(b.heard.slice(before).map((event) => event.data.id)).toEqual([
			second.message.id,
			second.message.id,
			first.message.id,
			first.message.id,
		]);

		fake.stripData = true;
		const refresh = await a.host.handle<object>({ cmd: "refresh", conversation_id: conversation });
		const committed = await call(fake, a.token, "POST", `${CONVERSATIONS}/${conversation}/mls/commits`, {
			...{ generation: 0, epoch: 1, ...refresh },
		});
		const event = b.heard.findLast((heard) => heard.type === "MLS_COMMIT")!;
		expect(event.data.entry).toMatchObject({ seq: committed.body.seq, kind: "commit" });
		expect(event.data.entry).not.toHaveProperty("data");
		// The queue still has it whole.
		const queue = (
			await call(fake, b.token, "GET", `${CONVERSATIONS}/${conversation}/mls/queue?after=${committed.body.seq - 1}`)
		).body;
		expect(queue.entries[0].data).toBeString();
	});
});

describe.skipIf(!coreLibrary)("the fake answers as the API does", () => {
	test("held events are what each request saved", async () => {
		const { fake, a, b, conversation } = await dmWithGroup();
		fake.holdEvents();
		const { message } = await send(fake, a, conversation, "first words");
		const path = `${CONVERSATIONS}/${conversation}/messages/${message.id}`;
		const edit = await a.host.handle<{ ciphertext: string }>({
			...{ cmd: "edit", conversation_id: conversation, message_id: message.id, text: "second words" },
		});
		await call(fake, a.token, "PATCH", path, { ciphertext: edit.ciphertext });
		const tombstone = await a.host.handle<{ ciphertext: string }>({
			...{ cmd: "delete", conversation_id: conversation, message_id: message.id },
		});
		await call(fake, a.token, "DELETE", path, { ciphertext: tombstone.ciphertext });
		const before = b.heard.length;
		fake.releaseEvents();
		const [created, updated] = b.heard.slice(before);
		expect(created).toMatchObject({
			type: "DM_MESSAGE_CREATE",
			data: { id: message.id, ciphertext: message.ciphertext },
		});
		expect(updated).toMatchObject({
			type: "DM_MESSAGE_UPDATE",
			data: { entry: { kind: "edit", data: edit.ciphertext } },
		});
		expect(updated?.data.entry).not.toHaveProperty("deleted");
	});

	test("a client without encryption is told to update, but for the configuration and the list", async () => {
		const fake = new FakeApi();
		const { token } = fake.signIn(fake.addUser());
		const ask = async (client?: string, path = "/api/users/@me/devices") => {
			const headers = { Authorization: `Bearer ${token}`, ...(client ? { "X-Duvet-Client": client } : {}) };
			const response = await fake.fetch(`${FAKE_API_URL}${path}`, { headers });
			return { status: response.status, body: await response.json() };
		};
		const update = (client: string | null, minimum: string | null) => ({
			status: 426,
			body: { error: "update Duvet", client, minimum },
		});
		expect(await ask()).toEqual(update(null, null));
		expect(await ask("desktop-windows/1.2")).toEqual(update(null, null));
		expect(await ask("desktop-linux/1.2.0")).toEqual(update("desktop-linux/1.2.0", null));
		fake.minClients = { ...fake.minClients, "desktop-windows": "1.2.0" };
		expect(await ask("desktop-windows/1.1.9")).toEqual(update("desktop-windows/1.1.9", "1.2.0"));
		expect(await ask("desktop-windows/1.10.0")).toEqual({ status: 200, body: [] });
		expect(await ask(undefined, "/api/e2e")).toMatchObject({ status: 200, body: { min_clients: fake.minClients } });
		expect(await ask(undefined, CONVERSATIONS)).toEqual({ status: 200, body: [] });
	});

	test("a request's answer comes before its events", async () => {
		const { fake, a, b, conversation } = await dmWithGroup();
		const order: string[] = [];
		fake.connect(b.token, b.id, (event) => {
			if (event.type !== "READY") order.push(event.type);
		});
		const { ciphertext } = await a.host.handle<{ ciphertext: string }>({
			...{
				cmd: "encrypt",
				conversation_id: conversation,
				nonce: crypto.randomUUID(),
				envelope: { text: "the answer first" },
			},
		});
		const response = await fake.fetch(`${FAKE_API_URL}${CONVERSATIONS}/${conversation}/messages`, {
			method: "POST",
			headers: { Authorization: `Bearer ${a.token}`, "X-Duvet-Client": CLIENT, "Content-Type": "application/json" },
			body: JSON.stringify({ ciphertext, nonce: crypto.randomUUID() }),
		});
		order.push(`answer ${response.status}`);
		await Promise.resolve();
		expect(order).toEqual(["answer 201", "DM_MESSAGE_CREATE"]);
	});

	test("the bodies the API's binding refuses are a 400", async () => {
		const fake = new FakeApi();
		const a = await device(fake, fake.addUser());
		const made = await a.host.handle<Record<string, string>>({ cmd: "create_identity" });
		const { identity_key, device_list, certificate, encrypted_identity, wrapped_backup_key } = made;
		const identity = { identity_key, device_list, certificate, encrypted_identity, wrapped_backup_key, replaces: null };
		const big = bytesBase64(new Uint8Array(64 * 1024 + 1));
		for (const transfers of [
			"all",
			[null],
			[{ device_id: a.id, certificate, message: "not base64!" }],
			[{ device_id: a.id, certificate, message: big }],
		]) {
			expect((await call(fake, a.token, "PUT", "/api/users/@me/identity", { ...identity, transfers })).status).toBe(
				400,
			);
		}
		expect((await call(fake, a.token, "PUT", "/api/users/@me/identity", identity)).status).toBe(200);
		const { key_packages } = await a.host.handle<{ key_packages: KeyPackage[] }>({ cmd: "key_packages" });
		const [first] = key_packages;
		const path = "/api/users/@me/devices/@me/key-packages";
		for (const body of [{}, { key_packages: [{ ...first, id: "" }] }, { key_packages: [{ ...first, data: "" }] }]) {
			expect((await call(fake, a.token, "PUT", path, body)).status).toBe(400);
		}
	});

	test("a device with nothing to hand out hears it, at 0", async () => {
		const fake = new FakeApi();
		const [ana, bo] = [fake.addUser(), fake.addUser()];
		const [a, b] = [await device(fake, ana), await device(fake, bo)];
		for (const d of [a, b]) await publishIdentity(fake, d);
		fake.addConversation({ type: "dm", members: [ana, bo] });
		expect((await call(fake, a.token, "POST", `/api/users/${bo}/key-packages/claim`)).body).toEqual({
			key_packages: [],
		});
		const low = b.heard.filter((event) => event.type === "KEY_PACKAGES_LOW").map((event) => event.data);
		expect(low).toEqual([{ device_id: b.id, remaining: 0 }]);
	});

	test("a rotation's transfer takes the place of the device's earlier one, outside the inbox's cap", async () => {
		const fake = new FakeApi();
		const ana = fake.addUser();
		const a = await device(fake, ana);
		const { made } = await publishIdentity(fake, a);
		// A second device of Ana's, which the first approves by its QR and which lists itself.
		const a2 = await device(fake, ana);
		const { qr } = await a2.host.handle<{ qr: string }>({ cmd: "approval_begin" });
		const approved = await a.host.handle<{ certificate: string; device_list: string }>({ cmd: "approval_from_qr", qr });
		const list = { device_list: approved.device_list, base_version: 1, certificate: approved.certificate };
		expect((await call(fake, a2.token, "PUT", "/api/users/@me/device-list", list)).body).toEqual({ version: 2 });
		await a.host.handle({ cmd: "device_list_uploaded", version: 2 });
		await observe(fake, a, ana);
		// Its inbox is full of what was sent to it.
		const inbox = `/api/devices/${a2.id}/inbox`;
		const sent: string[] = [];
		for (let i = 0; i < 1000; i++)
			sent.push((await call(fake, a.token, "POST", inbox, { message: btoa(`${i}`) })).body.id);
		expect((await call(fake, a.token, "POST", inbox, { message: btoa("one more") })).status).toBe(409);
		// A rotation's transfer goes in all the same, and the same rotation sent again puts its new one in that one's place.
		const certificates = (await call(fake, a.token, "GET", `/api/users/${ana}/identity`)).body.certificates;
		const transferred: string[] = [];
		for (let round = 0; round < 2; round++) {
			const r = await a.host.handle<Record<string, any>>({ cmd: "rotate_keys", remove: [], certificates });
			const transfers = r.transfers.map((t: any) => ({
				device_id: t.device_id,
				certificate: t.certificate,
				message: t.transfer,
			}));
			const put = await call(fake, a.token, "PUT", "/api/users/@me/identity", {
				...{ identity_key: r.identity_key, device_list: r.device_list, certificate: r.certificate, transfers },
				...{ encrypted_identity: r.encrypted_identity, wrapped_backup_key: r.wrapped_backup_key },
				...{ wrapped_previous_backup_keys: r.wrapped_previous_backup_keys, replaces: made.identity_key },
			});
			expect(put.status).toBe(200);
			const waiting = (await call(fake, a2.token, "GET", `/api/users/@me/devices/@me/inbox?after=${sent.at(-1)}`)).body;
			expect(waiting).toHaveLength(1);
			transferred.push(waiting[0].id);
		}
		expect(transferred[0]).not.toBe(transferred[1]);
		expect((await call(fake, a.token, "POST", inbox, { message: btoa("still full") })).status).toBe(409);
	});

	test("a reset keeps each device's joined_seq, and a message of the generation before is stale", async () => {
		const { fake, bo, a, b, conversation } = await dmWithGroup();
		const old = await a.host.handle<{ ciphertext: string }>({
			...{
				cmd: "encrypt",
				conversation_id: conversation,
				nonce: crypto.randomUUID(),
				envelope: { text: "before the reset" },
			},
		});
		const claimed = await call(fake, a.token, "POST", `/api/users/${bo}/key-packages/claim`);
		const reset = await a.host.handle<Record<string, any>>({
			...{ cmd: "reset_group", conversation_id: conversation },
			key_packages: { [bo]: claimed.body.key_packages.map((kp: { data: string }) => kp.data) },
		});
		const { generation, commit, group_info, initial_group_info, welcome } = reset;
		const committed = await call(fake, a.token, "POST", `${CONVERSATIONS}/${conversation}/mls/commits`, {
			...{ generation, epoch: 0, commit, group_info, initial_group_info, welcome },
		});
		expect(committed).toMatchObject({ status: 201, body: { seq: 3, generation: 1, epoch: 1, welcome_seq: 4 } });
		expect((await conversationOf(fake, a, conversation)).mls).toMatchObject({ generation: 1, joined_seq: 1 });
		expect((await conversationOf(fake, b, conversation)).mls).toMatchObject({ generation: 1, joined_seq: 2 });
		const stale = await call(fake, a.token, "POST", `${CONVERSATIONS}/${conversation}/messages`, {
			...{ ciphertext: old.ciphertext, nonce: crypto.randomUUID() },
		});
		expect(stale).toMatchObject({ status: 409, body: { error: "stale message", generation: 1, epoch: 1 } });
	});

	test("a message's entry says whom it mentions and what it answers", async () => {
		const { fake, ana, a, b, conversation } = await dmWithGroup();
		const { message: first } = await send(fake, a, conversation, "first");
		const stranger = "0193a4b2-0000-7000-8000-00000000dead";
		const { message: reply } = await send(fake, b, conversation, `<@${ana}> yes`, {
			...{ mentions: [ana, stranger], message_reference: { message_id: first.id } },
		});
		// Ana's device reads the queue from its start, as its core has applied none of it.
		const { entries } = (await call(fake, a.token, "GET", `${CONVERSATIONS}/${conversation}/mls/queue?after=0`)).body;
		const [firstEntry, replyEntry] = entries.slice(2);
		expect(firstEntry).toMatchObject({ message_id: first.id });
		expect(firstEntry).not.toHaveProperty("mentions");
		expect(firstEntry).not.toHaveProperty("reply_to");
		expect(replyEntry).toMatchObject({ message_id: reply.id, mentions: [ana], reply_to: first.id });
		// The core takes the entry as the queue gives it, and keeps what the message answers.
		expect((await apply(fake, a, conversation, entries)).applied_through).toBe(4);
		const read = await a.host.handle<{ messages: any[] }>({
			cmd: "messages",
			conversation_id: conversation,
			ids: [reply.id],
		});
		expect(read.messages).toEqual([expect.objectContaining({ text: `<@${ana}> yes`, reply_to: first.id })]);
	});

	test("an entry past 16 KiB comes without its data, which the queue has", async () => {
		const { fake, a, b, conversation } = await dmWithGroup();
		const { message } = await send(fake, a, conversation, "short");
		const edit = await a.host.handle<{ ciphertext: string }>({
			...{ cmd: "edit", conversation_id: conversation, message_id: message.id, text: "x".repeat(20_000) },
		});
		const path = `${CONVERSATIONS}/${conversation}/messages/${message.id}`;
		const { entry } = (await call(fake, a.token, "PATCH", path, { ciphertext: edit.ciphertext })).body;
		const event = b.heard.find((heard) => heard.type === "DM_MESSAGE_UPDATE")!;
		expect(event.data.entry).toMatchObject({ seq: entry.seq, kind: "edit" });
		expect(event.data.entry).not.toHaveProperty("data");
		const queue = (
			await call(fake, b.token, "GET", `${CONVERSATIONS}/${conversation}/mls/queue?after=${entry.seq - 1}`)
		).body;
		expect(queue.entries[0].data).toBe(edit.ciphertext);
	});

	test("a commit with no group to go on, and a message from a device without a leaf, are refused", async () => {
		const fake = new FakeApi();
		const [ana, bo] = [fake.addUser(), fake.addUser()];
		const [a, b] = [await device(fake, ana), await device(fake, bo)];
		for (const d of [a, b]) await publishIdentity(fake, d);
		const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
		for (const user of [ana, bo]) await observe(fake, a, user);
		// A group of Ana's device alone: no key package of Bo's goes in.
		const made = await a.host.handle<Record<string, any>>({
			...{ cmd: "create_group", conversation_id: conversation, kind: "dm", members: [ana, bo], key_packages: {} },
			...{ external_sender: fake.externalSender, legacy: false },
		});
		const path = `${CONVERSATIONS}/${conversation}/mls/commits`;
		const { commit, group_info, initial_group_info, welcome } = made;
		// Without epoch 0's group info, it isn't a creation: it goes on a group there isn't.
		expect(await call(fake, a.token, "POST", path, { generation: 0, epoch: 0, commit, group_info })).toMatchObject({
			status: 409,
			body: { error: "no group yet" },
		});
		const created = await call(fake, a.token, "POST", path, {
			generation: 0,
			epoch: 0,
			commit,
			group_info,
			initial_group_info,
			welcome,
		});
		expect(created.status).toBe(201);
		await a.host.handle({ cmd: "commit_result", conversation_id: conversation, accepted: true, seq: created.body.seq });
		const { ciphertext } = await a.host.handle<{ ciphertext: string }>({
			...{
				cmd: "encrypt",
				conversation_id: conversation,
				nonce: crypto.randomUUID(),
				envelope: { text: "only Ana's device" },
			},
		});
		const refused = await call(fake, b.token, "POST", `${CONVERSATIONS}/${conversation}/messages`, {
			...{ ciphertext, nonce: crypto.randomUUID() },
		});
		expect(refused).toMatchObject({ status: 403, body: { error: "this device isn't in the group" } });
	});
});
