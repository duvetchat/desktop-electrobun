// The browser harness (PLAN-E2E-CLIENTES.md, Task 8): builds the harness page (src/mainview/e2e-browser/) with Vite,
// serves it with `vite preview` on 127.0.0.1, and runs a suite's cases (src/mainview/e2e-browser/<suite>.cases.ts) in
// headless Chrome, over the DevTools protocol, and in headless Firefox, over WebDriver BiDi: Firefox has no DevTools
// protocol any more. Each browser runs in a profile of its own, in a temporary folder deleted after, and listens on
// 127.0.0.1 alone. The page's build is the release one, under the app's CSP (e2e-browser/vite.config.ts).
//
//   bun scripts/web-e2e.ts [--browser chrome|firefox] [suite ...]
//
// The suite is `host` when none is named. Without --browser it runs every browser it finds, and fails with none.
// CHROME and FIREFOX name a browser's binary; without them it looks in the usual places. Never `firefox` on the PATH:
// where it's a snap's launcher, it hangs without the snap's daemon.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, BrowserName, Case, Tab } from "../src/mainview/e2e-browser/harness";

const mainview = join(import.meta.dir, "..", "src", "mainview");
const vite = join(mainview, "node_modules", "vite", "bin", "vite.js");
const harnessConfig = join("e2e-browser", "vite.config.ts");

/** Where to look for each browser when its variable is unset. */
const BINARIES: Record<BrowserName, string[]> = {
	chrome: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
	firefox: ["/snap/firefox/current/usr/lib/firefox/firefox", "/usr/lib/firefox/firefox", "/opt/firefox/firefox"],
};

/** How long a case may take, and a browser or the preview to come up. */
const CASE_MS = 120_000;
const START_MS = 30_000;

/** A browser's binary: its variable's, else the first of BINARIES that exists, else none. */
export function browserBinary(name: BrowserName, env: Record<string, string | undefined> = process.env) {
	const given = env[name.toUpperCase()];
	if (given) return given;
	return BINARIES[name].find((path) => existsSync(path)) ?? null;
}

/** A JSON reply, as the DevTools protocol and BiDi send them: an `id` with a `result` or an `error`, else an event. */
interface Reply {
	id?: number;
	result?: any;
	error?: string | { message: string };
	message?: string;
}

/** A browser's debugging socket: each command with its id, settled by the reply that carries it. Events are ignored. */
class Wire {
	#socket: WebSocket;
	#next = 1;
	#waiting = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>();

