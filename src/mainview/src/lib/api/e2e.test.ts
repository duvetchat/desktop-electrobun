import { describe, expect, spyOn, test } from "bun:test";
import {
	FetchError,
	MAX_REQUEST_BYTES,
	type ApiClient,
	type FetchRequestConfig,
	type FetchResponse,
} from "$lib/api/api";
import { FakeApi } from "$lib/e2e/testing/fake-api";
import { e2eApi, type E2eApi } from "./e2e";

// The routes of end-to-end encryption (PLAN-E2E-API.md, «Rutas», A to K), as the engine reaches them: each sends what
// its table says (the API's code on its e2e branch, where it has the route) and gives back what the API answers.

const CONV = "0193a4b2-0000-7000-8000-0000000c0001";
const USER = "0193a4b2-0000-7000-8000-00000000a0a0";
const OTHER = "0193a4b2-0000-7000-8000-00000000b0b0";
const DEVICE = "0193a4b2-0000-7000-8000-0000000d0001";
const MESSAGE = "0193a4b2-0000-7000-8000-0000000e0001";
const SHARE = "0193a4b2-0000-7000-8000-0000000f0001";
const SEGMENT = "0193a4b2-0000-7000-8000-000000050001";
const conv = `/api/users/@me/conversations/${CONV}`;

/** A fetch's URL, whatever form it was given in. */
const urlOf = (input: string | URL | Request) => (input instanceof Request ? input.url : input.toString());

/** A request as the engine's client got it. */
interface Call {
	method: string;
	url: string;
	data?: unknown;
	config?: FetchRequestConfig;
}

/** A client that answers every request with `answer`, and keeps each request. */
function recording(answer: unknown) {
	const calls: Call[] = [];
	const respond = async (method: string, url: string, data?: unknown, config?: FetchRequestConfig) => {
		calls.push({ method, url, ...(data === undefined ? {} : { data }), ...(config === undefined ? {} : { config }) });
		const res: FetchResponse = { data: answer, status: 200, statusText: "OK", headers: new Headers() };
		return res;
	};
	const client: ApiClient = {
		get: (url, config) => respond("GET", url, undefined, config),
		delete: (url, config) => respond("DELETE", url, undefined, config),
		head: (url, config) => respond("HEAD", url, undefined, config),
		options: (url, config) => respond("OPTIONS", url, undefined, config),
		post: (url, data, config) => respond("POST", url, data, config),
		put: (url, data, config) => respond("PUT", url, data, config),
		patch: (url, data, config) => respond("PATCH", url, data, config),
	};
	return { calls, client };
}

const commit = { generation: 0, epoch: 3, commit: "Y29tbWl0", group_info: "aW5mbw==" };
const taken = { seq: 9, generation: 0, epoch: 4 };
const entry = { seq: 9, kind: "edit", data: "ZWRpdA==", sent_at: 1_764_000_000_000, generation: 0, epoch: 4 };
const device = {
	id: DEVICE,
	name: "Duvet for Windows",
	client: "desktop-windows/1.2.0",
	listed: false,
	created_at: "2026-11-25T00:00:00Z",
	last_seen_at: "2026-11-25T00:00:00Z",
	current: true,
};
const identity = {
	user_id: USER,
	identity_key: "a2V5",
	device_list: "bGlzdA==",
	device_list_version: 1,
	certificates: ["Y2VydA=="],
	active: true,
	changed_at: "2026-11-25T00:00:00Z",
};
const segmentBytes = new Blob([new Uint8Array([0xa1, 0x00, 0xff])]);

/** A file's bytes at the signed URL its route answers. */
const FILE = new Uint8Array([0xa1, 0x00, 0xff]);

/** Each route: what it's called with, what it sends, what the API answers, and what it gives back (the answer, nothing
 *  for one that answers nothing, or the file at the URL it answers). */
