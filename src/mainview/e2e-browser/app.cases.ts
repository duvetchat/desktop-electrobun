// The whole app in real browsers (PLAN-E2E-CLIENTES.md, Task 34): its web build, against a local stack of the API's
// suites, which scripts/web-e2e.ts serves it beside (`bun scripts/web-e2e.ts app`): two profiles as two people, and two
// tabs of one, which share one core (Ruling 16). The cases go on from one another, as a person's day does: the first
// signs the two in, sets up their devices and has them talk; the others open a second tab of the first person's, close
// the tab that holds the core while it sends, and reload a tab while it sends. A case drives the app as a person does,
// by its page (what a tab runs crosses as its source, so it sees the page, never this file's variables), and makes what
// the app has no case of its own for (a friendship, the DM) through the API. Each browser's run needs a fresh stack's
// accounts: one whose people already have encryption keys is a stack another run used.
import assert from "node:assert/strict";
import type { Account, Browser, Case, Held, Stack, Tab } from "./harness";

export const page = "app";

/** How long a step waits for the app: a first device's keys, a message through the gateway, a tab taking the core. */
const STEP_MS = 90_000;

/** Waits until `fn`, run in the tab, gives something truthy, and gives it: a page loading, or one that throws, waits on. */
async function until<A extends unknown[], T>(
	tab: Tab,
	what: string,
	fn: (...args: A) => T | Promise<T>,
	...args: A
): Promise<Awaited<T>> {
	const deadline = Date.now() + STEP_MS;
	let last = "";
	for (;;) {
		try {
			const value = await tab.run(fn, ...args);
			if (value) return value;
		} catch (error) {
			last = String(error);
		}
		if (Date.now() > deadline) throw new Error(`${what} never came${last ? `: ${last}` : ""}`);
		await Bun.sleep(150);
	}
}

/** Waits for the proxy's word on a held request, or fails saying what didn't come. */
async function soon(promise: Promise<void>, what: string) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<never>(
		(_, reject) => (timer = setTimeout(() => reject(new Error(`${what} never came`)), STEP_MS)),
	);
	try {
		await Promise.race([promise, late]);
	} finally {
		clearTimeout(timer);
	}
}

/** A person's own session at the API, beside the app's: what a case makes there. */
interface Person {
	id: string;
	username: string;
	headers: Record<string, string>;
}

/** A field of a JSON answer that has to be text: what it holds, or a failure naming it. */
function textOf(value: unknown, name: string): string {
	const field: unknown = typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
	if (typeof field !== "string") throw new Error(`the API's answer has no ${name}: ${JSON.stringify(value)}`);
	return field;
}

