// The page the browser cases (<suite>.cases.ts) run in, through scripts/web-e2e.ts: built in Vite's release build, as
// the app is, under the app's CSP (vite.config.ts here). What a case reaches is on window.duvetE2E: the host, the tabs
// and the web's checks, and a tab joined to a user's tabs as the engine will join them (Task 12), with a few methods of
// its own in the engine's place.
import { CoreError } from "$lib/e2e/errors";
import { startCoreWorker, WebCoreHost } from "$lib/e2e/host-web";
import { KEYS_DATABASE, KEYS_STORE, unwrapKey } from "$lib/e2e/web/keys";
import { filesOf, NAME_BYTES, POOL, SLOTS, slotName } from "$lib/e2e/web/pool";
import { missingInPage } from "$lib/e2e/web/support";
import { BrowserTabs } from "$lib/e2e/web/tabs";

/** The workers this page's hosts started. */
let workers = 0;
/** What each host's worker posted to this page. */
const received: unknown[] = [];

/** A host whose workers this page counts, and whose messages it keeps. */
function newHost() {
	return new WebCoreHost({
		start: () => {
			workers++;
			const worker = startCoreWorker();
			worker.addEventListener("message", (event: MessageEvent) => received.push(event.data));
			return worker;
		},
	});
}

/** This tab as one of a user's tabs: while it leads, its core is open, and it serves the methods below. */
class Joined {
	readonly host = newHost();
	readonly tabs: BrowserTabs;
	/** What the core's open answered, once this tab led. */
	opened: Awaited<ReturnType<WebCoreHost["open"]>> | null = null;
	/** The tabs that said they lead, in order. */
	readonly leaders: string[] = [];
	/** While true, this tab answers no request, as a tab stuck on a long command. */
	stall = false;

	constructor(readonly userId: string) {
		this.tabs = new BrowserTabs({
			userId,
			methods: {
				whoami: () => this.#answer(() => this.tabs.tab),
				status: () => this.#answer(() => this.host.handle({ cmd: "status" })),
			},
			// As the engine's start does (PLAN-E2E-CLIENTES.md, the engine): open, then a device if there's none.
			lead: async () => {
				this.opened = await this.host.open(userId);
				if (this.opened.state !== "ready") return;
				const status = await this.host.handle<{ device_id?: string }>({ cmd: "status" });
				if (!status.device_id) {
					await this.host.handle({ cmd: "create_device", user_id: userId, device_id: crypto.randomUUID() });
				}
			},
			onLeader: (tab) => this.leaders.push(tab),
		});
	}

	#answer<T>(answer: () => T): Promise<Awaited<T>> {
		return this.stall ? new Promise(() => {}) : Promise.resolve(answer());
	}
}

/** What a request's result looks like when it fails: its CoreError's code, else what it threw; null when it worked. */
async function failure(promise: Promise<unknown> | undefined): Promise<string | null> {
	if (!promise) return "nothing to run";
	try {
		await promise;
		return null;
	} catch (error) {
		return error instanceof CoreError ? `CoreError ${error.code}` : String(error);
	}
}

/** A folder of OPFS, or null when it isn't there. */
async function folder(parent: FileSystemDirectoryHandle, name: string) {
	try {
		return await parent.getDirectoryHandle(name);
	} catch {
		return null;
	}
}

