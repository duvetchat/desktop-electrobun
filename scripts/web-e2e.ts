// The browser harness (PLAN-E2E-CLIENTES.md, Tasks 8 and 34): runs a suite's cases (src/mainview/e2e-browser/
// <suite>.cases.ts) in headless Chrome, over the DevTools protocol, and in headless Firefox, over WebDriver BiDi: Firefox
// has no DevTools protocol any more. Each browser runs in a profile of its own, in a temporary folder deleted after, and
// listens on 127.0.0.1 alone. A suite runs on one of two pages, each built in a temporary folder and served on 127.0.0.1:
//   - the harness page (e2e-browser/), the host's cases' (`host`): built by Vite in its release build, under the app's
//     CSP (e2e-browser/vite.config.ts), and served with `vite preview`;
//   - the app itself (`app`), against a stack the API's harness keeps up (E2E_KEEP=1) and the API and gateway that run
//     on it, as the API's clients' suites name them: E2E_LIVE_API, E2E_LIVE_WS, E2E_LIVE_ACCOUNTS (JSON: each account's
//     id and email) and E2E_LIVE_PASSWORD. The app is built as the desktop's development build is (`vite build --mode
//     development`, its addresses baked in), and served at http://127.0.0.1:55173, the origin the harness's API takes
//     (its CORS_ORIGINS and FRONTEND_URL). Its requests to the API go through a proxy here, where a case can hold one
//     (Stack.hold), and its socket goes to the gateway itself. Each browser's run takes a pair of the accounts of its
//     own (Chrome the first two, Firefox the next two), so one fresh stack serves both.
//
//   bun scripts/web-e2e.ts [--browser chrome|firefox] [suite ...]
//
// The suite is `host` when none is named. Without --browser it runs every browser it finds, and fails with none.
// CHROME and FIREFOX name a browser's binary; without them it looks in the usual places. Never `firefox` on the PATH:
// where it's a snap's launcher, it hangs without the snap's daemon.
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { version } from "../package.json";
import type {
	Account,
	Browser,
	BrowserName,
	Forwarded,
	Held,
	Stack,
	Suite,
	SuiteRun,
	Tab,
} from "../src/mainview/e2e-browser/harness";

const mainview = join(import.meta.dir, "..", "src", "mainview");
const vite = join(mainview, "node_modules", "vite", "bin", "vite.js");
const harnessConfig = join("e2e-browser", "vite.config.ts");

/** Where to look for each browser when its variable is unset. */
const BINARIES: Record<BrowserName, string[]> = {
	chrome: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
	firefox: ["/snap/firefox/current/usr/lib/firefox/firefox", "/usr/lib/firefox/firefox", "/opt/firefox/firefox"],
};

/** How long a case may take (the app's, which sign in and set up devices, longer), and a browser or a page to come up. */
const CASE_MS = 120_000;
const APP_CASE_MS = 240_000;
const START_MS = 30_000;
/** The origin the API's harness takes from a browser (its CORS_ORIGINS and FRONTEND_URL): where the app is served. */
const APP_PORT = 55173;
/** Which of the stack's accounts each browser's run takes. */
const ACCOUNTS: Record<BrowserName, [number, number]> = { chrome: [0, 1], firefox: [2, 3] };

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

/** The app's stack as served, before a browser's run takes its accounts; and the end of a case's holds. */
type ServedStack = Omit<Stack, "accounts"> & { all: Account[]; endHolds(): void };

/** A page the suites run on, served: its URL, the expression that's true once a tab of it is ready, and its stack. */
interface Served {
	url: string;
	ready: string;
	stack: ServedStack | null;
	stop(): Promise<void>;
}

/**
 * A tab, given how its browser evaluates an expression there (to a string), reloads it and closes it, and the expression
 * that's true once its page is ready.
 */