async function signedIn(stack: Stack, account: Account): Promise<Person> {
	const answer = await fetch(`${stack.api}/api/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email: account.email, password: stack.password }),
	});
	if (!answer.ok) throw new Error(`${account.email} can't sign in at the stack: ${answer.status}`);
	const login: unknown = await answer.json();
	const headers = {
		Authorization: `Bearer ${textOf(login, "token")}`,
		"X-Session-Token": textOf(login, "session_token"),
		"X-Duvet-Client": stack.client,
		"Content-Type": "application/json",
	};
	const me: unknown = await (await fetch(`${stack.api}/api/users/@me`, { headers })).json();
	return { id: textOf(me, "id"), username: textOf(me, "username"), headers };
}

/** A request of the person's to the API: its JSON, or what it answered when it's not a 2xx. */
async function asked(stack: Stack, who: Person, method: string, path: string, body?: unknown): Promise<unknown> {
	const answer = await fetch(`${stack.api}${path}`, {
		method,
		headers: who.headers,
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	if (!answer.ok) throw new Error(`${method} ${path}: ${answer.status} ${await answer.text()}`);
	const json: unknown = await answer.json();
	return json;
}

/** The DM's messages as the API lists them, by their IDs, and all it holds of them: never their text. */
async function listed(stack: Stack, who: Person, dm: string): Promise<{ ids: string[]; json: string }> {
	const list = await asked(stack, who, "GET", `/api/users/@me/conversations/${dm}/messages`);
	if (!Array.isArray(list)) throw new Error(`the DM's messages aren't a list: ${JSON.stringify(list)}`);
	return { ids: list.map((message: unknown) => textOf(message, "id")), json: JSON.stringify(list) };
}

/** Signs in on the sign-in page, as a person types it, and waits for the app. */
async function signIn(tab: Tab, email: string, password: string) {
	// Until the page hydrates, a submit is the browser's own, a GET with the fields in its URL: an empty one goes first,
	// the browser's own held back, and only the page's form says what's missing.
	await until(tab, "the sign-in form", () => {
		if (document.querySelector("[data-auth-error]")) return true;
		window.addEventListener("submit", (event) => event.preventDefault(), { capture: true, once: true });
		document.querySelector("form")?.requestSubmit();
		return false;
	});
	await tab.run(
		(address: string, secret: string) => {
			const form = document.querySelector("form");
			const fields = ["email", "password"].map((id) => form?.querySelector<HTMLInputElement>(`#${id}`));
			if (!form || !fields[0] || !fields[1]) throw new Error("the sign-in page has no form");
			fields[0].value = address;
			fields[1].value = secret;
			form.requestSubmit();
		},
		email,
		password,
	);
	await appShown(tab);
}

/** The app, its chats listed. */
const appShown = (tab: Tab) =>
	until(tab, "the app", () => {
		// Each resource the page loads stays listed, the core's worker among them (loadedCore): 250 by default.
		performance.setResourceTimingBufferSize(100_000);
		// What the page says in its console's errors and warnings from now on, its last 50, for a failure to show.
		if (!Reflect.get(window, "__e2eSaid")) {
			const said: string[] = [];
			Reflect.set(window, "__e2eSaid", said);
			for (const level of ["error", "warn"] as const) {
				const original = console[level].bind(console);
				console[level] = (...args: unknown[]) => {
					said.push(
						`${level}: ${args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(" ")}`.slice(0, 400),
					);
					if (said.length > 50) said.shift();
					original(...args);
				};
			}
		}
		return location.pathname === "/app.html" && !!document.querySelector('[aria-label="Chats"]');
	});

/** What a tab shows of its open conversation and said in its console: what a failed wait prints. */
const whatItShows = (tab: Tab) =>
	tab
		.run(() => {
			const rows = [...document.querySelectorAll<HTMLElement>("[data-message-id]")].map(
				(row) => `${row.dataset.messageId?.slice(0, 13)}: ${row.textContent?.replace(/\s+/g, " ").trim().slice(0, 90)}`,
			);
			const said: unknown = Reflect.get(window, "__e2eSaid");
			return JSON.stringify({ rows, said: Array.isArray(said) ? said.map(String).slice(-12) : [] }, null, 1);
		})
		.catch((error: unknown) => `(can't read the tab: ${String(error)})`);

/** The stack of the case that runs: the requests its app made, for a failed wait to print. */
let running: Stack | null = null;

/** The app's requests the proxy passed on, its last 120: each one's method, path and the API's status. */
const trail = () =>
	(running?.forwarded() ?? [])
		.slice(-120)
		.map(({ method, path, status }) => `${method} ${path.replace(/[0-9a-f-]{36}/g, (id) => id.slice(0, 8))} ${status}`)
		.join("\n");

const KEY_PACKAGES = "/api/users/@me/devices/@me/key-packages";

/**
 * Waits until a device uploaded its key packages, in a request after the `from`th: as a person's device does once
 * it's set up, before anyone starts a DM with them. One made before has the group made without that device, which joins
 * it later by itself, and can't read what was sent before.
 */
async function keyPackagesUp(stack: Stack, from: number, what: string) {
	const deadline = Date.now() + STEP_MS;
	const up = () =>
		stack
			.forwarded()
			.slice(from)
			.some(({ method, path, status }) => method === "PUT" && path === KEY_PACKAGES && status === 200);
	while (!up()) {
		if (Date.now() > deadline) throw new Error(`${what}'s key packages never went up:\n${trail()}`);
		await Bun.sleep(150);
	}
}

/** What the app's bar of encrypted conversations says, if it shows. */
const gateText = (tab: Tab) =>
	tab.run(
		() =>
			document.querySelector('[role="region"][aria-label="Encrypted conversations"]')?.textContent?.trim() ?? "nothing",
	);

/** A first device set up as a person does: Set up, its recovery key saved, Continue; then no bar is left. */
async function setUp(tab: Tab) {
	await until(tab, "a first device's Set up", () => {
		const gate = document.querySelector('[role="region"][aria-label="Encrypted conversations"]');
		const button = [...(gate?.querySelectorAll("button") ?? [])].find((one) => one.textContent?.trim() === "Set up");
		button?.click();
		return !!button;
	}).catch(async (error: unknown) => {
		throw new Error(`${String(error)}; the app's bar says: ${await gateText(tab).catch(() => "?")}`, { cause: error });
	});
	await until(tab, "the recovery key's Continue", () => {
		const label = [...document.querySelectorAll("label")].find((one) => one.textContent?.trim() === "I saved it");
		const saved = label?.querySelector("input");
		if (!saved) return false;
		if (!saved.checked) saved.click();
		const go = [...document.querySelectorAll("button")].find((one) => one.textContent?.trim() === "Continue");
		if (!go || go.disabled) return false;
		go.click();
		return true;
	});
	await until(
		tab,
		"the device set up",
		() =>
			!document.querySelector('[role="region"][aria-label="Encrypted conversations"]') &&
			![...document.querySelectorAll("label")].some((one) => one.textContent?.trim() === "I saved it"),
	);
}

/** The DM with `name` open in the tab, from its row among the chats. */
const openChat = (tab: Tab, name: string) =>
	until(
		tab,
		`the chat with ${name}`,
		(person: string) => {
			if (document.querySelector(`[role="textbox"][aria-label="Message ${person}"]`)) return true;
			const rows = [...document.querySelectorAll<HTMLElement>('[aria-label="Chats"] button')];
			rows.find((row) => row.textContent?.includes(person))?.click();
			return false;
		},
		name,
	);

/** Types `text` into the DM's box as a person types it, and sends it with the Send button. */
async function send(tab: Tab, name: string, text: string) {
	await tab.run(
		(person: string, words: string) => {
			const box = document.querySelector<HTMLElement>(`[role="textbox"][aria-label="Message ${person}"]`);
			if (!box) throw new Error(`no box for the chat with ${person}`);
			box.focus();
			document.execCommand("insertText", false, words);
		},
		name,
		text,
	);
	await until(tab, "the Send button", () => {
		const button = document.querySelector<HTMLButtonElement>('button[aria-label="Send"]');
		if (!button || button.disabled) return false;
		button.click();
		return true;
	});
}

/**
 * The rows of the tab's open conversation that show `text`, by their IDs: a message being sent has its nonce's (a
 * UUIDv4), one the API took the API's (a UUIDv7).
 */
const rowsOf = (tab: Tab, text: string) =>
	tab.run(
		(words: string) =>
			[...document.querySelectorAll<HTMLElement>("[data-message-id]")]
				.filter((row) => row.textContent?.includes(words))
				.map((row) => row.dataset.messageId ?? ""),
		text,
	);

const isSent = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-7/.test(id);

/** Waits until the tab shows `text` once, as a message the API took, and nothing else of it: its row's ID. */
async function shownOnce(tab: Tab, text: string, what: string, sender?: Tab): Promise<string> {
	const deadline = Date.now() + STEP_MS;
	let rows: string[] = [];
	for (;;) {
		rows = await rowsOf(tab, text).catch(() => []);
		if (rows.length === 1 && isSent(rows[0] ?? "")) return rows[0] ?? "";
		if (Date.now() > deadline) {
			throw new Error(
				`${what}: the rows of "${text}" are ${JSON.stringify(rows)}, not one sent message. It shows ` +
					`${await whatItShows(tab)}\n${sender ? `The sender's tab shows ${await whatItShows(sender)}\n` : ""}` +
					`The app's last requests:\n${trail()}`,
			);
		}
		await Bun.sleep(150);
	}
}

/** The nonce `text` is being sent with in the tab: its row's while it waits for the API. */
async function nonceOf(tab: Tab, text: string): Promise<string> {
	const rows = await until(
		tab,
		`the row of "${text}"`,
		(words: string) => {
			const found = [...document.querySelectorAll<HTMLElement>("[data-message-id]")]
				.filter((row) => row.textContent?.includes(words))
				.map((row) => row.dataset.messageId ?? "");
			return found.length ? found : null;
		},
		text,
	);
	const [nonce] = rows ?? [];
	if (!nonce || isSent(nonce)) throw new Error(`"${text}" was sent before its hold: ${JSON.stringify(rows)}`);
	return nonce;
}

/** Whether the tab started the core's worker: only the tab that leads does (lib/e2e/web/tabs.ts). */
const loadedCore = (tab: Tab) =>
	tab.run(() =>
		performance.getEntriesByType("resource").some((entry) => entry.name.includes("/_app/immutable/workers/")),
	);

/** What a case leaves the ones after it: the two people, their tabs, their DM. */
interface Conversation {
	stack: Stack;
	first: Person;
	second: Person;
	dm: string;
	/** The DM's path at the API, as the app's messages go to it. */
	messages: RegExp;
	/** The first person's tab that leads, the one with the core, and their second tab; the second person's tab. */
	leading: Tab;
	other: Tab | null;
	theirs: Tab;
}

let shared: Conversation | null = null;

/** What the case before left, or why it can't go on. */
function conversation(): Conversation {
	if (!shared) throw new Error("the case before left no conversation");
	return shared;
}

/** A text no other message of the run has. */
const unique = (words: string) => `${words} ${crypto.randomUUID().slice(0, 8)}`;

/** What the app's messages to the DM that reached the API sent, in order: each one's nonce and ciphertext. */
function postsTo(stack: Stack, messages: RegExp): { nonce: string; ciphertext: string }[] {
	return stack
		.forwarded()
		.filter(({ method, path }) => method === "POST" && messages.test(path))
		.map(({ body }) => {
			const sent: unknown = JSON.parse(body);
			return { nonce: textOf(sent, "nonce"), ciphertext: textOf(sent, "ciphertext") };
		});
}

/** The ciphertexts of the messages with `nonce` that reached the API: one message sent again has the same in each. */
const ciphertextsOf = (stack: Stack, messages: RegExp, nonce: string) =>
	postsTo(stack, messages)
		.filter((post) => post.nonce === nonce)
		.map((post) => post.ciphertext);

/** A second tab of the app in a person's profile: their session, and their device. */
async function secondTab(profile: Browser): Promise<Tab> {
	const tab = await profile.open("/app.html");
	await appShown(tab);
	return tab;
}

const cases: Case[] = [
	{
		name: "two users converse in two browsers",
		async run(_browser, log, suite) {
			shared = null;
			const stack = suite.stack;
			running = stack;
			if (!stack) throw new Error("the app's cases need a stack");
			const [one, two] = stack.accounts;
			if (!one || !two) throw new Error("the stack names no two accounts for this browser");
			const [first, second] = await Promise.all([signedIn(stack, one), signedIn(stack, two)]);
			// A fresh stack's: a person with keys already is a run's before, whose devices this one's aren't.
			for (const person of [first, second]) {
				const identity = await fetch(`${stack.api}/api/users/${person.id}/identity`, { headers: person.headers });
				if (identity.ok) throw new Error(`${person.username} has encryption keys already: bring up a fresh stack`);
			}

			const leading = await (await suite.profile("first")).open("/sign-in.html");
			const theirs = await (await suite.profile("second")).open("/sign-in.html");
			await signIn(leading, one.email, stack.password);
			await signIn(theirs, two.email, stack.password);
			const started = performance.now();
			const firstSetUp = stack.forwarded().length;
			await setUp(leading);
			await keyPackagesUp(stack, firstSetUp, "the first device");
			const secondSetUp = stack.forwarded().length;
			await setUp(theirs);
			await keyPackagesUp(stack, secondSetUp, "the second device");
			log(`both devices set up in ${Math.round(performance.now() - started)} ms`);

			// Friends, and their DM, which the first person starts.
			const request = await asked(stack, first, "POST", "/api/users/@me/friends/requests", { user_id: second.id });
			await asked(stack, second, "POST", `/api/users/@me/friends/requests/${textOf(request, "id")}/accept`);
			const made = await asked(stack, first, "POST", "/api/users/@me/conversations", { type: 1, user_id: second.id });
			const dm = textOf(made, "id");
			await openChat(leading, second.username);
			await openChat(theirs, first.username);

			// Each one's message reaches the other, once, and shows once where it was sent.
			const hello = unique("hello from the first browser");
			await send(leading, second.username, hello);
			await shownOnce(theirs, hello, "the second browser", leading);
			await shownOnce(leading, hello, "the first browser");
			const back = unique("and hello back");
			await send(theirs, first.username, back);
			await shownOnce(leading, back, "the first browser", theirs);
			await shownOnce(theirs, back, "the second browser");

			// The API holds the two messages, and neither's text.
			const held = await listed(stack, first, dm);
			assert.equal(held.ids.length, 2);
			assert.ok(!held.json.includes(hello) && !held.json.includes(back), "the API holds no text");
			const messages = new RegExp(`^/api/users/@me/conversations/${dm}/messages$`);
			shared = { stack, first, second, dm, messages, leading, other: null, theirs };
		},
	},
	{
		name: "a second tab sends through the first",
		async run(_browser, _log, suite) {
			const chat = conversation();
			running = chat.stack;
			const { stack, first, second, dm } = chat;
			const other = await secondTab(await suite.profile("first"));
			chat.other = other;
			await openChat(other, second.username);
			const before = (await listed(stack, first, dm)).ids.length;

			const text = unique("from the second tab");
			await send(other, second.username, text);
			await shownOnce(chat.theirs, text, "the other person's browser", other);
			await shownOnce(other, text, "the second tab");
			assert.equal((await listed(stack, first, dm)).ids.length, before + 1, "the API took it once");
			// The second tab has no core of its own: the first one's encrypted it.
			assert.equal(await loadedCore(other), false, "the second tab started no core");
			assert.equal(await loadedCore(chat.leading), true, "the first tab holds the core");
		},
	},
	{
		name: "closing the tab that held the core mid-send loses nothing",
		async run(_browser, log, _suite) {
			const chat = conversation();
			running = chat.stack;
			const { stack, first, second, dm, messages } = chat;
			const other = chat.other;
			if (!other) throw new Error("the case before left no second tab");
			const before = (await listed(stack, first, dm)).ids.length;

			// The second tab's message: the first tab encrypts and sends it, and the proxy holds it before the API, which
			// never has it, so the view shows it waiting by its nonce.
			const held: Held = stack.hold("POST", messages, "before");
			const text = unique("as the first tab closed");
			await send(other, second.username, text);
			await soon(held.reached, "the first tab's request");
			const nonce = await nonceOf(other, text);
			// The tab that held the core closes, its request with it: the second one is the first person's tab from now on.
			await chat.leading.close();
			chat.leading = other;
			chat.other = null;
			await soon(held.dropped, "the first tab's request dropped");
			assert.deepEqual(ciphertextsOf(stack, messages, nonce), [], "nothing reached the API");

			// The second tab takes the core, and sends what waited: once.
			const shown = await shownOnce(other, text, "the second tab", chat.theirs);
			await shownOnce(chat.theirs, text, "the other person's browser");
			const after = await listed(stack, first, dm);
			assert.equal(after.ids.length, before + 1, "the API took it once");
			assert.ok(after.ids.includes(shown));
			const sent = ciphertextsOf(stack, messages, nonce);
			log(`${sent.length} request(s) with its nonce reached the API`);
			assert.ok(sent.length >= 1 && sent.every((bytes) => bytes === sent[0]), "the same bytes each time");
			assert.equal(await loadedCore(other), true, "the second tab holds the core now");
		},
	},
	{
		name: "a reload mid-send sends the pending message once",
		async run(_browser, log, _suite) {
			const chat = conversation();
			running = chat.stack;
			const { stack, first, second, dm, messages, leading } = chat;

			/** Reloads the tab while its message is held at `when`, and checks what follows: the message's nonce. */
			const reloadedWhile = async (when: "before" | "after", words: string) => {
				const before = (await listed(stack, first, dm)).ids.length;
				const held = stack.hold("POST", messages, when);
				const text = unique(words);
				await send(leading, second.username, text);
				await soon(held.reached, `the message held ${when} the API`);
				// Its nonce: the waiting row's, while the API hasn't had it; the request's once it has, as the gateway's copy
				// may have reached the view by then.
				const nonce = when === "before" ? await nonceOf(leading, text) : (postsTo(stack, messages).at(-1)?.nonce ?? "");
				assert.ok(nonce, "the message has a nonce");
				await leading.reload();
				await soon(held.dropped, "the held request dropped");

				// Back, the tab leads again: what waited goes once, with the same bytes, which the API answers with its message.
				await appShown(leading);
				await openChat(leading, second.username);
				const shown = await shownOnce(leading, text, `the reloaded tab (held ${when})`, chat.theirs);
				await shownOnce(chat.theirs, text, `the other person's browser (held ${when})`);
				const after = await listed(stack, first, dm);
				assert.equal(after.ids.length, before + 1, `the API took it once (held ${when})`);
				assert.ok(after.ids.includes(shown));
				const sent = ciphertextsOf(stack, messages, nonce);
				log(`held ${when} the API: ${sent.length} request(s) with its nonce reached it`);
				assert.ok(sent.length >= 1 && sent.every((bytes) => bytes === sent[0]), "the same bytes each time");
				return sent;
			};
			// The API never had it: the reloaded tab sends it from its core.
			assert.equal((await reloadedWhile("before", "as the tab reloaded, unsent")).length, 1, "sent once, after");
			// The API had it, and the tab never heard its answer: it isn't posted twice.
			await reloadedWhile("after", "as the tab reloaded, unanswered");
		},
	},
];

export default cases;
