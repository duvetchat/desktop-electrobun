import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The app's language and the Bun process's (#464): the main window's page tells Bun its language, for the menu bar and
// the windows' titles, and every page takes the system's languages from Bun, whose list is whole where the web view's
// may have only the first. Against a fake of the app's RPC.
const rpc = {
	told: [] as { locale: string }[],
	asks: 0,
	answers: [] as ((languages: string[]) => void)[],
	send: { appLanguage: (params: { locale: string }) => void rpc.told.push(params) },
	request: {
		systemLanguages: () => {
			rpc.asks++;
			return new Promise<string[]>((resolve) => rpc.answers.push(resolve));
		},
	},
};
let client: typeof rpc | null = rpc;
mock.module("$lib/electrobun-rpc", () => ({ getElectrobunRpc: () => Promise.resolve(client) }));
// The root layout's load, as it runs in a window's page: in a browser, the desktop app's or the web's.
const shell = { chrome: "mac" as "mac" | "web" };
mock.module("$app/environment", () => ({ browser: true }));
mock.module("$lib/platform", () => ({ currentShell: () => shell }));
const { followSystemLanguages, primeSystemLanguages, tellBunLanguage } = await import("./bun-link");
const { regionalLocale } = await import("$lib/i18n");
const { load } = await import("../../routes/+layout");

const settle = async () => {
	for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

test("Bun is told the language the page is in", async () => {
	tellBunLanguage("es");
	tellBunLanguage("en");
	await settle();
	expect(rpc.told).toEqual([{ locale: "es" }, { locale: "en" }]);
});

// regionalLocale is the system's tag in the app's language: en-GB from Bun's list, where the tests' web view has none.
test("the system's languages are Bun's, asked as the page starts and again when the system's change", async () => {
	const page = new EventTarget();
	expect(regionalLocale()).toBe("en");
	const stop = followSystemLanguages(undefined, page);
	await settle();
	expect(rpc.asks).toBe(1);
	rpc.answers.shift()?.(["en-GB", "es-CO"]);
	await settle();
	expect(regionalLocale()).toBe("en-GB");

	page.dispatchEvent(new Event("languagechange"));
	await settle();
	expect(rpc.asks).toBe(2);
	rpc.answers.shift()?.(["en-AU"]);
	await settle();
	expect(regionalLocale()).toBe("en-AU");

	stop();
	page.dispatchEvent(new Event("languagechange"));
	await settle();
	expect(rpc.asks).toBe(2);
});

test("an earlier ask's late answer doesn't undo a later one's, nor does one that comes after the page stopped", async () => {
	const page = new EventTarget();
	const stop = followSystemLanguages(undefined, page);
	page.dispatchEvent(new Event("languagechange"));
	await settle();
	const [first, second] = rpc.answers.splice(0);
	second?.(["en-NZ"]);
	await settle();
	first?.(["en-CA"]);
	await settle();
	expect(regionalLocale()).toBe("en-NZ");
	stop();
	followSystemLanguages(undefined, page)();
	await settle();
	rpc.answers.shift()?.(["en-IE"]);
	await settle();
	expect(regionalLocale()).toBe("en-NZ");
});

test("outside the desktop app there's no Bun: nothing is told or asked, and nothing breaks", async () => {
	client = null;
	const asks = rpc.asks;
	tellBunLanguage("fr");
	followSystemLanguages(undefined, new EventTarget())();
	await settle();
	expect(rpc.told.at(-1)).toEqual({ locale: "en" });
	expect(rpc.asks).toBe(asks);
	client = rpc;
});

// The page draws once its load is done (routes/+layout.ts): Bun's list is asked for before, or the first frame would
// have the web view's languages and the next Bun's (dates in US order, then British).
describe("before the page first draws", () => {
	test("Bun's languages are asked for and waited for", async () => {
		const asks = rpc.asks;
		let done = false;
		const primed = primeSystemLanguages().then(() => (done = true));
		await settle();
		expect(rpc.asks).toBe(asks + 1);
		expect(done).toBe(false);
		rpc.answers.shift()?.(["en-IN"]);
		await primed;
		expect(regionalLocale()).toBe("en-IN");
	});

	test("a Bun slow to answer holds the page a short while only, and its late answer is left", async () => {
		await primeSystemLanguages(undefined, 20);
		expect(regionalLocale()).toBe("en-IN");
		rpc.answers.shift()?.(["en-ZA"]);
		await settle();
		expect(regionalLocale()).toBe("en-IN");
	});

	test("a Bun that fails to answer, or none, leaves the languages as they were", async () => {
		const answer = rpc.request.systemLanguages;
		rpc.request.systemLanguages = () => Promise.reject(new Error("no answer"));
		await primeSystemLanguages();
		rpc.request.systemLanguages = answer;
		await primeSystemLanguages(() => Promise.reject(new Error("no RPC")));
		client = null;
		await primeSystemLanguages();
		client = rpc;
		expect(regionalLocale()).toBe("en-IN");
	});

	test("the root layout's load waits for them in the desktop app, and asks nothing on the web", async () => {
		let loaded = false;
		const loading = load().then(() => (loaded = true));
		await settle();
		expect(loaded).toBe(false);
		rpc.answers.shift()?.(["en-SG"]);
		await loading;
		expect(regionalLocale()).toBe("en-SG");

		shell.chrome = "web";
		const asks = rpc.asks;
		await load();
		expect(rpc.asks).toBe(asks);
		shell.chrome = "mac";
	});

	test("the root layout's load asks Bun before it puts the page in its language", () => {
		const source = readFileSync(join(import.meta.dir, "..", "..", "routes", "+layout.ts"), "utf8");
		expect(source).toMatch(
			/if \(currentShell\(\)\.chrome !== "web"\) await primeSystemLanguages\(\);\s*await startLocale\(\);/,
		);
		expect(source.match(/startLocale\(/g)).toHaveLength(1);
	});
});

// The root layout is what links them (+layout.svelte): without its calls Bun never hears of a change, and the menu bar
// and the windows' titles keep the language the app started in, whatever the page says.
describe("the root layout", () => {
	const layout = readFileSync(join(import.meta.dir, "..", "..", "routes", "+layout.svelte"), "utf8");

	test("tells Bun the main window's language, as it starts and on each change, in the desktop app only", () => {
		expect(layout).toMatch(
			/\$effect\(\(\) => \{\s*if \(shell\.window === "main" && shell\.chrome !== "web"\) tellBunLanguage\(currentLocale\(\)\);\s*\}\);/,
		);
		expect(layout.match(/tellBunLanguage\(/g)).toHaveLength(1);
	});

	test("follows the system's languages as Bun reads them in each window of the desktop app, until the page goes", () => {
		const mount = layout.slice(layout.indexOf("onMount(() => {"));
		expect(mount).toContain('const stopSystemLanguages = shell.chrome !== "web" ? followSystemLanguages() : () => {};');
		expect(mount).toMatch(/return \(\) => \{[^}]*\bstopSystemLanguages\(\);[^}]*\};/);
		expect(layout.match(/followSystemLanguages\(/g)).toHaveLength(1);
	});
});