const ROUTES: [
	name: string,
	call: (api: E2eApi) => Promise<unknown>,
	sent: Call,
	answer: unknown,
	gives?: "nothing" | "file",
][] = [
	// A. The configuration.
	[
		"config",
		(api) => api.config(),
		{ method: "GET", url: "/api/e2e" },
		{ external_sender: "c2VuZGVy", cutover_at: null, paused: false, min_clients: { web: "1.2.0" }, limits: {} },
	],
	// B. Devices and the session's binding.
	[
		"deviceChallenge",
		(api) => api.deviceChallenge(),
		{ method: "POST", url: "/api/users/@me/devices/challenge" },
		{ device_challenge: "Y2hhbGxlbmdl" },
	],
	[
		"registerDevice",
		(api) =>
			api.registerDevice({
				device_id: DEVICE,
				name: "Duvet for Windows",
				signature_key: "c2ln",
				hpke_key: "aHBrZQ==",
				proof: "cHJvb2Y=",
			}),
		{
			method: "POST",
			url: "/api/users/@me/devices",
			data: {
				device_id: DEVICE,
				name: "Duvet for Windows",
				signature_key: "c2ln",
				hpke_key: "aHBrZQ==",
				proof: "cHJvb2Y=",
			},
		},
		device,
	],
	[
		"bindDevice",
		(api) => api.bindDevice(DEVICE, "cHJvb2Y="),
		{ method: "POST", url: `/api/users/@me/devices/${DEVICE}/bind`, data: { proof: "cHJvb2Y=" } },
		null,
		"nothing",
	],
	["devices", (api) => api.devices(), { method: "GET", url: "/api/users/@me/devices" }, [device]],
	[
		"deleteDevice",
		(api) => api.deleteDevice(DEVICE),
		{ method: "DELETE", url: `/api/users/@me/devices/${DEVICE}` },
		null,
		"nothing",
	],
	// C. The identity and its device list.
	[
		"putIdentity",
		(api) =>
			api.putIdentity({
				identity_key: "a2V5",
				device_list: "bGlzdA==",
				certificate: "Y2VydA==",
				encrypted_identity: "aWRlbnRpdHk=",
				wrapped_backup_key: "d3JhcHBlZA==",
				replaces: null,
			}),
		{
			method: "PUT",
			url: "/api/users/@me/identity",
			data: {
				identity_key: "a2V5",
				device_list: "bGlzdA==",
				certificate: "Y2VydA==",
				encrypted_identity: "aWRlbnRpdHk=",
				wrapped_backup_key: "d3JhcHBlZA==",
				replaces: null,
			},
		},
		{ identity_id: "0193a4b2-0000-7000-8000-000000001d01", device_list_version: 1 },
	],
	[
		"putDeviceList",
		(api) => api.putDeviceList({ device_list: "bGlzdA==", base_version: 1, certificate: "Y2VydA==" }),
		{
			method: "PUT",
			url: "/api/users/@me/device-list",
			data: { device_list: "bGlzdA==", base_version: 1, certificate: "Y2VydA==" },
		},
		{ version: 2 },
	],
	["identity", (api) => api.identity(USER), { method: "GET", url: `/api/users/${USER}/identity` }, identity],
	[
		"identities",
		(api) => api.identities([USER, OTHER]),
		{ method: "GET", url: "/api/users/identities", config: { params: { ids: `${USER},${OTHER}` } } },
		[identity],
	],
	[
		"identityBackup",
		(api) => api.identityBackup(),
		{ method: "GET", url: "/api/users/@me/identity/backup" },
		{
			identity_key: "a2V5",
			device_list: "bGlzdA==",
			encrypted_identity: "aWRlbnRpdHk=",
			wrapped_backup_key: "d3JhcHBlZA==",
			wrapped_previous_backup_keys: null,
		},
	],
	// D. Key packages.
	[
		"putKeyPackages",
		(api) => api.putKeyPackages([{ id: "a3A=", data: "ZGF0YQ==", expires_at: 1_770_000_000_000, last_resort: true }]),
		{
			method: "PUT",
			url: "/api/users/@me/devices/@me/key-packages",
			data: { key_packages: [{ id: "a3A=", data: "ZGF0YQ==", expires_at: 1_770_000_000_000, last_resort: true }] },
		},
		{ handed_out: ["a3A="] },
	],
	[
		"claimKeyPackages",
		(api) => api.claimKeyPackages(OTHER),
		{ method: "POST", url: `/api/users/${OTHER}/key-packages/claim` },
		{ key_packages: [{ device_id: DEVICE, data: "ZGF0YQ==" }] },
	],
	// E. A conversation's group.
	[
		"groupInfo",
		(api) => api.groupInfo(CONV),
		{ method: "GET", url: `${conv}/mls/group-info` },
		{ generation: 0, epoch: 3, group_info: "aW5mbw==" },
	],
	[
		"commit",
		(api) => api.commit(CONV, { ...commit, initial_group_info: "aW5pdA==", welcome: "d2VsY29tZQ==" }),
		{
			method: "POST",
			url: `${conv}/mls/commits`,
			data: { ...commit, initial_group_info: "aW5pdA==", welcome: "d2VsY29tZQ==" },
		},
		{ ...taken, welcome_seq: 10 },
	],
	[
		"queue",
		(api) => api.queue(CONV, 8, 200),
		{ method: "GET", url: `${conv}/mls/queue`, config: { params: { after: 8, limit: 200 } } },
		{ entries: [entry], last_seq: 9, floor_seq: 1, generation: 0, epoch: 4 },
	],
	// F. Members.
	[
		"addMember",
		(api) => api.addMember(CONV, OTHER, { ...commit, welcome: "d2VsY29tZQ==" }),
		{ method: "POST", url: `${conv}/members`, data: { user_id: OTHER, ...commit, welcome: "d2VsY29tZQ==" } },
		{ id: "0193a4b2-0000-7000-8000-00000000ee01", conversation_id: CONV, user_id: OTHER, commit: taken },
	],
	[
		"removeMember",
		(api) => api.removeMember(CONV, OTHER, commit),
		{ method: "DELETE", url: `${conv}/members/${OTHER}`, config: { data: commit } },
		taken,
	],
	[
		"leave, from a conversation with a group",
		(api) => api.leave(CONV, "c3RhdGVtZW50"),
		{ method: "DELETE", url: `${conv}/members/@me`, config: { data: { statement: "c3RhdGVtZW50" } } },
		null,
		"nothing",
	],
	[
		"leave, from one without",
		(api) => api.leave(CONV),
		{ method: "DELETE", url: `${conv}/members/@me` },
		null,
		"nothing",
	],
	// G. Messages.
	[
		"sendMessage",
		(api) =>
			api.sendMessage(CONV, {
				ciphertext: "Y2lwaGVy",
				nonce: "f3c1d7a2-5b6e-4c8d-9e0f-1a2b3c4d5e6f",
				mentions: [OTHER],
				message_reference: { message_id: MESSAGE },
				allowed_mentions: { replied_user: false },
			}),
		{
			method: "POST",
			url: `${conv}/messages`,
			data: {
				ciphertext: "Y2lwaGVy",
				nonce: "f3c1d7a2-5b6e-4c8d-9e0f-1a2b3c4d5e6f",
				mentions: [OTHER],
				message_reference: { message_id: MESSAGE },
				allowed_mentions: { replied_user: false },
			},
		},
		{ id: MESSAGE, conversation_id: CONV, author_id: USER, content: null, type: 0, seq: 12 },
	],
	[
		"editMessage",
		(api) => api.editMessage(CONV, MESSAGE, "ZWRpdA=="),
		{ method: "PATCH", url: `${conv}/messages/${MESSAGE}`, data: { ciphertext: "ZWRpdA==" } },
		{ id: MESSAGE, edited_at: "2026-11-25T00:00:01Z", entry },
	],
	[
		"deleteMessage",
		(api) => api.deleteMessage(CONV, MESSAGE, "ZGVsZXRl"),
		{ method: "DELETE", url: `${conv}/messages/${MESSAGE}`, config: { data: { ciphertext: "ZGVsZXRl" } } },
		{ id: MESSAGE, entry: { ...entry, kind: "delete" } },
	],
	[
		"message",
		(api) => api.message(CONV, MESSAGE),
		{ method: "GET", url: `${conv}/messages/${MESSAGE}` },
		{ id: MESSAGE, conversation_id: CONV },
	],
	[
		"deletedMessages",
		(api) => api.deletedMessages(CONV, MESSAGE, 1000),
		{ method: "GET", url: `${conv}/messages/deleted`, config: { params: { after: MESSAGE, limit: 1000 } } },
		{ ids: [MESSAGE] },
	],
	// H. The inbox between devices.
	[
		"sendToDevice",
		(api) => api.sendToDevice(DEVICE, "bWVzc2FnZQ=="),
		{ method: "POST", url: `/api/devices/${DEVICE}/inbox`, data: { message: "bWVzc2FnZQ==" } },
		{ id: "0193a4b2-0000-7000-8000-000000001b01" },
	],
	[
		"inbox",
		(api) => api.inbox(MESSAGE, 100),
		{ method: "GET", url: "/api/users/@me/devices/@me/inbox", config: { params: { after: MESSAGE, limit: 100 } } },
		[{ id: MESSAGE, from_user_id: OTHER, from_device_id: DEVICE, message: "bWVzc2FnZQ==", created_at: "" }],
	],
	[
		"clearInbox",
		(api) => api.clearInbox(MESSAGE),
		{ method: "DELETE", url: "/api/users/@me/devices/@me/inbox", config: { params: { through: MESSAGE } } },
		null,
		"nothing",
	],
	// I. Shared history.
	[
		"putShare",
		(api) =>
			api.putShare(CONV, SHARE, {
				to_user_id: OTHER,
				kind: "share",
				range: "week",
				starts_at: "2025-11-13T02:13:20.000Z",
				size: 4096,
				parts: 1,
			}),
		{
			method: "PUT",
			url: `${conv}/history-shares/${SHARE}`,
			data: {
				...{ to_user_id: OTHER, kind: "share", range: "week", starts_at: "2025-11-13T02:13:20.000Z" },
				...{ size: 4096, parts: 1 },
			},
		},
		null,
		"nothing",
	],
	[
		"putSharePart",
		(api) => api.putSharePart(CONV, SHARE, 0, segmentBytes),
		{ method: "PUT", url: `${conv}/history-shares/${SHARE}/parts/0`, data: segmentBytes },
		null,
		"nothing",
	],
	[
		"completeShare",
		(api) => api.completeShare(CONV, SHARE),
		{ method: "POST", url: `${conv}/history-shares/${SHARE}/complete` },
		null,
		"nothing",
	],
	[
		"shares",
		(api) => api.shares(),
		{ method: "GET", url: "/api/users/@me/history-shares" },
		[
			{
				id: SHARE,
				conversation_id: CONV,
				from_user_id: OTHER,
				kind: "share",
				range: "week",
				starts_at: "2025-11-13T02:13:20Z",
				size: 4096,
				parts: 1,
			},
		],
	],
	[
		"sharePart",
		(api) => api.sharePart(SHARE, 0),
		{ method: "GET", url: `/api/history-shares/${SHARE}/parts/0` },
		{ url: "https://storage.test/part?signature=s" },
		"file",
	],
	[
		"ackShare",
		(api) => api.ackShare(SHARE),
		{ method: "POST", url: `/api/history-shares/${SHARE}/ack` },
		null,
		"nothing",
	],
	// J. The encrypted backup.
	[
		"segments",
		(api) => api.segments({ conversation_id: CONV, after: SEGMENT }),
		{
			method: "GET",
			url: "/api/users/@me/backup/segments",
			config: { params: { conversation_id: CONV, after: SEGMENT } },
		},
		[{ id: SEGMENT, conversation_id: CONV, day: "2026-11-24", complete: true, key_id: "a2V5aWQ=", size: 3 }],
	],
	[
		"putSegment, replacing the copy it saw",
		(api) => api.putSegment(CONV, "2026-11-24", segmentBytes, SEGMENT),
		{
			method: "PUT",
			url: `/api/users/@me/backup/segments/${CONV}/2026-11-24`,
			data: segmentBytes,
			config: { params: { replaces: SEGMENT } },
		},
		{ id: "0193a4b2-0000-7000-8000-000000050002" },
	],
	[
		"putSegment, with none seen",
		(api) => api.putSegment(CONV, "2026-11-24", segmentBytes, null),
		{
			method: "PUT",
			url: `/api/users/@me/backup/segments/${CONV}/2026-11-24`,
			data: segmentBytes,
			config: { params: { replaces: "none" } },
		},
		{ id: "0193a4b2-0000-7000-8000-000000050002" },
	],
	[
		"segment",
		(api) => api.segment(SEGMENT),
		{ method: "GET", url: `/api/users/@me/backup/segments/${SEGMENT}` },
		{ url: "https://storage.test/segment?signature=s" },
		"file",
	],
	// K. Decryption failures.
	[
		"reportDecryptFailure",
		(api) => api.reportDecryptFailure("envelope", 2),
		{ method: "POST", url: "/api/e2e/decrypt-failures", data: { kind: "envelope", count: 2 } },
		null,
		"nothing",
	],
	[
		"decryptFailures",
		(api) => api.decryptFailures("2026-11-01", "2026-11-25"),
		{
			method: "GET",
			url: "/api/internal/e2e/decrypt-failures",
			config: { params: { from: "2026-11-01", to: "2026-11-25" } },
		},
		[{ day: "2026-11-24", kind: "envelope", client: "web", version: "1.2.0", count: 2 }],
	],
];