	private constructor(socket: WebSocket) {
		this.#socket = socket;
		socket.addEventListener("message", (event) => this.#take(String(event.data)));
		socket.addEventListener("close", () => {
			for (const waiting of this.#waiting.values()) waiting.reject(new Error("the browser closed its socket"));
			this.#waiting.clear();
		});
	}

	static open(url: string): Promise<Wire> {
		return new Promise((resolve, reject) => {
			const socket = new WebSocket(url);
			socket.addEventListener("open", () => resolve(new Wire(socket)), { once: true });
			socket.addEventListener("error", () => reject(new Error(`can't connect to ${url}`)), { once: true });
		});
	}

	#take(text: string) {
		const reply: Reply = JSON.parse(text);
		const waiting = reply.id === undefined ? undefined : this.#waiting.get(reply.id);
		if (!waiting || reply.id === undefined) return;
		this.#waiting.delete(reply.id);
		if (reply.error === undefined) waiting.resolve(reply.result);
		else
			waiting.reject(
				new Error(typeof reply.error === "string" ? `${reply.error}: ${reply.message}` : reply.error.message),
			);
	}

	send(method: string, params: object = {}, sessionId?: string): Promise<any> {
		const id = this.#next++;
		const result = new Promise((resolve, reject) => this.#waiting.set(id, { resolve, reject }));
		this.#socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
		return result;
	}

	close() {
		this.#socket.close();
	}
}

/**
 * A child's stderr read to its end, its last 64 KiB kept for a failure's message, and the first match of `pattern` in
 * it: a browser says there where it listens. Read to the end, so a browser never stops on a full pipe.
 */
function readStderr(child: Bun.Subprocess<"ignore", "ignore", "pipe">, pattern: RegExp) {
	let text = "";
	let found: (match: RegExpMatchArray) => void = () => {};
	const match = new Promise<RegExpMatchArray>((resolve) => (found = resolve));
	void (async () => {
		const decoder = new TextDecoder();
		for await (const chunk of child.stderr) {
			text = (text + decoder.decode(chunk, { stream: true })).slice(-65_536);
			const matched = text.match(pattern);
			if (matched) found(matched);
		}
	})();
	return { match, tail: () => text };
}

async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	let timer: Timer | undefined;
	const late = new Promise<never>(
		(_, reject) => (timer = setTimeout(() => reject(new Error(`${what} took over ${ms} ms`)), ms)),
	);
	try {
		return await Promise.race([promise, late]);
	} finally {
		clearTimeout(timer);
	}
}

/** What a tab runs: `fn` called with `args`, its result wrapped so `undefined` crosses too. */
const callOf = (fn: (...args: any[]) => unknown, args: unknown[]) =>
	`(async () => JSON.stringify({ value: await (${fn.toString()})(...${JSON.stringify(args)}) }))()`;

/** A tab, given how its browser evaluates an expression there (to a string), reloads it and closes it. */
function tabOf(
	evaluate: (expression: string) => Promise<string>,
	reload: () => Promise<void>,
	close: () => Promise<void>,
) {
	const ready = async () => {
		const deadline = Date.now() + START_MS;
		for (;;) {
			// While the page loads, its old document can answer, or none: the mark tells the new one.
			const loaded = await evaluate(`String(typeof duvetE2E === "object" && !window.__reloading)`).catch(() => "false");
			if (loaded === "true") return;
			if (Date.now() > deadline) throw new Error("the harness page didn't load");
			await Bun.sleep(50);
		}
	};
	const tab: Tab = {
		async run(fn, ...args) {
			return JSON.parse(await evaluate(callOf(fn, args))).value;
		},
		async reload() {
			await evaluate(`String(window.__reloading = true)`);
			await reload();
			await ready();
		},
		close,
	};
	return { tab, ready };
}

/** A running browser: the cases' Browser, and how to end it. */
interface Launched {
	browser: Browser;
	close(): Promise<void>;
}

/** Ends a browser: its own way first, then by signal, then its profile goes. */
async function end(child: Bun.Subprocess, closeGently: () => Promise<unknown>, profile: string) {
	await within(closeGently(), 5_000, "closing the browser").catch(() => child.kill("SIGKILL"));
	await within(child.exited, 5_000, "the browser's exit").catch(() => child.kill("SIGKILL"));
	await child.exited;
	rmSync(profile, { recursive: true, force: true });
}

export async function launchChrome(binary: string, page: string): Promise<Launched> {
	const profile = mkdtempSync(join(tmpdir(), "duvet-web-e2e-chrome-"));
	const child = Bun.spawn(
		[
			binary,
			"--headless",
			"--remote-debugging-address=127.0.0.1",
			"--remote-debugging-port=0",
			`--user-data-dir=${profile}`,
			"--no-first-run",
			"--no-default-browser-check",
			"--disable-background-networking",
			"--disable-component-update",
			"--disable-sync",
			"--mute-audio",
			// A container's /dev/shm can be too small for a renderer's memory: /tmp then.
			"--disable-dev-shm-usage",
			// The profile's own key, not the system keyring's: without a desktop session, Chrome 158 waited out D-Bus's
			// 25 s for the keyring at its first request.
			"--password-store=basic",
			// Chrome's sandbox won't start as root, nor, outside the .deb's AppArmor profile, where Ubuntu restricts user
			// namespaces, as on CI's runner: CHROME_NO_SANDBOX says so. The page it runs is this harness's alone.
			...(process.getuid?.() === 0 || process.env.CHROME_NO_SANDBOX ? ["--no-sandbox"] : []),
			"about:blank",
		],
		{ stdin: "ignore", stdout: "ignore", stderr: "pipe" },
	);
	const stderr = readStderr(child, /DevTools listening on (ws:\/\/\S+)/);
	let wire: Wire;
	try {
		const listening = await within(stderr.match, START_MS, "Chrome's start");
		wire = await Wire.open(listening[1] ?? "");
	} catch (error) {
		await end(child, async () => {}, profile);
		throw new Error(`Chrome didn't start: ${String(error)}\n${stderr.tail()}`, { cause: error });
	}
	const browser: Browser = {
		name: "chrome",
		async open() {
			const { targetId } = await wire.send("Target.createTarget", { url: page });
			const { sessionId } = await wire.send("Target.attachToTarget", { targetId, flatten: true });
			const evaluate = async (expression: string) => {
				const reply = await wire.send(
					"Runtime.evaluate",
					{ expression, awaitPromise: true, returnByValue: true },
					sessionId,
				);
				if (reply.exceptionDetails) {
					throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
				}
				return String(reply.result.value);
			};
			const { tab, ready } = tabOf(
				evaluate,
				() => wire.send("Page.reload", {}, sessionId),
				() => wire.send("Target.closeTarget", { targetId }),
			);
			await ready();
			return tab;
		},
	};
	return { browser, close: () => end(child, () => wire.send("Browser.close"), profile) };
}

export async function launchFirefox(binary: string, page: string): Promise<Launched> {
	const profile = mkdtempSync(join(tmpdir(), "duvet-web-e2e-firefox-"));
	// What a fresh profile would show or fetch on its first start. The remote agent sets the rest it recommends.
	writeFileSync(
		join(profile, "user.js"),
		[
			'user_pref("browser.shell.checkDefaultBrowser", false);',
			'user_pref("browser.aboutwelcome.enabled", false);',
			'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
			'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);',
			'user_pref("app.update.disabledForTesting", true);',
		].join("\n"),
	);
	const child = Bun.spawn(
		[binary, "--headless", "--no-remote", "--profile", profile, "--remote-debugging-port", "0", "about:blank"],
		{ stdin: "ignore", stdout: "ignore", stderr: "pipe" },
	);
	const stderr = readStderr(child, /WebDriver BiDi listening on (ws:\/\/\S+)/);
	let wire: Wire;
	try {
		const listening = await within(stderr.match, START_MS, "Firefox's start");
		wire = await Wire.open(`${listening[1] ?? ""}/session`);
		await wire.send("session.new", { capabilities: {} });
	} catch (error) {
		await end(child, async () => {}, profile);
		throw new Error(`Firefox didn't start: ${String(error)}\n${stderr.tail()}`, { cause: error });
	}
	const browser: Browser = {
		name: "firefox",
		async open() {
			const { context } = await wire.send("browsingContext.create", { type: "tab" });
			await wire.send("browsingContext.navigate", { context, url: page, wait: "complete" });
			const evaluate = async (expression: string) => {
				const reply = await wire.send("script.evaluate", {
					expression,
					target: { context },
					awaitPromise: true,
					resultOwnership: "none",
				});
				if (reply.type === "exception") throw new Error(reply.exceptionDetails.text);
				return String(reply.result.value);
			};
			const { tab, ready } = tabOf(
				evaluate,
				() => wire.send("browsingContext.reload", { context, wait: "complete" }),
				() => wire.send("browsingContext.close", { context }),
			);
			await ready();
			return tab;
		},
	};
	return { browser, close: () => end(child, () => wire.send("browser.close"), profile) };
}

/** A port nobody listens on now, on 127.0.0.1. */
function freePort(): number {
	const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
	const { port } = listener;
	listener.stop(true);
	return port;
}

/** Vite, from src/mainview, where it's installed, with the harness's config. */
function runVite(args: string[], quiet = false) {
	return Bun.spawn([process.execPath, vite, ...args, "--config", harnessConfig], {
		cwd: mainview,
		stdin: "ignore",
		stdout: quiet ? "ignore" : "inherit",
		stderr: "inherit",
	});
}

/** Builds the harness page into `out` and serves it there; resolves with its URL and how to stop it. */
export async function serveHarness(out: string): Promise<{ url: string; stop(): Promise<void> }> {
	if ((await runVite(["build", "--outDir", out, "--emptyOutDir", "--logLevel", "warn"]).exited) !== 0) {
		throw new Error("the harness page didn't build");
	}
	const port = freePort();
	const server = runVite(
		["preview", "--outDir", out, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
		true,
	);
	const url = `http://127.0.0.1:${port}/`;
	const stop = async () => {
		server.kill();
		await server.exited;
	};
	const deadline = Date.now() + START_MS;
	for (;;) {
		if (
			await fetch(url).then(
				(response) => response.ok,
				() => false,
			)
		)
			return { url, stop };
		if (Date.now() > deadline || server.exitCode !== null) {
			await stop();
			throw new Error("vite preview didn't serve the harness page");
		}
		await Bun.sleep(100);
	}
}

/** A suite's cases, from src/mainview/e2e-browser/<suite>.cases.ts. */
async function suiteCases(suite: string): Promise<Case[]> {
	if (!/^[a-z][a-z0-9-]*$/.test(suite)) throw new Error(`no suite ${suite}`);
	const module: { default: Case[] } = await import(join(mainview, "e2e-browser", `${suite}.cases.ts`));
	return module.default;
}

/**
 * Runs each case in a browser of its own, a fresh profile each: nothing one leaves in OPFS, IndexedDB or a lock reaches
 * the next (and the core's OPFS pool holds six files, which a run's cases would fill). Says how many failed.
 */
async function runCases(name: BrowserName, binary: string, page: string, suite: string, cases: Case[]) {
	let failed = 0;
	for (const each of cases) {
		const title = `${name} · ${suite} · ${each.name}`;
		const skipped = each.skip?.[name];
		if (skipped) {
			console.log(`- ${title}: skipped, ${skipped}`);
			continue;
		}
		const lines: string[] = [];
		const started = performance.now();
		try {
			const launched = name === "chrome" ? await launchChrome(binary, page) : await launchFirefox(binary, page);
			try {
				await within(
					each.run(launched.browser, (line) => lines.push(line)),
					CASE_MS,
					"the case",
				);
			} finally {
				await launched.close();
			}
			console.log(`✓ ${title} (${Math.round(performance.now() - started)} ms)`);
		} catch (error) {
			failed++;
			console.log(`✗ ${title} (${Math.round(performance.now() - started)} ms)\n  ${String(error)}`);
		}
		for (const line of lines) console.log(`    ${line}`);
	}
	return failed;
}

async function main(argv: string[]) {
	const at = argv.indexOf("--browser");
	const asked = at === -1 ? null : argv[at + 1];
	if (asked !== null && asked !== "chrome" && asked !== "firefox") throw new Error("--browser takes chrome or firefox");
	const suites = argv.filter((arg, index) => !arg.startsWith("--") && (at === -1 || index !== at + 1));
	const browsers = (asked ? [asked] : (["chrome", "firefox"] as const)).flatMap((name) => {
		const binary = browserBinary(name);
		if (binary) return [{ name, binary }];
		if (asked) throw new Error(`${name} isn't here: set ${name.toUpperCase()} to its binary`);
		console.log(`- ${name}: not found, skipped`);
		return [];
	});
	if (browsers.length === 0) throw new Error("no browser to run the cases in");
	const loaded = await Promise.all(
		(suites.length ? suites : ["host"]).map(async (suite) => ({ suite, cases: await suiteCases(suite) })),
	);

	const out = mkdtempSync(join(tmpdir(), "duvet-web-e2e-page-"));
	let failed = 0;
	try {
		const harness = await serveHarness(out);
		try {
			for (const { name, binary } of browsers) {
				for (const { suite, cases } of loaded) failed += await runCases(name, binary, harness.url, suite, cases);
			}
		} finally {
			await harness.stop();
		}
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
	if (failed) {
		console.log(`${failed} failed`);
		process.exit(1);
	}
}

if (import.meta.main) await main(process.argv.slice(2));
