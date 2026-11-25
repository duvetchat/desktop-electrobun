// The API as the encryption engine sees it, in memory, for the engine's tests (PLAN-E2E-CLIENTES.md, Task 6): step 3's
// routes (PLAN-E2E-API.md, its routes A to K) answering through `fetch` as the API does, with its events to each
// connection, and switches that lose an answer, answer 426, 503, 409 or any refusal, hold events to let them go
// backwards, twice or a kind at a time, and take an entry's data out of its event. A request's events go out after its
// answer: once fetch has handed the answer back (or failed, when it's lost), on the microtask queue, so the code that
// awaited it runs first, and each is its data as it was when the request sent it; holdEvents gives any other order. It
// reads what the core signs (CBOR, Ed25519) and an MLS message's framing as the API does, but runs no validator: a
// commit is taken by its generation and epoch alone, and of what it changes the fake knows only the devices its welcome
// brings and the one an external commit adds.
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { base64Bytes } from "$lib/activity-thumbnail";
import { bytesBase64 } from "$lib/staged-images";
import { asBytes, asMap, asUuid, cbor, type Cbor } from "../cbor";
import { uuidv7 } from "../uuid";

/** Where the fake answers: any origin does, only the path counts. */
export const FAKE_API_URL = "https://fake-api.test";
/** A file's signed URL, as the API answers it: a path of its own (storage.SignedAttachmentURL), on the API's host. */
const signedPath = (file: string) => `/attachments/${file}?sig=fake`;

/** What a connection to the gateway hears: a dispatch's type and data. */
export interface GatewayEvent {
	type: string;
	data: any;
}

/** Which requests a switch takes: its method (any without one) and its path, as written or by a pattern. */
export interface RouteMatch {
	method?: string;
	path: string | RegExp;
}

interface Answer {
	status: number;
	body?: unknown;
	headers?: Record<string, string>;
}

/** A refusal a route answers with, thrown from anywhere in it. */
class Refusal extends Error {
	constructor(readonly answer: Answer) {
		super(`${answer.status}`);
	}
}
const fail = (status: number, error: string, extra: object = {}) => new Refusal({ status, body: { error, ...extra } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID_PATH = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

// The API's limits (its GET /api/e2e gives them out), in bytes but for the counts.
const LIMITS = {
	ciphertext_bytes: 32 << 10,
	key_packages: 100,
	last_resort_key_packages: 1,
	key_package_bytes: 4 << 10,
	inbox_message_bytes: 64 << 10,
	history_share_parts: 64,
	history_share_part_bytes: (1 << 20) + 16,
	group_members: 20,
	listed_devices: 20,
	commit_bytes: 256 << 10,
	welcome_bytes: 1 << 20,
	group_info_bytes: 1 << 20,
	encrypted_identity_bytes: 1 << 10,
	wrapped_backup_key_bytes: 1 << 10,
	wrapped_previous_backup_keys_bytes: 64 << 10,
	certificate_bytes: 1 << 10,
	device_list_bytes: 4 << 10,
	epochs_behind: 5,
};
/** An event carries an entry's data up to this much; past it the client reads the entry from the queue. */
const MAX_EVENT_DATA = 16 << 10;
/** A key package is handed out only with this much of its life left. */
const KEY_PACKAGE_MARGIN = 24 * 3600 * 1000;
/** Under this many single-use key packages left to hand out, a device hears KEY_PACKAGES_LOW. */
const KEY_PACKAGES_LOW = 20;
const INBOX_MAX = 1000;

// The labels the core signs its objects under: a signature covers label || 0x00 || body.
const LABEL = {
	certificate: "duvet device certificate v1",
	list: "duvet device list v1",
	leave: "duvet leave v1",
	bind: "duvet device bind v1",
};

// ---------------------------------------------------------------------------------------------------------------------
// What the fake reads of what the core makes.

const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i]);
const base64url = (bytes: Uint8Array) => bytesBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A signed object's body, once its Ed25519 signature over label || 0x00 || body verifies with key; else null. */
function signedBody(label: string, signed: Uint8Array, key: Uint8Array): Map<string, Cbor> | null {
	const object = asMap(cbor(signed));
	const body = asBytes(object?.get("body"));
	const sig = asBytes(object?.get("sig"), 64);
	if (!body || !sig || key.length !== 32) return null;
	const message = new Uint8Array([...new TextEncoder().encode(label), 0, ...body]);
	try {
		const publicKey = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: base64url(key) }, format: "jwk" });
		if (!verify(null, message, publicKey, sig)) return null;
	} catch {
		return null; // a key that isn't one verifies nothing
	}
	const fields = asMap(cbor(body));
	return fields?.get("v") === 1 ? fields : null;
}

interface Certificate {
	user: string;
	device: string;
	signatureKey: Uint8Array;
	hpkeKey: Uint8Array;
}

function readCertificate(signed: Uint8Array, identityKey: Uint8Array): Certificate | null {
	const body = signedBody(LABEL.certificate, signed, identityKey);
	const [user, device] = [asUuid(body?.get("user")), asUuid(body?.get("device"))];
	const [signatureKey, hpkeKey] = [asBytes(body?.get("signature_key"), 32), asBytes(body?.get("hpke_key"), 32)];
	return user && device && signatureKey && hpkeKey ? { user, device, signatureKey, hpkeKey } : null;
}

interface DeviceList {
	user: string;
	version: number;
	devices: string[];
}

function readDeviceList(signed: Uint8Array, identityKey: Uint8Array): DeviceList | null {
	const body = signedBody(LABEL.list, signed, identityKey);
	const user = asUuid(body?.get("user"));
	const key = asBytes(body?.get("identity_key"), 32);
	const version = body?.get("version");
	const listed = body?.get("devices");
	if (!user || !key || !equal(key, identityKey) || typeof version !== "number" || !Array.isArray(listed)) return null;
	// The devices are in order, each once.
	const devices: string[] = [];
	for (const raw of listed) {
		const device = asUuid(raw);
		if (!device || device <= (devices.at(-1) ?? "")) return null;
		devices.push(device);
	}
	return { user, version, devices };
}

interface Framing {
	wire: number;
	conversation?: string;
	generation?: number;
	epoch?: number;
	/** A public message's sender type: 1 a member, 2 an external sender, 4 a new member's own commit. */
	sender?: number;
	/** A private message's content type: 1 an application message. */
	content?: number;
	/** A welcome's new members, by their key packages' refs in base64 (the IDs key_packages gives them). */
	welcomed?: string[];
}
const PUBLIC = 1;
const PRIVATE = 2;
const WELCOME = 3;
const GROUP_INFO = 4;