function tabOf(
	evaluate: (expression: string) => Promise<string>,
	reload: () => Promise<void>,
	close: () => Promise<void>,
	isReady: string,
) {
	const ready = async () => {
		const deadline = Date.now() + START_MS;
		for (;;) {
			// While the page loads, its old document can answer, or none: the mark tells the new one.
			const loaded = await evaluate(`String((${isReady}) && !window.__reloading)`).catch(() => "false");
			if (loaded === "true") return;
			if (Date.now() > deadline) throw new Error("the page didn't load");
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

/** What a run has open (a browser, a build, a server, a built page), each with its ending, for a signal. */
const open = new Set<() => Promise<unknown>>();

/** Keeps `ending` for a signal to run, until what it ends is ended the usual way: the function returned forgets it. */
function track(ending: () => Promise<unknown>) {
	open.add(ending);
	return () => open.delete(ending);
}

export async function launchChrome(binary: string, page: Served): Promise<Launched> {
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
			// The app's layout at a laptop's size: headless Chrome's own is 800×600.
			"--window-size=1280,800",
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
	const untrack = track(() => end(child, async () => child.kill(), profile));
	const stderr = readStderr(child, /DevTools listening on (ws:\/\/\S+)/);
	let wire: Wire;
	try {
		const listening = await within(stderr.match, START_MS, "Chrome's start");
		wire = await Wire.open(listening[1] ?? "");
	} catch (error) {
		untrack();
		await end(child, async () => child.kill(), profile);
		throw new Error(`Chrome didn't start: ${String(error)}\n${stderr.tail()}`, { cause: error });
	}
	const browser: Browser = {
		name: "chrome",
		async open(path = "") {
			const { targetId } = await wire.send("Target.createTarget", { url: new URL(path, page.url).href });
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
				page.ready,
			);
			await ready();
			return tab;
		},
	};
	return {
		browser,
		close: async () => {
			untrack();
			await end(child, () => wire.send("Browser.close"), profile);
		},
	};
}

export async function launchFirefox(binary: string, page: Served): Promise<Launched> {
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
		[
			...[binary, "--headless", "--no-remote", "--profile", profile, "--remote-debugging-port", "0"],
			...["--window-size=1280,800", "about:blank"],
		],
		{ stdin: "ignore", stdout: "ignore", stderr: "pipe" },
	);
	const untrack = track(() => end(child, async () => child.kill(), profile));
	const stderr = readStderr(child, /WebDriver BiDi listening on (ws:\/\/\S+)/);
	let wire: Wire;
	try {
		const listening = await within(stderr.match, START_MS, "Firefox's start");
		wire = await Wire.open(`${listening[1] ?? ""}/session`);
		await wire.send("session.new", { capabilities: {} });
	} catch (error) {
		untrack();
		await end(child, async () => child.kill(), profile);
		throw new Error(`Firefox didn't start: ${String(error)}\n${stderr.tail()}`, { cause: error });
	}
	const browser: Browser = {
		name: "firefox",
		async open(path = "") {
			const { context } = await wire.send("browsingContext.create", { type: "tab" });
			const url = new URL(path, page.url).href;
			await wire.send("browsingContext.navigate", { context, url, wait: "complete" });
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
				page.ready,
			);
			await ready();
			return tab;
		},
	};
	return {
		browser,
		close: async () => {
			untrack();
			await end(child, () => wire.send("browser.close"), profile);
		},
	};
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

/** Builds the harness page into `out` and serves it there; resolves with it served. */
export async function serveHarness(out: string): Promise<Served> {
	const build = runVite(["build", "--outDir", out, "--emptyOutDir", "--logLevel", "warn"]);
	const built = track(async () => build.kill());
	const exitCode = await build.exited;
	built();
	if (exitCode !== 0) throw new Error("the harness page didn't build");
	const port = freePort();
	const server = runVite(
		["preview", "--outDir", out, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
		true,
	);
	const url = `http://127.0.0.1:${port}/`;
	const untrack = track(async () => server.kill());
	const stop = async () => {
		untrack();
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
			return { url, ready: `typeof duvetE2E === "object"`, stack: null, stop };
		if (Date.now() > deadline || server.exitCode !== null) {
			await stop();
			throw new Error("vite preview didn't serve the harness page");
		}
		await Bun.sleep(100);
	}
}

/** The stack the API's clients' suites name (their liveEnv), which the app's suite runs against. */
export function liveStack(env: Record<string, string | undefined> = process.env) {
	const { E2E_LIVE_API: api, E2E_LIVE_WS: ws, E2E_LIVE_ACCOUNTS: listed, E2E_LIVE_PASSWORD: password } = env;
	if (!api || !ws || !listed || !password) {
		throw new Error(
			"the app's suite runs against a stack: set E2E_LIVE_API, E2E_LIVE_WS, E2E_LIVE_ACCOUNTS and E2E_LIVE_PASSWORD",
		);
	}
	const parsed: unknown = JSON.parse(listed);
	const accounts = (Array.isArray(parsed) ? parsed : []).flatMap((each: unknown): Account[] => {
		if (typeof each !== "object" || each === null) return [];
		const id: unknown = Reflect.get(each, "id");
		const email: unknown = Reflect.get(each, "email");
		return typeof id === "string" && typeof email === "string" ? [{ id, email }] : [];
	});
	return { api: api.replace(/\/+$/, ""), ws: ws.replace(/\/+$/, ""), accounts, password };
}

/** A hold a case asked for, until a request takes it. */
interface Hold {
	method: string;
	path: RegExp;
	when: "before" | "after";
	reach(): void;
	drop(): void;
	release(): void;
	released: Promise<void>;
}

/**
 * A proxy on 127.0.0.1 between the app and the API at `target`: it passes on each request as it came, but for the
 * headers it can't (its host, its length, its encodings: Bun's fetch decodes the answer), and keeps what it passed on.
 * A request that matches a hold is held, before it reaches the API or with the API's answer, until the hold is let go
 * or the app goes away from it: it's dropped then, unsent or unanswered. A case's holds end with it (endHolds): those no
 * request took go, and the requests still held go on.
 */
export function startProxy(target: string) {
	const holds: Hold[] = [];
	/** The holds a request took, while it waits on them. */
	const taken = new Set<Hold>();
	const forwarded: Forwarded[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		// A held request waits for its case, however long.
		idleTimeout: 0,
		async fetch(request) {
			const url = new URL(request.url);
			const body = ["GET", "HEAD"].includes(request.method) ? undefined : new Uint8Array(await request.arrayBuffer());
			const at = holds.findIndex((one) => one.method === request.method && one.path.test(url.pathname));
			const hold = at === -1 ? undefined : holds.splice(at, 1)[0];
			const gone = new Promise<"gone">((settle) =>
				request.signal.addEventListener("abort", () => settle("gone"), { once: true }),
			);
			// Whether the app went away before the hold was let go: then the request is dropped, unsent or unanswered.
			const goneFirst = async (held: Hold) => {
				taken.add(held);
				const first = await Promise.race([held.released.then(() => "on" as const), gone]);
				taken.delete(held);
				if (first === "on") return false;
				held.drop();
				return true;
			};
			if (hold?.when === "before") {
				hold.reach();
				if (await goneFirst(hold)) return new Response(null, { status: 499 });
			}
			const headers = new Headers(request.headers);
			for (const name of ["host", "connection", "content-length", "accept-encoding"]) headers.delete(name);
			const answer = await fetch(`${target}${url.pathname}${url.search}`, {
				method: request.method,
				headers,
				body,
				redirect: "manual",
			});
			const sent = body ? new TextDecoder().decode(body) : "";
			forwarded.push({ method: request.method, path: url.pathname, body: sent, status: answer.status });
			const answered = new Headers(answer.headers);
			for (const name of ["content-encoding", "content-length", "transfer-encoding", "connection"]) {
				answered.delete(name);
			}
			if (hold?.when === "after") {
				const bytes = await answer.arrayBuffer();
				hold.reach();
				if (await goneFirst(hold)) return new Response(null, { status: 499 });
				return new Response(bytes, { status: answer.status, headers: answered });
			}
			return new Response(answer.body, { status: answer.status, headers: answered });
		},
	});
	const hold = (method: string, path: RegExp, when: "before" | "after"): Held => {
		let reach = () => {};
		let drop = () => {};
		let release = () => {};
		const reached = new Promise<void>((settle) => (reach = settle));
		const dropped = new Promise<void>((settle) => (drop = settle));
		const released = new Promise<void>((settle) => (release = settle));
		holds.push({ method, path, when, reach, drop, release, released });
		return { reached, dropped, release };
	};
	return {
		url: `http://127.0.0.1:${server.port}`,
		hold,
		forwarded: () => [...forwarded],
		endHolds: () => {
			for (const one of [...holds.splice(0), ...taken]) one.release();
		},
		stop: () => server.stop(true),
	};
}

/**
 * The app's build, of every one of its pages, into `out`: the desktop's development build (`vite build --mode
 * development`, the build `bun run start` makes), the one that keeps VITE_API_URL and VITE_WS_URL, in which the app
 * routes by its pages' .html, as the packaged app and duvet.chat do. Run by the package's script, as CI builds it.
 */
async function buildApp(out: string, api: string, ws: string) {
	const build = Bun.spawn([process.execPath, "run", "build", "--mode", "development", "--logLevel", "warn"], {
		cwd: mainview,
		env: { ...process.env, VITE_API_URL: api, VITE_WS_URL: ws, DUVET_BUILD_DIR: out },
		stdin: "ignore",
		stdout: "inherit",
		stderr: "inherit",
	});
	const built = track(async () => build.kill());
	const exitCode = await build.exited;
	built();
	if (exitCode !== 0) throw new Error("the app didn't build");
}

/**
 * The built app's files, from the folder `root` (an absolute path), on 127.0.0.1 at `port`, as duvet.chat's server
 * serves them: each page by its .html. Its stop.
 */
function serveFiles(root: string, port: number): () => Promise<void> {
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port,
		fetch(request) {
			const path = decodeURIComponent(new URL(request.url).pathname);
			// join takes out the path's `..`: what's left outside the folder isn't served.
			const file = join(root, path === "/" ? "index.html" : path);
			const isFile = file.startsWith(root + sep) && existsSync(file) && statSync(file).isFile();
			return isFile ? new Response(Bun.file(file)) : new Response("not found", { status: 404 });
		},
	});
	return () => server.stop(true);
}

