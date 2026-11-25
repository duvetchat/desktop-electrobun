// The web's core in a real browser (PLAN-E2E-CLIENTES.md, Task 8): its worker over OPFS, its wrapped key, one tab at a
// time. scripts/web-e2e.ts runs these in Chrome and in Firefox, each case in a profile of its own, on the harness page
// (page.ts): what a tab runs crosses as its source, so it reaches the page's duvetE2E, never this file's variables.
import assert from "node:assert/strict";
import type { Browser, Case, Tab } from "./harness";

/** A tab joined to `userId`'s tabs, and its tab's ID. */
async function join(browser: Browser, userId: string): Promise<{ tab: Tab; id: string }> {
	const tab = await browser.open();
	return { tab, id: await tab.run((user: string) => duvetE2E.join(user), userId) };
}

/** Once the tab leads: what its core's open answered. */
const lead = (tab: Tab) =>
	tab.run(async () => {
		await duvetE2E.joined?.tabs.leading;
		return duvetE2E.joined?.opened ?? null;
	});

/** The core's status, asked through the tabs: the leader's own, or the leader's answer. */
const status = (tab: Tab) =>
	tab.run(() => duvetE2E.joined?.tabs.call<{ device_id?: string; key_storage?: string }>("status") ?? null);

const whoami = (tab: Tab) => tab.run(() => duvetE2E.joined?.tabs.call<string>("whoami") ?? null);

