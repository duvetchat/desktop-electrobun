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
				const worker = (name: string) => /worker/.test(name);
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
		},
	},
	{
		name: "destroy leaves nothing to open",
		async run(browser) {
			const userId = crypto.randomUUID();
			const { tab } = await join(browser, userId);
			assert.equal((await lead(tab))?.state, "ready");
			const device = (await status(tab))?.device_id;
			assert.ok(device);
			const left = await tab.run(async (user: string) => {
				await duvetE2E.joined?.host.destroy(user);
				return { keys: (await duvetE2E.keysKept()).records.length, names: await duvetE2E.poolNames() };
			}, userId);
			assert.deepEqual(left, { keys: 0, names: [] });
			// Opened again, it's a new database: no device in it, and a new key.
			const fresh = await tab.run(async (user: string) => {
				const host = duvetE2E.newHost();
				const opened = await host.open(user);
				const { device_id } = await host.handle<{ device_id?: string }>({ cmd: "status" });
				return { opened, device: device_id ?? null };
			}, userId);
			assert.deepEqual(fresh, { opened: { state: "ready", keyStorage: "provided" }, device: null });
		},
	},
];

export default cases;
