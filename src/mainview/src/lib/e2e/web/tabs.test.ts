import { describe, expect, test } from "bun:test";
import { CoreError } from "../errors";
import { BrowserTabs, lockName, type ChannelLike, type LockManagerLike, type Methods } from "./tabs";

// The tabs' protocol (PLAN-E2E-CLIENTES.md, the web's worker, lock and tabs) over a channel and a lock of its own: the
// fakes below do what BroadcastChannel and navigator.locks do, as tabs.ts uses them. The browser's own, with the core,
// are e2e-browser/host.cases.ts's.

/**
 * navigator.locks for one name at a time: whoever asked first holds it until its callback settles. An abort takes a
 * request out of the line, and does nothing to one that holds the lock, as the API's does.
 */
class FakeLocks implements LockManagerLike {
	#queues = new Map<string, { callback: () => Promise<void>; resolve: (value: unknown) => void; granted?: true }[]>();
	#held = new Set<string>();

	request(name: string, { signal }: { signal: AbortSignal }, callback: () => Promise<void>): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const queue = this.#queues.get(name) ?? [];
			this.#queues.set(name, queue);
			const entry: { callback: () => Promise<void>; resolve: (value: unknown) => void; granted?: true } = {
				callback,
				resolve,
			};
			queue.push(entry);
			signal.addEventListener("abort", () => {
				const at = queue.indexOf(entry);
				if (at === -1 || entry.granted) return;
				queue.splice(at, 1);
				reject(new DOMException("aborted", "AbortError"));
			});
			this.#grant(name);
		});
	}

	#grant(name: string) {
		const next = this.#queues.get(name)?.[0];
		if (!next || this.#held.has(name)) return;
		this.#held.add(name);
		next.granted = true;
		void next
			.callback()
			.finally(() => {
				this.#queues.get(name)?.shift();
				this.#held.delete(name);
				this.#grant(name);
			})
			.then(next.resolve, next.resolve);
	}
}

/**
 * BroadcastChannel among the tabs of one test: each message, cloned as it's posted, reaches every other channel of its
 * name. What can't be cloned throws as it's posted, listeners or not; what a listener throws is kept, as an EventTarget
 * reports it and goes on.
 */
class FakeHub {
	#channels = new Set<{ name: string; listeners: Set<(event: { data: unknown }) => void> }>();
	/** Every message posted, in order. */
	readonly posted: unknown[] = [];
	/** What the listeners threw. */
	readonly thrown: unknown[] = [];

	channel(name: string): ChannelLike {
		const self = { name, listeners: new Set<(event: { data: unknown }) => void>() };
		this.#channels.add(self);
		return {
			postMessage: (message) => {
				const data = structuredClone(message);
				this.posted.push(message);
				for (const other of this.#channels) {
					if (other === self || other.name !== name) continue;
					setTimeout(() => {
						for (const listener of other.listeners) {
							try {
								listener({ data: structuredClone(data) });
							} catch (error) {
								this.thrown.push(error);
							}
						}
					}, 0);
				}
			},
			addEventListener: (_type, listener) => self.listeners.add(listener),
			close: () => this.#channels.delete(self),
		};
	}
}

const user = "0193a4b2-0000-7000-8000-000000000001";

/** A promise and its resolve, to hold a method or a lead until a test lets it go. */
function held<T = void>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((done) => (resolve = done));
	return { promise, resolve };
}

