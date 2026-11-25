import { describe, expect, test } from "bun:test";
import { CoreError } from "./errors";
import { WebCoreHost, type WorkerLike } from "./host-web";

// The web's CoreHost (PLAN-E2E-CLIENTES.md, the core's host and the web's worker), the page's side: what it posts to
// its worker and what it does with the answers, over a worker of the test's. The worker itself, with the core, OPFS and
// IndexedDB, is e2e-browser/host.cases.ts's.

const ana = "0193a4b2-0000-7000-8000-000000000001";

type Posted = { id: number; op: string } & Record<string, unknown>;
type Answer = Record<string, unknown> | undefined;

/** A worker that answers each message as `respond` says, a moment later, as a worker does; undefined answers nothing. */
class FakeWorker implements WorkerLike {
	readonly posted: Posted[] = [];
	terminated = false;
	#listeners = new Map<string, Set<(event: any) => void>>();

	constructor(readonly respond: (message: Posted, worker: FakeWorker) => Answer | Answer[]) {}

	postMessage(message: Posted) {
		this.posted.push(message);
		setTimeout(() => {
			const answers = this.respond(message, this);
			for (const answer of Array.isArray(answers) ? answers : [answers]) if (answer) this.answer(answer);
		}, 0);
	}

	addEventListener(type: string, listener: (event: any) => void) {
		const listeners = this.#listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.#listeners.set(type, listeners);
	}

	terminate() {
		this.terminated = true;
	}