/** Builds the app against the stack the environment names, into `out`, and serves it, its proxy to the API with it. */
export async function serveApp(out: string): Promise<Served> {
	const live = liveStack();
	const proxy = startProxy(live.api);
	const untrack = track(async () => proxy.stop());
	let stopFiles = async () => {};
	const stop = async () => {
		untrack();
		await proxy.stop();
		await stopFiles();
	};
	try {
		await buildApp(out, proxy.url, live.ws);
		stopFiles = serveFiles(out, APP_PORT);
	} catch (error) {
		await stop();
		throw error;
	}
	const stack: ServedStack = {
		api: live.api,
		all: live.accounts,
		password: live.password,
		client: `web/${version}`,
		hold: proxy.hold,
		forwarded: proxy.forwarded,
		endHolds: proxy.endHolds,
	};
	return { url: `http://127.0.0.1:${APP_PORT}/`, ready: `document.readyState === "complete"`, stack, stop };
}

/** A suite's module, from src/mainview/e2e-browser/<suite>.cases.ts. */
async function suiteOf(suite: string): Promise<Suite> {
	if (!/^[a-z][a-z0-9-]*$/.test(suite)) throw new Error(`no suite ${suite}`);
	return import(join(mainview, "e2e-browser", `${suite}.cases.ts`));
}

