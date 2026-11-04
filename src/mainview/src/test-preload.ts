import { afterAll, mock } from "bun:test";

// Each test file runs in a global object and a module registry of its own (`bun test --isolate`, #176), and this file
// runs first in each one (bunfig.toml): every file starts from the same environment, alone or in the full run. Once a
// file's tests are done, it fails the run if the file left fetch replaced (#166), or if the files shared a global object.

/** The webview's localStorage as the code under test uses it, empty when a file starts. */
class MemoryStorage {
	#items = new Map<string, string>();
	get length() {
		return this.#items.size;
	}
	key(index: number) {
		return [...this.#items.keys()][index] ?? null;
	}
	getItem(key: string) {
		return this.#items.get(key) ?? null;
	}
	setItem(key: string, value: string) {
		this.#items.set(key, String(value));
	}
	removeItem(key: string) {
		this.#items.delete(key);
	}
	clear() {
		this.#items.clear();
	}
}

// What the app gets from Vite (vite.config.ts's defines), from SvelteKit ($app/environment) and from the webview, as the
// code reads them: the API at an address that never resolves, SvelteKit outside a browser, and no session kept.
Object.assign(globalThis, {
	VITE_API_URL: "https://api.test",
	VITE_WS_URL: "",
	VITE_DOMAIN_TARGET_ENV: "duvet",
	localStorage: new MemoryStorage(),
});
mock.module("$app/environment", () => ({ browser: false }));

const realFetch = globalThis.fetch;
// Without --isolate, Bun runs every file in the global object of the first, where this file ran once: by the end of
// the run, Bun.main names another file.
const testFile = Bun.main;

afterAll(() => {
	if (Bun.main !== testFile) {
		throw new Error(
			"test files ran in one global object, each seeing what the files before it left: run `bun test --isolate` (#176)",
		);
	}
	if (globalThis.fetch !== realFetch) {
		throw new Error("a test file left globalThis.fetch replaced: put the real one back when its tests end (#166)");
	}
});