/** A tab of `user` on the test's hub and locks, serving `methods` while it leads. */
function tabOf(hub: FakeHub, locks: FakeLocks, name: string, methods: Methods = {}, lead = async () => {}) {
	const changed: string[] = [];
	const leaders: string[] = [];
	let led = 0;
	const tabs = new BrowserTabs({
		userId: user,
		tab: name,
		channel: hub.channel(lockName(user)),
		locks,
		methods: { whoami: () => name, ...methods },
		lead: async () => {
			led++;
			await lead();
		},
		onChanged: (conversation) => changed.push(conversation),
		onLeader: (tab) => leaders.push(tab),
	});
	return { tabs, changed, leaders, led: () => led };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("the tabs of one user", () => {
	test("the first tab leads, and the others ask it", async () => {
		const hub = new FakeHub();
		const locks = new FakeLocks();
		const a = tabOf(hub, locks, "a", { echo: (params) => ({ from: "a", params }) });
		await a.tabs.leading;
		const b = tabOf(hub, locks, "b", { echo: () => ({ from: "b" }) });
		expect(await b.tabs.call<{ from: string; params: unknown }>("echo", { n: 1 })).toEqual({
			from: "a",
			params: { n: 1 },
		});
		expect(await b.tabs.call<string>("whoami")).toBe("a");
		expect(a.led()).toBe(1);
		expect(b.led()).toBe(0);
		expect(a.tabs.leader).toBe(true);
		expect(b.tabs.leader).toBe(false);
	});

	test("the lock and the channel are the user's", () => {
		expect(lockName(user)).toBe(`duvet-e2e:${user}`);
	});

	test("one tab leads at a time, and the lock passes when its tab closes", async () => {
		const hub = new FakeHub();
		const locks = new FakeLocks();
		let leading = 0;
		let most = 0;
		const lead = async () => {
			leading++;
			most = Math.max(most, leading);
			await settle();
		};
		const a = tabOf(hub, locks, "a", {}, lead);
		const b = tabOf(hub, locks, "b", {}, lead);
		const c = tabOf(hub, locks, "c", {}, lead);
		await a.tabs.leading;
		await settle();
		expect([a.led(), b.led(), c.led()]).toEqual([1, 0, 0]);

		leading--;
		a.tabs.close();
		await b.tabs.leading;
		await settle();
		// The next in line leads, and says so to the others.
		expect([b.led(), c.led()]).toEqual([1, 0]);
		expect(c.leaders).toEqual(["a", "b"]);
		expect(await c.tabs.call<string>("whoami")).toBe("b");
		expect(most).toBe(1);
	});

	test("a request left unanswered is sent again to the tab that leads next", async () => {
		const hub = new FakeHub();
		const locks = new FakeLocks();
		const stuck = held<string>();
		const a = tabOf(hub, locks, "a", { slow: () => stuck.promise });
		await a.tabs.leading;
		const b = tabOf(hub, locks, "b", { slow: () => "b answered" });
		const c = tabOf(hub, locks, "c", { slow: () => "c answered" });
		const fromB = b.tabs.call("slow");
		const fromC = c.tabs.call("slow");
		await settle();
		// The leader got both and answers neither: it closes, as a tab does, with them still running.
		a.tabs.close();
		// b leads next: it runs its own request, and answers c's, which c sends again when b says it leads.
		expect(await fromB).toBe("b answered");
		expect(await fromC).toBe("b answered");
		// What the leader answers after it closed reaches nobody.
		stuck.resolve("a answered");
		await settle();
		expect(await c.tabs.call<string>("whoami")).toBe("b");
	});

	test("a request made while the lock passes is answered by the new tab", async () => {
		const hub = new FakeHub();
		const locks = new FakeLocks();
		const opening = held();
		const a = tabOf(hub, locks, "a");
		await a.tabs.leading;
		const b = tabOf(hub, locks, "b", {}, () => opening.promise);
		const c = tabOf(hub, locks, "c");
		a.tabs.close();
		await settle();
		// No tab answers while b opens its core: c's request waits for b.
		let answered = false;
		const fromC = c.tabs.call<string>("whoami").finally(() => (answered = true));
		await settle();
		expect(answered).toBe(false);
		opening.resolve();
		expect(await fromC).toBe("b");
		expect(b.led()).toBe(1);
	});

	test("an answer settles its request once, whoever answers again", async () => {
		const hub = new FakeHub();
		const locks = new FakeLocks();
		const a = tabOf(hub, locks, "a");
		await a.tabs.leading;
		const b = tabOf(hub, locks, "b");
		expect(await b.tabs.call<string>("whoami")).toBe("a");
		const request = hub.posted.find(
			(message) => typeof message === "object" && message !== null && "method" in message,
		);
		expect(request).toMatchObject({ method: "whoami", from: "b" });
		// The same request again, as a tab that led sends it to the next one: answered again, settled once.
		const twice = hub.channel(lockName(user));
		twice.postMessage(request);
		await settle();
		expect(await b.tabs.call<string>("whoami")).toBe("a");
	});

	test("errors come back as the core's, by their code", async () => {
		const hub = new FakeHub();
		const locks = new FakeLocks();
		const a = tabOf(hub, locks, "a", {
			missing: () => {
				throw new CoreError("not_found", "no such message", { what: "message" });
			},
			broken: () => {
				throw new TypeError("a bug");
			},
		});
		await a.tabs.leading;
		const b = tabOf(hub, locks, "b");
		const missing = await b.tabs.call("missing").catch((error: unknown) => error);
		expect(missing).toBeInstanceOf(CoreError);
		expect(missing).toMatchObject({ code: "not_found", what: "message", message: "no such message" });
		expect(await b.tabs.call("broken").catch((error: unknown) => error)).toMatchObject({ code: "internal" });
		expect(await b.tabs.call("nothing").catch((error: unknown) => error)).toMatchObject({
			code: "bad_command",
			field: "method",
		});
		// The leader's own call, which runs in place, fails the same way.
		expect(await a.tabs.call("missing").catch((error: unknown) => error)).toMatchObject({ code: "not_found" });
	});

	test("the leader's own calls run in place, and its changes reach the other tabs", async () => {
		const hub = new FakeHub();
		const locks = new FakeLocks();
		const a = tabOf(hub, locks, "a");
		await a.tabs.leading;
		const b = tabOf(hub, locks, "b");
		const before = hub.posted.length;
		expect(await a.tabs.call<string>("whoami")).toBe("a");
		expect(hub.posted.length).toBe(before);

		a.tabs.changed("0193a4b2-0000-7000-8000-0000000000c1");
		await settle();
		expect(b.changed).toEqual(["0193a4b2-0000-7000-8000-0000000000c1"]);
		expect(a.changed).toEqual([]);
	});

	test("a tab that closes stops answering, and its own calls fail", async () => {
		const hub = new FakeHub();
		const locks = new FakeLocks();
		const a = tabOf(hub, locks, "a");
		await a.tabs.leading;
		const b = tabOf(hub, locks, "b");
		const c = tabOf(hub, locks, "c");
		const stuck = c.tabs.call("whoami", undefined);
		c.tabs.close();
		expect(await stuck.catch((error: unknown) => error)).toMatchObject({ code: "internal" });
		expect(await c.tabs.call<string>("whoami").catch((error: unknown) => error)).toMatchObject({ code: "internal" });
		// c's place in line goes too: b leads after a, and nobody waits on c.
		a.tabs.close();
		await b.tabs.leading;
		expect(c.led()).toBe(0);
	});

	test("a request that can't be cloned is refused, and leaves nothing to stop the resends", async () => {
		const hub = new FakeHub();
		const locks = new FakeLocks();
		const stuck = held<string>();
		const a = tabOf(hub, locks, "a", { echo: () => stuck.promise });
		await a.tabs.leading;
		tabOf(hub, locks, "b", { echo: () => "b answered" });
		const c = tabOf(hub, locks, "c");
		const refused = await c.tabs.call("echo", { callback: () => 1 }).catch((error: unknown) => error);
		expect(refused).toBeInstanceOf(CoreError);
		expect(refused).toMatchObject({ code: "bad_command", field: "params" });
		// a gets c's next request and never answers it; b, leading next, gets it again.
		const next = c.tabs.call<string>("echo", { n: 1 });
		await settle();
		a.tabs.close();
		expect(await next).toBe("b answered");
	});

	test("a request that can't be cloned when it's sent again is refused, and the others still go", async () => {
		const hub = new FakeHub();
		const locks = new FakeLocks();
		const stuck = held<string>();
		const a = tabOf(hub, locks, "a", { echo: () => stuck.promise });
		await a.tabs.leading;
		tabOf(hub, locks, "b", { echo: (params) => params });
		const c = tabOf(hub, locks, "c");
		const params: Record<string, unknown> = { n: 1 };
		const changed = c.tabs.call("echo", params).catch((error: unknown) => error);
		const kept = c.tabs.call("echo", { n: 2 });
		await settle();
		// Changed after it went, by the code that made it: it can't be cloned any more.
		params.callback = () => 1;
		a.tabs.close();
		expect(await changed).toMatchObject({ code: "bad_command", field: "params" });
		expect(await kept).toEqual({ n: 2 });
	});

	test("an answer that can't be cloned comes back internal", async () => {
		const hub = new FakeHub();
		const locks = new FakeLocks();
		const a = tabOf(hub, locks, "a", { give: () => ({ callback: () => 1 }) });
		await a.tabs.leading;
		const b = tabOf(hub, locks, "b");
		const answer = await b.tabs.call("give").catch((error: unknown) => error);
		expect(answer).toBeInstanceOf(CoreError);
		expect(answer).toMatchObject({ code: "internal" });
	});

	test("a new leader's word sends the requests again before onLeader, which can't stop them", async () => {
		const hub = new FakeHub();
		const locks = new FakeLocks();
		const stuck = held<string>();
		const a = tabOf(hub, locks, "a", { echo: () => stuck.promise });
		await a.tabs.leading;
		tabOf(hub, locks, "b", { echo: () => "b answered" });
		const c = new BrowserTabs({
			userId: user,
			tab: "c",
			channel: hub.channel(lockName(user)),
			locks,
			methods: {},
			lead: async () => {},
			onLeader: () => {
				throw new Error("a callback that throws");
			},
		});
		const asked = c.call<string>("echo");
		await settle();
		a.tabs.close();
		expect(await asked).toBe("b answered");
		expect(hub.thrown).toHaveLength(1);
	});

	test("a tab that closes before it leads, or as it opens its core, says so in leading", async () => {
		const hub = new FakeHub();
		const locks = new FakeLocks();
		const a = tabOf(hub, locks, "a");
		await a.tabs.leading;
		const b = tabOf(hub, locks, "b");
		b.tabs.close();
		expect(await b.tabs.leading.catch((error: unknown) => error)).toMatchObject({ code: "internal" });
		const opening = held();
		const c = tabOf(hub, locks, "c", {}, () => opening.promise);
		a.tabs.close();
		await settle();
		expect(c.led()).toBe(1);
		c.tabs.close();
		opening.resolve();
		expect(await c.tabs.leading.catch((error: unknown) => error)).toMatchObject({ code: "internal" });
	});

	test("what another page posts on the channel is read past", async () => {
		const hub = new FakeHub();
		const locks = new FakeLocks();
		const a = tabOf(hub, locks, "a");
		await a.tabs.leading;
		const b = tabOf(hub, locks, "b");
		const stranger = hub.channel(lockName(user));
		for (const junk of [null, 7, "leader", { event: "leader" }, { id: 1, from: 2 }, { id: "x", to: "b", ok: 1 }]) {
			stranger.postMessage(junk);
		}
		await settle();
		expect(await b.tabs.call<string>("whoami")).toBe("a");
	});
});