/** A browser of `name` that starts as its first tab opens, and how to end it then. */
function lazyBrowser(name: BrowserName, launch: () => Promise<Launched>) {
	let launched: Promise<Launched> | null = null;
	const browser: Browser = {
		name,
		async open(path) {
			launched ??= launch();
			return (await launched).browser.open(path);
		},
	};
	return {
		browser,
		async close() {
			if (launched) await (await launched).close();
		},
	};
}

/** The stack as a browser's run sees it: the pair of accounts of its own (ACCOUNTS). */
function stackFor(name: BrowserName, served: ServedStack): Stack {
	const accounts = ACCOUNTS[name].map((n) => served.all[n]).filter((account) => account !== undefined);
	if (accounts.length !== 2)
		throw new Error(`${name}'s run takes the stack's accounts ${ACCOUNTS[name].join(" and ")}`);
	const { api, password, client, hold, forwarded } = served;
	return { api, password, client, hold, forwarded, accounts };
}

/**
 * Runs each case in a browser of its own, a fresh profile each: nothing one leaves in OPFS, IndexedDB or a lock reaches
 * the next (and the core's OPFS pool holds six files, which a run's cases would fill). A suite's named profiles
 * (SuiteRun.profile) are kept from case to case, and end with the suite. Says how many failed.
 */