const cases: Case[] = [
	{
		name: "nothing loads before the host is first used",
		async run(browser) {
			const tab = await browser.open();
			const userId = crypto.randomUUID();
			const loads = await tab.run(async (user: string) => {
				const worker = (name: string) => /worker|duvet_e2e|\.wasm/.test(name);
				const before = duvetE2E.loaded().filter(worker);
				const host = duvetE2E.newHost();
				const made = duvetE2E.loaded().filter(worker);
				const opened = await host.open(user);
				return { before, made, opened, after: duvetE2E.loaded().filter(worker), violations: duvetE2E.violations };
			}, userId);
			assert.deepEqual(loads.before, []);
			assert.deepEqual(loads.made, []);
			assert.equal(loads.opened.state, "ready");
			assert.equal(loads.after.length, 1, "the core's worker loads as the host opens");
			assert.deepEqual(loads.violations, []);
		},
	},
	{
		name: "the core opens over OPFS and keeps its device across a reload",
		async run(browser, log) {
			const userId = crypto.randomUUID();
			const { tab } = await join(browser, userId);
			assert.deepEqual(await lead(tab), { state: "ready", keyStorage: "provided" });
			const first = await status(tab);
			assert.ok(first?.device_id, "a device is made");
			assert.equal(first.key_storage, "provided");
			log(`first open: ${JSON.stringify(await tab.run(() => duvetE2E.joined?.host.openTimes ?? null))}`);

			await tab.reload();
			await tab.run((user: string) => duvetE2E.join(user), userId);
			assert.equal((await lead(tab))?.state, "ready");
			assert.equal((await status(tab))?.device_id, first.device_id, "the same device after a reload");
			log(`after a reload: ${JSON.stringify(await tab.run(() => duvetE2E.joined?.host.openTimes ?? null))}`);

			// The database is a file in OPFS's pool, named for its user: read once no worker holds the pool.
			const names = await tab.run(async () => {
				await duvetE2E.joined?.host.close();
				return duvetE2E.poolNames();
			});
			assert.ok(names.includes(`${userId}.db`), `the pool holds ${JSON.stringify(names)}`);
			assert.deepEqual(await tab.run(() => duvetE2E.violations), []);
		},
	},
	{
		name: "two tabs share one core",
		async run(browser) {
			const userId = crypto.randomUUID();
			const a = await join(browser, userId);
			assert.equal((await lead(a.tab))?.state, "ready");
			const b = await join(browser, userId);
			// b asks, and a answers with its core.
			assert.equal(await whoami(b.tab), a.id);
			const device = (await status(a.tab))?.device_id;
			assert.ok(device);
			assert.equal((await status(b.tab))?.device_id, device);
			assert.equal(await b.tab.run(() => duvetE2E.joined?.tabs.leader), false);
			assert.equal(await b.tab.run(() => duvetE2E.workers()), 0, "b starts no worker");
			// Nor could it: a core b opened outside the tabs finds the databases held by a's.
			const second = await b.tab.run((user: string) => duvetE2E.newHost().open(user), userId);
			assert.deepEqual(second, { state: "locked" });
			assert.equal((await status(a.tab))?.device_id, device, "a's core goes on");
		},
	},
	{
		name: "the lock passes when its tab closes",
		async run(browser) {
			const userId = crypto.randomUUID();
			const a = await join(browser, userId);
			assert.equal((await lead(a.tab))?.state, "ready");
			const device = (await status(a.tab))?.device_id;
			const b = await join(browser, userId);
			const c = await join(browser, userId);
			await a.tab.close();
			// b asked for the lock before c: it leads, with the same database, and says so.
			assert.equal((await lead(b.tab))?.state, "ready");
			assert.equal(await whoami(c.tab), b.id);
			assert.equal((await status(c.tab))?.device_id, device);
			// c joined after a said it leads: what it heard is b's word alone.
			assert.deepEqual(await c.tab.run(() => duvetE2E.joined?.leaders), [b.id]);
			assert.equal(await c.tab.run(() => duvetE2E.workers()), 0);
		},
	},
	{
		name: "a request made while the lock passes is answered by the new tab",
		async run(browser) {
			const userId = crypto.randomUUID();
			const a = await join(browser, userId);
			assert.equal((await lead(a.tab))?.state, "ready");
			const b = await join(browser, userId);
			const c = await join(browser, userId);
			// a gets c's first request and never answers it, as a tab busy with a long command; then it closes.
			await a.tab.run(() => {
				if (duvetE2E.joined) duvetE2E.joined.stall = true;
			});
			const unanswered = whoami(c.tab);
			await Bun.sleep(200);
			await a.tab.close();
			// c's second request goes while b still opens the core, and nobody answers it.
			const meanwhile = whoami(c.tab);
			assert.equal(await unanswered, b.id);
			assert.equal(await meanwhile, b.id);
			assert.equal((await lead(b.tab))?.state, "ready");
		},
	},
	{
		name: "a trapped call reopens",
		async run(browser) {
			const userId = crypto.randomUUID();
			const { tab } = await join(browser, userId);
			assert.equal((await lead(tab))?.state, "ready");
			const device = (await status(tab))?.device_id;
			assert.ok(device);
			// The core's WebAssembly traps (an `unreachable`): the call is internal, and the next one opens it again.
			const trapped = await tab.run(() => duvetE2E.failure(duvetE2E.joined?.host.handle({ cmd: "__trap" })));
			assert.equal(trapped, "CoreError internal");
			assert.equal((await status(tab))?.device_id, device, "the same database, open again");
			// The worker fails outside any call: what it had is internal, and the next call opens again too.
			const died = await tab.run(() => duvetE2E.failure(duvetE2E.joined?.host.handle({ cmd: "__die" })));
			assert.equal(died, "CoreError internal");
			assert.equal((await status(tab))?.device_id, device);
			assert.equal(await tab.run(() => duvetE2E.workers()), 3, "one worker, then one after each cut");
		},
	},
	{
		name: "a call with no core open is internal, and a command JSON can't write is refused",
		async run(browser) {
			const tab = await browser.open();
			const said = await tab.run(async (user: string) => {
				const host = duvetE2E.newHost();
				const before = await duvetE2E.failure(host.handle({ cmd: "status" }));
				// The worker itself, asked before it opened a core.
				const worker = duvetE2E.startCoreWorker();
				const raw = await new Promise((resolve) => {
					worker.addEventListener("message", (event: MessageEvent) => resolve(event.data), { once: true });
					worker.postMessage({ id: 1, op: "handle", command: { cmd: "status" } });
				});
				worker.terminate();
				const opened = (await host.open(user)).state;
				// A BigInt crosses to the worker, and JSON can't write it: refused there, and the worker goes on.
				const big = await duvetE2E.failure(host.handle({ cmd: "status", n: 1n }));
				const goesOn = await duvetE2E.failure(host.handle({ cmd: "status" }));
				const workers = duvetE2E.workers();
				await host.close();
				const after = await duvetE2E.failure(host.handle({ cmd: "status" }));
				return { before, raw, opened, big, goesOn, workers, after };
			}, crypto.randomUUID());
			assert.deepEqual(said, {
				before: "CoreError internal",
				raw: { id: 1, reply: { error: { code: "internal", message: "no core is open" } } },
				opened: "ready",
				big: "CoreError bad_command",
				goesOn: null,
				workers: 1,
				after: "CoreError internal",
			});
		},
	},
	{
		name: "a browser without OPFS says so",
		async run(browser) {
			const tab = await browser.open();
			const userId = crypto.randomUUID();
			const said = await tab.run(async (user: string) => {
				Reflect.deleteProperty(StorageManager.prototype, "getDirectory");
				const withoutOpfs = duvetE2E.missingInPage();
				const opened = await duvetE2E.newHost().open(user);
				Reflect.deleteProperty(Navigator.prototype, "locks");
				return { withoutOpfs, opened, withoutLocks: duvetE2E.missingInPage(), workers: duvetE2E.workers() };
			}, userId);
			assert.deepEqual(said, {
				withoutOpfs: ["opfs"],
				opened: { state: "unsupported" },
				withoutLocks: ["locks", "opfs"],
				workers: 0,
			});
		},
	},
	{
		name: "the page can't read the database key",
		async run(browser) {
			const userId = crypto.randomUUID();
			const { tab } = await join(browser, userId);
			assert.equal((await lead(tab))?.state, "ready");
			// IndexedDB keeps the key sealed, beside the key that seals it, which can't be exported. A script of the page
			// could still use that key as the worker does: what it can't do is take it, or find the database key in clear.
			assert.deepEqual(await tab.run(() => duvetE2E.keysKept()), {
				stores: ["keys"],
				records: [
					{
						user: userId,
						fields: ["wrapped", "wrapping"],
						wrapping: { extractable: false, algorithm: "AES-GCM", usages: ["decrypt", "encrypt"] },
						exportRefused: true,
						sealedBytes: 12 + 32 + 16,
					},
				],
			});
			// What the worker told the page: states and replies, never the key.
			const opens = await tab.run(() =>
				duvetE2E
					.received()
					.map((message) => JSON.stringify(message))
					.filter((text) => text.includes('"state"')),
			);
			assert.equal(opens.length, 1);
			assert.match(
				opens[0] ?? "",
				/^\{"id":\d+,"reply":\{"ok":\{"state":"ready","keyStorage":"provided","times":\{[^{}]*\}\}\}\}$/,
			);
			// Nor is it in any other message the worker sent: the key, unwrapped here as a script of the page could,
			// isn't in one as bytes, in hex or in base64.
			const leaks = await tab.run((user: string) => duvetE2E.keyLeaks(user), userId);
			assert.ok(leaks.checked >= 3, `${leaks.checked} messages checked`);
			assert.deepEqual(leaks.found, []);
		},
	},
	{
		name: "destroy leaves nothing to open, and another account's database as it was",
		async run(browser) {
			const userId = crypto.randomUUID();
			const other = crypto.randomUUID();
			const tab = await browser.open();
			// Another account's database first: its device, read back later.
			const deviceOf = (user: string) =>
				tab.run(async (id: string) => {
					const host = duvetE2E.newHost();
					await host.open(id);
					let { device_id } = await host.handle<{ device_id?: string }>({ cmd: "status" });
					if (!device_id) {
						await host.handle({ cmd: "create_device", user_id: id, device_id: crypto.randomUUID() });
						({ device_id } = await host.handle<{ device_id?: string }>({ cmd: "status" }));
					}
					await host.close();
					return device_id ?? null;
				}, user);
			const otherDevice = await deviceOf(other);
			assert.ok(otherDevice);
			await tab.run((user: string) => duvetE2E.join(user), userId);
			assert.equal((await lead(tab))?.state, "ready");
			const device = (await status(tab))?.device_id;
			assert.ok(device);
			const left = await tab.run(async (user: string) => {
				await duvetE2E.joined?.host.destroy(user);
				const { records } = await duvetE2E.keysKept();
				return { keys: records.map((record) => record.user), names: await duvetE2E.poolNames() };
			}, userId);
			assert.deepEqual(left, { keys: [other], names: [`${other}.db`] });
			// Opened again, it's a new database: no device in it, and a new key.
			const fresh = await tab.run(async (user: string) => {
				const host = duvetE2E.newHost();
				const opened = await host.open(user);
				const { device_id } = await host.handle<{ device_id?: string }>({ cmd: "status" });
				await host.close();
				return { opened, device: device_id ?? null };
			}, userId);
			assert.deepEqual(fresh, { opened: { state: "ready", keyStorage: "provided" }, device: null });
			assert.equal(await deviceOf(other), otherDevice, "the other account's database, as it was");
		},
	},
	{
		name: "seven accounts' databases fit in one browser, and each writes",
		async run(browser) {
			const tab = await browser.open();
			const users = Array.from({ length: 7 }, () => crypto.randomUUID());
			// Each account's first open makes its database, which keeps a slot of the pool for good, and its first write
			// needs another, for its journal.
			const made = await tab.run(async (all: string[]) => {
				const results: { state: string; wrote: string | null }[] = [];
				for (const user of all) {
					const host = duvetE2E.newHost();
					const { state } = await host.open(user);
					const command = { cmd: "create_device", user_id: user, device_id: crypto.randomUUID() };
					const wrote = state === "ready" ? await duvetE2E.failure(host.handle(command)) : "not open";
					await host.close();
					results.push({ state, wrote });
				}
				return results;
			}, users);
			assert.deepEqual(
				made,
				users.map(() => ({ state: "ready", wrote: null })),
			);
			// The first account, opened again with all seven there, still writes: its identity.
			const again = await tab.run(async (user: string) => {
				const host = duvetE2E.newHost();
				const { state } = await host.open(user);
				const wrote = await duvetE2E.failure(host.handle({ cmd: "create_identity" }));
				await host.close();
				return { state, wrote, names: await duvetE2E.poolNames() };
			}, users[0] ?? "");
			assert.deepEqual({ state: again.state, wrote: again.wrote }, { state: "ready", wrote: null });
			assert.deepEqual(again.names, users.map((user) => `${user}.db`).sort());
		},
	},
];

export default cases;