describe("each route", () => {
	for (const [name, call, sent, answer, gives] of ROUTES) {
		test(`${name} sends what its table says and gives back its answer`, async () => {
			const { calls, client } = recording(answer);
			// The storage's host, which only a file's route reaches, and then at the URL the API answered.
			const fetched = spyOn(globalThis, "fetch").mockImplementation(
				(async (_input: string | URL | Request) => new Response(FILE)) as typeof fetch,
			);
			try {
				const got = await call(e2eApi(client));
				expect(calls).toEqual([sent]);
				if (gives === "nothing") expect(got).toBeUndefined();
				else if (gives === "file") expect(got).toEqual(FILE);
				else expect(got).toBe(answer);
				const fetchedUrls: unknown[] = fetched.mock.calls.map(([input]) => urlOf(input));
				// Through the API itself (stream=1), never a redirect to its storage.
				expect(fetchedUrls).toEqual(
					gives === "file"
						? [typeof answer === "object" && answer && "url" in answer ? `${answer.url}&stream=1` : null]
						: [],
				);
			} finally {
				fetched.mockRestore();
			}
		});
	}

	// A message with files goes as a form (PLAN-E2E-API.md, G): its fields, each mention and file ID its own field, the
	// reply and its mentions as JSON, and the sealed files in the order their IDs name them.
	test("sendMessage with files sends them in a form, after their IDs", async () => {
		const { calls, client } = recording({ id: MESSAGE });
		const [first, second] = [new Blob([new Uint8Array([1])]), new Blob([new Uint8Array([2, 2])])];
		const progress = () => {};
		await e2eApi(client).sendMessage(
			CONV,
			{
				ciphertext: "Y2lwaGVy",
				nonce: "n",
				mentions: [OTHER, USER],
				message_reference: { message_id: MESSAGE },
				allowed_mentions: { replied_user: true },
				sticker_attachment_id: SEGMENT,
				attachment_ids: [SHARE, SEGMENT],
			},
			[first, second],
			{ onUploadProgress: progress },
		);
		expect(calls).toHaveLength(1);
		const { method, url, data, config } = calls[0]!;
		expect([method, url, config]).toEqual(["POST", `${conv}/messages`, { onUploadProgress: progress }]);
		if (!(data instanceof FormData)) throw new Error("not a form");
		// A file by its size: Bun's FormData types every value as a string.
		const fields = [...data.entries()].map(([key, value]: [string, unknown]) => [
			key,
			value instanceof Blob ? value.size : value,
		]);
		expect(fields).toEqual([
			["ciphertext", "Y2lwaGVy"],
			["nonce", "n"],
			["mentions", OTHER],
			["mentions", USER],
			["message_reference", JSON.stringify({ message_id: MESSAGE })],
			["allowed_mentions", JSON.stringify({ replied_user: true })],
			["sticker_attachment_id", SEGMENT],
			["attachment_ids", SHARE],
			["attachment_ids", SEGMENT],
			["files", 1],
			["files", 2],
		]);
	});
});