async function runCases(name: BrowserName, binary: string, page: Served, suite: string, module: Suite) {
	const launch = () => (name === "chrome" ? launchChrome(binary, page) : launchFirefox(binary, page));
	const limit = module.page === "app" ? APP_CASE_MS : CASE_MS;
	const profiles = new Map<string, ReturnType<typeof lazyBrowser>>();
	const run: SuiteRun = {
		stack: page.stack && stackFor(name, page.stack),
		async profile(profile) {
			const kept = profiles.get(profile) ?? lazyBrowser(name, launch);
			profiles.set(profile, kept);
			return kept.browser;
		},
	};
	let failed = 0;
	try {
		for (const each of module.default) {
			const title = `${name} · ${suite} · ${each.name}`;
			const skipped = each.skip?.[name];
			if (skipped) {
				console.log(`- ${title}: skipped, ${skipped}`);
				continue;
			}
			const lines: string[] = [];
			const started = performance.now();
			const own = lazyBrowser(name, launch);
			try {
				try {
					await within(
						each.run(own.browser, (line) => lines.push(line), run),
						limit,
						"the case",
					);
				} finally {
					// What the case held at the proxy goes on: the next case's requests aren't taken by its holds.
					page.stack?.endHolds();
					await own.close();
				}
				console.log(`✓ ${title} (${Math.round(performance.now() - started)} ms)`);
			} catch (error) {
				failed++;
				console.log(`✗ ${title} (${Math.round(performance.now() - started)} ms)\n  ${String(error)}`);
			}
			for (const line of lines) console.log(`    ${line}`);
		}
	} finally {
		await Promise.all([...profiles.values()].map((kept) => kept.close()));
	}
	return failed;
}

async function main(argv: string[]) {
	// A run stopped by a signal (a timeout, a cancelled job) ends its browsers, its servers and its folders first.
	for (const [signal, code] of [
		["SIGINT", 130],
		["SIGTERM", 143],
	] as const) {
		process.on(signal, () => {
			void Promise.allSettled([...open].map((ending) => ending())).then(() => process.exit(code));
		});
	}
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
		(suites.length ? suites : ["host"]).map(async (suite) => ({ suite, module: await suiteOf(suite) })),
	);

	// Each page the suites run on, built in a folder of its own and served once, for every browser.
	const outs: string[] = [];
	const built = track(async () => outs.forEach((out) => rmSync(out, { recursive: true, force: true })));
	const served = new Map<"harness" | "app", Served>();
	let failed = 0;
	try {
		for (const page of new Set(loaded.map(({ module }) => module.page ?? "harness"))) {
			const out = mkdtempSync(join(tmpdir(), `duvet-web-e2e-${page}-`));
			outs.push(out);
			served.set(page, await (page === "app" ? serveApp(out) : serveHarness(out)));
		}
		for (const { name, binary } of browsers) {
			for (const { suite, module } of loaded) {
				const page = served.get(module.page ?? "harness");
				if (page) failed += await runCases(name, binary, page, suite, module);
			}
		}
	} finally {
		await Promise.all([...served.values()].map((page) => page.stop()));
		built();
		for (const out of outs) rmSync(out, { recursive: true, force: true });
	}
	if (failed) {
		console.log(`${failed} failed`);
		process.exit(1);
	}
}

if (import.meta.main) await main(process.argv.slice(2));
