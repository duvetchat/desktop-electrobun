// What a browser must have to run the web's core (PLAN-E2E-CLIENTES.md, the web's worker, lock and tabs; decision
// 49.6): Web Locks, to pick the one tab that runs it; OPFS, where its database lives; and in its worker, OPFS's
// synchronous access handles, which only a dedicated worker has. Without one, the DMs show their notice and the rest
// of the app goes on, so each check reads, never calls, and says what's missing rather than throwing.

export type Missing =
	| "locks"
	| "opfs"
	| "workers"
	| "broadcast_channel"
	| "sync_access_handles"
	| "indexeddb"
	| "web_crypto";

/** Whether `path`, read from `scope` one property at a time, ends at a function: anything missing, or that throws, isn't. */
function has(scope: unknown, path: string[]): boolean {
	let value = scope;
	try {
		for (const name of path) {
			if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
			value = Reflect.get(value, name);
		}
	} catch {
		// A getter that throws, as some do where a feature is off: the feature isn't there.
		return false;
	}
	return typeof value === "function";
}

/** What the page lacks to start the core's worker and reach the user's other tabs. */
export function missingInPage(scope: unknown = globalThis): Missing[] {
	const missing: Missing[] = [];
	if (!has(scope, ["navigator", "locks", "request"])) missing.push("locks");
	if (!has(scope, ["navigator", "storage", "getDirectory"])) missing.push("opfs");
	if (!has(scope, ["Worker"])) missing.push("workers");
	if (!has(scope, ["BroadcastChannel"])) missing.push("broadcast_channel");
	return missing;
}

/** What the core's worker lacks to open its database and keep its key. */
export function missingInWorker(scope: unknown = globalThis): Missing[] {
	const missing: Missing[] = [];
	if (!has(scope, ["navigator", "storage", "getDirectory"])) missing.push("opfs");
	if (!has(scope, ["FileSystemFileHandle", "prototype", "createSyncAccessHandle"])) missing.push("sync_access_handles");
	if (!has(scope, ["indexedDB", "open"])) missing.push("indexeddb");
	if (!has(scope, ["crypto", "subtle", "encrypt"])) missing.push("web_crypto");
	return missing;
}