	answer(data: Record<string, unknown>) {
		if (this.terminated) return;
		for (const listener of this.#listeners.get("message") ?? []) listener({ data });
	}

	fail() {
		for (const listener of this.#listeners.get("error") ?? []) listener({ message: "the worker failed" });
	}

	ops() {
		return this.posted.map((message) => message.op);
	}
}

/** What a worker with a core answers: opens, runs a command (its reply says which), closes. */
function core(message: Posted): Answer {
	const { id, op } = message;
	if (op === "open") return { id, reply: { ok: { state: "ready", keyStorage: "provided", times: {} } } };
	if (op === "handle") return { id, reply: { ok: { ran: message.command } } };
	if (op === "close" || op === "destroy") return { id, reply: { ok: {} } };
	return { id, reply: { error: { code: "bad_command", message: `no ${op}` } } };
}

/** A worker's answer to a call the core trapped on: the call is internal, and the worker ends. */
const trapped = (message: Posted): Answer => ({
	id: message.id,
	reply: { error: { code: "internal", message: "the core trapped" } },
	ended: true,
});

/** A host over workers made by `respond`, with what it started, and a page that has everything the core needs. */
function hostOver(respond: (message: Posted, worker: FakeWorker) => Answer | Answer[] = core) {
	const workers: FakeWorker[] = [];
	const host = new WebCoreHost({
		start: () => {
			const worker = new FakeWorker(respond);
			workers.push(worker);
			return worker;
		},
		missing: () => [],
	});
	return { host, workers };
}

const refusal = (promise: Promise<unknown>) =>
	promise.then(
		() => null,
		(error: unknown) => error,
	);

describe("the web's core host", () => {
	test("nothing starts before the host is first opened", async () => {
		const { host, workers } = hostOver();
		expect(workers).toHaveLength(0);
		expect(await host.open(ana)).toEqual({ state: "ready", keyStorage: "provided" });
		expect(workers).toHaveLength(1);
		expect(workers[0]?.posted[0]).toMatchObject({ op: "open", userId: ana });
	});

	test("without what the core needs, it says so and starts nothing", async () => {
		const workers: FakeWorker[] = [];
		const host = new WebCoreHost({
			start: () => {
				const worker = new FakeWorker(core);
				workers.push(worker);
				return worker;
			},
			missing: () => ["locks"],
		});
		expect(await host.open(ana)).toEqual({ state: "unsupported" });
		expect(workers).toHaveLength(0);
		expect(await refusal(host.handle({ cmd: "status" }))).toMatchObject({ code: "internal" });
	});

	test("a worker that can't open says why, and ends", async () => {
		for (const state of ["unsupported", "locked", "failed"] as const) {
			const { host, workers } = hostOver((message) =>
				message.op === "open" ? { id: message.id, reply: { ok: { state } } } : core(message),
			);
			expect(await host.open(ana)).toEqual({ state });
			expect(workers[0]?.terminated).toBe(true);
			expect(await refusal(host.handle({ cmd: "status" }))).toMatchObject({ code: "internal" });
			expect(workers).toHaveLength(1);
		}
	});

	test("a user's ID names a database, so only a UUID does", async () => {
		const { host, workers } = hostOver();
		expect(await refusal(host.open("../other"))).toMatchObject({ code: "bad_command", field: "user_id" });
		expect(workers).toHaveLength(0);
	});

	test("a reply settles its own request, whatever order they come in", async () => {
		const held: Posted[] = [];
		const { host, workers } = hostOver((message) => {
			if (message.op !== "handle") return core(message);
			held.push(message);
			return undefined;
		});
		await host.open(ana);
		const one = host.handle({ cmd: "one" });
		const two = host.handle({ cmd: "two" });
		await Bun.sleep(5);
		const worker = workers[0];
		const [first, second] = held;
		if (!worker || !first || !second) throw new Error("the worker didn't get both");
		worker.answer({ id: second.id, reply: { ok: "second" } });
		worker.answer({ id: first.id, reply: { error: { code: "gap", message: "a gap", from: 3 } } });
		expect(await two).toBe("second");
		const error = await refusal(one);
		expect(error).toBeInstanceOf(CoreError);
		expect(error).toMatchObject({ code: "gap", from: 3 });
	});

	test("the commands with ways of their own aren't handled", async () => {
		const { host, workers } = hostOver();
		await host.open(ana);
		for (const cmd of ["attachment_encrypt", "attachment_decrypt", "history_share", "catch_up", "history_import"]) {
			expect(await refusal(host.handle({ cmd }))).toMatchObject({ code: "bad_command", field: "cmd" });
		}
		expect(workers[0]?.ops()).toEqual(["open"]);
	});

	test("a call cut by the core's trap is internal, and the next call opens the core again first", async () => {
		const { host, workers } = hostOver((message, worker) =>
			message.op === "handle" && worker === workers[0] ? trapped(message) : core(message),
		);
		await host.open(ana);
		const cut = await refusal(host.handle({ cmd: "status" }));
		expect(cut).toBeInstanceOf(CoreError);
		expect(cut).toMatchObject({ code: "internal" });
		expect(workers[0]?.terminated).toBe(true);
		// The next call starts a worker, opens the same user's database, then runs.
		expect(await host.handle<{ ran: unknown }>({ cmd: "status" })).toEqual({ ran: { cmd: "status" } });
		expect(workers).toHaveLength(2);
		expect(workers[1]?.posted.map(({ op, userId }) => [op, userId])).toEqual([
			["open", ana],
			["handle", undefined],
		]);
	});

	test("every call a worker had when it failed is internal, and the next call opens again", async () => {
		const { host, workers } = hostOver((message) => (message.op === "handle" ? undefined : core(message)));
		await host.open(ana);
		const one = refusal(host.handle({ cmd: "one" }));
		const two = refusal(host.handle({ cmd: "two" }));
		await Bun.sleep(5);
		workers[0]?.fail();
		expect(await one).toMatchObject({ code: "internal" });
		expect(await two).toMatchObject({ code: "internal" });
		expect(workers[0]?.terminated).toBe(true);
		const next = host.handle({ cmd: "three" });
		await Bun.sleep(5);
		expect(workers[1]?.ops()).toEqual(["open", "handle"]);
		workers[1]?.answer({ id: workers[1].posted[1]?.id, reply: { ok: "three" } });
		expect(await next).toBe("three");
	});

	test("calls made while the core opens again wait for it, and one worker starts", async () => {
		const { host, workers } = hostOver((message, worker) =>
			message.op === "handle" && worker === workers[0] ? trapped(message) : core(message),
		);
		await host.open(ana);
		await refusal(host.handle({ cmd: "trap" }));
		const after = await Promise.all([host.handle({ cmd: "a" }), host.handle({ cmd: "b" })]);
		expect(after).toEqual([{ ran: { cmd: "a" } }, { ran: { cmd: "b" } }]);
		expect(workers).toHaveLength(2);
		expect(workers[1]?.ops()).toEqual(["open", "handle", "handle"]);
	});

	test("a core that doesn't open again fails the call, and the next call tries again", async () => {
		let reopenings = 0;
		const { host, workers } = hostOver((message, worker) => {
			if (message.op === "handle" && worker === workers[0]) return trapped(message);
			if (message.op === "open" && worker !== workers[0] && reopenings++ === 0) {
				return { id: message.id, reply: { ok: { state: "failed" } } };
			}
			return core(message);
		});
		await host.open(ana);
		await refusal(host.handle({ cmd: "trap" }));
		expect(await refusal(host.handle({ cmd: "status" }))).toMatchObject({ code: "internal" });
		expect(workers[1]?.terminated).toBe(true);
		expect(await host.handle<{ ran: unknown }>({ cmd: "status" })).toEqual({ ran: { cmd: "status" } });
		expect(workers).toHaveLength(3);
	});

	test("a file goes to the worker whole and comes back as the core sealed it, its progress told", async () => {
		const sealed = new Blob(["sealed"]);
		const { host, workers } = hostOver((message) => {
			if (message.op !== "seal") return core(message);
			return [
				{ id: message.id, progress: 65_536 },
				{ id: message.id, progress: 70_000 },
				{ id: message.id, reply: { ok: sealed } },
			];
		});
		await host.open(ana);
		const plain = new Blob([new Uint8Array(70_000)]);
		const progress: number[] = [];
		const made = await host.sealFile("a2V5", "0193a4b2-0000-7000-8000-0000000000f1", plain, (done) =>
			progress.push(done),
		);
		expect(made).toBe(sealed);
		expect(progress).toEqual([65_536, 70_000]);
		expect(workers[0]?.posted[1]).toMatchObject({
			op: "seal",
			key: "a2V5",
			attachmentId: "0193a4b2-0000-7000-8000-0000000000f1",
			file: plain,
		});
	});

	test("a package holds 64 parts at most", async () => {
		const { host, workers } = hostOver();
		await host.open(ana);
		const parts = Array.from({ length: 65 }, () => new Uint8Array(1));
		expect(await refusal(host.importShare("share", parts))).toMatchObject({ code: "too_large" });
		expect(workers[0]?.ops()).toEqual(["open"]);
	});

	test("close ends the worker, after its core closed, and its calls", async () => {
		const { host, workers } = hostOver((message) => (message.op === "handle" ? undefined : core(message)));
		await host.open(ana);
		const pending = refusal(host.handle({ cmd: "slow" }));
		await host.close();
		expect(workers[0]?.ops()).toEqual(["open", "handle", "close"]);
		expect(workers[0]?.terminated).toBe(true);
		expect(await pending).toMatchObject({ code: "internal" });
		expect(await refusal(host.handle({ cmd: "status" }))).toMatchObject({ code: "internal" });
		expect(workers).toHaveLength(1);
	});

	test("a worker that doesn't answer its close is ended all the same", async () => {
		const { host, workers } = hostOver((message) => (message.op === "close" ? undefined : core(message)));
		await host.open(ana);
		const started = performance.now();
		await host.close();
		expect(workers[0]?.terminated).toBe(true);
		expect(performance.now() - started).toBeLessThan(5_000);
	});

	test("destroy closes the core, then a new worker deletes the database and its key", async () => {
		const { host, workers } = hostOver();
		await host.open(ana);
		await host.destroy(ana);
		expect(workers[0]?.ops()).toEqual(["open", "close"]);
		expect(workers[0]?.terminated).toBe(true);
		expect(workers[1]?.posted).toMatchObject([{ op: "destroy", userId: ana }]);
		expect(workers[1]?.terminated).toBe(true);
		expect(await refusal(host.handle({ cmd: "status" }))).toMatchObject({ code: "internal" });
	});

	test("a worker that can't start: open says failed, and a reopen's call or a destroy is internal", async () => {
		const refused = () => {
			throw new DOMException("the page may not start this worker", "SecurityError");
		};
		const never = new WebCoreHost({ start: refused, missing: () => [] });
		expect(await never.open(ana)).toEqual({ state: "failed" });
		expect(await refusal(never.destroy(ana))).toMatchObject({ code: "internal" });

		// A core that opened, then trapped: the worker for its reopen can't start.
		let started = 0;
		const host = new WebCoreHost({
			start: () => {
				if (started++ > 0) refused();
				return new FakeWorker((message) => (message.op === "handle" ? trapped(message) : core(message)));
			},
			missing: () => [],
		});
		expect(await host.open(ana)).toEqual({ state: "ready", keyStorage: "provided" });
		expect(await refusal(host.handle({ cmd: "status" }))).toMatchObject({ code: "internal" });
		const reopened = await refusal(host.handle({ cmd: "status" }));
		expect(reopened).toBeInstanceOf(CoreError);
		expect(reopened).toMatchObject({ code: "internal" });
	});

	test("an open that made a database and failed has a new worker delete it and its key", async () => {
		const { host, workers } = hostOver((message) =>
			message.op === "open" ? { id: message.id, reply: { ok: { state: "failed", made: true } } } : core(message),
		);
		expect(await host.open(ana)).toEqual({ state: "failed" });
		expect(workers[0]?.terminated).toBe(true);
		expect(workers[1]?.posted).toMatchObject([{ op: "destroy", userId: ana }]);
		expect(workers[1]?.terminated).toBe(true);
		// One that found its database there and failed deletes nothing.
		const kept = hostOver((message) =>
			message.op === "open" ? { id: message.id, reply: { ok: { state: "failed" } } } : core(message),
		);
		expect(await kept.host.open(ana)).toEqual({ state: "failed" });
		expect(kept.workers).toHaveLength(1);
	});

	test("destroy tells what refused it", async () => {
		const { host } = hostOver((message) =>
			message.op === "destroy"
				? { id: message.id, reply: { error: { code: "locked", message: "another tab holds the databases" } } }
				: core(message),
		);
		expect(await refusal(host.destroy(ana))).toMatchObject({ code: "locked" });
	});
});