/** What the API reads of an MLS message (RFC 9420): its wire format, and its group, epoch and sender or content. */
function framing(data: Uint8Array): Framing | null {
	const reader = (bytes: Uint8Array) => {
		let at = 0;
		const take = (n: number) => {
			if (at + n > bytes.length) throw new Error("cut short");
			return bytes.subarray(at, (at += n));
		};
		const uint = (n: number) => take(n).reduce((value, byte) => value * 256 + byte, 0);
		// A vector's length takes 1, 2 or 4 bytes, as its first two bits say.
		const vector = () => {
			const first = uint(1);
			const more = [0, 1, 3][first >> 6];
			if (more === undefined) throw new Error("a length MLS never takes");
			return take(more ? (first & 0x3f) * 256 ** more + uint(more) : first);
		};
		return { uint, vector, left: () => bytes.length - at };
	};
	try {
		const r = reader(data);
		if (r.uint(2) !== 1) return null;
		const wire = r.uint(2);
		if (wire === GROUP_INFO) return { wire };
		if (wire === WELCOME) {
			r.uint(2); // its cipher suite
			const secrets = reader(r.vector());
			const welcomed: string[] = [];
			while (secrets.left() > 0) {
				welcomed.push(bytesBase64(secrets.vector()));
				secrets.vector(); // the KEM output
				secrets.vector(); // the sealed group secrets
			}
			return { wire, welcomed };
		}
		if (wire !== PUBLIC && wire !== PRIVATE) return null;
		const group = r.vector();
		if (group.length !== 20) return null;
		const epoch = r.uint(8);
		const conversation = asUuid(group.subarray(0, 16))!;
		const generation = group.subarray(16).reduce((value, byte) => value * 256 + byte, 0);
		return wire === PUBLIC
			? { wire, conversation, generation, epoch, sender: r.uint(1) }
			: { wire, conversation, generation, epoch, content: r.uint(1) };
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------------------------------------------------
// What a request sends, read as the API reads it: a refusal for anything else.

/** A request's binary field, standard base64, as its text: from min bytes to max once decoded. */
function base64In(value: unknown, field: string, max = Infinity, min = 0): string {
	if (typeof value !== "string" || !BASE64.test(value)) throw fail(400, `${field} isn't base64`);
	const length = base64Bytes(value).length;
	if (length > max) throw fail(400, `${field} is ${max} bytes at most`);
	if (length < min) throw fail(400, `${field} is ${min} bytes at least`);
	return value;
}
const bytesIn = (value: unknown, field: string, max = Infinity, min = 0) =>
	base64Bytes(base64In(value, field, max, min));
function uuidIn(value: unknown, field: string): string {
	if (typeof value !== "string" || !UUID.test(value)) throw fail(400, `${field} isn't a UUID`);
	return value;
}
/** An RFC 3339 time, as Go binds a time.Time (a number among what it refuses): the instant in UTC, as the API gives it. */
function timeIn(value: unknown, field: string): string {
	const rfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;
	const at = typeof value === "string" && rfc3339.test(value) ? Date.parse(value) : NaN;
	if (Number.isNaN(at)) throw fail(400, `${field} isn't an RFC 3339 time`);
	return new Date(at).toISOString();
}
/**
 * A form as the API binds an encrypted message's (gin's form binding): each field's first value, the lists' all of them
 * (mentions, attachment_ids), the reply and its allowed mentions from their JSON, and the files' bytes in their order.
 */
async function formBody(bytes: Uint8Array<ArrayBuffer>, type: string): Promise<Record<string, unknown>> {
	const form = await new Response(bytes, { headers: { "Content-Type": type } }).formData();
	const text = (value: FormDataEntryValue | undefined) => (typeof value === "string" ? value : "");
	const body: Record<string, unknown> = {};
	for (const field of new Set(form.keys())) {
		const values = form.getAll(field);
		if (field === "files") {
			// As Go's multipart reader takes them: a part without a file name is no file.
			const named = values.filter((value): value is File => typeof value !== "string" && value.name !== "");
			body.files = await Promise.all(named.map(async (value) => new Uint8Array(await value.arrayBuffer())));
		} else if (field === "mentions" || field === "attachment_ids") body[field] = values.map(text);
		else if (field === "message_reference" || field === "allowed_mentions") {
			try {
				body[field] = JSON.parse(text(values[0]));
			} catch {
				throw fail(400, `${field} isn't JSON`);
			}
		} else body[field] = text(values[0]);
	}
	return body;
}

function numberIn(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
		throw fail(400, `${field} isn't a number`);
	return value;
}

/** A rotation's transfers, as the API binds them: an array of objects, each a device, its certificate and its message. */
function transfersIn(value: unknown): { device_id: string; certificate: string; message: string }[] {
	if (value == null) return [];
	if (!Array.isArray(value)) throw fail(400, "transfers is an array");
	return value.map((transfer: any) => {
		if (typeof transfer !== "object" || !transfer || Array.isArray(transfer))
			throw fail(400, "a transfer is an object");
		return {
			device_id: uuidIn(transfer.device_id, "transfers.device_id"),
			certificate: base64In(transfer.certificate, "transfers.certificate", LIMITS.certificate_bytes, 1),
			message: base64In(transfer.message, "transfers.message", LIMITS.inbox_message_bytes, 1),
		};
	});
}

// The platforms X-Duvet-Client names, as the API has them.
const PLATFORMS = ["desktop-windows", "desktop-macos", "desktop-linux", "web", "android", "ios"];

/** A version as the API reads one: major.minor.patch, each part 1 to 4 decimal digits; null for anything else. */
function versionIn(text: string): number[] | null {
	const parts = text.split(".");
	return parts.length === 3 && parts.every((part) => /^\d{1,4}$/.test(part)) ? parts.map(Number) : null;
}

/** What X-Duvet-Client says the client is, <platform>/<version>, as the API reads it; null for anything else. */
function clientIn(header: string | null): { platform: string; version: number[] } | null {
	const [, platform = "", text = ""] = /^([^/]*)\/(.*)$/s.exec(header ?? "") ?? [];
	const version = versionIn(text);
	return version && PLATFORMS.includes(platform) ? { platform, version } : null;
}

/** Whether a version is the least one or a later one. */
function atLeast(version: number[], least: number[]) {
	const at = version.findIndex((part, i) => part !== least[i]);
	return at < 0 || version[at]! > least[at]!;
}

// ---------------------------------------------------------------------------------------------------------------------
// The fake's state.

interface Session {
	user: string;
	token: string;
	challenge: Uint8Array;
	device: string | null;
}

interface Device {
	id: string;
	user: string;
	name: string;
	client: string | null;
	signatureKey: Uint8Array;
	hpkeKey: Uint8Array;
	certificate: Uint8Array | null;
	/** The identity that certified it. */
	certifiedBy: string | null;
	listed: boolean;
	removed: boolean;
	created_at: string;
}

interface Identity {
	id: string;
	identityKey: Uint8Array;
	deviceList: Uint8Array;
	version: number;
	encrypted_identity: string;
	wrapped_backup_key: string;
	wrapped_previous_backup_keys: string | null;
	changed_at: string;
}

interface KeyPackage {
	data: string;
	expiresAt: number;
	lastResort: boolean;
	handedOut: boolean;
}

interface Member {
	id: string;
	conversation_id: string;
	user_id: string;
	created_at: string;
	updated_at: string;
}

interface Entry {
	seq: number;
	kind: "commit" | "welcome" | "proposal" | "message" | "edit" | "delete";
	data: string;
	sent_at: number;
	generation: number;
	epoch: number;
	message_id?: string;
	sender_user?: string;
	sender_device?: string;
	statement?: string;
	deleted?: boolean;
	mentions?: string[];
	reply_to?: string;
}

interface Message {
	id: string;
	conversation_id: string;
	author_id: string;
	content: null;
	type: number;
	created_at: string;
	updated_at: string;
	nonce?: string;
	ciphertext?: string | null;
	seq?: number;
	sent_at?: number;
	generation?: number;
	epoch?: number;
	sender_device_id?: string;
	edited_at?: string | null;
	mentions?: string[];
	message_reference?: unknown;
	sticker_attachment_id?: string | null;
	attachments?: FileRow[];
	history_share?: { to_user_id: string; range: string };
}

/** A message's file as the API keeps one it hasn't opened (kind 1), and lists it, signed. */
interface FileRow {
	id: string;
	message_id: string | null;
	filename: "file";
	content_type: "application/octet-stream";
	size_bytes: number;
	width: null;
	height: null;
	created_at: string;
	deleted_at: null;
	kind: 1;
	url: string;
}

interface Conversation {
	id: string;
	type: 1 | 2;
	owner_id: string;
	created_at: string;
	legacy: boolean;
	members: Member[];
	group: { generation: number; epoch: number; group_info: string } | null;
	/** The last number its queue gave: commits, welcomes, proposals, edits, deletions and messages share it. */
	seq: number;
	/** The number its queue is whole from: what comes before it is gone (expireQueue). */
	floor: number;
	entries: Entry[];
	messages: Message[];
	deleted: Set<string>;
	/** The devices with a leaf in its group, by the number of the entry they have had it from. */
	leaves: Map<string, number>;
	/** What each commit taken answered, by its bytes: the same commit again gets it. */
	commits: Map<string, { seq: number; generation: number; epoch: number; welcome_seq?: number }>;
}

interface Segment {
	id: string;
	identity: string;
	conversation_id: string;
	day: string;
	complete: boolean;
	key_id: string;
	size: number;
	created_at: string;
	file: string;
}

interface Share {
	id: string;
	conversation_id: string;
	from_user_id: string;
	from_device_id: string;
	to_user_id: string;
	kind: "share" | "catch_up";
	range: string;
	starts_at: string;
	size: number;
	parts: number;
	uploaded: Map<number, string>;
	completed: boolean;
	acked: Set<string>;
}

interface Connection {
	user: string;
	device: string | null;
	listener: (event: GatewayEvent) => void;
}

interface Context {
	session: Session;
	device: Device | null;
	params: Record<string, string>;
	query: URLSearchParams;
	body: any;
	bytes: Uint8Array<ArrayBuffer>;
	headers: Headers;
	/** Its files go up, and nothing else is done (cutAfterFiles). */
	filesOnly: boolean;
}

type Needs = "nothing" | "session" | "device" | "listed";
/** A route: its method, its path, what its session needs, its handler, and whether any client may call it. */
type Route = [method: string, path: RegExp, needs: Needs, handler: (ctx: Context) => Answer, anyClient: boolean];

/** An event a request sends: to its user's connections, or to one device's. */
interface Outgoing {
	user: string;
	device?: string;
	event: GatewayEvent;
}

const now = () => new Date().toISOString();
const ok = (body: unknown, status = 200): Answer => ({ status, body });
const NO_CONTENT: Answer = { status: 204 };

export class FakeApi {
	/**
	 * The API's Ed25519 public key, its groups' one external sender, in base64 (GET /api/e2e's). A test that sets another
	 * plays a server that changed it: the fake checks no commit against it.
	 */
	externalSender: string;
	/** The cutover's instant, as GET /api/e2e gives it. */
	cutoverAt: string | null = null;
	/** Take every entry's data out of its event, as one past 16 KiB travels: the client reads it from the queue. */
	stripData = false;
	/** What POST /api/e2e/decrypt-failures was told. */
	readonly decryptFailures: { kind: string; count: number }[] = [];
	/**
	 * The lowest version of each platform with end-to-end encryption (E2E_MIN_CLIENTS), which GET /api/e2e gives out: a
	 * request from a client below it, or of a platform it doesn't name, gets a 426. Day one's platforms, any version.
	 */
	minClients: Record<string, string> = { "desktop-windows": "0.0.0", web: "0.0.0", android: "0.0.0" };

	#users = new Set<string>();
	#sessions = new Map<string, Session>();
	#devices = new Map<string, Device>();
	#identities = new Map<string, Identity>();
	#keyPackages = new Map<string, Map<string, KeyPackage>>();
	#conversations = new Map<string, Conversation>();
	#inboxes = new Map<
		string,
		{ id: string; from_user_id: string; from_device_id: string; message: string; created_at: string }[]
	>();
	#segments = new Map<string, Segment>();
	#shares = new Map<string, Share>();
	#files = new Map<string, Uint8Array<ArrayBuffer>>();
	/** Messages' files, by the ID their client gave them: whose they are, and what they're on (none yet). */
	#fileRows = new Map<string, { owner: string; row: FileRow }>();
	/** The most bytes one file takes, as Duvet's storage does: what goes up encrypted counts. */
	fileLimit = 20 << 20;
	/** The inbox messages that are a rotation's transfers, by ID. */
	#transfers = new Set<string>();
	/** What each message answers: the ID of the message it replies to, by its own. */
	#repliesTo = new Map<string, string>();
	#connections = new Set<Connection>();
	/** What the request being answered sends, which fetch sends once its answer is made. */
	#outbox: Outgoing[] = [];
	/** Events held for releaseEvents, while holding. */
	#held: { connection: Connection; event: GatewayEvent }[] | null = null;
	#switches: { match: RouteMatch; effect: "lose" | "cut" | "files" | Answer }[] = [];
	/** Requests held until as many as each gate counts have come (gather). */
	#gates: { match: RouteMatch; count: number; waiting: (() => void)[] }[] = [];
	#routes: Route[];
	#lastId = "";

	constructor() {
		const key = generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x!;
		this.externalSender = bytesBase64(base64Bytes(key.replace(/-/g, "+").replace(/_/g, "/").padEnd(44, "=")));
		this.#routes = this.#table();
	}

	/** An ID the fake mints, always above the one before as the API's are: two in one millisecond still sort in turn. */
	#id(): string {
		let id = uuidv7();
		if (id <= this.#lastId) id = uuidv7(Number.parseInt(this.#lastId.slice(0, 13).replace("-", ""), 16) + 1);
		return (this.#lastId = id);
	}

	// -------------------------------------------------------------------------------------------------------------
	// What a test does around the routes.

	/** A user of the API, by their new ID. */
	addUser(): string {
		const id = this.#id();
		this.#users.add(id);
		return id;
	}

	/** A session of the user's, as a login gives it: its token and its challenge to bind a device with. */
	signIn(user: string): { token: string; device_challenge: string } {
		if (!this.#users.has(user)) throw new Error(`no user ${user}`);
		const token = crypto.randomUUID();
		const challenge = crypto.getRandomValues(new Uint8Array(32));
		this.#sessions.set(token, { user, token, challenge, device: null });
		return { token, device_challenge: bytesBase64(challenge) };
	}

	/** A conversation of these users (its members by their membership's ID, in this order), and its ID. */
	addConversation({
		type,
		members,
		owner = members[0],
		legacy = false,
	}: {
		type: "dm" | "group";
		members: string[];
		owner?: string;
		legacy?: boolean;
	}): string {
		const id = this.#id();
		const at = now();
		this.#conversations.set(id, {
			...{ id, type: type === "dm" ? 1 : 2, owner_id: owner!, created_at: at, legacy, group: null, seq: 0, floor: 1 },
			members: members.map((user) => ({
				id: this.#id(),
				conversation_id: id,
				user_id: user,
				created_at: at,
				updated_at: at,
			})),
			...{ entries: [], messages: [], deleted: new Set(), leaves: new Map(), commits: new Map() },
		});
		return id;
	}

	/**
	 * A connection to the gateway of the session's, identified with its device (null for none): it hears READY at once,
	 * which says nothing of conversations or their groups, as the gateway's doesn't, then the events for its user, and for
	 * its device. Its end.
	 */
	connect(token: string, device: string | null, listener: (event: GatewayEvent) => void): () => void {
		const session = this.#sessions.get(token);
		if (!session) throw new Error("no such session");
		const connection = { user: session.user, device, listener };
		this.#connections.add(connection);
		listener({ type: "READY", data: { user: { id: session.user } } });
		return () => this.#connections.delete(connection);
	}

	/** The conversation's members change as the server alone changes them: these users join it, with no commit. */
	addMembers(conversationId: string, users: string[]) {
		const conv = this.#conversations.get(conversationId);
		if (!conv) throw new Error(`no conversation ${conversationId}`);
		for (const user of users) {
			const at = now();
			conv.members.push({ id: this.#id(), conversation_id: conv.id, user_id: user, created_at: at, updated_at: at });
		}
	}

	/** The conversation's queue is whole only from `floor` on: a read from before it is a 410, as the API's once it expired. */
	expireQueue(conversationId: string, floor: number) {
		const conv = this.#conversations.get(conversationId);
		if (!conv) throw new Error(`no conversation ${conversationId}`);
		conv.floor = floor;
	}

	/** The conversation is deleted, as the API deletes one: no list has it, and its routes answer 404. */
	deleteConversation(conversationId: string) {
		if (!this.#conversations.delete(conversationId)) throw new Error(`no conversation ${conversationId}`);
	}

	/** The next request the match takes never reaches the API: fetch fails, and nothing is done. */
	cutRequest(match: RouteMatch) {
		this.#switches.push({ match, effect: "cut" });
	}

	/** The requests the match takes wait until `count` of them have come, then go on in the order they came: once. */
	gather(match: RouteMatch, count: number) {
		this.#gates.push({ match, count, waiting: [] });
	}

	/** The next request the match takes does its work, and its answer is lost: fetch fails, as with a cut connection. */
	loseAnswer(match: RouteMatch) {
		this.#switches.push({ match, effect: "lose" });
	}

	/**
	 * The next message the match takes has its files go up, and its connection is cut as it waits for its conversation's
	 * row: nothing else is done, as the API's own send (ruling 5), whose resend takes its files as they went up.
	 */
	cutAfterFiles(match: RouteMatch) {
		this.#switches.push({ match, effect: "files" });
	}

	/**
	 * The next request the match takes is refused, and does nothing: 426 and 503 in the API's words (503 with its
	 * Retry-After), any other with the body given.
	 */
	refuse(match: RouteMatch, status: number, body?: unknown, headers: Record<string, string> = {}) {
		const own: Record<number, Answer> = {
			426: { status, body: { error: "update Duvet", client: null, minimum: null } },
			503: { status, body: { error: "encrypted conversations are paused" }, headers: { "Retry-After": "60" } },
		};
		const answer = own[status] ?? { status, body };
		this.#switches.push({
			match,
			effect: { ...answer, ...(body === undefined ? {} : { body }), headers: { ...answer.headers, ...headers } },
		});
	}

	/** Events wait from now on, until releaseEvents. */
	holdEvents() {
		this.#held ??= [];
	}

	/**
	 * The events held, sent: in their order, backwards, and each once or twice. Then events go at once again, unless
	 * `only` picks those that go now: the others stay held, as does what comes after, until a release without it.
	 */
	releaseEvents({
		order = "as_sent",
		repeat = false,
		only,
	}: { order?: "as_sent" | "reverse"; repeat?: boolean; only?: (event: GatewayEvent) => boolean } = {}) {
		const held = this.#held;
		if (!held) return;
		const going = only ? held.filter(({ event }) => only(event)) : held;
		this.#held = only ? held.filter(({ event }) => !only(event)) : null;
		for (const { connection, event } of order === "reverse" ? going.reverse() : going) {
			for (let times = repeat ? 2 : 1; times > 0; times--) connection.listener(structuredClone(event));
		}
	}

	// -------------------------------------------------------------------------------------------------------------
	// Requests.

	/** The API, as fetch: a request to any of its routes gets the API's answer. */
	fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const request = new Request(input, init);
		const url = new URL(request.url);
		const gate = this.#gates.find(({ match }) => matches(match, request.method, url.pathname));
		if (gate) {
			const held = new Promise<void>((go) => gate.waiting.push(go));
			if (gate.waiting.length === gate.count) {
				this.#gates.splice(this.#gates.indexOf(gate), 1);
				for (const go of gate.waiting) go();
			}
			await held;
		}
		const switched = this.#switches.findIndex(({ match }) => matches(match, request.method, url.pathname));
		const effect = switched < 0 ? null : this.#switches.splice(switched, 1)[0]!.effect;
		if (effect === "cut") throw new TypeError("fetch failed: the request never reached the API");
		if (effect && effect !== "lose" && effect !== "files") return respond(effect);
		const { answer, events } = await this.#answer(request, url, effect === "files");
		if (effect === "files") throw new TypeError("fetch failed: the connection closed once its files were up");
		// Its events go once its answer is made, lost or not: after the code that awaited it takes its first step.
		queueMicrotask(() => queueMicrotask(() => this.#send(events)));
		if (effect === "lose") throw new TypeError("fetch failed: the answer was lost");
		return respond(answer);
	};

	/** A request's answer, and the events it sends: none for a refusal, as the API's rolled-back work sends none. */
	async #answer(request: Request, url: URL, filesOnly = false): Promise<{ answer: Answer; events: Outgoing[] }> {
		const route = this.#routes.find(([method, path]) => method === request.method && path.test(url.pathname));
		if (!route) return { answer: { status: 404, body: { error: "no such route" } }, events: [] };
		const [, path, needs, handler, anyClient] = route;
		const bytes = new Uint8Array(await request.arrayBuffer());
		try {
			// In the API's order: the session (401), the client (426), the device (403), then the body (400).
			const session = this.#session(request.headers, needs);
			if (needs !== "nothing" && !anyClient) this.#checkClient(request.headers);
			const device = session?.device ? (this.#devices.get(session.device) ?? null) : null;
			if ((needs === "device" || needs === "listed") && (!device || device.removed)) {
				throw fail(403, "this session has no device");
			}
			if (needs === "listed" && !device?.listed) throw fail(403, "this device isn't on your device list");
			let body: unknown = null;
			const type = request.headers.get("Content-Type") ?? "";
			if (type.includes("json") && bytes.length > 0) {
				try {
					body = JSON.parse(new TextDecoder().decode(bytes));
				} catch {
					throw fail(400, "the body isn't JSON");
				}
			} else if (type.includes("multipart/form-data")) body = await formBody(bytes, type);
			const params = path.exec(url.pathname)?.groups ?? {};
			const answer = handler({
				session: session!,
				device,
				params,
				query: url.searchParams,
				body,
				bytes,
				headers: request.headers,
				filesOnly,
			});
			return { answer, events: this.#outbox.splice(0) };
		} catch (error) {
			this.#outbox.length = 0;
			if (error instanceof Refusal) return { answer: error.answer, events: [] };
			throw error;
		}
	}

	#session(headers: Headers, needs: Needs): Session | null {
		if (needs === "nothing") return null;
		const token = /^Bearer (.+)$/.exec(headers.get("Authorization") ?? "")?.[1];
		const session = token ? this.#sessions.get(token) : undefined;
		if (!session) throw fail(401, "unauthorized");
		return session;
	}

	/** The client gate: a client without end-to-end encryption is told to update Duvet (426), in the API's words. */
	#checkClient(headers: Headers) {
		const client = clientIn(headers.get("X-Duvet-Client"));
		const least = client ? this.minClients[client.platform] : undefined;
		const lowest = least === undefined ? null : versionIn(least);
		if (client && lowest && atLeast(client.version, lowest)) return;
		throw fail(426, "update Duvet", {
			client: client && `${client.platform}/${client.version.join(".")}`,
			minimum: least ?? null,
		});
	}

	/** An event the request sends, as its data is now: what this request or a later one changes after doesn't reach it. */
	#emit(user: string, type: string, data: unknown, device?: string) {
		this.#outbox.push({ user, device, event: { type, data: structuredClone(data) } });
	}

	/** Events to each connection of their user (of their device, when they name one), each its own copy; or held. */
	#send(events: Outgoing[]) {
		for (const { user, device, event } of events) {
			for (const connection of this.#connections) {
				if (connection.user !== user || (device && connection.device !== device)) continue;
				if (this.#held) this.#held.push({ connection, event });
				else connection.listener(structuredClone(event));
			}
		}
	}

	// -------------------------------------------------------------------------------------------------------------
	// The routes (PLAN-E2E-API.md, its routes A to K): under /api, the conversations' at /api/users/@me/conversations.
	// Every route that takes a session takes only a client with end-to-end encryption, but GET /api/e2e and the
	// conversations' list (anyClient), so a client without it still starts and sees its conversations.

	#table(): Route[] {
		const me = "/api/users/@me";
		const conv = `${me}/conversations/(?<conversation>${UUID_PATH})`;
		const route = (
			method: string,
			path: string,
			needs: Needs,
			handler: (ctx: Context) => Answer,
			anyClient = false,
		): Route => [method, new RegExp(`^${path}$`), needs, handler, anyClient];
		return [
			route(
				"GET",
				"/api/e2e",
				"session",
				() =>
					ok({
						external_sender: this.externalSender,
						cutover_at: this.cutoverAt,
						paused: false,
						min_clients: this.minClients,
						limits: LIMITS,
					}),
				true,
			),
			route("POST", "/api/e2e/decrypt-failures", "session", ({ body }) => {
				this.decryptFailures.push({ kind: String(body?.kind), count: body?.count ?? 1 });
				return NO_CONTENT;
			}),
			route("POST", `${me}/devices/challenge`, "session", ({ session }) => {
				session.challenge = crypto.getRandomValues(new Uint8Array(32));
				return ok({ device_challenge: bytesBase64(session.challenge) });
			}),
			route("POST", `${me}/devices`, "session", (ctx) => this.#registerDevice(ctx)),
			route("POST", `${me}/devices/(?<device>${UUID_PATH})/bind`, "session", (ctx) => this.#bindDevice(ctx)),
			route("GET", `${me}/devices`, "session", ({ session }) =>
				ok(this.#devicesOf(session.user).map((device) => this.#deviceView(device, session))),
			),
			route("DELETE", `${me}/devices/(?<device>${UUID_PATH})`, "session", ({ session, params }) => {
				const device = this.#devices.get(params.device!);
				if (!device || device.user !== session.user || device.removed) throw fail(404, "device not found");
				if (device.listed) throw fail(409, "sign a device list without it");
				this.#removeDevices(session.user, [device]);
				return NO_CONTENT;
			}),
			route("PUT", `${me}/identity`, "device", (ctx) => this.#putIdentity(ctx)),
			route("PUT", `${me}/device-list`, "device", (ctx) => this.#putDeviceList(ctx)),
			route("GET", `${me}/identity/backup`, "device", ({ session }) => {
				const identity = this.#identities.get(session.user);
				if (!identity) throw fail(404, "no identity");
				const { encrypted_identity, wrapped_backup_key, wrapped_previous_backup_keys } = identity;
				return ok({
					...{ identity_key: bytesBase64(identity.identityKey), device_list: bytesBase64(identity.deviceList) },
					...{ encrypted_identity, wrapped_backup_key, wrapped_previous_backup_keys },
				});
			}),
			route("GET", "/api/users/identities", "session", ({ session, query }) => {
				const ids = (query.get("ids") ?? "").split(",").filter(Boolean);
				if (ids.length > 50 || ids.some((id) => !UUID.test(id))) throw fail(400, "ids are 50 user IDs at most");
				const readable = ids.filter((id) => this.#identities.has(id) && this.#mayRead(session.user, id));
				return ok(readable.map((id) => this.#identityView(id)));
			}),
			route("GET", `/api/users/(?<user>${UUID_PATH})/identity`, "session", ({ session, params }) => {
				if (!this.#users.has(params.user!) || !this.#mayRead(session.user, params.user!)) {
					throw fail(403, "you can't read this user's identity");
				}
				if (!this.#identities.has(params.user!)) throw fail(404, "no identity");
				return ok(this.#identityView(params.user!));
			}),
			route("PUT", `${me}/devices/@me/key-packages`, "listed", (ctx) => this.#uploadKeyPackages(ctx)),
			route("POST", `/api/users/(?<user>${UUID_PATH})/key-packages/claim`, "listed", (ctx) =>
				this.#claimKeyPackages(ctx),
			),
			route("POST", `/api/devices/(?<device>${UUID_PATH})/inbox`, "device", (ctx) => this.#sendToInbox(ctx)),
			route("GET", `${me}/devices/@me/inbox`, "device", ({ device, query }) => {
				// As the API binds them (its InboxQuery): after a message's ID, and from 1 to 100 of them.
				const after = query.has("after") ? uuidIn(query.get("after"), "after") : "";
				const limit = Number(query.get("limit") ?? 100);
				if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw fail(400, "limit is 1 to 100");
				return ok((this.#inboxes.get(device!.id) ?? []).filter((m) => m.id > after).slice(0, limit));
			}),
			route("DELETE", `${me}/devices/@me/inbox`, "device", ({ device, query }) => {
				const through = uuidIn(query.get("through"), "through");
				this.#inboxes.set(
					device!.id,
					(this.#inboxes.get(device!.id) ?? []).filter((m) => m.id > through),
				);
				return NO_CONTENT;
			}),
			route(
				"GET",
				`${me}/conversations`,
				"session",
				({ session, device }) => ok(this.#conversationsOf(session.user).map((c) => this.#view(c, device))),
				true,
			),
			route("GET", `${conv}/mls/group-info`, "listed", (ctx) => {
				const { group } = this.#memberOf(ctx);
				if (!group) throw fail(404, "no group yet");
				return ok({ generation: group.generation, epoch: group.epoch, group_info: group.group_info });
			}),
			route("POST", `${conv}/mls/commits`, "listed", (ctx) => {
				const answer = this.#commit(this.#memberOf(ctx), ctx, "commits");
				return ok(answer, 201);
			}),
			route("GET", `${conv}/mls/queue`, "device", (ctx) => this.#queue(this.#memberOf(ctx), ctx.query)),
			route("POST", `${conv}/members`, "listed", (ctx) => this.#addMember(ctx)),
			route("DELETE", `${conv}/members/@me`, "listed", (ctx) => this.#leave(ctx)),
			route("DELETE", `${conv}/members/(?<user>${UUID_PATH})`, "listed", (ctx) => this.#removeMember(ctx)),
			route("POST", `${conv}/messages`, "listed", (ctx) => this.#sendMessage(ctx)),
			route("GET", `${conv}/messages/deleted`, "session", (ctx) => {
				const after = ctx.query.get("after") ?? "";
				const limit = Math.min(Number(ctx.query.get("limit") ?? 1000) || 1000, 1000);
				return ok({
					ids: [...this.#memberOf(ctx).deleted]
						.filter((id) => id > after)
						.sort()
						.slice(0, limit),
				});
			}),
			route("GET", `${conv}/messages/(?<message>${UUID_PATH})`, "session", (ctx) => {
				const held = this.#memberOf(ctx);
				const message = held.messages.find((m) => m.id === ctx.params.message && !held.deleted.has(m.id));
				if (!message) throw fail(404, "direct message not found");
				return ok(message);
			}),
			route("PATCH", `${conv}/messages/(?<message>${UUID_PATH})`, "session", (ctx) => this.#changeMessage(ctx, "edit")),
			route("DELETE", `${conv}/messages/(?<message>${UUID_PATH})`, "session", (ctx) =>
				this.#changeMessage(ctx, "delete"),
			),
			route("PUT", `${conv}/history-shares/(?<share>${UUID_PATH})`, "listed", (ctx) => this.#putShare(ctx)),
			route("PUT", `${conv}/history-shares/(?<share>${UUID_PATH})/parts/(?<n>\\d+)`, "listed", (ctx) => {
				const share = this.#ownShare(ctx);
				const n = Number(ctx.params.n);
				if (n >= share.parts) throw fail(400, `the share has ${share.parts} parts`);
				if (ctx.bytes.length > LIMITS.history_share_part_bytes) throw fail(413, "a part is 1 MiB and its tag at most");
				share.uploaded.set(n, this.#keepFile(ctx.bytes));
				return NO_CONTENT;
			}),
			route("POST", `${conv}/history-shares/(?<share>${UUID_PATH})/complete`, "listed", (ctx) =>
				this.#completeShare(ctx),
			),
			route("GET", `${me}/history-shares`, "device", ({ session, device }) => {
				const waiting = [...this.#shares.values()].filter(
					(share) => share.completed && share.to_user_id === session.user && !share.acked.has(device!.id),
				);
				return ok(waiting.map((share) => this.#shareView(share)));
			}),
			route("GET", `/api/history-shares/(?<share>${UUID_PATH})/parts/(?<n>\\d+)`, "session", ({ session, params }) => {
				const share = this.#shares.get(params.share!);
				const file = share?.uploaded.get(Number(params.n));
				if (!share || !file || ![share.to_user_id, share.from_user_id].includes(session.user)) {
					throw fail(404, "no such part");
				}
				return ok({ url: signedPath(file) });
			}),
			route("POST", `/api/history-shares/(?<share>${UUID_PATH})/ack`, "device", ({ session, device, params }) => {
				const share = this.#shares.get(params.share!);
				if (!share?.completed || share.to_user_id !== session.user) throw fail(404, "no such share");
				share.acked.add(device!.id);
				return NO_CONTENT;
			}),
			route("GET", `${me}/backup/segments`, "device", ({ session, query }) => {
				const identity = this.#identities.get(session.user);
				const after = query.get("after") ?? "";
				const conversation = query.get("conversation_id");
				const listed = [...this.#segments.values()].filter(
					(s) => s.identity === identity?.id && s.id > after && (!conversation || s.conversation_id === conversation),
				);
				return ok(
					listed.slice(0, 1000).map(({ id, conversation_id, day, complete, key_id, size, created_at }) => ({
						...{ id, conversation_id, day, complete, key_id, size, created_at },
					})),
				);
			}),
			route(
				"PUT",
				`${me}/backup/segments/(?<conversation>${UUID_PATH})/(?<day>\\d{4}-\\d{2}-\\d{2})`,
				"listed",
				(ctx) => this.#putSegment(ctx),
			),
			route("GET", `${me}/backup/segments/(?<segment>${UUID_PATH})`, "device", ({ session, params }) => {
				const segment = this.#segments.get(params.segment!);
				if (!segment || segment.identity !== this.#identities.get(session.user)?.id) throw fail(404, "no such segment");
				return ok({ url: signedPath(segment.file) });
			}),
			// A file at its signed URL, which the part's and the segment's routes answer: it takes no session.
			// Through the API alone (stream=1), as the app asks: without it, the API would send the client to its storage.
			route("GET", `/attachments/(?<file>${UUID_PATH})`, "nothing", ({ params, query }) => {
				if (query.get("stream") !== "1")
					throw fail(400, "the fake API serves a file through itself: ask with stream=1");
				const file = this.#files.get(params.file!);
				if (!file) throw fail(404, "no such file");
				return { status: 200, body: file };
			}),
		];
	}

	// -------------------------------------------------------------------------------------------------------------
	// Devices and sessions.

	/** A bind proof's word that the session is this device's: its fields, once its device's key signed them. */
	#checkProof(session: Session, deviceId: string, signatureKey: Uint8Array, hpkeKey: Uint8Array, proof: Uint8Array) {
		const body = signedBody(LABEL.bind, proof, signatureKey);
		const challenge = asBytes(body?.get("challenge"), 32);
		const key = asBytes(body?.get("hpke_key"), 32);
		const fits = asUuid(body?.get("user")) === session.user && asUuid(body?.get("device")) === deviceId;
		if (!fits || !challenge || !equal(challenge, session.challenge) || !key || !equal(key, hpkeKey)) {
			throw fail(403, "the proof doesn't verify");
		}
		// The challenge is spent.
		session.challenge = crypto.getRandomValues(new Uint8Array(32));
	}

	#registerDevice({ session, body, headers }: Context): Answer {
		const id = uuidIn(body?.device_id, "device_id");
		// Counted by code point, as the API's validator counts a string (max=64).
		const name = typeof body?.name === "string" && body.name && Array.from(body.name).length <= 64 ? body.name : null;
		if (!name) throw fail(400, "a device has a name of 64 characters at most");
		const signatureKey = bytesIn(body?.signature_key, "signature_key", 32);
		const hpkeKey = bytesIn(body?.hpke_key, "hpke_key", 32);
		if (signatureKey.length !== 32 || hpkeKey.length !== 32) throw fail(400, "a device's keys are 32 bytes");
		const known = this.#devices.get(id);
		const same = known && known.user === session.user && !known.removed;
		if (known && !(same && equal(known.signatureKey, signatureKey) && equal(known.hpkeKey, hpkeKey))) {
			throw fail(409, "device id in use");
		}
		this.#checkProof(session, id, signatureKey, hpkeKey, bytesIn(body?.proof, "proof", 1024));
		session.device = id;
		if (known) return ok(this.#deviceView(known, session));
		const device: Device = {
			...{ id, user: session.user, name, client: headers.get("X-Duvet-Client"), signatureKey, hpkeKey },
			...{ certificate: null, certifiedBy: null, listed: false, removed: false, created_at: now() },
		};
		this.#devices.set(id, device);
		this.#emit(session.user, "DEVICE_ADD", this.#deviceView(device, null));
		return ok(this.#deviceView(device, session), 201);
	}

	#bindDevice({ session, params, body }: Context): Answer {
		const device = this.#devices.get(params.device!);
		if (!device || device.user !== session.user || device.removed) throw fail(404, "device not found");
		this.#checkProof(session, device.id, device.signatureKey, device.hpkeKey, bytesIn(body?.proof, "proof", 1024));
		session.device = device.id;
		return NO_CONTENT;
	}

	#devicesOf(user: string) {
		return [...this.#devices.values()].filter((device) => device.user === user && !device.removed);
	}

	#deviceView(device: Device, session: Session | null) {
		const { id, name, client, listed, created_at } = device;
		return { id, name, client, created_at, last_seen_at: created_at, listed, current: session?.device === id };
	}

	/** Devices taken out: their sessions end, and their key packages and inbox go, as the API does. */
	#removeDevices(user: string, devices: Device[]) {
		for (const device of devices) {
			device.removed = true;
			device.listed = false;
			this.#keyPackages.delete(device.id);
			this.#inboxes.delete(device.id);
			for (const [token, session] of this.#sessions) if (session.device === device.id) this.#sessions.delete(token);
			// shortcut: no removal of its leaves is proposed (that takes the validator); a test that needs one posts it.
			this.#emit(user, "DEVICE_REMOVE", { device_id: device.id });
		}
	}

	// -------------------------------------------------------------------------------------------------------------
	// Identities and device lists.

	/** Who may read a user's identity: themselves and whoever shares a conversation with them. */
	#mayRead(viewer: string, user: string) {
		return viewer === user || this.#shareConversation(viewer, user);
	}

	#identityView(user: string) {
		const identity = this.#identities.get(user)!;
		const list = readDeviceList(identity.deviceList, identity.identityKey)!;
		const certificates = list.devices.flatMap((id) => {
			const certificate = this.#devices.get(id)?.certificate;
			return certificate ? [bytesBase64(certificate)] : [];
		});
		return {
			...{
				user_id: user,
				identity_key: bytesBase64(identity.identityKey),
				device_list: bytesBase64(identity.deviceList),
			},
			// shortcut: every user is active, as if a listed device connected lately; a test of deviceless members sets it.
			...{ device_list_version: identity.version, certificates, active: true, changed_at: identity.changed_at },
		};
	}

	/** A device list of the user's own, signed by identityKey, naming this device, 20 devices at most. */
	#readList(session: Session, device: Device, identityKey: Uint8Array, signed: Uint8Array): DeviceList {
		const list = readDeviceList(signed, identityKey);
		if (!list) throw fail(400, "the device list isn't signed by the identity key");
		if (list.user !== session.user) throw fail(400, "the device list is another user's");
		if (list.devices.length > LIMITS.listed_devices) throw fail(400, "a device list names 20 devices at most");
		if (!list.devices.includes(device.id)) throw fail(400, "the device list doesn't name this session's device");
		return list;
	}

	/** A certificate from identityKey for one of the user's devices, carrying the keys that device registered. */
	#checkCertificate(user: string, deviceId: string, identityKey: Uint8Array, signed: Uint8Array) {
		const device = this.#devices.get(deviceId);
		const said = readCertificate(signed, identityKey);
		if (!device || device.user !== user || device.removed)
			throw fail(400, `device ${deviceId} isn't a registered device of yours`);
		if (!said || said.user !== user || said.device !== deviceId) {
			throw fail(400, `the certificate for device ${deviceId} doesn't verify as the identity's for it`);
		}
		if (!equal(said.signatureKey, device.signatureKey) || !equal(said.hpkeKey, device.hpkeKey)) {
			throw fail(400, `the certificate for device ${deviceId} doesn't carry the keys it registered`);
		}
	}

	#putIdentity({ session, device, body }: Context): Answer {
		const identityKey = bytesIn(body?.identity_key, "identity_key", 32);
		const deviceList = bytesIn(body?.device_list, "device_list", LIMITS.device_list_bytes);
		const certificate = bytesIn(body?.certificate, "certificate", LIMITS.certificate_bytes);
		for (const field of ["encrypted_identity", "wrapped_backup_key"]) bytesIn(body?.[field], field, 1024);
		const replaces = body?.replaces == null ? null : bytesIn(body.replaces, "replaces", 32);
		const transfers = transfersIn(body?.transfers);
		const list = this.#readList(session, device!, identityKey, deviceList);
		const current = this.#identities.get(session.user) ?? null;
		const sameKey = current !== null && equal(identityKey, current.identityKey);
		const replacesCurrent = current !== null && replaces !== null && equal(replaces, current.identityKey);
		// PUT …/identity's four cases: the first, the same one again, a rotation, or starting over (reset).
		const change = sameKey
			? "same"
			: !current && !replaces
				? "first"
				: replacesCurrent
					? body?.reset
						? "reset"
						: "rotation"
					: null;
		if (!change) {
			throw fail(409, "identity changed", { identity_key: current ? bytesBase64(current.identityKey) : null });
		}
		if (change === "rotation" && !device!.listed) throw fail(403, "this device isn't on your device list");
		if (change !== "same" && list.version !== 1) throw fail(400, "a new identity's device list is version 1");
		if ((change === "first" || change === "reset") && transfers.length) {
			throw fail(
				400,
				"only a rotation brings transfers: a first identity and starting over certify this session's device alone",
			);
		}
		// Each device of the list gets its certificate: the session's own, and every other one through its transfer.
		const certificates = new Map([[device!.id, certificate]]);
		this.#checkCertificate(session.user, device!.id, identityKey, certificate);
		for (const { device_id: id, certificate: transferred } of transfers) {
			if (certificates.has(id) || !list.devices.includes(id))
				throw fail(400, `a transfer for device ${id} the list doesn't take`);
			const signed = base64Bytes(transferred);
			this.#checkCertificate(session.user, id, identityKey, signed);
			certificates.set(id, signed);
		}
		if (list.devices.some((id) => !certificates.has(id)))
			throw fail(400, "the list names a device with no transfer for it");

		let identity = current!;
		if (change !== "same") {
			identity = {
				...{ id: this.#id(), identityKey, deviceList, version: list.version, changed_at: now() },
				...{ encrypted_identity: body.encrypted_identity, wrapped_backup_key: body.wrapped_backup_key },
				wrapped_previous_backup_keys: body.wrapped_previous_backup_keys ?? null,
			};
			this.#identities.set(session.user, identity);
			const off: Device[] = [];
			for (const own of this.#devicesOf(session.user)) {
				const signed = certificates.get(own.id);
				if (signed) Object.assign(own, { certificate: signed, certifiedBy: identity.id, listed: true });
				else if (own.listed && change === "rotation") off.push(own);
				else own.listed = false;
			}
			this.#removeDevices(session.user, off);
		}
		for (const transfer of transfers)
			this.#deliver(session.user, device!.id, transfer.device_id, transfer.message, true);
		if (change !== "same") this.#announceIdentity(session.user);
		return ok({ identity_id: identity.id, device_list_version: identity.version });
	}

	#putDeviceList({ session, device, body }: Context): Answer {
		const current = this.#identities.get(session.user);
		if (!current) throw fail(404, "no identity");
		const signed = bytesIn(body?.device_list, "device_list", LIMITS.device_list_bytes);
		if (equal(signed, current.deviceList)) return ok({ version: current.version });
		const list = this.#readList(session, device!, current.identityKey, signed);
		if (body?.base_version !== current.version || list.version <= current.version) {
			throw fail(409, "device list changed", {
				device_list: bytesBase64(current.deviceList),
				version: current.version,
			});
		}
		const certificate =
			body?.certificate == null ? null : bytesIn(body.certificate, "certificate", LIMITS.certificate_bytes);
		if (certificate) this.#checkCertificate(session.user, device!.id, current.identityKey, certificate);
		for (const id of list.devices) {
			const listedDevice = this.#devices.get(id);
			const ofThisIdentity = listedDevice && !listedDevice.removed && listedDevice.certifiedBy === current.id;
			if (!ofThisIdentity && !(certificate && id === device!.id)) {
				throw fail(400, `the list names device ${id}, which has no certificate of this identity`);
			}
		}
		if (certificate) Object.assign(device!, { certificate, certifiedBy: current.id });
		Object.assign(current, { deviceList: signed, version: list.version });
		const off: Device[] = [];
		for (const own of this.#devicesOf(session.user)) {
			const listed = list.devices.includes(own.id);
			if (listed && !own.listed) this.#emit(session.user, "DEVICE_ADD", this.#deviceView({ ...own, listed }, null));
			if (!listed && own.listed) off.push(own);
			own.listed = listed;
		}
		this.#removeDevices(session.user, off);
		this.#announceIdentity(session.user);
		return ok({ version: list.version });
	}

	/** IDENTITY_UPDATE, to the user and whoever shares a conversation with them. */
	#announceIdentity(user: string) {
		const identity = this.#identities.get(user)!;
		const update = {
			user_id: user,
			identity_key: bytesBase64(identity.identityKey),
			device_list_version: identity.version,
		};
		for (const to of this.#peopleOf(user)) this.#emit(to, "IDENTITY_UPDATE", update);
	}

	// -------------------------------------------------------------------------------------------------------------
	// Key packages and the inbox.

	#uploadKeyPackages({ device, body }: Context): Answer {
		// The whole set, as the API binds it: an empty one takes them all away, and none at all is refused.
		if (!Array.isArray(body?.key_packages)) throw fail(400, "key_packages is the device's whole set");
		const uploaded: unknown[] = body.key_packages;
		const set = uploaded.map((kp: any) => ({
			id: base64In(kp?.id, "key_packages.id", 64, 1),
			data: base64In(kp?.data, "key_packages.data", LIMITS.key_package_bytes, 1),
			expiresAt: numberIn(kp?.expires_at, "expires_at"),
			lastResort: kp?.last_resort === true,
		}));
		const lastResorts = set.filter((kp) => kp.lastResort).length;
		if (set.length - lastResorts > LIMITS.key_packages || lastResorts > LIMITS.last_resort_key_packages) {
			throw fail(400, "a device keeps 100 single-use key packages and 1 of last resort at most");
		}
		if (new Set(set.map((kp) => kp.id)).size !== set.length) throw fail(400, "a key package is there twice");
		const kept = this.#keyPackages.get(device!.id) ?? new Map<string, KeyPackage>();
		// What the new set leaves out goes, but the single-use ones handed out: those are never handed out again.
		const ids = new Set(set.map((kp) => kp.id));
		for (const [id, kp] of kept) if (!ids.has(id) && (!kp.handedOut || kp.lastResort)) kept.delete(id);
		for (const kp of set) if (!kept.has(kp.id)) kept.set(kp.id, { ...kp, handedOut: false });
		this.#keyPackages.set(device!.id, kept);
		return ok({ handed_out: set.filter((kp) => !kp.lastResort && kept.get(kp.id)!.handedOut).map((kp) => kp.id) });
	}

	#claimKeyPackages({ session, device, params }: Context): Answer {
		const user = params.user!;
		if (!this.#users.has(user)) throw fail(404, "user not found");
		if (user !== session.user && !this.#shareConversation(session.user, user)) {
			throw fail(
				403,
				"only your own key packages, a friend's, or those of someone you share a conversation with can be claimed",
			);
		}
		const notBefore = Date.now() + KEY_PACKAGE_MARGIN;
		const handed: { device_id: string; data: string }[] = [];
		const devices = this.#devicesOf(user).filter((d) => d.listed && d.id !== device!.id);
		for (const listed of devices.sort((a, b) => (a.id < b.id ? -1 : 1))) {
			const live = [...(this.#keyPackages.get(listed.id) ?? new Map<string, KeyPackage>())].filter(
				([, kp]) => kp.expiresAt > notBefore,
			);
			const single = live
				.filter(([, kp]) => !kp.lastResort && !kp.handedOut)
				.sort(([a, x], [b, y]) => x.expiresAt - y.expiresAt || (a < b ? -1 : 1));
			const pick =
				single[0] ?? live.filter(([, kp]) => kp.lastResort).sort(([, x], [, y]) => y.expiresAt - x.expiresAt)[0];
			// What it has left to hand out after this claim: 0 when it had none, which it hears too.
			const remaining = Math.max(0, single.length - 1);
			if (remaining < KEY_PACKAGES_LOW)
				this.#emit(user, "KEY_PACKAGES_LOW", { device_id: listed.id, remaining }, listed.id);
			if (!pick) continue;
			pick[1].handedOut = true;
			handed.push({ device_id: listed.id, data: pick[1].data });
		}
		return ok({ key_packages: handed });
	}

	#sendToInbox({ session, device, params, body }: Context): Answer {
		const message = bytesIn(body?.message, "message");
		if (message.length === 0 || message.length > LIMITS.inbox_message_bytes)
			throw fail(400, "a message to a device is 64 KiB at most");
		const to = this.#devices.get(params.device!);
		if (!to || to.removed) throw fail(404, "device not found");
		if (to.user !== session.user && !this.#shareConversation(session.user, to.user)) {
			throw fail(403, "only your own devices, and those of someone you share a conversation with, take your messages");
		}
		// A rotation's transfer counts toward no cap.
		const waiting = (this.#inboxes.get(to.id) ?? []).filter((m) => !this.#transfers.has(m.id));
		if (waiting.length >= INBOX_MAX) throw fail(409, "inbox full");
		return ok({ id: this.#deliver(session.user, device!.id, to.id, body.message) }, 201);
	}

	/**
	 * A message into a device's inbox, and DEVICE_MESSAGE to it: the message's ID. A rotation's transfer takes the place
	 * of the device's earlier ones: only the newest is of use, as the API keeps it.
	 */
	#deliver(from: string, fromDevice: string, to: string, message: string, transfer = false): string {
		const device = this.#devices.get(to);
		if (!device) return "";
		const id = this.#id();
		const inbox = (this.#inboxes.get(to) ?? []).filter((m) => !transfer || !this.#transfers.has(m.id));
		inbox.push({ id, from_user_id: from, from_device_id: fromDevice, message, created_at: now() });
		if (transfer) this.#transfers.add(id);
		this.#inboxes.set(to, inbox);
		this.#emit(device.user, "DEVICE_MESSAGE", { device_id: to, id }, to);
		return id;
	}

	// -------------------------------------------------------------------------------------------------------------
	// Conversations, their groups and their queue.

	#conversationsOf(user: string) {
		return [...this.#conversations.values()].filter((conv) => conv.members.some((m) => m.user_id === user));
	}

	#shareConversation(a: string, b: string) {
		return this.#conversationsOf(a).some((conv) => conv.members.some((m) => m.user_id === b));
	}

	/** The user and everyone they share a conversation with. */
	#peopleOf(user: string) {
		return new Set([user, ...this.#conversationsOf(user).flatMap((conv) => conv.members.map((m) => m.user_id))]);
	}

	#memberOf({ session, params }: Context): Conversation {
		const conv = this.#conversations.get(params.conversation!);
		if (!conv) throw fail(404, "conversation not found");
		if (!conv.members.some((m) => m.user_id === session.user))
			throw fail(403, "you aren't a member of this conversation");
		return conv;
	}

	/** A conversation as its object shows it: legacy, and its group (mls), with where this device joined it. */
	#view(conv: Conversation, device: Device | null) {
		const { id, type, owner_id, created_at, legacy, members, group, seq, floor, leaves } = conv;
		const mls = group && {
			...{ generation: group.generation, epoch: group.epoch, last_seq: seq, floor_seq: floor },
			joined_seq: (device && leaves.get(device.id)) ?? null,
		};
		return {
			id,
			type,
			name: null,
			owner_id,
			created_at,
			updated_at: created_at,
			deleted_at: null,
			members,
			legacy,
			mls,
		};
	}

	/** An entry of the conversation's queue, under its next number. */
	#addEntry(conv: Conversation, entry: Omit<Entry, "seq" | "sent_at">): Entry {
		const added = { seq: ++conv.seq, sent_at: Date.now(), ...entry };
		conv.entries.push(added);
		return added;
	}

	/** An entry as an event carries it: without its data past 16 KiB, or when the switch says so. */
	#forEvent(entry: Entry) {
		const { data, ...rest } = entry;
		return this.stripData || base64Bytes(data).length > MAX_EVENT_DATA ? rest : entry;
	}

	/**
	 * A message as the queue's entry it is: its data its ciphertext, emptied once it's deleted; whom it mentions, by their
	 * IDs in order, which its deletion takes away; and what it answers.
	 */
	#messageEntry(m: Message): Entry {
		const deleted = this.#conversations.get(m.conversation_id)?.deleted.has(m.id) ?? false;
		const mentions = deleted ? [] : [...(m.mentions ?? [])].sort();
		const replyTo = this.#repliesTo.get(m.id);
		return {
			...{ seq: m.seq!, kind: "message", data: m.ciphertext ?? "", sent_at: m.sent_at!, generation: m.generation! },
			...{ epoch: m.epoch!, message_id: m.id, sender_user: m.author_id, sender_device: m.sender_device_id },
			...(deleted ? { deleted } : {}),
			...(mentions.length ? { mentions } : {}),
			...(replyTo ? { reply_to: replyTo } : {}),
		};
	}

	#queue(conv: Conversation, query: URLSearchParams): Answer {
		// As the API binds them (its MlsQueueQuery): a number from 0, and from 1 to 500 of them.
		const after = query.has("after") ? Number(query.get("after")) : 0;
		const limit = query.has("limit") ? Number(query.get("limit")) : 200;
		if (!Number.isSafeInteger(after) || after < 0) throw fail(400, "after is a number from 0");
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw fail(400, "limit is 1 to 500");
		if (!conv.group) throw fail(404, "no group yet");
		if (after + 1 < conv.floor) throw fail(410, "queue expired", { floor_seq: conv.floor });
		const all = [
			...conv.entries,
			...conv.messages.filter((m) => m.seq !== undefined).map((m) => this.#messageEntry(m)),
		];
		const entries: Entry[] = [];
		let size = 0;
		for (const entry of all.filter((e) => e.seq > after).sort((a, b) => a.seq - b.seq)) {
			size += entry.data.length;
			if (entries.length === limit || (entries.length > 0 && size > 4 << 20)) break;
			entries.push(entry);
		}
		const { generation, epoch } = conv.group;
		return ok({ entries, last_seq: conv.seq, floor_seq: conv.floor, generation, epoch });
	}

	/**
	 * A commit into the conversation's group (POST …/mls/commits, and the members routes'): its framing is what the request
	 * says, the same bytes again get the answer they got, and it's taken only on the group's generation and epoch (a
	 * creation's on the generation after, or the first). Its welcome's devices join from the welcome's entry, an external
	 * commit's device from the commit's; its entries go out as MLS_COMMIT and MLS_WELCOME.
	 */
	#commit(conv: Conversation, { session, device, body }: Context, route: "commits" | "add" | "remove") {
		const generation = numberIn(body?.generation, "generation");
		const epoch = numberIn(body?.epoch, "epoch");
		const commit = bytesIn(body?.commit, "commit", LIMITS.commit_bytes);
		const create = body?.initial_group_info != null;
		const welcome = body?.welcome == null ? null : bytesIn(body.welcome, "welcome", LIMITS.welcome_bytes);
		const framed = framing(commit);
		if (framed?.wire !== PUBLIC || framed.conversation !== conv.id) {
			throw fail(400, "the commit isn't a public message of this conversation's group");
		}
		if (framed.generation !== generation || framed.epoch !== epoch) {
			throw fail(400, "the commit's generation and epoch aren't the ones the request says");
		}
		if (create && epoch !== 0) throw fail(400, "a group's creation commits on its epoch 0");
		// Every commit brings the group info of the epoch it makes; a creation, epoch 0's too.
		for (const groupInfo of [body?.group_info, ...(create ? [body.initial_group_info] : [])]) {
			if (framing(bytesIn(groupInfo, "group_info", LIMITS.group_info_bytes))?.wire !== GROUP_INFO) {
				throw fail(400, "a group info isn't an MLS group info");
			}
		}
		const welcomed = welcome && framing(welcome);
		if (welcome && welcomed?.wire !== WELCOME) throw fail(400, "the welcome isn't an MLS welcome");
		if (route === "commits" && welcome && !create) throw fail(400, "a welcome only comes with a group's creation");
		if (route === "add" && (!welcome || create)) throw fail(400, "an addition brings its welcome");
		if (route === "remove" && (welcome || create)) throw fail(400, "a removal brings no welcome");

		const sent = conv.commits.get(body.commit);
		if (sent) return sent;
		const { group } = conv;
		if (!group && (!create || generation !== 0))
			throw fail(409, route === "commits" ? "no group yet" : "create the group first");
		const taken =
			group &&
			(create ? generation !== group.generation + 1 : generation !== group.generation || epoch !== group.epoch);
		if (group && taken) {
			throw fail(409, "another commit took this epoch", { generation: group.generation, epoch: group.epoch });
		}

		const after = epoch + 1;
		conv.group = { generation, epoch: after, group_info: body.group_info };
		const by = { sender_user: session.user, sender_device: device!.id };
		const entry = this.#addEntry(conv, { kind: "commit", data: body.commit, generation, epoch, ...by });
		const welcomeEntry =
			welcome && this.#addEntry(conv, { kind: "welcome", data: body.welcome, generation, epoch: after, ...by });
		// The devices it brings in: the committer's with a creation, or with its own external commit, which takes it out
		// and in again; and those whose key packages its welcome names. A new generation's leaves are those its creation
		// brings, and a device brought in again keeps the number it has had the queue from, as the API's SetMlsLeaf does.
		const before = conv.leaves;
		if (create) conv.leaves = new Map([[device!.id, before.get(device!.id) ?? entry.seq]]);
		else if (framed.sender === 4) conv.leaves.set(device!.id, entry.seq);
		const brought = (welcomed?.welcomed ?? []).flatMap((ref) =>
			[...this.#keyPackages].filter(([, kps]) => kps.has(ref)).map(([id]) => id),
		);
		for (const id of brought) if (id !== device!.id) conv.leaves.set(id, before.get(id) ?? welcomeEntry!.seq);

		const answer = {
			seq: entry.seq,
			generation,
			epoch: after,
			...(welcomeEntry ? { welcome_seq: welcomeEntry.seq } : {}),
		};
		conv.commits.set(body.commit, answer);
		for (const member of conv.members) {
			this.#emit(member.user_id, "MLS_COMMIT", {
				conversation_id: conv.id,
				generation,
				epoch: after,
				entry: this.#forEvent(entry),
			});
		}
		const welcomedUsers = new Map<string, string[]>();
		for (const id of brought) {
			const user = this.#devices.get(id)?.user;
			if (user && id !== device!.id) welcomedUsers.set(user, [...(welcomedUsers.get(user) ?? []), id]);
		}
		for (const [user, devices] of welcomedUsers) {
			const data = {
				conversation_id: conv.id,
				generation,
				epoch: after,
				devices,
				entry: this.#forEvent(welcomeEntry!),
			};
			this.#emit(user, "MLS_WELCOME", data);
		}
		return answer;
	}

	/**
	 * An addition: the owner's commit of exactly that user, which goes to the members after it, the one it adds among
	 * them, as the API sends it. It answers with the member and the commit's answer, as the API's MemberAdded.
	 */
	#addMember(ctx: Context): Answer {
		const conv = this.#memberOf(ctx);
		const user = uuidIn(ctx.body?.user_id, "user_id");
		// The same addition again gets the answer it got.
		const added = conv.members.find((m) => m.user_id === user);
		const sent = conv.commits.get(ctx.body?.commit);
		if (added && sent) return ok({ ...added, commit: sent }, 201);
		if (conv.type !== 2) throw fail(400, "a DM's members don't change");
		if (conv.owner_id !== ctx.session.user) throw fail(403, "only the group's owner adds members");
		if (!this.#users.has(user)) throw fail(404, "user not found");
		if (conv.members.some((m) => m.user_id === user)) throw fail(409, "already a member");
		if (conv.members.length >= LIMITS.group_members) throw fail(400, "a group can have 20 members at most");
		const at = now();
		const member = { id: this.#id(), conversation_id: conv.id, user_id: user, created_at: at, updated_at: at };
		conv.members.push(member);
		try {
			return ok({ ...member, commit: this.#commit(conv, ctx, "add") }, 201);
		} catch (error) {
			// Refused: nothing changed, the members neither.
			conv.members.pop();
			throw error;
		}
	}

	/** A removal: the owner's commit of exactly that user, which they hear too. It answers with the commit's answer (200). */
	#removeMember(ctx: Context): Answer {
		const conv = this.#memberOf(ctx);
		if (conv.owner_id !== ctx.session.user) throw fail(403, "only the group's owner removes members");
		const sent = conv.commits.get(ctx.body?.commit);
		if (sent) return ok(sent); // the same removal again
		if (!conv.members.some((m) => m.user_id === ctx.params.user)) throw fail(404, "not a member");
		const commit = this.#commit(conv, ctx, "remove");
		conv.members = conv.members.filter((m) => m.user_id !== ctx.params.user);
		return ok(commit);
	}

	/**
	 * Leaving: the user's statement, signed by the session's device, of this conversation's generation and an epoch it
	 * has reached; without a group, none. The owner passes to the member who came first.
	 */
	#leave(ctx: Context): Answer {
		const conv = this.#memberOf(ctx);
		const { session, device, body } = ctx;
		if (conv.group) {
			const said = signedBody(LABEL.leave, bytesIn(body?.statement, "statement", 1024), device!.signatureKey);
			const epoch = said?.get("epoch");
			const fits =
				asUuid(said?.get("user")) === session.user &&
				asUuid(said?.get("conversation")) === conv.id &&
				asUuid(said?.get("device")) === device!.id &&
				said?.get("generation") === conv.group.generation &&
				typeof epoch === "number" &&
				epoch <= conv.group.epoch;
			if (!fits) throw fail(400, "the statement doesn't verify");
		}
		// shortcut: the API's proposals to remove the leaves of who left take its validator; none goes in the queue here.
		conv.members = conv.members.filter((m) => m.user_id !== session.user);
		if (conv.owner_id === session.user && conv.members[0]) conv.owner_id = conv.members[0].user_id;
		return NO_CONTENT;
	}

	// -------------------------------------------------------------------------------------------------------------
	// Messages.

	/** A message's MLS message, checked as the API checks it: an application message of the group, not stale. */
	#checkMessage(conv: Conversation, device: Device, ciphertext: Uint8Array) {
		const { group } = conv;
		if (!group) throw fail(409, "no group yet");
		const framed = framing(ciphertext);
		if (framed?.wire !== PRIVATE || framed.conversation !== conv.id || framed.content !== 1) {
			throw fail(400, "the message isn't an application message of this conversation's group");
		}
		if (framed.generation !== group.generation || framed.epoch! < group.epoch - LIMITS.epochs_behind) {
			throw fail(409, "stale message", { generation: group.generation, epoch: group.epoch });
		}
		if (framed.epoch! > group.epoch) throw fail(400, "the message is of an epoch the group hasn't reached");
		if (!conv.leaves.has(device.id)) throw fail(403, "this device isn't in the group");
		return framed;
	}

	#sendMessage(ctx: Context): Answer {
		const conv = this.#memberOf(ctx);
		const { session, device, body } = ctx;
		if (body?.content != null || body?.embeds != null || body?.components != null) {
			throw fail(400, "conversations are end-to-end encrypted");
		}
		const nonce = body?.nonce;
		if (typeof nonce !== "string" || !nonce || nonce.length > 64)
			throw fail(400, "a message has its nonce, 64 characters at most");
		const ciphertext = bytesIn(body?.ciphertext, "ciphertext", LIMITS.ciphertext_bytes, 1);
		const listed: unknown = body?.mentions ?? [];
		if (!Array.isArray(listed) || listed.length > 20 || listed.some((id) => typeof id !== "string" || !UUID.test(id))) {
			throw fail(400, "invalid mentions");
		}
		const ids: unknown = body?.attachment_ids ?? [];
		const files: unknown = body?.files ?? [];
		if (
			!Array.isArray(ids) ||
			!Array.isArray(files) ||
			ids.length !== files.length ||
			ids.some((id) => typeof id !== "string" || !UUID.test(id)) ||
			new Set(ids).size !== ids.length
		) {
			throw fail(400, "attachment_ids names each of files, in their order, each with an ID of its own");
		}
		const framed = this.#checkMessage(conv, device!, ciphertext);
		const sent = conv.messages.find((m) => m.sender_device_id === device!.id && m.nonce === nonce);
		if (sent) {
			if (conv.deleted.has(sent.id)) throw fail(409, "this message was deleted");
			if (sent.ciphertext !== body.ciphertext) throw fail(409, "this nonce went with another message");
			return ok(sent, 201);
		}
		const replied = this.#repliedIn(conv, body?.message_reference);
		// Its files go up first, each with the ID its client gave it, as the API keeps them: as they came, named file. One
		// up already from a send that failed (the sender's, on no message, its size and SHA-256) is taken again.
		const rows = files.map((bytes: Uint8Array<ArrayBuffer>, i) => this.#upFile(session.user, String(ids[i]), bytes));
		if (ctx.filesOnly) throw fail(499, "the client went away");
		// Whom it mentions, as the API has it: whom it names, then the author of what it answers (unless its
		// allowed_mentions say not to, or that's a notice), each once, of the members, never its own author.
		const members = conv.members.map((m) => m.user_id);
		const mentionReplied = body?.allowed_mentions == null || body.allowed_mentions.replied_user === true;
		const notice = replied?.type === 2 || replied?.type === 3;
		const named: string[] = [...listed, ...(replied && mentionReplied && !notice ? [replied.author_id] : [])];
		const mentions = [...new Set(named)].filter((user) => user !== session.user && members.includes(user));
		const at = now();
		const message: Message = {
			...{ id: this.#id(), conversation_id: conv.id, author_id: session.user, content: null, type: 0 },
			...{ created_at: at, updated_at: at, nonce, ciphertext: body.ciphertext, seq: ++conv.seq, sent_at: Date.now() },
			...{ generation: framed.generation!, epoch: framed.epoch!, sender_device_id: device!.id, edited_at: null },
			...{ mentions, message_reference: body.message_reference ?? null },
			sticker_attachment_id: body.sticker_attachment_id ?? null,
		};
		for (const row of rows) row.message_id = message.id;
		message.attachments = rows;
		conv.messages.push(message);
		if (replied) this.#repliesTo.set(message.id, replied.id);
		for (const member of conv.members) this.#emit(member.user_id, "DM_MESSAGE_CREATE", message);
		return ok(message, 201);
	}

	/**
	 * The message a message's reference answers, as the API checks it: a reply (type 0) to a message of the conversation
	 * that isn't deleted; null for no reference.
	 */
	#repliedIn(conv: Conversation, reference: any): Message | null {
		const id: unknown = reference?.message_id;
		if (id == null || id === "") return null;
		if (reference.type != null && reference.type !== 0) {
			throw fail(400, "invalid message reference: type must be 0 (reply)");
		}
		if (typeof id !== "string" || !UUID.test(id)) throw fail(400, "invalid message reference: message_id");
		const replied = conv.messages.find((m) => m.id === id && !conv.deleted.has(m.id));
		if (!replied) throw fail(404, "referenced message not found");
		return replied;
	}

	/** An edit (PATCH) or a deletion (DELETE) of the author's message: its MLS message as the queue's entry. */
	#changeMessage(ctx: Context, kind: "edit" | "delete"): Answer {
		const conv = this.#memberOf(ctx);
		const { session, params, body } = ctx;
		const message = conv.messages.find((m) => m.id === params.message);
		if (!message || message.seq === undefined) throw fail(404, "direct message not found");
		if (message.author_id !== session.user) throw fail(403, "only its author changes a message");
		const device = ctx.device && !ctx.device.removed ? ctx.device : null;
		if (!device) throw fail(403, "this session has no device");
		const ciphertext = bytesIn(body?.ciphertext, "ciphertext", LIMITS.ciphertext_bytes, 1);
		const again = conv.entries.find(
			(e) => e.kind === kind && e.message_id === message.id && e.data === body.ciphertext,
		);
		const done = (entry: Entry) =>
			ok(kind === "edit" ? { id: message.id, edited_at: message.edited_at, entry } : { id: message.id, entry });
		if (again) return done(again);
		if (conv.deleted.has(message.id)) throw fail(404, "direct message not found");
		const framed = this.#checkMessage(conv, device, ciphertext);
		const by = { sender_user: session.user, sender_device: device.id, message_id: message.id };
		const entry = this.#addEntry(conv, {
			kind,
			data: body.ciphertext,
			generation: framed.generation!,
			epoch: framed.epoch!,
			...by,
		});
		if (kind === "edit") {
			message.edited_at = now();
			const update = {
				id: message.id,
				conversation_id: conv.id,
				edited_at: message.edited_at,
				entry: this.#forEvent(entry),
			};
			for (const member of conv.members) this.#emit(member.user_id, "DM_MESSAGE_UPDATE", update);
		} else {
			// The deletion empties the message and its edits, whose entries say so.
			conv.deleted.add(message.id);
			message.ciphertext = null;
			for (const edit of conv.entries.filter((e) => e.kind === "edit" && e.message_id === message.id)) {
				Object.assign(edit, { data: "", deleted: true });
			}
			const deletion = { id: message.id, conversation_id: conv.id, entry: this.#forEvent(entry) };
			for (const member of conv.members) this.#emit(member.user_id, "DM_MESSAGE_DELETE", deletion);
		}
		return done(entry);
	}

	// -------------------------------------------------------------------------------------------------------------
	// Shared history and backups.

	#keepFile(bytes: Uint8Array<ArrayBuffer>) {
		const id = this.#id();
		this.#files.set(id, bytes);
		return id;
	}

	/**
	 * A message's file going up with the ID its client gave it: one of the same size and bytes the user sent before on no
	 * message is that one again; any other row with its ID is a 409, and one past the storage's limit a 413.
	 */
	#upFile(user: string, id: string, bytes: Uint8Array<ArrayBuffer>): FileRow {
		if (bytes.length > this.fileLimit) throw fail(413, "file too large");
		const held = this.#fileRows.get(id);
		if (held) {
			const same = this.#files.get(id);
			if (held.owner !== user || held.row.message_id !== null || !same || !equal(same, bytes)) {
				throw fail(409, "attachment ID in use");
			}
			return held.row;
		}
		const row: FileRow = {
			...{ id, message_id: null, filename: "file", content_type: "application/octet-stream" },
			...{ size_bytes: bytes.length, width: null, height: null, created_at: now(), deleted_at: null, kind: 1 },
			url: signedPath(id),
		};
		this.#fileRows.set(id, { owner: user, row });
		this.#files.set(id, bytes);
		return row;
	}

	/** The bytes the API keeps of a message's file, by its ID: what went up, never opened. */
	fileBytes(id: string): Uint8Array | undefined {
		return this.#fileRows.has(id) ? this.#files.get(id) : undefined;
	}

	#shareView({ id, conversation_id, from_user_id, kind, range, starts_at, size, parts }: Share) {
		return { id, conversation_id, from_user_id, kind, range, starts_at, size, parts };
	}

	#putShare(ctx: Context): Answer {
		const conv = this.#memberOf(ctx);
		const { session, device, params, body } = ctx;
		const to = uuidIn(body?.to_user_id, "to_user_id");
		if (!conv.members.some((m) => m.user_id === to)) throw fail(403, "the share's recipient isn't a member");
		if (body?.kind !== "share" && body?.kind !== "catch_up") throw fail(400, "a share's kind is share or catch_up");
		const parts = numberIn(body?.parts, "parts");
		if (parts < 1 || parts > LIMITS.history_share_parts) throw fail(400, "a share has 1 to 64 parts");
		if (this.#shares.has(params.share!)) throw fail(409, "share id in use");
		const share: Share = {
			...{
				id: params.share!,
				conversation_id: conv.id,
				from_user_id: session.user,
				from_device_id: device!.id,
				to_user_id: to,
			},
			...{ kind: body.kind, range: String(body.range), starts_at: timeIn(body.starts_at, "starts_at"), parts },
			...{ size: numberIn(body.size, "size"), uploaded: new Map(), completed: false, acked: new Set() },
		};
		this.#shares.set(share.id, share);
		return ok(this.#shareView(share), 201);
	}

	#ownShare(ctx: Context): Share {
		const conv = this.#memberOf(ctx);
		const share = this.#shares.get(ctx.params.share!);
		if (!share || share.conversation_id !== conv.id || share.from_device_id !== ctx.device!.id)
			throw fail(404, "no such share");
		return share;
	}

	/** A share whose parts are all up reaches its recipient (HISTORY_SHARE_CREATE); a share, not a catch-up, posts its notice. */
	#completeShare(ctx: Context): Answer {
		const share = this.#ownShare(ctx);
		if (share.uploaded.size < share.parts) throw fail(409, "the share is missing parts");
		if (share.completed) return NO_CONTENT;
		share.completed = true;
		this.#emit(share.to_user_id, "HISTORY_SHARE_CREATE", this.#shareView(share));
		if (share.kind === "share") {
			const conv = this.#conversations.get(share.conversation_id)!;
			const at = now();
			const notice: Message = {
				...{ id: this.#id(), conversation_id: conv.id, author_id: share.from_user_id, content: null, type: 4 },
				...{ created_at: at, updated_at: at, history_share: { to_user_id: share.to_user_id, range: share.range } },
			};
			conv.messages.push(notice);
			for (const member of conv.members) this.#emit(member.user_id, "DM_MESSAGE_CREATE", notice);
		}
		return NO_CONTENT;
	}

	/** A day's segment, in place of the one it names (`replaces`: its ID, or none): its header must be this route's. */
	#putSegment({ session, params, query, bytes }: Context): Answer {
		const identity = this.#identities.get(session.user);
		if (!identity) throw fail(404, "no identity");
		const header = asMap(cbor(bytes));
		const keyId = asBytes(header?.get("key_id"), 8);
		const fits =
			header?.get("v") === 1 &&
			asUuid(header.get("user")) === session.user &&
			asUuid(header.get("conversation")) === params.conversation &&
			header.get("day") === params.day &&
			typeof header.get("complete") === "boolean";
		if (!fits || !keyId) throw fail(400, "the segment's header isn't this route's");
		const current = [...this.#segments.values()].find(
			(s) => s.identity === identity.id && s.conversation_id === params.conversation && s.day === params.day,
		);
		if ((query.get("replaces") ?? "none") !== (current?.id ?? "none")) {
			throw fail(409, "another copy of this day came first", { current: current?.id ?? null });
		}
		if (current) this.#segments.delete(current.id);
		const segment: Segment = {
			...{ id: this.#id(), identity: identity.id, conversation_id: params.conversation!, day: params.day! },
			...{
				complete: header.get("complete") === true,
				key_id: bytesBase64(keyId),
				size: bytes.length,
				created_at: now(),
			},
			file: this.#keepFile(bytes),
		};
		this.#segments.set(segment.id, segment);
		return ok({ id: segment.id }, 201);
	}
}

function matches({ method, path }: RouteMatch, requestMethod: string, pathname: string) {
	return (!method || method === requestMethod) && (typeof path === "string" ? path === pathname : path.test(pathname));
}

function respond({ status, body, headers = {} }: Answer): Response {
	if (body instanceof Uint8Array) {
		return new Response(body.slice(), { status, headers: { "Content-Type": "application/octet-stream", ...headers } });
	}
	if (body === undefined) return new Response(null, { status, headers });
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}