/** IndexedDB's keys database as a script of this page reads it: its stores, and its records by user. */
async function keyRecords(): Promise<{ stores: string[]; users: IDBValidKey[]; values: unknown[] }> {
	const known = await indexedDB.databases();
	if (!known.some((database) => database.name === KEYS_DATABASE)) return { stores: [], users: [], values: [] };
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(KEYS_DATABASE);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	try {
		const read = <T>(request: IDBRequest<T>) =>
			new Promise<T>((resolve, reject) => {
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
		const store = database.transaction(KEYS_STORE, "readonly").objectStore(KEYS_STORE);
		const [users, values] = await Promise.all([read(store.getAllKeys()), read(store.getAll())]);
		return { stores: [...database.objectStoreNames], users, values };
	} finally {
		database.close();
	}
}

const harness = {
	WebCoreHost,
	startCoreWorker,
	CoreError,
	missingInPage,
	newHost,
	failure,
	/** The workers this page's hosts started, and what they posted to it. */
	workers: () => workers,
	received: () => received,
	/** This tab, joined to `userId`'s tabs: its tab's ID. */
	joined: null as Joined | null,
	join(userId: string) {
		this.joined = new Joined(userId);
		return this.joined.tabs.tab;
	},
	/** What this page loaded, by URL: the core's worker shows here once it's started. */
	loaded: () => performance.getEntriesByType("resource").map((entry) => entry.name),
	/** The page's CSP, and what it refused. */
	csp: () => document.querySelector('meta[http-equiv="content-security-policy"]')?.getAttribute("content") ?? null,
	violations: [] as string[],
	/**
	 * What IndexedDB's keys database holds, as a script of this page reads it: each record's fields, and of its wrapping
	 * key, whether it's a CryptoKey and what it allows, and whether it can be exported. Nothing, before a worker made it.
	 */
	async keysKept() {
		const { stores, users, values } = await keyRecords();
		const records = await Promise.all(
			values.map(async (value: unknown, index) => {
				const record = typeof value === "object" && value !== null ? value : {};
				const wrapping: unknown = Reflect.get(record, "wrapping");
				const wrapped: unknown = Reflect.get(record, "wrapped");
				const key = wrapping instanceof CryptoKey ? wrapping : null;
				const user = users[index];
				return {
					user: typeof user === "string" ? user : null,
					fields: Object.keys(record).sort(),
					wrapping: key && {
						extractable: key.extractable,
						algorithm: key.algorithm.name,
						usages: [...key.usages].sort(),
					},
					exportRefused: key ? (await failure(crypto.subtle.exportKey("raw", key))) !== null : null,
					sealedBytes: wrapped instanceof ArrayBuffer ? wrapped.byteLength : null,
				};
			}),
		);
		return { stores, records };
	},
	/**
	 * Which of the messages this page's workers posted hold the user's database key: its bytes, in hex or in base64.
	 * The key is unwrapped here with the CryptoKey IndexedDB keeps beside it, as any script of the page could.
	 */
	async keyLeaks(userId: string) {
		const { users, values } = await keyRecords();
		const key = await unwrapKey(userId, values[users.indexOf(userId)]);
		const hex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
		const base64 = btoa(String.fromCharCode(...key));
		const found = received.flatMap((message, index) => {
			const text = JSON.stringify(message, (_name, value: unknown) =>
				ArrayBuffer.isView(value)
					? hex(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
					: value instanceof ArrayBuffer
						? hex(new Uint8Array(value))
						: value,
			);
			return text.includes(hex(key)) || text.includes(base64) ? [index] : [];
		});
		return { checked: received.length, found };
	},
	/**
	 * The names of the files in OPFS's pool, as their slots' headers say, read with a file's own reader (the page has
	 * no synchronous access handles): only while no worker holds the pool.
	 */
	async poolNames(): Promise<string[]> {
		const pool = await folder(await navigator.storage.getDirectory(), POOL);
		const slots = pool && (await folder(pool, SLOTS));
		if (!slots) return [];
		const names: string[] = [];
		for (const file of await filesOf(slots)) {
			const header = new Uint8Array(await (await file.getFile()).slice(0, NAME_BYTES).arrayBuffer());
			const name = slotName(header);
			if (name !== null) names.push(name);
		}
		return names.sort();
	},
};

document.addEventListener("securitypolicyviolation", (event) =>
	harness.violations.push(`${event.violatedDirective} ${event.blockedURI}`),
);

declare global {
	var duvetE2E: typeof harness;
}
globalThis.duvetE2E = harness;