// A part of a shared history and a day of the backup come from the signed URL their route answers (PLAN-E2E-API.md, I
// and J): fetched with none of the app's headers, which a redirect would have carried to the storage's host, the session
// token among them. The API's is a path of its own (storage.SignedAttachmentURL), on the API's host, not the page's.
describe("a file at its signed URL", () => {
	const SIGNED = `/attachments/${SEGMENT}?sig=s&exp=1763000000`;
	// Asked of the API itself (stream=1), its signed query as the API wrote it.
	const FETCHED = `https://api.test${SIGNED}&stream=1`;
	const appHeaders = ["Authorization", "X-Session-Token", "X-Duvet-Client"];

	test("is fetched with none of the app's headers, after the API's route with them all", async () => {
		localStorage.setItem("duvet_session_token", "access");
		localStorage.setItem("duvet_refresh_token", "session");
		const sent: { url: string; init?: RequestInit }[] = [];
		const fetched = spyOn(globalThis, "fetch").mockImplementation((async (
			input: string | URL | Request,
			init?: RequestInit,
		) => {
			const url = urlOf(input);
			sent.push({ url, init });
			return url === FETCHED ? new Response(FILE) : Response.json({ url: SIGNED });
		}) as typeof fetch);
		try {
			expect(await e2eApi().segment(SEGMENT)).toEqual(FILE);
			expect(sent.map(({ url }) => url)).toEqual([
				`https://api.test/api/users/@me/backup/segments/${SEGMENT}`,
				FETCHED,
			]);
			const [route, file] = sent.map(({ init }) => new Headers(init?.headers));
			for (const name of appHeaders) expect([name, route!.has(name)]).toEqual([name, true]);
			for (const name of appHeaders) expect([name, file!.has(name)]).toEqual([name, false]);
			expect(sent[1]?.init?.credentials).toBe("omit");
		} finally {
			fetched.mockRestore();
			localStorage.clear();
		}
	});

	// Task 30: a package's part is a megabyte and its tag at most, as the core seals it; a server that sends more makes
	// the page hold nothing past that.
	test("of a package's part, past a part's size, is refused", async () => {
		const fetched = spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request) =>
			urlOf(input) === FETCHED
				? new Response(new Uint8Array((1 << 20) + 17))
				: Response.json({ url: SIGNED })) as typeof fetch);
		try {
			expect(
				await e2eApi()
					.sharePart(SHARE, 0)
					.catch((e: unknown) => e),
			).toBeInstanceOf(RangeError);
		} finally {
			fetched.mockRestore();
		}
	});

	// Task 32's review, I2: a day of the backup is what the API keeps of one at most, its 32 MiB; a server that sends more
	// makes the page hold nothing past that, as the restore runs at every start.
	test("of a day of the backup, past the API's 32 MiB, is refused", async () => {
		const fetched = spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request) =>
			urlOf(input) === FETCHED
				? new Response(new Uint8Array(MAX_REQUEST_BYTES + 1))
				: Response.json({ url: SIGNED })) as typeof fetch);
		try {
			expect(
				await e2eApi()
					.segment(SEGMENT)
					.catch((e: unknown) => e),
			).toBeInstanceOf(RangeError);
		} finally {
			fetched.mockRestore();
		}
	});

	test("that the storage refuses fails with its status", async () => {
		const fetched = spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request) =>
			urlOf(input) === FETCHED
				? new Response("expired", { status: 403 })
				: Response.json({ url: SIGNED })) as typeof fetch);
		try {
			const failure = await e2eApi()
				.sharePart(SHARE, 0)
				.catch((e: unknown) => e);
			expect(failure).toBeInstanceOf(FetchError);
			expect(failure).toMatchObject({ response: { status: 403 } });
		} finally {
			fetched.mockRestore();
		}
	});
});

// The fake API (testing/fake-api.ts) is the API as every engine test meets it: each route the app's own client sends,
// with what it says it is, reaches the fake's route of the same method and path, which knows it by its rules (a 401, a
// 403 or a 400 for what a test didn't set up), not as no route at all, and not as a client to update.
test("every route reaches the fake API's, with the app's client and session", async () => {
	const fake = new FakeApi();
	const { token } = fake.signIn(fake.addUser());
	localStorage.setItem("duvet_session_token", token);
	const fetched = spyOn(globalThis, "fetch").mockImplementation(fake.fetch as typeof fetch);
	try {
		const api = e2eApi();
		const missed: string[] = [];
		// The staff's route has no fake: no engine reads it.
		for (const [name, call] of ROUTES.filter(([route]) => route !== "decryptFailures")) {
			const outcome = await call(api).then(
				() => null,
				(error: { response?: FetchResponse }) => error.response,
			);
			if (outcome?.status === 426 || outcome?.data?.error === "no such route")
				missed.push(`${name}: ${outcome.status}`);
		}
		expect(missed).toEqual([]);
	} finally {
		fetched.mockRestore();
		localStorage.clear();
	}
});
